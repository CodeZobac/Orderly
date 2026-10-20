import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { postgresFixture } from "./postgres";
import { signIn, authenticate } from "../lib/auth";
import { mutate, snapshot } from "../lib/domain";
import { billing, previewBilling, listBilling } from "../lib/billing";
import {
  billingCsv,
  csvCell,
  exactDuration,
  money,
  taskSubtotals,
} from "../lib/billing-format";
import type { BillingBatch, BillingFilters } from "../lib/billing-types";
const hour = 3600000;
const from = Date.parse("2026-09-01T00:00:00Z");
const filters: BillingFilters = {
  from: "2026-09-01",
  to: "2026-09-03",
  timezone: "UTC",
  clientId: "",
  projectId: "",
};
async function fixture() {
  const { pg, db } = await postgresFixture();
  const owner = await authenticate(
    db,
    await signIn(
      db,
      "register",
      `${randomUUID()}@billing.test`,
      "long-billing-password",
    ),
  );
  const act = (input: Record<string, unknown>) =>
    mutate(db, owner, { ...input, key: randomUUID() });
  const bill = (command: string, input: Record<string, unknown> = {}) =>
    billing(db, owner, command, { ...input, key: input.key ?? randomUUID() });
  await act({ action: "client", name: "=Client" });
  const client = (await snapshot(db, owner)).clients[0];
  await act({
    action: "project",
    clientId: client.id,
    name: "Report",
    currency: "EUR",
    rate: "60",
  });
  const project = (await snapshot(db, owner)).projects[0];
  await act({ action: "task", projectId: project.id, name: "Delivery" });
  const task = (await snapshot(db, owner)).tasks[0];
  const manual = (start: number, end: number, billable = true) =>
    act({
      action: "manual",
      taskId: task.id,
      start,
      end,
      billable,
      notes: "@note",
    });
  return { pg, db, owner, act, bill, client, project, task, manual };
}
test("exact two billable hours plus one non-billable hour, immutable snapshot, summed CSV amounts and audited void/reissue", async () => {
  const f = await fixture();
  try {
    await f.manual(from, from + 2 * hour);
    await f.manual(from + 2 * hour, from + 3 * hour, false);
    const draft = await f.bill("draft", { filters });
    assert.equal(draft.snapshot.totals[0].minorAmount, "12000");
    assert.equal(draft.snapshot.totals[0].recordedMs, 3 * hour);
    assert.equal(draft.snapshot.totals[0].billableMs, 2 * hour);
    const payload = {
      batchId: draft.id,
      version: draft.version,
      reviewedLong: [],
      key: randomUUID(),
    };
    const [done, retry] = await Promise.all([
      f.bill("finalize", payload),
      f.bill("finalize", payload),
    ]);
    assert.deepEqual(done, retry);
    const stored = await billing(f.db, f.owner, "get", { batchId: done.id });
    const entry = (await snapshot(f.db, f.owner)).entries[0];
    await assert.rejects(
      f.act({ action: "delete", entryId: entry.id, version: entry.version }),
      /finalized report/,
    );
    await assert.rejects(
      f.bill("rate", {
        entryId: entry.id,
        version: entry.version,
        rate: "99",
        reason: "Correction",
      }),
      /finalized report/,
    );
    await f.act({ action: "rate", projectId: f.project.id, rate: "99" });
    await f.pg.query("update orderly_private.tasks set name=$1 where id=$2", [
      "Renamed later",
      f.task.id,
    ]);
    assert.deepEqual(
      (await billing(f.db, f.owner, "get", { batchId: stored.id })).snapshot,
      stored.snapshot,
    );
    assert.equal(
      (await previewBilling(f.db, f.owner, filters)).lines.length,
      0,
    );
    const csv = billingCsv(stored.snapshot, stored.id, stored.status);
    assert.match(csv, /"120.00"/);
    assert.match(csv, /"'=Client"/);
    assert.match(csv, /"'@note"/);
    assert.equal(
      taskSubtotals(stored.snapshot)[0].minorAmount.toString(),
      "12000",
    );
    await assert.rejects(
      f.bill("finalize", {
        batchId: done.id,
        version: done.version,
        reviewedLong: [],
      }),
      /already finalized/,
    );
    const voided = await f.bill("void", {
      batchId: done.id,
      version: done.version,
      reason: "Correct the notes",
    });
    assert.deepEqual(voided.snapshot, done.snapshot);
    assert.equal(
      (await previewBilling(f.db, f.owner, filters)).totals[0].minorAmount,
      "12000",
    );
    await f.bill("rate", {
      entryId: entry.id,
      version: entry.version,
      rate: "30",
      reason: "Agreed discount",
    });
    const history = await listBilling(f.db, f.owner);
    assert.ok(history.audit.some((a) => a.action === "void"));
    assert.ok(
      history.audit.some(
        (a) => a.action === "rate" && a.detail.reason === "Agreed discount",
      ),
    );
  } finally {
    await f.pg.close();
  }
});
test("overlapping drafts, stale reviews, adjacent midnight allocations and partially billed entry locks", async () => {
  const f = await fixture();
  try {
    await f.manual(from + 23 * hour, from + 25 * hour);
    const first = await f.bill("draft", {
      filters: { ...filters, to: "2026-09-02" },
    });
    const competing = await f.bill("draft", { filters });
    await f.bill("finalize", {
      batchId: first.id,
      version: first.version,
      reviewedLong: [],
    });
    await assert.rejects(
      f.bill("finalize", {
        batchId: competing.id,
        version: competing.version,
        reviewedLong: [],
      }),
      /changed/,
    );
    const refreshed = await f.bill("refresh", {
      batchId: competing.id,
      version: competing.version,
    });
    assert.equal(refreshed.snapshot.lines[0].start, from + 24 * hour);
    assert.equal(refreshed.snapshot.totals[0].billableMs, hour);
    assert.equal(refreshed.snapshot.alreadyAllocatedMs, hour);
    const second = await f.bill("finalize", {
      batchId: refreshed.id,
      version: refreshed.version,
      reviewedLong: [],
    });
    const entry = (await snapshot(f.db, f.owner)).entries[0];
    const firstDone = await billing(f.db, f.owner, "get", {
      batchId: first.id,
    });
    await f.bill("void", {
      batchId: firstDone.id,
      version: firstDone.version,
      reason: "Reissue first slice",
    });
    await assert.rejects(
      f.act({ action: "delete", entryId: entry.id, version: entry.version }),
      /finalized report/,
    );
    await f.bill("void", {
      batchId: second.id,
      version: second.version,
      reason: "Reissue second slice",
    });
    await f.act({
      action: "delete",
      entryId: entry.id,
      version: entry.version,
    });
  } finally {
    await f.pg.close();
  }
});
test("DST calendar boundaries, long-entry acknowledgments, running entries and separate currencies", async () => {
  const f = await fixture();
  try {
    const dstStart = Date.parse("2026-03-29T00:00:00Z");
    await f.manual(dstStart, dstStart + 23 * hour);
    const dst = {
      ...filters,
      from: "2026-03-29",
      to: "2026-03-30",
      timezone: "Europe/Lisbon",
    };
    const draft = await f.bill("draft", { filters: dst });
    assert.equal(draft.snapshot.end - draft.snapshot.start, 23 * hour);
    await assert.rejects(
      f.bill("finalize", {
        batchId: draft.id,
        version: draft.version,
        reviewedLong: [],
      }),
      /Explicitly review/,
    );
    await f.bill("finalize", {
      batchId: draft.id,
      version: draft.version,
      reviewedLong: draft.snapshot.longEntryIds,
    });
    await f.act({
      action: "project",
      clientId: f.client.id,
      name: "JPY work",
      currency: "JPY",
      rate: "60",
    });
    const project = (await snapshot(f.db, f.owner)).projects.find(
      (p) => p.currency === "JPY",
    )!;
    await f.act({ action: "task", projectId: project.id, name: "Meeting" });
    const task = (await snapshot(f.db, f.owner)).tasks.find(
      (t) => t.project_id === project.id,
    )!;
    await f.manual(from, from + hour);
    await f.act({
      action: "manual",
      taskId: task.id,
      start: from + hour,
      end: from + 2 * hour,
      billable: true,
    });
    const mixed = await previewBilling(f.db, f.owner, filters);
    assert.deepEqual(
      mixed.totals.map((t) => t.currency),
      ["EUR", "JPY"],
    );
    assert.equal(mixed.totals[1].digits, 0);
    assert.equal(mixed.totals[1].minorAmount, "60");
    await f.act({ action: "start", taskId: task.id });
    const today = new Date().toISOString().slice(0, 10),
      tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const running = await f.bill("draft", {
      filters: { ...filters, from: today, to: tomorrow },
    });
    assert.match(running.snapshot.issues[0].message, /running/);
    await assert.rejects(
      f.bill("finalize", {
        batchId: running.id,
        version: running.version,
        reviewedLong: [],
      }),
      /Resolve review issues/,
    );
  } finally {
    await f.pg.close();
  }
});
test("sum exact rationals then round currency total, largest remainders ensure every line adds up", async () => {
  const f = await fixture();
  try {
    await f.act({ action: "rate", projectId: f.project.id, rate: "0.01" });
    // Two 30-minute lines: .5 minor units each; line rounding would overbill.
    await f.manual(from, from + hour / 2);
    await f.manual(from + hour, from + hour * 1.5);
    const review = await previewBilling(f.db, f.owner, filters);
    assert.equal(review.totals[0].minorAmount, "1");
    assert.equal(
      review.lines.reduce((sum, l) => sum + BigInt(l.minorAmount), BigInt(0)),
      BigInt(1),
    );
    assert.equal(review.lines.filter((l) => l.minorAmount === "1").length, 1);
    assert.equal(money("900719925474099199", 2), "9007199254740991.99");
    assert.equal(exactDuration(3600001), "1:00:00.001");
    for (const value of ["=1+1", " +SUM(A1)", "\t@command", "-1", "\r=1"])
      assert.ok(csvCell(value).startsWith("\"'"));
  } finally {
    await f.pg.close();
  }
});
test("provider evidence cannot multiply time and later evidence changes cannot rewrite final reports", async () => {
  const f = await fixture();
  try {
    await f.manual(from, from + 2 * hour);
    for (const provider of ["asana", "notion", "github"]) {
      await f.pg.query(
        "insert into orderly_private.connections(id,user_id,provider,account_id,label) values($1,$2,$3,$3,$3)",
        [provider, f.owner, provider],
      );
      await f.pg.query(
        "insert into orderly_private.sources(id,user_id,connection_id,external_id,name,project_id,mapping) values($1,$2,$1,$1,$1,$3,$4)",
        [provider, f.owner, f.project.id, "{}"],
      );
    }
    for (const provider of ["asana", "notion"])
      await f.pg.query(
        "insert into orderly_private.external_tasks(id,user_id,connection_id,external_id,task_id,metadata) values($1,$2,$1,$1,$3,$4)",
        [
          provider,
          f.owner,
          f.task.id,
          JSON.stringify({
            name: provider,
            url: `https://example.com/${provider}`,
          }),
        ],
      );
    for (const id of ["one", "two"]) {
      await f.pg.query(
        "insert into orderly_private.pull_requests(id,user_id,source_id,external_id,metadata,seen_run) values($1,$2,'github',$1,$3,'fixture')",
        [
          id,
          f.owner,
          JSON.stringify({
            title: id,
            url: `https://github.com/example/repo/pull/${id}`,
          }),
        ],
      );
      await f.pg.query(
        "insert into orderly_private.pr_links values($1,$2,$3,'confirmed','Explicit')",
        [id, f.task.id, f.owner],
      );
    }
    const draft = await f.bill("draft", { filters });
    assert.equal(draft.snapshot.lines[0].evidence.length, 4);
    const done = await f.bill("finalize", {
      batchId: draft.id,
      version: draft.version,
      reviewedLong: [],
    });
    await f.pg.exec(
      "update orderly_private.pull_requests set metadata='{}',available=false; update orderly_private.external_tasks set metadata='{}';",
    );
    const loaded = await billing(f.db, f.owner, "get", { batchId: done.id });
    assert.deepEqual(loaded.snapshot, done.snapshot);
    assert.equal(loaded.snapshot.totals[0].minorAmount, "12000");
  } finally {
    await f.pg.close();
  }
});
test("billing ownership, optimistic revisions and private grants", async () => {
  const f = await fixture();
  try {
    await f.manual(from, from + hour);
    const draft = await f.bill("draft", { filters });
    const other = await authenticate(
      f.db,
      await signIn(
        f.db,
        "register",
        `${randomUUID()}@other.test`,
        "long-other-password",
      ),
    );
    await assert.rejects(
      billing(f.db, other, "get", { batchId: draft.id }),
      /not found/,
    );
    await assert.rejects(
      billing(f.db, other, "preview", {
        filters: { ...filters, projectId: f.project.id },
      }),
      /not found/,
    );
    await assert.rejects(
      f.bill("finalize", { batchId: draft.id, version: 99, reviewedLong: [] }),
      /changed/,
    );
    const check = await f.pg.query<{ exposed: boolean }>(
      "select has_function_privilege('anon','public.orderly_billing(text,text,jsonb)','execute') or has_table_privilege('authenticated','orderly_private.billing_batches','select') exposed",
    );
    assert.equal(check.rows[0].exposed, false);
    const done: BillingBatch = await f.bill("finalize", {
      batchId: draft.id,
      version: draft.version,
      reviewedLong: [],
    });
    await assert.rejects(
      f.pg.query(
        "update orderly_private.billing_batches set snapshot='{}' where id=$1",
        [done.id],
      ),
      /immutable/,
    );
  } finally {
    await f.pg.close();
  }
});

test("25-hour autumn day, 3/4-decimal currency precision, zero rate and currency mismatch review", async () => {
  const f = await fixture();
  try {
    const autumn = {
      ...filters,
      from: "2025-10-26",
      to: "2025-10-27",
      timezone: "Europe/Lisbon",
    };
    const review = await previewBilling(f.db, f.owner, autumn);
    assert.equal(review.end - review.start, 25 * hour);
    for (const [currency, digits, amount] of [
      ["BHD", 3, "1250"],
      ["CLF", 4, "12500"],
    ] as const) {
      await f.act({
        action: "project",
        clientId: f.client.id,
        name: currency,
        currency,
        rate: "1.25",
      });
      const project = (await snapshot(f.db, f.owner)).projects.find(
        (p) => p.currency === currency,
      )!;
      await f.act({ action: "task", projectId: project.id, name: currency });
      const task = (await snapshot(f.db, f.owner)).tasks.find(
        (t) => t.project_id === project.id,
      )!;
      const offset = digits * hour;
      await f.act({
        action: "manual",
        taskId: task.id,
        start: from + offset,
        end: from + offset + hour,
        billable: true,
      });
      const total = (await previewBilling(f.db, f.owner, filters)).totals.find(
        (t) => t.currency === currency,
      )!;
      assert.equal(total.digits, digits);
      assert.equal(total.minorAmount, amount);
    }
    await f.act({ action: "rate", projectId: f.project.id, rate: "0" });
    await f.manual(from, from + hour);
    const zero = await previewBilling(f.db, f.owner, filters);
    assert.equal(
      zero.totals.find((t) => t.currency === "EUR")!.minorAmount,
      "0",
    );
    const entry = (await snapshot(f.db, f.owner)).entries.find(
      (e) => e.task_id === f.task.id,
    )!;
    await f.pg.query(
      "update orderly_private.entries set currency='ZZZ' where id=$1",
      [entry.id],
    );
    const invalid = await f.bill("draft", { filters });
    assert.ok(invalid.snapshot.issues.some((i) => i.entryId === entry.id));
    await assert.rejects(
      f.bill("finalize", {
        batchId: invalid.id,
        version: invalid.version,
        reviewedLong: [],
      }),
      /Resolve review issues/,
    );
  } finally {
    await f.pg.close();
  }
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { postgresFixture } from "./postgres";
import { mutate, snapshot } from "../lib/domain";
import { signIn, authenticate } from "../lib/auth";
import { dailyTotals, weekDays } from "../lib/time";
import type { Entry } from "../lib/types";
async function fixture() {
  const { pg, db } = await postgresFixture();
  const token = await signIn(
    db,
    "register",
    `${randomUUID()}@test.local`,
    "long-test-password",
  );
  const user = await authenticate(db, token);
  const act = (input: Record<string, unknown>, now = Date.now()) =>
    mutate(db, user, { ...input, key: input.key || randomUUID() }, now);
  await act({ action: "client", name: "Studio" });
  const client = (await snapshot(db, user)).clients[0];
  await act({
    action: "project",
    clientId: client.id,
    name: "Website",
    currency: "EUR",
    rate: "75.25",
  });
  const project = (await snapshot(db, user)).projects[0];
  await act({ action: "task", projectId: project.id, name: "Design" });
  await act({ action: "task", projectId: project.id, name: "Build" });
  const tasks = (await snapshot(db, user)).tasks;
  return { pg, db, user, act, project, tasks };
}
test("retry keys, shared PostgreSQL state, stale switch, repeated stop and refresh preserve one timer", async () => {
  const { pg, db, user, act, tasks } = await fixture();
  const other = db;
  const now = Date.now() - 10000;
  try {
    const input = { action: "start", taskId: tasks[0].id, key: randomUUID() };
    const result = await act(input, now);
    assert.deepEqual(await act(input, now + 1000), result);
    await assert.rejects(
      async () =>
        mutate(
          other,
          user,
          { action: "start", taskId: tasks[1].id, key: randomUUID() },
          now + 1000,
        ),
      /already running/,
    );
    const entry = (await snapshot(other, user)).entries[0];
    assert.equal(entry.start, now);
    await act(
      { action: "switch", entryId: entry.id, taskId: tasks[1].id },
      now + 2000,
    );
    await assert.rejects(
      async () =>
        await act(
          { action: "switch", entryId: entry.id, taskId: tasks[0].id },
          now + 3000,
        ),
      /changed/,
    );
    await act({ action: "stop", entryId: entry.id }, now + 4000);
    assert.equal(
      (await snapshot(db, user)).entries.filter((e) => e.end === null).length,
      1,
    );
    const active = (await snapshot(db, user)).entries.find(
      (e) => e.end === null,
    )!;
    await act({ action: "stop", entryId: active.id }, now + 5000);
    await act({ action: "stop", entryId: active.id }, now + 6000);
    assert.equal((await snapshot(other, user)).entries.length, 2);
    assert.equal(
      (await snapshot(db, user)).entries.find((e) => e.id === active.id)!.end,
      now + 5000,
    );
  } finally {
    await pg.close();
  }
});
test("manual interval validation, boundaries, active overlap and rate snapshots", async () => {
  const { pg, db, user, act, project, tasks } = await fixture();
  const base = Date.now() - 100000;
  const manual = async (start: number, end: number) =>
    await act({
      action: "manual",
      taskId: tasks[0].id,
      start,
      end,
      billable: true,
      notes: "Work",
    });
  await assert.rejects(async () => manual(base + 1000, base), /after start/);
  await manual(base, base + 1000);
  await manual(base + 1000, base + 2000);
  await assert.rejects(async () => manual(base + 500, base + 1500), /overlaps/);
  await act({ action: "rate", projectId: project.id, rate: "100.00" });
  assert.equal((await snapshot(db, user)).entries[0].rate, 7525);
  await act({ action: "start", taskId: tasks[0].id }, base + 3000);
  await assert.rejects(
    async () => manual(base + 2000, base + 4000),
    /overlaps/,
  );
  assert.equal(
    (await snapshot(db, user)).entries.find((e) => e.end === null)!.rate,
    10000,
  );
  await pg.close();
});
test("ownership isolation, authentication, correction audit, optimistic versions and undo", async () => {
  const { pg, db, user, act, tasks } = await fixture();
  const other = await authenticate(
    db,
    await signIn(db, "register", "other@test.local", "another-password"),
  );
  const base = Date.now() - 10000;
  assert.equal((await snapshot(db, other)).tasks.length, 0);
  await assert.rejects(
    async () =>
      mutate(db, other, {
        action: "start",
        taskId: tasks[0].id,
        key: randomUUID(),
      }),
    /not found/,
  );
  await act({
    action: "manual",
    taskId: tasks[0].id,
    start: base,
    end: base + 2000,
    billable: true,
  });
  const entry = (await snapshot(db, user)).entries[0];
  await assert.rejects(
    async () =>
      mutate(db, other, {
        action: "delete",
        entryId: entry.id,
        version: 1,
        key: randomUUID(),
      }),
    /not found/,
  );
  await act({
    action: "edit",
    entryId: entry.id,
    version: 1,
    taskId: entry.task_id,
    start: base,
    end: base + 3000,
    billable: false,
    notes: "Corrected",
  });
  await assert.rejects(
    async () => act({ action: "delete", entryId: entry.id, version: 1 }),
    /changed/,
  );
  await act({ action: "delete", entryId: entry.id, version: 2 });
  assert.equal((await snapshot(db, user)).entries.length, 0);
  await act({ action: "restore", entryId: entry.id, version: 3 });
  assert.equal((await snapshot(db, user)).entries[0].billable, 0);
  assert.equal((await snapshot(db, user)).audit.length, 4);
  await assert.rejects(async () => authenticate(db, "bad"), /expired/);
  await assert.rejects(
    async () => signIn(db, "login", "other@test.local", "wrong-password"),
    /incorrect/,
  );
  await pg.close();
});
const entry = (start: string, end: string | null) =>
  ({ start: Date.parse(start), end: end ? Date.parse(end) : null }) as Entry;
test("DST spring/fall and midnight daily splits preserve exact elapsed time", async () => {
  const spring = dailyTotals(
    [entry("2026-03-29T00:00:00Z", "2026-03-29T23:00:00Z")],
    "Europe/Lisbon",
  );
  assert.equal(spring["2026-03-29"], 23 * 3600000);
  const fall = dailyTotals(
    [entry("2026-10-24T23:00:00Z", "2026-10-26T00:00:00Z")],
    "Europe/Lisbon",
  );
  assert.equal(fall["2026-10-25"], 25 * 3600000);
  const split = dailyTotals(
    [
      entry("2026-01-01T23:30:00Z", "2026-01-02T00:30:00Z"),
      entry("2026-01-03T00:00:00Z", null),
    ],
    "UTC",
  );
  assert.deepEqual(split, { "2026-01-01": 1800000, "2026-01-02": 1800000 });
  assert.equal(
    weekDays(Date.parse("2026-01-04T23:00:00Z"), "UTC")[0],
    "2025-12-29",
  );
});

test("durable rate history, retry payload binding and throttled authentication", async () => {
  const { pg, db, user, act, project, tasks } = await fixture();
  await act({ action: "rate", projectId: project.id, rate: "99.95" });
  assert.equal(
    Number(
      (
        await pg.query<{ count: number }>(
          "SELECT COUNT(*) AS count FROM orderly_private.project_rates WHERE user_id=$1 AND project_id=$2",
          [user, project.id],
        )
      ).rows[0].count,
    ),
    2,
  );
  const key = randomUUID();
  await act({ action: "timezone", timezone: "Europe/Lisbon", key });
  await assert.rejects(
    async () => act({ action: "timezone", timezone: "UTC", key }),
    /already used/,
  );
  await assert.rejects(
    async () => act({ action: "timezone", timezone: "Invalid/Timezone" }),
    /valid IANA/,
  );
  const before = (await snapshot(db, user)).entries.length;
  await assert.rejects(
    async () =>
      await act({
        action: "manual",
        taskId: tasks[0].id,
        start: Date.now() - 1000,
        end: Date.now() + 100000,
        billable: true,
      }),
    /timestamp/,
  );
  assert.equal((await snapshot(db, user)).entries.length, before);
  for (let i = 0; i < 10; i++)
    await assert.rejects(
      async () =>
        signIn(db, "login", "missing@test.local", "incorrect-password"),
      /incorrect/,
    );
  await assert.rejects(
    async () => signIn(db, "login", "missing@test.local", "incorrect-password"),
    /Too many/,
  );
  await pg.close();
});

test("private schema, RPC privileges and concurrent retry requests", async () => {
  const { pg, db, user, act, tasks } = await fixture();
  try {
    const access = await pg.query<{ role: string; allowed: boolean }>(
      `select role, has_function_privilege(role,'public.orderly_snapshot(text)','EXECUTE') as allowed from unnest(array['anon','authenticated','service_role']) role`,
    );
    assert.deepEqual(
      access.rows.map((r) => r.allowed),
      [false, false, true],
    );
    const rls = await pg.query<{ enabled: boolean }>(
      "select bool_and(relrowsecurity) as enabled from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='orderly_private' and relkind='r'",
    );
    assert.equal(rls.rows[0].enabled, true);
    for (const role of ["anon", "authenticated"]) {
      await assert.rejects(
        () =>
          pg.transaction(async (tx) => {
            await tx.exec(`set local role ${role}`);
            await tx.query("select public.orderly_snapshot($1)", [user]);
          }),
        /permission denied/,
      );
      await assert.rejects(
        () =>
          pg.transaction(async (tx) => {
            await tx.exec(`set local role ${role}`);
            await tx.query("select * from orderly_private.users");
          }),
        /permission denied/,
      );
    }
    const key = randomUUID();
    const input = { action: "start", taskId: tasks[0].id, key };
    const results = await Promise.all([act(input), act(input)]);
    assert.deepEqual(results[0], results[1]);
    assert.equal((await snapshot(db, user)).entries.length, 1);
    const before = (await snapshot(db, user)).entries[0];
    await assert.rejects(
      () =>
        act(
          { action: "switch", entryId: before.id, taskId: "missing" },
          before.start + 1000,
        ),
      /not found/,
    );
    assert.equal((await snapshot(db, user)).entries[0].end, null);
  } finally {
    await pg.close();
  }
});

test("SQLite import preserves identities, password hashes, sessions and history atomically", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const { mkdtempSync, readFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join, resolve } = await import("node:path");
  const { readLegacyDatabase } = await import("../scripts/import-sqlite");
  const { tokenHash } = await import("../lib/auth");
  const { scryptSync } = await import("node:crypto");
  const dir = mkdtempSync(join(tmpdir(), "orderly-import-"));
  const file = join(dir, "legacy.sqlite");
  const sqlite = new DatabaseSync(file);
  const { pg, db } = await postgresFixture();
  try {
    sqlite.exec(readFileSync(resolve("migrations/001-foundation.sql"), "utf8"));
    sqlite.exec(
      readFileSync(resolve("migrations/002-rate-history.sql"), "utf8"),
    );
    const hash =
      "salt:" + scryptSync("legacy-password", "salt", 64).toString("hex");
    sqlite
      .prepare("insert into users(id,email,password) values(?,?,?)")
      .run("legacy", "legacy@test.local", hash);
    sqlite
      .prepare("insert into sessions values(?,?,?)")
      .run(tokenHash("legacy-token"), "legacy", Date.now() + 60000);
    sqlite
      .prepare("insert into clients values(?,?,?)")
      .run("client", "legacy", "Imported");
    sqlite
      .prepare("insert into projects values(?,?,?,?,?,?)")
      .run("project", "legacy", "client", "Project", "EUR", 7500);
    sqlite
      .prepare("insert into tasks values(?,?,?,?)")
      .run("task", "legacy", "project", "Work");
    sqlite
      .prepare(
        "insert into entries(id,user_id,task_id,start,end,rate,currency) values(?,?,?,?,?,?,?)",
      )
      .run("entry", "legacy", "task", 1000, 2000, 7500, "EUR");
    const data = readLegacyDatabase(file);
    await db.rpc("orderly_import", { data });
    assert.equal(await authenticate(db, "legacy-token"), "legacy");
    assert.equal(
      await authenticate(
        db,
        await signIn(db, "login", "legacy@test.local", "legacy-password"),
      ),
      "legacy",
    );
    assert.equal((await snapshot(db, "legacy")).entries[0].rate, 7500);
    await assert.rejects(() => db.rpc("orderly_import", { data }), /empty/);
    assert.equal((await snapshot(db, "legacy")).entries.length, 1);
  } finally {
    sqlite.close();
    await pg.close();
    rmSync(dir, { recursive: true });
  }
});

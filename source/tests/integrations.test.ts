import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { encrypt, decrypt, signature } from "../lib/integration-crypto";
import {
  importPage,
  normalizeAsana,
  normalizeNotion,
  validateMapping,
  ProviderError,
} from "../lib/providers";
import { integrationRpc, syncRpc, workOnce } from "../lib/integrations";
import type { Integrations, SourceOption } from "../lib/integration-types";
import { postgresFixture } from "./postgres";
import { signIn, authenticate } from "../lib/auth";
import { tokenHash } from "../lib/auth";
import { mutate, snapshot } from "../lib/domain";

test("OAuth states are session-bound, short-lived, provider-specific and single-use", async () => {
  const { pg, db } = await postgresFixture();
  try {
    const token = await signIn(
        db,
        "register",
        `${randomUUID()}@test.local`,
        "long-fixture-password",
      ),
      owner = await authenticate(db, token);
    await integrationRpc(db, owner, "state", {
      hash: "state",
      provider: "asana",
      verifier: "encrypted",
      session: tokenHash(token),
    });
    await assert.rejects(
      () => syncRpc(db, "consume_state", { hash: "state", provider: "notion" }),
      /expired|used/,
    );
    const consumed = await syncRpc<{ user_id: string }>(db, "consume_state", {
      hash: "state",
      provider: "asana",
    });
    assert.equal(consumed.user_id, owner);
    await assert.rejects(
      () => syncRpc(db, "consume_state", { hash: "state", provider: "asana" }),
      /expired|used/,
    );
    await integrationRpc(db, owner, "state", {
      hash: "expired",
      provider: "notion",
      verifier: "encrypted",
      session: tokenHash(token),
    });
    await pg.query(
      "update orderly_private.oauth_states set expires=0 where hash=$1",
      ["expired"],
    );
    await assert.rejects(
      () =>
        syncRpc(db, "consume_state", { hash: "expired", provider: "notion" }),
      /expired|used/,
    );
    await integrationRpc(db, owner, "state", {
      hash: "logout",
      provider: "notion",
      verifier: "encrypted",
      session: tokenHash(token),
    });
    await db.rpc("orderly_auth", {
      command: "logout",
      input: { token: tokenHash(token) },
    });
    await assert.rejects(
      () =>
        syncRpc(db, "consume_state", { hash: "logout", provider: "notion" }),
      /Sign in/,
    );
  } finally {
    await pg.close();
  }
});

test("multi-home imports require explicit attribution; provider titles never merge across connections", async () => {
  const { pg, db } = await postgresFixture();
  try {
    const token = await signIn(
        db,
        "register",
        `${randomUUID()}@test.local`,
        "long-fixture-password",
      ),
      owner = await authenticate(db, token);
    const act = (input: Record<string, unknown>) =>
      mutate(db, owner, { ...input, key: randomUUID() });
    await act({ action: "client", name: "Client" });
    await act({
      action: "project",
      clientId: (await snapshot(db, owner)).clients[0].id,
      name: "Billing",
      currency: "EUR",
      rate: "12.00",
    });
    const project = (await snapshot(db, owner)).projects[0];
    for (const provider of ["asana", "notion"]) {
      const connectionId = await integrationRpc<string>(db, owner, "connect", {
        provider,
        account: provider,
        label: provider,
        credentials: "encrypted",
      });
      await integrationRpc(db, owner, "map", {
        connectionId,
        externalId: provider,
        name: provider,
        projectId: project.id,
        mapping: {},
      });
      const claim = await syncRpc<{ job: { id: string; lease: string } }>(
        db,
        "claim",
        { lease: randomUUID() },
      );
      await syncRpc(db, "page", {
        jobId: claim.job.id,
        lease: claim.job.lease,
        cursor: null,
        tasks: [
          {
            id: "same-id",
            name: "Same title",
            ambiguous: provider === "asana",
            archived: false,
            status: "Open",
          },
        ],
      });
    }
    const state = await integrationRpc<Integrations>(db, owner, "list");
    assert.equal(state.tasks.length, 2);
    const ambiguous = state.tasks.find((t) => t.metadata.ambiguous)!;
    assert.equal(ambiguous.task_id, null);
    assert.equal((await snapshot(db, owner)).tasks.length, 1);
    const created = await integrationRpc<string>(db, owner, "link", {
      externalTaskId: ambiguous.id,
      projectId: project.id,
    });
    assert.equal((await snapshot(db, owner)).tasks.length, 2);
    await act({ action: "start", taskId: created });
    assert.equal((await snapshot(db, owner)).entries.length, 1);
    await assert.rejects(
      () =>
        integrationRpc(db, owner, "link", {
          externalTaskId: ambiguous.id,
          taskId: state.tasks.find((t) => !t.metadata.ambiguous)!.task_id,
        }),
      /recorded time/,
    );
  } finally {
    await pg.close();
  }
});

test("stable properties survive renames; incompatible types require remapping; multi-home Asana is ambiguous", () => {
  const source: SourceOption = {
    id: "source",
    name: "Work",
    properties: [
      { id: "title", name: "Renamed", type: "title" },
      { id: "s%3A", name: "Progress", type: "select" },
    ],
  };
  const mapping = { title: "title", status: "s%3A" };
  validateMapping("notion", source, mapping);
  const task = normalizeNotion(
    {
      id: "page",
      properties: {
        Renamed: { id: "title", title: [{ plain_text: "Task" }] },
        Progress: { id: "s%3A", type: "select", select: { name: "Doing" } },
      },
    },
    mapping,
  );
  assert.equal(task.name, "Task");
  assert.equal(task.status, "Doing");
  source.properties[1].type = "number";
  assert.throws(() => validateMapping("notion", source, mapping), /Remap/);
  assert.equal(
    normalizeAsana(
      {
        gid: "a",
        name: "Task",
        memberships: [{ project: { gid: "one" } }, { project: { gid: "two" } }],
      },
      "one",
      {},
    ).ambiguous,
    true,
  );
});

test("credentials are encrypted and authenticated; raw webhook signatures reject tampering", () => {
  const old = process.env.ORDERLY_INTEGRATION_KEY;
  process.env.ORDERLY_INTEGRATION_KEY = "01".repeat(32);
  try {
    const encrypted = encrypt({ access_token: "fixture-secret" });
    assert.equal(encrypted.includes("fixture-secret"), false);
    assert.deepEqual(decrypt(encrypted), { access_token: "fixture-secret" });
    const parts = encrypted.split(".");
    parts[3] = Buffer.from("invalid").toString("base64url");
    assert.throws(() => decrypt(parts.join(".")));
    const raw = '{ "id": "event" }',
      secret = "fixture-hook";
    const signed = createHmac("sha256", secret).update(raw).digest("hex");
    assert.equal(signature(raw, secret, signed), true);
    assert.equal(
      signature(JSON.stringify(JSON.parse(raw)), secret, signed),
      false,
    );
    assert.equal(signature(raw, secret, "bad"), false);
    assert.equal(signature(raw, secret, "sha256=" + signed, "sha256="), true);
  } finally {
    if (old === undefined) delete process.env.ORDERLY_INTEGRATION_KEY;
    else process.env.ORDERLY_INTEGRATION_KEY = old;
  }
});

test("provider pagination is bounded to one page; rate limits and revoked source access are classified", async () => {
  const original = globalThis.fetch,
    urls: string[] = [];
  let failure = 0;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    urls.push(url);
    if (failure)
      return new Response("{}", {
        status: failure,
        headers: { "Retry-After": "120" },
      });
    if (url.includes("/projects/"))
      return Response.json({ data: { gid: "source", name: "Work" } });
    if (url.includes("/tasks?"))
      return Response.json({
        data: [
          {
            gid: "task",
            name: "Asana",
            memberships: [{ project: { gid: "source" } }],
          },
        ],
        next_page: { offset: "second" },
      });
    if (!url.endsWith("/query"))
      return Response.json({
        id: "source",
        title: [],
        properties: { Name: { id: "title", type: "title" } },
      });
    assert.equal(
      new Headers(init?.headers).get("Notion-Version"),
      "2026-03-11",
    );
    assert.equal(JSON.parse(String(init?.body)).start_cursor, "second");
    return Response.json({
      results: [
        {
          id: "page",
          properties: {
            Name: { id: "title", title: [{ plain_text: "Notion" }] },
          },
        },
      ],
      has_more: true,
      next_cursor: "third",
    });
  };
  try {
    const asana = await importPage(
      "asana",
      { access_token: "fixture" },
      "source",
      {},
      "first",
    );
    assert.equal(asana.cursor, "second");
    assert.ok(urls[1].includes("offset=first"));
    const notion = await importPage(
      "notion",
      { access_token: "fixture" },
      "source",
      { title: "title" },
      "second",
    );
    assert.equal(notion.cursor, "third");
    assert.equal(notion.tasks[0].name, "Notion");
    failure = 429;
    await assert.rejects(
      () => importPage("asana", { access_token: "fixture" }, "source", {}),
      (e) => e instanceof ProviderError && e.delay === 120000,
    );
    failure = 404;
    await assert.rejects(
      () =>
        importPage("notion", { access_token: "fixture" }, "source", {
          title: "title",
        }),
      (e) => e instanceof ProviderError && e.kind === "inaccessible",
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("durable imports dedupe tasks/events; leases, ownership, history and disconnect are preserved", async () => {
  const { pg, db } = await postgresFixture();
  try {
    const token = await signIn(
        db,
        "register",
        `${randomUUID()}@test.local`,
        "long-fixture-password",
      ),
      owner = await authenticate(db, token);
    const act = (input: Record<string, unknown>, now = Date.now()) =>
      mutate(db, owner, { ...input, key: randomUUID() }, now);
    await act({ action: "client", name: "Client" });
    const client = (await snapshot(db, owner)).clients[0];
    await act({
      action: "project",
      clientId: client.id,
      name: "Project",
      currency: "EUR",
      rate: "75.25",
    });
    const project = (await snapshot(db, owner)).projects[0];
    const connectionId = await integrationRpc<string>(db, owner, "connect", {
      provider: "asana",
      account: "account",
      label: "Fixture",
      credentials: "encrypted-fixture",
    });
    const sourceId = await integrationRpc<string>(db, owner, "map", {
      connectionId,
      externalId: "source",
      name: "Work",
      projectId: project.id,
      mapping: {},
    });
    type Claim = { job: { id: string; lease: string }; source: { id: string } };
    const claim = () => syncRpc<Claim>(db, "claim", { lease: randomUUID() });
    const save = (j: Claim, tasks: unknown[]) =>
      syncRpc(db, "page", {
        jobId: j.job.id,
        lease: j.job.lease,
        tasks,
        cursor: null,
      });
    const task = {
      id: "external",
      name: "Imported",
      url: "https://app.asana.com/0/1/2",
      status: "Open",
      ambiguous: false,
      archived: false,
    };
    const first = await claim();
    assert.ok(first);
    assert.equal(await syncRpc(db, "claim", { lease: randomUUID() }), null);
    await save(first, [task]);
    const imported = (await snapshot(db, owner)).tasks[0];
    const now = Date.now() - 10000;
    await act({ action: "start", taskId: imported.id }, now);
    const entry = (await snapshot(db, owner)).entries[0];
    await act({ action: "stop", entryId: entry.id }, now + 5000);
    const before = (await snapshot(db, owner)).entries;
    await syncRpc(db, "event", { connectionId, sourceId, eventId: "event" });
    await syncRpc(db, "event", { connectionId, sourceId, eventId: "event" });
    await save(await claim(), [
      { ...task, name: "Renamed", status: "Completed" },
    ]);
    assert.equal((await snapshot(db, owner)).tasks.length, 1);
    assert.deepEqual((await snapshot(db, owner)).entries, before);
    assert.equal((await snapshot(db, owner)).tasks[0].name, "Renamed");
    await integrationRpc(db, owner, "resync", { connectionId, sourceId });
    await save(await claim(), []);
    assert.equal(
      (await snapshot(db, owner)).tasks[0].external?.[0].available,
      false,
    );
    await integrationRpc(db, owner, "resync", { connectionId, sourceId });
    const retired = await claim();
    await integrationRpc(db, owner, "disconnect", { connectionId });
    await assert.rejects(() => save(retired, [task]), /retired|expired/);
    assert.deepEqual((await snapshot(db, owner)).entries, before);
    const state = await integrationRpc<Integrations>(db, owner, "list");
    assert.equal(state.connections[0].status, "disconnected");
    assert.equal(JSON.stringify(state).includes("encrypted-fixture"), false);
    const otherToken = await signIn(
        db,
        "register",
        `${randomUUID()}@test.local`,
        "long-fixture-password",
      ),
      other = await authenticate(db, otherToken);
    await assert.rejects(
      () => integrationRpc(db, other, "resync", { connectionId, sourceId }),
      /not found/,
    );
  } finally {
    await pg.close();
  }
});

test("worker persists retry classification without leaking upstream response bodies", async () => {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const original = globalThis.fetch,
    old = process.env.ORDERLY_INTEGRATION_KEY;
  process.env.ORDERLY_INTEGRATION_KEY = "02".repeat(32);
  globalThis.fetch = async () =>
    new Response("provider private body", {
      status: 429,
      headers: { "Retry-After": "90" },
    });
  try {
    const credentials = encrypt({ access_token: "fixture" });
    const db = {
      async rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
        calls.push({ name, args });
        if (args.command === "claim")
          return {
            job: { id: "job", lease: "lease", attempts: 0 },
            source: { external_id: "source", mapping: {} },
            connection: { provider: "asana", credentials },
          } as T;
        return {} as T;
      },
    };
    assert.equal(await workOnce(db), true);
    const failure = calls.find((x) => x.args.command === "fail")!;
    const input = failure.args.input as Record<string, unknown>;
    assert.equal(input.status, "error");
    assert.equal(input.delay, 90000);
    assert.equal(
      JSON.stringify(calls).includes("provider private body"),
      false,
    );
  } finally {
    globalThis.fetch = original;
    if (old === undefined) delete process.env.ORDERLY_INTEGRATION_KEY;
    else process.env.ORDERLY_INTEGRATION_KEY = old;
  }
});

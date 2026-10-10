import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import {
  exactSuggestions,
  normalizePull,
  githubApi,
  GITHUB_VERSION,
} from "../lib/github-provider";
import { githubRpc } from "../lib/github";
import { signature } from "../lib/integration-crypto";
import { signIn, authenticate } from "../lib/auth";
import { mutate, snapshot } from "../lib/domain";
import { integrationRpc, syncRpc } from "../lib/integrations";
import type { GitHubSnapshot, PullMetadata } from "../lib/github-types";
import { postgresFixture } from "./postgres";

test("exact references explain suggestions, preserve ambiguity and reject partial IDs", () => {
  const refs = [
    {
      task_id: "asana",
      external_id: "123456",
      url: "https://app.asana.com/0/1/123456",
      provider: "asana",
    },
    {
      task_id: "notion",
      external_id: "123456",
      url: "https://www.notion.so/exact-page",
      provider: "notion",
    },
  ];
  assert.equal(
    exactSuggestions("matching title only; x123456 1234567", refs).length,
    0,
  );
  const ambiguous = exactSuggestions("task-123456-work", refs);
  assert.equal(ambiguous.length, 2);
  assert.match(ambiguous[0].reason, /asana ID: 123456/);
  const url = exactSuggestions("See https://www.notion.so/exact-page)", refs);
  assert.equal(url.length, 1);
  assert.match(url[0].reason, /notion URL/);
  assert.equal(
    exactSuggestions("https://www.notion.so/exact-page-extra", refs).length,
    0,
  );
});

test("signed raw GitHub deliveries reject altered payloads and invalid signatures", () => {
  const raw = '{"action":"opened","installation":{"id":1}}',
    secret = "fixture-webhook-secret";
  const signed =
    "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
  assert.equal(signature(raw, secret, signed, "sha256="), true);
  assert.equal(signature(raw + " ", secret, signed, "sha256="), false);
  assert.equal(signature(raw, secret, "sha256=short", "sha256="), false);
});

test("GitHub requests pin version, avoid redirects, and classify retry/access loss", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (url, init) => {
      assert.equal(String(url), "https://api.github.com/user");
      assert.equal(
        new Headers(init?.headers).get("X-GitHub-Api-Version"),
        GITHUB_VERSION,
      );
      assert.equal(init?.redirect, "error");
      return new Response("{}", {
        status: 429,
        headers: { "retry-after": "120" },
      });
    };
    await assert.rejects(() => githubApi("fixture", "user"), /rate limit/);
    globalThis.fetch = async () => new Response("{}", { status: 401 });
    await assert.rejects(() => githubApi("fixture", "user"), /Reconnect/);
    globalThis.fetch = async () => new Response("{}", { status: 404 });
    await assert.rejects(
      () => githubApi("fixture", "user"),
      /access is unavailable/,
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("many-to-many evidence and repeated/out-of-order deliveries preserve 45 minutes", async () => {
  const { pg, db } = await postgresFixture();
  try {
    const token = await signIn(
        db,
        "register",
        `${randomUUID()}@test.local`,
        "long-fixture-password",
      ),
      owner = await authenticate(db, token);
    const act = (input: Record<string, unknown>, now?: number) =>
      mutate(db, owner, { key: randomUUID(), ...input }, now);
    await act({ action: "client", name: "Client" });
    const client = (await snapshot(db, owner)).clients[0];
    await act({
      action: "project",
      name: "Project",
      clientId: client.id,
      currency: "USD",
      rate: "50",
    });
    const project = (await snapshot(db, owner)).projects[0];
    await act({ action: "task", name: "Asana task", projectId: project.id });
    await act({ action: "task", name: "Notion task", projectId: project.id });
    const tasks = (await snapshot(db, owner)).tasks;
    const start = Date.now() - 3600000;
    await act({ action: "start", taskId: tasks[0].id }, start);
    const entry = (await snapshot(db, owner)).entries[0];
    await act({ action: "stop", entryId: entry.id }, start + 2700000);
    const before = (await snapshot(db, owner)).entries;
    const connectionId = await integrationRpc<string>(db, owner, "connect", {
      provider: "github",
      account: "123",
      label: "Fixture",
      credentials: "encrypted",
    });
    // Use the server mapping API with a real read fence, rather than bypassing its guard.
    const lease = randomUUID();
    const c = await githubRpc<{ generation: number }>(db, owner, "credential", {
      connectionId,
      lease,
    });
    const sourceId = await githubRpc<string>(db, owner, "map", {
      connectionId,
      lease,
      generation: c.generation,
      externalId: "456",
      name: "fixture/repo",
      projectId: project.id,
      mapping: { installation: "789", fullName: "fixture/repo" },
    });
    await githubRpc(db, owner, "read_release", { connectionId, lease });
    const meta: PullMetadata = {
      id: "1000",
      number: 1,
      url: "https://github.com/fixture/repo/pull/1",
      title: "Days of PR lifetime",
      author: "fixture",
      branch: "task-123",
      base: "main",
      state: "merged",
      createdAt: start - 86400000 * 5,
      updatedAt: start,
      closedAt: start,
      mergedAt: start,
    };
    async function importPage(pulls: unknown[]) {
      const work = await syncRpc<{ job: { id: string; lease: string } }>(
        db,
        "claim",
        { lease: randomUUID() },
      );
      await syncRpc(db, "github_page", {
        jobId: work.job.id,
        lease: work.job.lease,
        pulls,
        cursor: null,
      });
    }
    await importPage([
      {
        metadata: meta,
        suggestions: tasks.map((t) => ({
          taskId: t.id,
          reason: "exact ID fixture",
        })),
      },
      {
        metadata: {
          ...meta,
          id: "1001",
          number: 2,
          url: "https://github.com/fixture/repo/pull/2",
        },
        suggestions: [],
      },
    ]);
    let state = await githubRpc<GitHubSnapshot>(db, owner, "list");
    assert.equal(state.links.filter((l) => l.status === "confirmed").length, 0);
    for (const task of tasks)
      await githubRpc(db, owner, "link", {
        prId: state.pulls[0].id,
        taskId: task.id,
      });
    await githubRpc(db, owner, "link", {
      prId: state.pulls[1].id,
      taskId: tasks[0].id,
    });
    await githubRpc(db, owner, "link", {
      prId: state.pulls[1].id,
      taskId: tasks[0].id,
    });
    state = await githubRpc(db, owner, "list");
    assert.equal(
      state.audit.length,
      3,
      "idempotent confirmation is not audited twice",
    );
    const delivery = {
      delivery: "delivery-one",
      event: "pull_request",
      action: "opened",
      installation: "789",
      repository: "456",
    };
    await syncRpc(db, "github_event", delivery);
    await syncRpc(db, "github_event", delivery);
    const receipts = await pg.query<{ count: number }>(
      "select count(*)::int as count from orderly_private.sync_events",
    );
    assert.equal(receipts.rows[0].count, 1);
    await importPage([
      {
        metadata: {
          ...meta,
          state: "open",
          updatedAt: start - 1000,
          mergedAt: null,
          closedAt: null,
        },
        suggestions: [],
      },
      {
        metadata: {
          ...meta,
          id: "1001",
          number: 2,
          url: "https://github.com/fixture/repo/pull/2",
        },
        suggestions: [],
      },
    ]);
    state = await githubRpc(db, owner, "list");
    assert.equal(
      state.pulls.find((p) => p.metadata.id === "1000")!.metadata.state,
      "merged",
    );
    assert.equal(state.links.filter((l) => l.status === "confirmed").length, 3);
    assert.deepEqual((await snapshot(db, owner)).entries, before);
    assert.equal(before[0].end! - before[0].start, 2700000);
    await githubRpc(db, owner, "unlink", {
      prId: state.pulls[0].id,
      taskId: tasks[0].id,
    });
    assert.equal(
      (await githubRpc<GitHubSnapshot>(db, owner, "list")).audit.length,
      4,
    );
    const other = await authenticate(
      db,
      await signIn(
        db,
        "register",
        `${randomUUID()}@test.local`,
        "long-fixture-password",
      ),
    );
    await assert.rejects(
      () =>
        githubRpc(db, other, "link", {
          prId: state.pulls[0].id,
          taskId: tasks[0].id,
        }),
      /not found/,
    );
    assert.equal(
      (await githubRpc<GitHubSnapshot>(db, other, "list")).pulls.length,
      0,
    );
    // A removed installation fences an in-flight read, without deleting evidence/time.
    await githubRpc(db, owner, "resync", { connectionId, sourceId });
    const work = await syncRpc<{ job: { id: string; lease: string } }>(
      db,
      "claim",
      { lease: randomUUID() },
    );
    await syncRpc(db, "github_event", {
      delivery: "removed",
      event: "installation",
      action: "deleted",
      installation: "789",
    });
    await assert.rejects(
      () =>
        syncRpc(db, "github_page", {
          jobId: work.job.id,
          lease: work.job.lease,
          pulls: [],
          cursor: null,
        }),
      /retired|changed/,
    );
    state = await githubRpc(db, owner, "list");
    assert.equal(state.pulls.length, 2);
    assert.equal(
      state.pulls.every((p) => !p.available),
      true,
    );
    assert.deepEqual((await snapshot(db, owner)).entries, before);
    const grants = await pg.query<{ allowed: boolean }>(
      "select has_function_privilege('anon','public.orderly_github(text,text,jsonb)','execute') as allowed",
    );
    assert.equal(grants.rows[0].allowed, false);
  } finally {
    await pg.close();
  }
});

test("normalization retains PR identity/state/timestamps without source code or body", () => {
  const value = normalizePull({
    id: 1,
    number: 2,
    html_url: "https://github.com/fixture/repo/pull/2",
    title: "Title",
    body: "Sensitive text",
    user: { login: "author" },
    head: { ref: "feature" },
    base: { ref: "main" },
    state: "closed",
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-02T00:00:00Z",
    closed_at: "2026-10-02T00:00:00Z",
    merged_at: "2026-10-02T00:00:00Z",
  });
  assert.equal(value.state, "merged");
  assert.equal("body" in value, false);
  assert.equal(value.author, "author");
});

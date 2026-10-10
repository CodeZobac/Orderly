import { test, expect, chromium } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import type { Integrations } from "../lib/integration-types";
import type { Snapshot } from "../lib/types";
import type { GitHubSnapshot } from "../lib/github-types";

test("GitHub task evidence, explicit suggestions and timer selection with mocked providers", async ({
  page,
}) => {
  const start = Date.now() - 3600000;
  const work: Snapshot = {
    user: { email: "fixture@test.local", timezone: "UTC" },
    clients: [{ id: "client", name: "Client" }],
    projects: [
      {
        id: "project",
        client_id: "client",
        name: "Billing",
        currency: "EUR",
        rate: 6000,
      },
    ],
    tasks: [
      {
        id: "asana-task",
        project_id: "project",
        name: "Design Asana",
        external: [
          {
            provider: "asana",
            name: "Board design",
            url: "https://app.asana.com/0/1/123456",
            status: "Done",
            archived: false,
            ambiguous: false,
            explicit: true,
            available: true,
          },
        ],
      },
      { id: "notion-task", project_id: "project", name: "Notion review" },
    ],
    entries: [
      {
        id: "entry",
        task_id: "asana-task",
        start,
        end: start + 2700000,
        rate: 6000,
        currency: "EUR",
        billable: 1,
        notes: "Recorded work",
        version: 1,
      },
    ],
    audit: [],
    now: Date.now(),
  };
  const evidence: GitHubSnapshot = {
    connections: [
      {
        id: "connection",
        provider: "github",
        account_id: "123",
        label: "Fixture",
        status: "connected",
        error: null,
        generation: 1,
      },
    ],
    sources: [
      {
        id: "source",
        connection_id: "connection",
        external_id: "456",
        name: "fixture/repo",
        project_id: "project",
        mapping: {},
        status: "synced",
        error: null,
        last_success: Date.now(),
        webhook_id: null,
      },
    ],
    pulls: [
      {
        id: "pr",
        source_id: "source",
        available: true,
        metadata: {
          id: "1000",
          number: 1,
          url: "https://github.com/fixture/repo/pull/1",
          title: "Deliver design",
          author: "fixture",
          branch: "task-123456",
          base: "main",
          state: "merged",
          createdAt: start - 86400000 * 3,
          updatedAt: start,
          closedAt: start,
          mergedAt: start,
        },
      },
    ],
    links: [
      {
        pr_id: "pr",
        task_id: "asana-task",
        status: "suggested",
        reason: "asana ID: 123456",
      },
      {
        pr_id: "pr",
        task_id: "notion-task",
        status: "suggested",
        reason: "notion ID: 123456",
      },
    ],
    events: [{ pr_id: "pr", kind: "merged", at: start }],
    audit: [],
  };
  await page.route("**/api/work", async (route) => {
    if (route.request().method() === "POST") {
      const input = route.request().postDataJSON();
      if (input.action === "start")
        work.entries.push({
          id: "active",
          task_id: input.taskId,
          start: Date.now() - 1000,
          end: null,
          rate: 6000,
          currency: "EUR",
          billable: 1,
          notes: "",
          version: 1,
        });
      return route.fulfill({
        json: { result: { ok: true }, data: { ...work, now: Date.now() } },
      });
    }
    await route.fulfill({ json: { ...work, now: Date.now() } });
  });
  await page.route("**/api/integrations", (route) =>
    route.fulfill({
      json: { connections: [], sources: [], tasks: [], memberships: [] },
    }),
  );
  await page.route("**/api/github", async (route) => {
    if (route.request().method() === "POST") {
      const input = route.request().postDataJSON();
      if (input.action === "link")
        evidence.links.find((l) => l.task_id === input.taskId)!.status =
          "confirmed";
      return route.fulfill({ json: input.taskId || {} });
    }
    await route.fulfill({ json: evidence });
  });
  await page.goto("/settings");
  const card = page
    .locator(".evidence-card")
    .filter({ hasText: "Deliver design" });
  await expect(
    card.getByText("Several exact matches — confirm each intended link"),
  ).toBeVisible();
  await expect(
    card.getByText("Review reminder: this PR has no confirmed task link."),
  ).toBeVisible();
  await card
    .getByRole("button", { name: "Confirm link", exact: true })
    .first()
    .click();
  await expect(card.getByText("00:45:00 recorded on task")).toBeVisible();
  expect(work.entries).toHaveLength(1);
  await card
    .getByRole("combobox", { name: "Record time on a canonical task" })
    .selectOption("asana-task");
  await card
    .getByRole("button", { name: "Start timer on selected task" })
    .click();
  expect(work.entries[1].task_id).toBe("asana-task");
  await page.goto("/tasks/asana-task");
  await expect(
    page.getByRole("heading", { name: "Linked pull requests" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "00:45:00 recorded on this task, counted once across all linked PRs.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "asana: Board design" }),
  ).toBeVisible();
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
});

test("Notion mapping, import status and timer controls with mocked provider responses", async ({
  page,
}) => {
  const work: Snapshot = {
    user: { email: "fixture@test.local", timezone: "UTC" },
    clients: [{ id: "client", name: "Client" }],
    projects: [
      {
        id: "project",
        client_id: "client",
        name: "Billing",
        currency: "EUR",
        rate: 7525,
      },
    ],
    tasks: [],
    entries: [],
    audit: [],
    now: Date.now(),
  };
  const state: Integrations = {
    connections: [
      {
        id: "connection",
        provider: "notion",
        account_id: "workspace",
        label: "Workspace",
        status: "connected",
        error: null,
        generation: 1,
      },
    ],
    sources: [],
    tasks: [],
    memberships: [],
  };
  await page.route("**/api/work", async (route) => {
    if (route.request().method() === "POST") {
      const input = route.request().postDataJSON();
      if (input.action === "start")
        work.entries.push({
          id: "entry",
          task_id: input.taskId,
          start: Date.now() - 1000,
          end: null,
          rate: 7525,
          currency: "EUR",
          billable: 1,
          notes: "",
          version: 1,
        });
      if (input.action === "stop") {
        work.entries[0].end = Date.now();
        work.entries[0].version++;
      }
      await route.fulfill({
        json: { result: { ok: true }, data: { ...work, now: Date.now() } },
      });
    } else await route.fulfill({ json: { ...work, now: Date.now() } });
  });
  await page.route("**/api/integrations", async (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({ json: state });
    const input = route.request().postDataJSON();
    if (input.action === "discover")
      return route.fulfill({
        json: {
          sources: [{ id: "source", name: "Tasks", properties: [] }],
          cursor: null,
          workspaces: false,
        },
      });
    if (input.action === "inspect")
      return route.fulfill({
        json: {
          id: "source",
          name: "Tasks",
          properties: [
            { id: "title", name: "Renamed title", type: "title" },
            { id: "status-id", name: "Progress", type: "status" },
          ],
        },
      });
    if (input.action === "map") {
      expect(input.mapping).toEqual({ title: "title", status: "status-id" });
      state.sources.push({
        id: "mapped",
        connection_id: "connection",
        external_id: "source",
        name: "Tasks",
        project_id: "project",
        mapping: input.mapping,
        status: "synced",
        error: null,
        last_success: Date.now(),
        webhook_id: null,
      });
      work.tasks.push({
        id: "task",
        project_id: "project",
        name: "Imported task",
        external: [
          {
            provider: "notion",
            name: "Imported task",
            url: "https://notion.so/page",
            status: "Doing",
            archived: false,
            ambiguous: false,
            explicit: false,
            available: true,
          },
        ],
      });
    }
    await route.fulfill({ json: { ok: true } });
  });
  await page.goto("/settings");
  await page.getByRole("button", { name: "Choose sources" }).click();
  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  await page.getByLabel("Orderly billing project").selectOption("project");
  await page.getByLabel("status property (optional)").selectOption("status-id");
  for (const width of [320, 375, 414, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.getByRole("button", { name: "Save mapping & import" }).click();
  await expect(page.getByText("Billing · synced")).toBeVisible();
  await page.getByRole("button", { name: "Refresh sync status" }).click();
  await page.goto("/");
  await expect(page.getByText("Notion · Doing")).toBeVisible();
  await page.getByRole("button", { name: "Start / resume" }).click();
  await expect(
    page.getByRole("button", { name: "Stop timer", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Stop timer", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Stop timer", exact: true }),
  ).toHaveCount(0);
});
test("core journey, concurrency, persistence, ownership and responsive contrast", async ({
  page,
  browser,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByRole("button", { name: "New here? Create account" }).click();
  await page
    .getByLabel("Email", { exact: true })
    .fill(`${randomUUID()}@test.local`);
  await page
    .getByLabel("Password · 12–128 characters")
    .fill("browser-test-password");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Today", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Projects", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Projects", exact: true }),
  ).toBeVisible();
  await page.goto("/projects");
  await page
    .getByRole("textbox", { name: "Client name", exact: true })
    .fill("North Studio");
  await page.getByRole("button", { name: "Add client", exact: true }).click();
  await expect(
    page
      .getByRole("combobox", { name: "Client", exact: true })
      .locator("option"),
  ).toHaveCount(2);
  await page
    .getByRole("combobox", { name: "Client", exact: true })
    .selectOption({ label: "North Studio" });
  await page.getByLabel("Project name").fill("Portfolio");
  await page.getByLabel("Hourly rate", { exact: true }).fill("85.50");
  await page.getByRole("button", { name: "Add project", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Portfolio", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "Project", exact: true })
    .selectOption({ label: "Portfolio" });
  await page.getByLabel("Task name").fill("Build the homepage");
  await page.getByRole("button", { name: "Add task", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "Build the homepage", exact: true }),
  ).toBeVisible();
  const api = page.context().request,
    origin = { Origin: "http://localhost:3200" };
  const initial = await (await api.get("/api/work")).json(),
    task = initial.tasks[0];
  const second = await page.context().newPage();
  await second.goto("/");
  const responses = await Promise.all([
    api.post("/api/work", {
      headers: origin,
      data: { action: "start", taskId: task.id, key: randomUUID() },
    }),
    second.request.post("/api/work", {
      headers: origin,
      data: { action: "start", taskId: task.id, key: randomUUID() },
    }),
  ]);
  expect(responses.map((r) => r.status()).sort()).toEqual([200, 409]);
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Stop timer", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Stop timer", exact: true }),
  ).toBeVisible();
  const active = (await (await api.get("/api/work")).json()).entries[0];
  const state = await page.context().storageState();
  const restartedBrowser = await chromium.launch();
  const reopened = await restartedBrowser.newContext({ storageState: state });
  const rp = await reopened.newPage();
  await rp.goto("http://localhost:3200");
  await expect(
    rp.getByRole("button", { name: "Stop timer", exact: true }),
  ).toBeVisible();
  await reopened.close();
  await restartedBrowser.close();
  await expect.poll(() => Date.now() - active.start).toBeGreaterThan(1500);
  await page.getByRole("button", { name: "Stop timer", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Start timer", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Timesheet", exact: true }).click();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const editor = page.getByRole("region", { name: "Correct time entry" });
  await editor.getByLabel("Notes", { exact: true }).fill("Reviewed work");
  await editor.getByLabel("Billable work").uncheck();
  await editor.getByRole("button", { name: "Save correction" }).click();
  await expect(page.getByText("Reviewed work", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByText("Reviewed work", { exact: true })).toBeVisible();
  const other = await browser.newContext();
  expect(
    (await other.request.get("http://localhost:3200/api/work")).status(),
  ).toBe(401);
  await other.request.post("http://localhost:3200/api/auth", {
    headers: origin,
    data: {
      action: "register",
      email: `${randomUUID()}@test.local`,
      password: "second-test-password",
    },
  });
  expect(
    (
      await other.request.post("http://localhost:3200/api/work", {
        headers: origin,
        data: { action: "start", taskId: task.id, key: randomUUID() },
      })
    ).status(),
  ).toBe(404);
  await other.close();
  expect(
    (
      await api.post("/api/work", {
        headers: { Origin: "https://untrusted.invalid" },
        data: { action: "timezone", timezone: "UTC", key: randomUUID() },
      })
    ).status(),
  ).toBe(403);
  for (const width of [320, 375, 414, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const route of [
      "/",
      "/projects",
      "/timesheet",
      "/settings",
      `/tasks/${task.id}`,
    ]) {
      await page.goto(route);
      await expect(page.locator(".rail")).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        `${width} ${route}`,
      ).toBe(false);
      expect(
        await page
          .locator(".workspace button,.workspace nav a")
          .evaluateAll((els) =>
            els
              .filter((el) => {
                const r = el.getBoundingClientRect();
                return (
                  r.width > 0 &&
                  (r.right > innerWidth + 1 ||
                    r.left < 0 ||
                    el.scrollWidth > el.clientWidth + 1)
                );
              })
              .map((el) => el.textContent),
          ),
        `${width} ${route}`,
      ).toEqual([]);
      await page.screenshot({
        path: info.outputPath(`${width}-${route.split("/")[1] || "today"}.png`),
        fullPage: true,
      });
    }
  }
  await page.goto("/");
  await expect(page.locator(".rail")).toBeVisible();
  await page.getByRole("link", { name: "Skip to content" }).focus();
  await expect(
    page.getByRole("link", { name: "Skip to content" }),
  ).toBeFocused();
  expect(
    await page
      .getByRole("link", { name: "Skip to content" })
      .evaluate((el) => getComputedStyle(el).outlineStyle),
  ).toBe("solid");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Orderly Freelance time" }),
  ).toBeFocused();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator("html")).toHaveCSS("overflow-x", "clip");
  const ratios = await page.evaluate(() => {
    const ctx = document.createElement("canvas").getContext("2d")!;
    const root = getComputedStyle(document.documentElement);
    function lum(n: string) {
      ctx.fillStyle = root.getPropertyValue(`--color-${n}`).trim();
      ctx.fillRect(0, 0, 1, 1);
      const v = Array.from(ctx.getImageData(0, 0, 1, 1).data)
        .slice(0, 3)
        .map((x) => x / 255)
        .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return v[0] * 0.2126 + v[1] * 0.7152 + v[2] * 0.0722;
    }
    return [
      ["ink", "paper", 7],
      ["muted", "paper", 4.5],
      ["muted", "paper-2", 4.5],
      ["ink", "accent", 4.5],
      ["ink", "accent-hover", 4.5],
      ["ink", "accent-active", 4.5],
      ["muted", "disabled", 4.5],
      ["error", "error-paper", 4.5],
      ["focus", "paper", 3],
      ["focus", "accent", 3],
      ["rule", "surface", 3],
    ].map(([fg, bg, min]) => {
      const a = lum(String(fg)),
        b = lum(String(bg));
      return {
        fg,
        bg,
        min: Number(min),
        ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
      };
    });
  });
  writeFileSync(
    info.outputPath("contrast.json"),
    JSON.stringify(ratios, null, 2),
  );
  await info.attach("contrast.json", {
    body: JSON.stringify(ratios, null, 2),
    contentType: "application/json",
  });
  for (const pair of ratios)
    expect(pair.ratio, `${pair.fg}/${pair.bg}`).toBeGreaterThanOrEqual(
      pair.min,
    );
  expect(errors).toEqual([]);
  await second.close();
});

test("manual UTC validation, timezone and retry after a lost save acknowledgment", async ({
  page,
}) => {
  const api = page.context().request,
    headers = { Origin: "http://localhost:3200" };
  await api.post("/api/auth", {
    headers,
    data: {
      action: "register",
      email: `${randomUUID()}@test.local`,
      password: "browser-test-password",
    },
  });
  const action = async (input: Record<string, unknown>) => {
    const r = await api.post("/api/work", {
      headers,
      data: { ...input, key: randomUUID() },
    });
    expect(r.ok()).toBeTruthy();
    return (await r.json()).data;
  };
  let data = await action({ action: "client", name: "Field Studio" });
  data = await action({
    action: "project",
    clientId: data.clients[0].id,
    name: "Research",
    currency: "EUR",
    rate: "60.00",
  });
  data = await action({
    action: "task",
    projectId: data.projects[0].id,
    name: "Interview",
  });
  const taskId = data.tasks[0].id;
  await page.goto("/");
  await page
    .getByRole("combobox", { name: "Task", exact: true })
    .selectOption(taskId);
  let intercepted = false;
  await page.route("**/api/work", async (route) => {
    if (
      route.request().method() === "POST" &&
      route.request().postDataJSON().action === "start" &&
      !intercepted
    ) {
      intercepted = true;
      await route.fetch();
      await route.abort();
    } else await route.continue();
  });
  await page.getByRole("button", { name: "Start timer", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Retry save", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Retry save", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Stop timer", exact: true }),
  ).toBeVisible();
  expect((await (await api.get("/api/work")).json()).entries).toHaveLength(1);
  await page.unroute("**/api/work");
  await page.getByRole("button", { name: "Stop timer", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Start timer", exact: true }),
  ).toBeVisible();
  await page.goto("/settings");
  await page.getByLabel("IANA timezone").fill("Europe/Lisbon");
  await page.getByRole("button", { name: "Save timezone" }).click();
  await expect(page.locator(".timezone")).toHaveText("Europe/Lisbon");
  await page.goto("/timesheet");
  await page
    .getByRole("combobox", { name: "Task", exact: true })
    .selectOption(taskId);
  const start = new Date(Date.now() - 3600000).toISOString().slice(0, 23),
    end = new Date(Date.now() - 1800000).toISOString().slice(0, 23);
  await page.getByLabel("Start · UTC", { exact: true }).fill(end);
  await page.getByLabel("End · UTC", { exact: true }).fill(start);
  await page.getByRole("button", { name: "Add entry", exact: true }).click();
  await expect(page.locator(".notice[role=alert]")).toContainText(
    "End must be after start",
  );
  await page.getByLabel("Start · UTC", { exact: true }).fill(start);
  await page.getByLabel("End · UTC", { exact: true }).fill(end);
  await page.getByLabel("Notes", { exact: true }).fill("Interview notes");
  await page.getByRole("button", { name: "Add entry", exact: true }).click();
  await expect(
    page.getByText("Interview notes", { exact: true }),
  ).toBeVisible();
  expect((await (await api.get("/api/work")).json()).entries).toHaveLength(2);
});

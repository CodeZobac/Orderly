import { test, expect, chromium } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
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

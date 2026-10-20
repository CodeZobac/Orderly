import { test, expect } from "@playwright/test";
import type { Snapshot } from "../lib/types";
import type { BillingBatch, BillingReview } from "../lib/billing-types";
import { billingCsv } from "../lib/billing-format";

test("billing draft review, finalization, CSV download and responsive printable snapshot (mocked API)", async ({
  page,
}) => {
  const start = Date.parse("2026-09-01T09:00:00Z");
  const work: Snapshot = {
    user: { email: "billing@test.local", timezone: "UTC" },
    clients: [{ id: "client", name: "Client" }],
    projects: [
      {
        id: "project",
        client_id: "client",
        name: "Delivery",
        currency: "EUR",
        rate: 6000,
      },
    ],
    tasks: [
      {
        id: "task",
        project_id: "project",
        name: "Board task",
        external: [
          {
            provider: "asana",
            name: "Imported task",
            url: "https://app.asana.com/0/1/2",
            status: "Done",
            archived: false,
            ambiguous: false,
            explicit: true,
            available: true,
          },
        ],
      },
    ],
    entries: [
      {
        id: "entry",
        task_id: "task",
        start,
        end: start + 7200000,
        rate: 6000,
        currency: "EUR",
        billable: 1,
        notes: "",
        version: 2,
      },
    ],
    audit: [],
    now: Date.parse("2026-09-03T12:00:00Z"),
  };
  const review: BillingReview = {
    filters: {
      from: "2026-09-01",
      to: "2026-09-04",
      timezone: "UTC",
      projectId: "",
      clientId: "",
    },
    start: Date.parse("2026-09-01"),
    end: Date.parse("2026-09-04"),
    policy: "Exact milliseconds; currency total rounded half up.",
    lines: [
      {
        entryId: "entry",
        revision: 2,
        taskId: "task",
        task: "Board task",
        projectId: "project",
        project: "Delivery",
        clientId: "client",
        client: "Client",
        start,
        end: start + 7200000,
        sourceStart: start,
        sourceEnd: start + 7200000,
        recordedMs: 7200000,
        billedMs: 7200000,
        billable: true,
        rate: 6000,
        currency: "EUR",
        digits: 2,
        notes: "",
        numerator: "4320000000000",
        denominator: "360000000",
        minorAmount: "12000",
        evidence: [
          {
            kind: "asana",
            label: "Imported task",
            url: "https://app.asana.com/0/1/2",
          },
          {
            kind: "github",
            label: "Supporting PR",
            url: "https://github.com/example/repo/pull/1",
          },
        ],
      },
    ],
    totals: [
      {
        currency: "EUR",
        digits: 2,
        recordedMs: 7200000,
        billableMs: 7200000,
        nonBillableMs: 0,
        minorAmount: "12000",
      },
    ],
    issues: [],
    longEntryIds: [],
    alreadyAllocatedMs: 0,
  };
  let report: BillingBatch | null = null;
  await page.route("**/api/work", (route) => route.fulfill({ json: work }));
  await page.route("**/api/billing**", async (route) => {
    if (route.request().url().includes("/export"))
      return route.fulfill({
        contentType: "text/csv",
        headers: { "Content-Disposition": 'attachment; filename="report.csv"' },
        body: billingCsv(report!.snapshot, report!.id, report!.status),
      });
    if (route.request().method() === "GET") {
      return route.fulfill({
        json: route.request().url().includes("?id=")
          ? report
          : { batches: report ? [report] : [], audit: [] },
      });
    }
    const payload = route.request().postDataJSON();
    if (payload.command === "draft")
      report = {
        id: "batch",
        version: 1,
        status: "draft",
        filters: review.filters,
        snapshot: review,
        created_at: work.now,
        finalized_at: null,
        voided_at: null,
        void_reason: null,
      };
    if (payload.command === "finalize")
      report = {
        ...report!,
        status: "finalized",
        version: 2,
        finalized_at: work.now,
      };
    return route.fulfill({
      json: payload.command === "preview" ? review : report,
    });
  });
  await page.goto("/billing");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "EUR 120.00", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Supporting PR" })).toBeVisible();
  for (const width of [320, 375, 414, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBeTruthy();
  }
  await page
    .getByRole("button", { name: "Finalize report", exact: true })
    .click();
  await expect(
    page.getByText(/Amounts, labels, entry revisions and evidence are frozen/),
  ).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Export CSV" }).click();
  expect((await download).suggestedFilename()).toBe("report.csv");
  await page.emulateMedia({ media: "print" });
  await expect(
    page.getByRole("button", { name: "Save draft", exact: true }),
  ).toBeHidden();
  await expect(
    page.getByRole("heading", { name: "EUR 120.00", exact: true }),
  ).toBeVisible();
});

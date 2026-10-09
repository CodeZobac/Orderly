import { chromium, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
async function main() {
  const origin = process.env.ORDERLY_SMOKE_ORIGIN || "http://localhost:3100";
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(origin);
    await page
      .getByRole("button", { name: "New here? Create account" })
      .click();
    await page
      .getByLabel("Email", { exact: true })
      .fill(`${randomUUID()}@test.local`);
    await page
      .getByLabel("Password · 12–128 characters")
      .fill("production-smoke-password");
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
    await page
      .getByRole("textbox", { name: "Client name", exact: true })
      .fill("Production smoke studio");
    await page.getByRole("button", { name: "Add client", exact: true }).click();
    await expect(
      page
        .getByRole("combobox", { name: "Client", exact: true })
        .locator("option"),
    ).toHaveCount(2);
    const cookie = (await page.context().cookies()).find(
      (c) => c.name === "orderly_session",
    );
    expect(cookie?.secure).toBe(true);
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("Strict");
    expect(errors).toEqual([]);
    console.log(
      "Production smoke passed: register, persisted client, navigation, secure session, no browser exceptions.",
    );
  } finally {
    await browser.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

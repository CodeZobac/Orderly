import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testMatch: ["browser.spec.ts", "billing-browser.spec.ts"],
  timeout: 120000,
  workers: 1,
  use: { baseURL: "http://localhost:3200", headless: true },
  webServer: [
    {
      command: "node --import tsx tests/rpc-server.ts",
      url: "http://127.0.0.1:3001/health",
      reuseExistingServer: false,
    },
    {
      command: "npm run dev -- --port 3200",
      url: "http://localhost:3200",
      reuseExistingServer: false,
      env: {
        SUPABASE_URL: "http://127.0.0.1:3001",
        SUPABASE_SECRET_KEY: "sb_secret_fixture_only",
        ORDERLY_ORIGIN: "http://localhost:3200",
      },
    },
  ],
});

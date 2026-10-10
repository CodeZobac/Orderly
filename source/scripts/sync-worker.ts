import { loadEnvConfig } from "@next/env";
import { database } from "../lib/db";
import { workOnce } from "../lib/integrations";
loadEnvConfig(process.cwd());
const once = process.argv.includes("--once");
let stopping = false;
process.on("SIGINT", () => {
  stopping = true;
});
process.on("SIGTERM", () => {
  stopping = true;
});
async function main() {
  do {
    try {
      const worked = await workOnce(database());
      if (!worked && !once)
        await new Promise((resolve) => setTimeout(resolve, 5000));
    } catch {
      console.error(
        "Sync worker unavailable. Check database migrations and server environment.",
      );
      if (once) process.exitCode = 1;
      else await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  } while (!once && !stopping);
}
void main().catch(() => {
  console.error("Sync worker stopped unexpectedly. Check server setup.");
  process.exitCode = 1;
});

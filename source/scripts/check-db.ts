// Schema deployment is owned by the Supabase GitHub integration.
import { loadEnvConfig } from "@next/env";
import { openDatabase } from "../lib/db";
loadEnvConfig(process.cwd());
async function main() {
  try {
    await openDatabase().rpc("orderly_snapshot", { owner: "" });
    console.log(
      "Supabase RPC connection verified. Deploy migrations through the configured GitHub integration.",
    );
  } catch {
    console.error(
      "Supabase connection unavailable. Add the server secret and deploy source/supabase/migrations through GitHub.",
    );
    process.exitCode = 1;
  }
}
main();

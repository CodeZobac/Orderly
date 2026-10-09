import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { loadEnvConfig } from "@next/env";
import { openDatabase } from "../lib/db";
loadEnvConfig(process.cwd());
export function readLegacyDatabase(path: string) {
  const sqlite = new DatabaseSync(resolve(path), { readOnly: true });
  try {
    const data: Record<string, unknown[]> = {};
    for (const table of [
      "users",
      "sessions",
      "auth_attempts",
      "clients",
      "projects",
      "tasks",
      "entries",
      "audit",
      "project_rates",
      "requests",
    ]) {
      const exists = sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
        .get(table);
      if (exists) data[table] = sqlite.prepare(`SELECT * FROM ${table}`).all();
      else if (table === "project_rates")
        data[table] = sqlite
          .prepare(
            "SELECT id,user_id,id AS project_id,rate,0 AS at FROM projects",
          )
          .all();
      else throw new Error(`Missing legacy table: ${table}`);
    }
    return data;
  } finally {
    sqlite.close();
  }
}
async function main() {
  const path = process.argv[2];
  if (!path)
    throw new Error(
      "Usage: npm run db:import -- /absolute/path/orderly.sqlite (stop the old app first)",
    );
  const result = await openDatabase().rpc("orderly_import", {
    data: readLegacyDatabase(path),
  });
  console.log("Import committed:", result);
}
if (process.argv[1]?.endsWith("import-sqlite.ts"))
  main().catch(() => {
    console.error(
      "Import failed. Check server credentials, migrations, source schema, and an empty target database.",
    );
    process.exitCode = 1;
  });

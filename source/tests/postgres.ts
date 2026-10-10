import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import type { Database } from "../lib/db";
import { Problem } from "../lib/problem";

export async function postgresFixture() {
  const pg = new PGlite();
  await pg.exec(
    "create role anon; create role authenticated; create role service_role bypassrls;",
  );
  for (const file of readdirSync(resolve("supabase/migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await pg.exec(readFileSync(resolve("supabase/migrations", file), "utf8"));
  const db: Database = {
    async rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
      const signatures: Record<string, string[]> = {
        orderly_auth: ["command", "input"],
        orderly_snapshot: ["owner"],
        orderly_mutate: ["owner", "input", "at_ms"],
        orderly_import: ["data"],
        orderly_integrations: ["owner", "command", "input"],
        orderly_sync: ["command", "input"],
        orderly_github: ["owner", "command", "input"],
        orderly_board_sync: ["command", "input"],
      };
      const names = signatures[name];
      if (!names) throw new Error("Unknown fixture RPC");
      try {
        const values = names.map((key) =>
          typeof args[key] === "object" ? JSON.stringify(args[key]) : args[key],
        );
        const result = await pg.transaction(async (tx) => {
          await tx.exec("set local role service_role");
          return tx.query<{ result: T }>(
            `select public.${name}(${names.map((_, i) => "$" + (i + 1)).join(",")}) as result`,
            values,
          );
        });
        return result.rows[0].result;
      } catch (error) {
        const message = (error as Error).message;
        if (/^ORDERLY:\d{3}:/.test(message)) {
          const [, status, ...parts] = message.split(":");
          throw new Problem(parts.join(":"), Number(status));
        }
        throw error;
      }
    },
  };
  return { pg, db };
}

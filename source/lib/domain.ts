import type { Database } from "./db";
import type { Snapshot } from "./types";
import { Problem } from "./problem";
export { Problem } from "./problem";

export function validateMutation(input: Record<string, unknown>) {
  if (input.action !== "timezone") return;
  if (typeof input.timezone !== "string")
    throw new Problem("Choose a valid IANA timezone.");
  try {
    new Intl.DateTimeFormat("en", { timeZone: input.timezone });
  } catch {
    throw new Problem("Choose a valid IANA timezone.");
  }
}

export async function snapshot(
  db: Database,
  userId: string,
): Promise<Snapshot> {
  return db.rpc<Snapshot>("orderly_snapshot", { owner: userId });
}
export async function mutate(
  db: Database,
  userId: string,
  input: Record<string, unknown>,
  now = Date.now(),
) {
  validateMutation(input);
  return db.rpc<{ ok?: boolean; id?: string }>("orderly_mutate", {
    owner: userId,
    input,
    at_ms: now,
  });
}

import { MissingRpc, type Database } from "./db";
import type { Snapshot } from "./types";
import { authenticate, tokenHash } from "./auth";
import { mutate, snapshot, Problem, validateMutation } from "./domain";

type WorkResult = {
  mode: "combined" | "legacy";
  data: Snapshot;
  result?: { ok?: boolean; id?: string };
  timing: { auth: number; mutation: number; snapshot: number };
};
// Allow application-first rollout without breaking existing installations.
// Retry discovery after one minute, so a deployed migration takes effect live.
const retryAfter = new WeakMap<Database, number>();
export async function work(
  db: Database,
  token: string | undefined,
  input?: Record<string, unknown>,
): Promise<WorkResult> {
  if (!token) throw new Problem("Sign in to continue.", 401);
  if (input) validateMutation(input);
  if ((retryAfter.get(db) ?? 0) <= Date.now()) {
    try {
      const value = await db.rpc<Omit<WorkResult, "mode">>("orderly_work", {
        session_hash: tokenHash(token),
        command: input ? "mutate" : "read",
        input: input ?? {},
        at_ms: Date.now(),
      });
      retryAfter.delete(db);
      return { ...value, mode: "combined" };
    } catch (e) {
      // A missing function cannot have committed a write. Never fall back on
      // timeouts, network errors or SQL failures with an uncertain outcome.
      if (!(e instanceof MissingRpc) || e.rpcName !== "orderly_work") throw e;
      retryAfter.set(db, Date.now() + 60000);
    }
  }
  const start = performance.now();
  const owner = await authenticate(db, token);
  const authenticated = performance.now();
  const result = input ? await mutate(db, owner, input) : undefined;
  const mutated = performance.now();
  const data = await snapshot(db, owner);
  return {
    mode: "legacy",
    data,
    result,
    timing: {
      auth: authenticated - start,
      mutation: mutated - authenticated,
      snapshot: performance.now() - mutated,
    },
  };
}

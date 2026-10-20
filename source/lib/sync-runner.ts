import { after } from "next/server";
import type { Database } from "./db";
import { workOnce } from "./integrations";

// Keep queue processing alive after Vercel sends the response. The durable
// Postgres queue, connection leases and generation fences remain authoritative;
// this is the same worker used by the supervised CLI process.
// Each route using this helper declares maxDuration=300. Stop starting pages
// after two minutes to leave time for an in-flight provider request to finish.
type Batch = { promise: Promise<void>; wakeAgain: boolean };
const active = new WeakMap<Database, Batch>();

async function drain(db: Database, batch: Batch) {
  const started = Date.now();
  let pages = 0;
  console.info("Orderly sync batch started.");
  try {
    while (pages < 20 && Date.now() - started < 120000) {
      batch.wakeAgain = false;
      if (!(await workOnce(db))) {
        // A map/webhook may have committed after the claim statement began.
        // Do not lose that wake-up when coalescing concurrent invocations.
        if (batch.wakeAgain) continue;
        break;
      }
      pages++;
    }
    console.info("Orderly sync batch finished.", { pages });
  } catch {
    // Do not print provider payloads, credentials or arbitrary error messages.
    // A failed after-callback must not turn a committed map into a save error.
    console.error(
      "Orderly sync batch could not finish. Check database access, encryption configuration and provider setup.",
    );
  }
}

export function scheduleSync(db: Database) {
  after(async () => {
    let batch = active.get(db);
    if (!batch) {
      batch = { promise: Promise.resolve(), wakeAgain: false };
      batch.promise = drain(db, batch).finally(() => active.delete(db));
      active.set(db, batch);
    } else {
      batch.wakeAgain = true;
    }
    await batch.promise;
  });
}

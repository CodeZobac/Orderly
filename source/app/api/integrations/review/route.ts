import { cookies } from "next/headers";
import { authenticate } from "@/lib/auth";
import { database } from "@/lib/db";
import { failure, originCheck } from "@/lib/http";
import { Problem } from "@/lib/problem";
import { scheduleSync } from "@/lib/sync-runner";

export const maxDuration = 300;
export async function POST(request: Request) {
  try {
    originCheck(request);
    const db = database();
    const owner = await authenticate(
      db,
      (await cookies()).get("orderly_session")?.value,
    );
    const raw = await request.text();
    if (raw.length > 120000)
      throw new Problem("Review request is too large.", 413);
    let input;
    try {
      input = JSON.parse(raw);
    } catch {
      throw new Problem("Invalid review request.");
    }
    if (
      !input ||
      !["apply", "retry"].includes(input.action) ||
      typeof input.sourceId !== "string"
    )
      throw new Problem("Invalid review action.");
    if (
      input.action === "apply" &&
      (!Number.isInteger(input.revision) ||
        !input.decisions ||
        Array.isArray(input.decisions) ||
        typeof input.decisions !== "object" ||
        Object.keys(input.decisions).length > 1500)
    )
      throw new Problem("Invalid review decisions.");
    const result = await db.rpc("orderly_review", {
      owner,
      command: input.action,
      input,
    });
    if (input.action === "retry") scheduleSync(db);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error);
  }
}

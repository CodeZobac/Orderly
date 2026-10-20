import { cookies } from "next/headers";
import { authenticate } from "@/lib/auth";
import { database, MissingRpc } from "@/lib/db";
import { body, failure, originCheck } from "@/lib/http";
import { integrationAction, integrationRpc } from "@/lib/integrations";
import { scheduleSync } from "@/lib/sync-runner";
export const maxDuration = 300;
async function identity() {
  const db = database();
  return {
    db,
    owner: await authenticate(
      db,
      (await cookies()).get("orderly_session")?.value,
    ),
  };
}
export async function GET() {
  try {
    const { db, owner } = await identity();
    const state = await integrationRpc<
      import("@/lib/integration-types").Integrations
    >(db, owner, "list");
    state.connections = state.connections.filter(
      (c) => String(c.provider) !== "github",
    );
    const ids = new Set(state.connections.map((c) => c.id));
    state.sources = state.sources.filter((s) => ids.has(s.connection_id));
    state.notionWebhookConfigured =
      !!process.env.NOTION_WEBHOOK_VERIFICATION_TOKEN;
    try {
      state.reviews = await db.rpc("orderly_review", {
        owner,
        command: "list",
        input: {},
      });
    } catch (error) {
      if (!(error instanceof MissingRpc) || error.rpcName !== "orderly_review")
        throw error;
      state.reviews = [];
      state.reviewSetupRequired = true;
    }
    return Response.json(state, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: Request) {
  try {
    originCheck(request);
    const { db, owner } = await identity();
    const input = await body(request);
    if (input.action === "run") {
      // Authentication/origin checks above protect this queue wake-up. No
      // browser-supplied owner or job IDs reach the service-only worker.
      scheduleSync(db);
      return Response.json(
        { accepted: true },
        { status: 202, headers: { "Cache-Control": "no-store" } },
      );
    }
    const result = await integrationAction(db, owner, input);
    if (input.action === "map" || input.action === "resync") scheduleSync(db);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error);
  }
}

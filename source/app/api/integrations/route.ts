import { cookies } from "next/headers";
import { authenticate } from "@/lib/auth";
import { database } from "@/lib/db";
import { body, failure, originCheck } from "@/lib/http";
import { integrationAction, integrationRpc } from "@/lib/integrations";
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
    return Response.json(
      await integrationAction(db, owner, await body(request)),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return failure(error);
  }
}

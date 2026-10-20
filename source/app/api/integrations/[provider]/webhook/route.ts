import { tokenHash } from "@/lib/auth";
import { database } from "@/lib/db";
import { decrypt, encrypt, signature } from "@/lib/integration-crypto";
import { provider, syncRpc } from "@/lib/integrations";
import { failure } from "@/lib/http";
import { Problem } from "@/lib/problem";
import { captureNotionToken } from "@/lib/notion-webhook-setup";
import { scheduleSync } from "@/lib/sync-runner";
export const maxDuration = 300;
export async function POST(
  request: Request,
  context: { params: Promise<{ provider: string }> },
) {
  try {
    const p = provider((await context.params).provider),
      db = database();
    const raw = await request.text();
    if (raw.length > 1000000) throw new Problem("Webhook too large.", 413);
    if (p === "asana") {
      const token = new URL(request.url).searchParams.get("token");
      if (!token) throw new Problem("Webhook retired.", 410);
      const secret = request.headers.get("x-hook-secret");
      if (secret) {
        if (secret.length > 1000) throw new Problem("Invalid handshake.");
        await syncRpc(db, "hook", { token, secret: encrypt(secret) });
        return new Response(null, {
          status: 204,
          headers: { "X-Hook-Secret": secret },
        });
      }
      const hook = await syncRpc<{
        secret: string;
        source: string;
        connection: string;
        webhookId: string | null;
      }>(db, "hook", { token });
      if (!hook.webhookId)
        throw new Problem("Webhook setup is still pending.", 503);
      if (
        !hook.secret ||
        !signature(
          raw,
          decrypt<string>(hook.secret),
          request.headers.get("x-hook-signature"),
        )
      )
        throw new Problem("Webhook signature rejected.", 403);
      const value = JSON.parse(raw);
      if (!Array.isArray(value.events))
        throw new Problem("Invalid webhook payload.");
      await syncRpc(db, "event", {
        connectionId: hook.connection,
        sourceId: hook.source,
        eventId: tokenHash(raw),
      });
    } else {
      const value = JSON.parse(raw);
      // Only a private operator-created capability may capture unsigned setup.
      if (typeof value.verification_token === "string" && !value.id) {
        await captureNotionToken(
          db,
          new URL(request.url).searchParams.get("setup"),
          value.verification_token,
        );
        return new Response(null, { status: 204 });
      }
      const secret = process.env.NOTION_WEBHOOK_VERIFICATION_TOKEN;
      // A captured unsigned token is never automatically trusted. The operator
      // verifies in Notion and explicitly configures the server HMAC secret.
      if (!secret)
        throw new Problem(
          "Configure the Notion webhook verification token on the server.",
          503,
        );
      if (
        !signature(
          raw,
          secret,
          request.headers.get("x-notion-signature"),
          "sha256=",
        )
      )
        throw new Problem("Webhook signature rejected.", 403);
      if (
        typeof value.id !== "string" ||
        typeof value.workspace_id !== "string"
      )
        throw new Problem("Invalid webhook payload.");
      const connections = await syncRpc<{ id: string }[]>(
        db,
        "notion_connections",
        { workspace: value.workspace_id },
      );
      for (const c of connections)
        await syncRpc(db, "event", { connectionId: c.id, eventId: value.id });
    }
    // Receipt and follow-up jobs committed before acknowledging delivery.
    // Verification handshakes return earlier and never trigger queue work.
    scheduleSync(db);
    return new Response(null, { status: 204 });
  } catch (error) {
    return failure(error);
  }
}

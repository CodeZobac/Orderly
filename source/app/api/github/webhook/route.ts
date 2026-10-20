import { database } from "@/lib/db";
import { signature } from "@/lib/integration-crypto";
import { failure } from "@/lib/http";
import { Problem } from "@/lib/problem";
import { scheduleSync } from "@/lib/sync-runner";
export const maxDuration = 300;
export async function POST(request: Request) {
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw) > 2000000)
      throw new Problem("Webhook too large.", 413);
    const secret = process.env.GITHUB_WEBHOOK_SECRET;
    if (!secret)
      throw new Problem("Configure GITHUB_WEBHOOK_SECRET on the server.", 503);
    if (
      !signature(
        raw,
        secret,
        request.headers.get("x-hub-signature-256"),
        "sha256=",
      )
    )
      throw new Problem("Invalid GitHub signature.", 403);
    const event = request.headers.get("x-github-event"),
      delivery = request.headers.get("x-github-delivery");
    if (!delivery || !/^[a-zA-Z0-9-]{1,100}$/.test(delivery))
      throw new Problem("Invalid delivery ID.");
    if (
      ![
        "pull_request",
        "installation",
        "installation_repositories",
        "github_app_authorization",
      ].includes(event || "")
    )
      return new Response(null, { status: 204 });
    let value: {
      action?: string;
      installation?: { id?: number };
      repository?: { id?: number };
      sender?: { id?: number };
      repositories_removed?: { id: number }[];
    };
    try {
      value = JSON.parse(raw);
    } catch {
      throw new Problem("Invalid webhook JSON.");
    }
    if (!value || typeof value !== "object")
      throw new Problem("Invalid webhook payload.");
    if (
      event !== "github_app_authorization" &&
      !Number.isSafeInteger(value.installation?.id)
    )
      throw new Problem("Invalid installation.");
    if (
      event === "github_app_authorization" &&
      !Number.isSafeInteger(value.sender?.id)
    )
      throw new Problem("Invalid authorization subject.");
    const db = database();
    await db.rpc("orderly_sync", {
      command: "github_event",
      input: {
        event,
        delivery,
        action: value.action,
        installation: String(value.installation?.id || ""),
        repository: String(value.repository?.id || ""),
        userId: String(value.sender?.id || ""),
        removed: (value.repositories_removed || []).map((r) => String(r.id)),
      },
    });
    scheduleSync(db);
    return new Response(null, { status: 204 });
  } catch (error) {
    return failure(error);
  }
}

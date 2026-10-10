import { randomBytes } from "node:crypto";
import type { Database } from "./db";
import { tokenHash } from "./auth";
import { decrypt, encrypt } from "./integration-crypto";
import { Problem } from "./problem";

export type NotionSetupStatus = {
  ownerId: string;
  configured: boolean;
  authorized: boolean;
  active: boolean;
  received: boolean;
  expiresAt: number | null;
};
export function setupAuthorized(owner: string) {
  if (typeof window !== "undefined")
    throw new Error("Webhook setup requires the server.");
  return (
    !!process.env.NOTION_WEBHOOK_SETUP_OWNER_ID &&
    process.env.NOTION_WEBHOOK_SETUP_OWNER_ID === owner
  );
}
function requireOperator(owner: string) {
  if (!setupAuthorized(owner))
    throw new Problem(
      "Notion webhook setup is restricted to the configured deployment owner.",
      403,
    );
}
export function notionSetupRpc<T>(
  db: Database,
  owner: string,
  command: string,
  session: string,
  input: Record<string, unknown> = {},
) {
  return db.rpc<T>("orderly_notion_setup", {
    owner,
    command,
    input: { ...input, session: tokenHash(session) },
  });
}
export async function setupStatus(
  db: Database,
  owner: string,
  session: string,
): Promise<NotionSetupStatus> {
  const configured = !!process.env.NOTION_WEBHOOK_SETUP_OWNER_ID,
    authorized = setupAuthorized(owner);
  const state = authorized
    ? await notionSetupRpc<{
        active: boolean;
        received: boolean;
        expiresAt: number | null;
      }>(db, owner, "status", session)
    : { active: false, received: false, expiresAt: null };
  return { ownerId: owner, configured, authorized, ...state };
}
export async function beginNotionSetup(
  db: Database,
  owner: string,
  session: string,
  requestUrl: string,
) {
  requireOperator(owner);
  // Validate encryption configuration before opening a capture that could never be read.
  encrypt(null);
  const url = new URL("/api/integrations/notion/webhook", requestUrl);
  if (
    url.protocol !== "https:" &&
    !(
      process.env.NODE_ENV !== "production" &&
      ["localhost", "127.0.0.1"].includes(url.hostname)
    )
  )
    throw new Problem("Use a public HTTPS URL for Notion webhook setup.");
  const capability = randomBytes(32).toString("base64url");
  const state = await notionSetupRpc<{ expiresAt: number }>(
    db,
    owner,
    "begin",
    session,
    { hash: tokenHash(capability) },
  );
  url.searchParams.set("setup", capability);
  return { url: url.toString(), expiresAt: state.expiresAt };
}
export async function captureNotionToken(
  db: Database,
  capability: string | null,
  token: string,
) {
  // Unsigned setup payloads have no workspace identity. A private, expiring
  // operator-created capability binds them; they never become trusted HMAC keys.
  if (!capability) return;
  if (
    !/^[A-Za-z0-9_-]{43}$/.test(capability) ||
    !/^[A-Za-z0-9_-]{16,1000}$/.test(token)
  )
    throw new Problem("Invalid Notion verification capture.");
  const operator = process.env.NOTION_WEBHOOK_SETUP_OWNER_ID;
  if (!operator) throw new Problem("Notion webhook setup is disabled.", 403);
  await db.rpc("orderly_notion_setup", {
    owner: operator,
    command: "capture",
    input: { hash: tokenHash(capability), token: encrypt(token) },
  });
}
export async function retrieveNotionToken(
  db: Database,
  owner: string,
  session: string,
) {
  requireOperator(owner);
  const encrypted = await notionSetupRpc<string>(
    db,
    owner,
    "retrieve",
    session,
  );
  return { token: decrypt<string>(encrypted) };
}
export async function discardNotionSetup(
  db: Database,
  owner: string,
  session: string,
) {
  requireOperator(owner);
  await notionSetupRpc(db, owner, "discard", session);
  return { ok: true };
}

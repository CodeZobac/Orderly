import { workGitHub, type GitHubWork } from "./github";
import { randomBytes, randomUUID } from "node:crypto";
import { tokenHash } from "./auth";
import type { Database } from "./db";
import { decrypt, encrypt, equal } from "./integration-crypto";
import type {
  Connection,
  Credentials,
  Mapping,
  Provider,
  Source,
} from "./integration-types";
import {
  api,
  authorization,
  discover,
  exchange,
  importPage,
  inspect,
  ProviderError,
  validateMapping,
} from "./providers";
import { Problem } from "./problem";

export function provider(value: string): Provider {
  if (value !== "asana" && value !== "notion")
    throw new Problem("Unknown provider.", 404);
  return value;
}
export function integrationRpc<T>(
  db: Database,
  owner: string,
  command: string,
  input: Record<string, unknown> = {},
) {
  return db.rpc<T>("orderly_integrations", { owner, command, input });
}
export function syncRpc<T>(
  db: Database,
  command: string,
  input: Record<string, unknown> = {},
) {
  return db.rpc<T>("orderly_sync", { command, input });
}
export async function beginAuthorization(
  db: Database,
  owner: string,
  p: Provider,
  session: string,
) {
  const state = randomBytes(32).toString("base64url"),
    verifier = randomBytes(32).toString("base64url");
  const url = authorization(p, state, verifier);
  await integrationRpc(db, owner, "state", {
    hash: tokenHash(state),
    provider: p,
    verifier: encrypt(verifier),
    session: tokenHash(session),
  });
  return { state, url };
}
export async function finishAuthorization(
  db: Database,
  p: Provider,
  state: string,
  code: string,
) {
  const row = await syncRpc<{ user_id: string; verifier: string }>(
    db,
    "consume_state",
    { hash: tokenHash(state), provider: p },
  );
  const value = await exchange(p, {
    code,
    verifier: decrypt<string>(row.verifier),
  });
  if (!value.account)
    throw new ProviderError(
      "reconnect",
      "Provider returned no account identity. Connect again.",
    );
  await integrationRpc(db, row.user_id, "connect", {
    provider: p,
    account: value.account,
    label: value.label,
    identity: value.identity,
    credentials: encrypt(value.credentials),
  });
}
export async function connection(
  db: Database,
  owner: string,
  id: unknown,
  lease: string,
) {
  if (typeof id !== "string") throw new Problem("Choose a connection.");
  return integrationRpc<Connection & { credentials: string }>(
    db,
    owner,
    "credential",
    { connectionId: id, lease },
  );
}
export async function integrationAction(
  db: Database,
  owner: string,
  input: Record<string, unknown>,
) {
  const action = input.action;
  if (action === "disconnect" || action === "resync" || action === "link")
    return integrationRpc(db, owner, action, input);
  if (!["discover", "inspect", "map", "webhook"].includes(String(action)))
    throw new Problem("Unknown integration action.");
  const lease = randomUUID();
  const c = await connection(db, owner, input.connectionId, lease);
  try {
    let credentials = decrypt<Credentials>(c.credentials);
    const refresh = async () => {
      if (!credentials.refresh_token)
        throw new ProviderError(
          "reconnect",
          "Reconnect this provider to restore access.",
        );
      credentials = (
        await exchange(c.provider, { refresh: credentials.refresh_token })
      ).credentials;
      await integrationRpc(db, owner, "read_credentials", {
        connectionId: c.id,
        lease,
        generation: c.generation,
        credentials: encrypt(credentials),
      });
    };
    if (credentials.expires_at && credentials.expires_at <= Date.now() + 60000)
      await refresh();
    const operation = async () => {
      if (action === "discover")
        return discover(
          c.provider,
          credentials,
          typeof input.cursor === "string" ? input.cursor : undefined,
          typeof input.workspace === "string" ? input.workspace : undefined,
        );
      if (
        typeof input.externalId !== "string" ||
        !/^[a-zA-Z0-9-]{1,200}$/.test(input.externalId)
      )
        throw new Problem("Choose a valid source ID.");
      if (action === "webhook") {
        if (c.provider !== "asana")
          throw new Problem(
            "Configure Notion webhooks in its developer portal.",
          );
        const token = randomBytes(32).toString("base64url");
        await integrationRpc(db, owner, "hook_begin", { ...input, token });
        const result = await api("asana", credentials, "webhooks", {
          data: {
            resource: input.externalId,
            target: `${process.env.ORDERLY_ORIGIN}/api/integrations/asana/webhook?token=${token}`,
          },
        });
        const data = result.data as { gid?: string } | undefined;
        const secret = result["X-Hook-Secret"];
        if (typeof secret !== "string" || !data?.gid)
          throw new Problem(
            "Webhook subscription failed. Try enabling it again.",
            502,
          );
        const hook = await syncRpc<{ secret: string }>(db, "hook", { token });
        if (!hook.secret || !equal(decrypt<string>(hook.secret), secret))
          throw new Problem(
            "Webhook secret did not match the provider response.",
            403,
          );
        await integrationRpc(db, owner, "hook_finish", {
          ...input,
          token,
          secret: hook.secret,
          webhookId: data.gid,
        });
        return { enabled: true };
      }
      const source = await inspect(c.provider, credentials, input.externalId);
      if (action === "inspect") return source;
      if (
        !input.mapping ||
        typeof input.mapping !== "object" ||
        Array.isArray(input.mapping)
      )
        throw new Problem("Choose source properties.");
      const mapping = input.mapping as Mapping;
      if (
        Object.entries(mapping).some(
          ([field, value]) =>
            !["sections", "automation", "doing"].includes(field) &&
            typeof value !== "string",
        )
      )
        throw new Problem("Property IDs must be strings.");
      if (
        mapping.sections &&
        (typeof mapping.sections !== "object" ||
          Array.isArray(mapping.sections) ||
          Object.values(mapping.sections).some(
            (value) => typeof value !== "string" || value.length > 200,
          ))
      )
        throw new Problem(
          "Section status mappings must contain text labels up to 200 characters.",
        );
      validateMapping(c.provider, source, mapping);
      if (c.provider === "notion" && mapping.automation && !c.identity?.user_id)
        throw new Problem(
          "Reconnect Notion to identify your account before enabling timers.",
          409,
        );
      return integrationRpc(db, owner, "map", {
        ...input,
        name: source.name,
        externalId: source.id,
        mapping,
      });
    };
    try {
      return await operation();
    } catch (error) {
      if (
        !(error instanceof ProviderError) ||
        error.kind !== "reconnect" ||
        !credentials.refresh_token
      )
        throw error;
      await refresh();
      return await operation();
    }
  } finally {
    await integrationRpc(db, owner, "read_release", {
      connectionId: c.id,
      lease,
    }).catch(() => undefined);
  }
}

type Work = {
  job: { id: string; lease: string; cursor: string | null; attempts: number };
  source: Source;
  connection: (Connection & { credentials: string }) | GitHubWork["connection"];
};
// One invocation handles one page. PostgreSQL persists progress between invocations.
// Three-minute connection lease serializes refresh across workers; writes are fenced.
export async function workOnce(db: Database) {
  const work = await syncRpc<Work | null>(db, "claim", { lease: randomUUID() });
  if (!work) return false;
  const { job, source, connection: c } = work,
    fence = { jobId: job.id, lease: job.lease };
  if (c.provider === "github")
    return workGitHub(db, {
      job,
      source: source as GitHubWork["source"],
      connection: c,
    });
  try {
    let credentials = decrypt<Credentials>(c.credentials);
    let refreshed = false;
    const refresh = async () => {
      if (!credentials.refresh_token)
        throw new ProviderError(
          "reconnect",
          "Reconnect this provider to restore access.",
        );
      const value = await exchange(c.provider, {
        refresh: credentials.refresh_token,
      });
      credentials = value.credentials;
      refreshed = true;
      await syncRpc(db, "credentials", {
        ...fence,
        credentials: encrypt(credentials),
      });
    };
    if (credentials.expires_at && credentials.expires_at <= Date.now() + 60000)
      await refresh();
    let page;
    try {
      page = await importPage(
        c.provider,
        credentials,
        source.external_id,
        source.mapping,
        job.cursor || undefined,
      );
    } catch (error) {
      if (
        !(error instanceof ProviderError) ||
        error.kind !== "reconnect" ||
        !credentials.refresh_token ||
        refreshed
      )
        throw error;
      await refresh();
      page = await importPage(
        c.provider,
        credentials,
        source.external_id,
        source.mapping,
        job.cursor || undefined,
      );
    }
    await syncRpc(db, "page", { ...fence, ...page });
  } catch (error) {
    // A remap/disconnect may retire the lease while a provider request is in flight.
    if (error instanceof Problem && error.status === 409) return true;
    const known = error instanceof ProviderError;
    try {
      await syncRpc(db, "fail", {
        ...fence,
        status: known ? error.kind : "error",
        error: known
          ? error.message
          : "Sync could not finish. Check server setup or retry.",
        delay: Math.max(
          known ? error.delay : 0,
          Math.min(900000, 1000 * 2 ** job.attempts) +
            Math.floor(Math.random() * 1000),
        ),
      });
    } catch (failure) {
      if (!(failure instanceof Problem && failure.status === 409))
        throw failure;
    }
  }
  return true;
}

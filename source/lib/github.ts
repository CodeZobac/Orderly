import { randomBytes, randomUUID } from "node:crypto";
import type { Database } from "./db";
import { tokenHash } from "./auth";
import { decrypt, encrypt } from "./integration-crypto";
import {
  githubApi,
  githubAuthorization,
  githubExchange,
  githubInstallUrl,
  installations,
  numeric,
  pageNumber,
  pullPage,
  repositories,
  repository,
} from "./github-provider";
import { ProviderError } from "./providers";
import { Problem } from "./problem";
import type { Credentials, Source } from "./integration-types";
import type { GitHubConnection, TaskReference } from "./github-types";

export function githubRpc<T>(
  db: Database,
  owner: string,
  command: string,
  input: Record<string, unknown> = {},
) {
  return db.rpc<T>("orderly_github", { owner, command, input });
}
function sync<T>(
  db: Database,
  command: string,
  input: Record<string, unknown>,
) {
  return db.rpc<T>("orderly_sync", { command, input });
}
export async function beginGitHub(
  db: Database,
  owner: string,
  session: string,
) {
  const state = randomBytes(32).toString("base64url"),
    verifier = randomBytes(32).toString("base64url");
  const url = githubAuthorization(state, verifier);
  await db.rpc("orderly_integrations", {
    owner,
    command: "state",
    input: {
      hash: tokenHash(state),
      provider: "github",
      verifier: encrypt(verifier),
      session: tokenHash(session),
    },
  });
  return { state, url };
}
export async function finishGitHub(db: Database, state: string, code: string) {
  const value = await sync<{
    user_id: string;
    verifier: string;
    session_token: string;
  }>(db, "consume_state", { hash: tokenHash(state), provider: "github" });
  const credentials = await githubExchange({
    code,
    verifier: decrypt<string>(value.verifier),
  });
  const user = await githubApi<{ id: number; login: string }>(
    credentials.access_token,
    "user",
  );
  // Bind to GitHub's verified user ID, never a callback installation_id.
  await db.rpc("orderly_github", {
    owner: value.user_id,
    command: "connect",
    input: {
      provider: "github",
      session: value.session_token,
      account: String(user.id),
      label: user.login,
      credentials: encrypt(credentials),
    },
  });
}
async function refreshed(credentials: Credentials) {
  if (!credentials.expires_at || credentials.expires_at > Date.now() + 60000)
    return credentials;
  if (!credentials.refresh_token)
    throw new ProviderError(
      "reconnect",
      "Reconnect GitHub to renew authorization.",
    );
  return githubExchange({ refresh: credentials.refresh_token });
}
export async function githubAction(
  db: Database,
  owner: string,
  input: Record<string, unknown>,
) {
  const action = String(input.action);
  if (
    ["link", "reject", "unlink", "local", "disconnect", "resync"].includes(
      action,
    )
  )
    return githubRpc(db, owner, action, input);
  if (action === "install") return { url: githubInstallUrl() };
  if (!["installations", "repositories", "map"].includes(action))
    throw new Problem("Unknown GitHub action.");
  const lease = randomUUID();
  const c = await githubRpc<GitHubConnection & { credentials: string }>(
    db,
    owner,
    "credential",
    { connectionId: input.connectionId, lease },
  );
  try {
    const old = decrypt<Credentials>(c.credentials),
      credentials = await refreshed(old);
    if (credentials !== old)
      await githubRpc(db, owner, "read_credentials", {
        connectionId: c.id,
        lease,
        generation: c.generation,
        credentials: encrypt(credentials),
      });
    if (action === "installations")
      return installations(credentials.access_token, pageNumber(input.cursor));
    const installation = numeric(input.installation);
    if (action === "repositories")
      return repositories(
        credentials.access_token,
        installation,
        pageNumber(input.cursor),
      );
    const repo = await repository(
      credentials.access_token,
      installation,
      numeric(input.externalId),
    );
    return githubRpc(db, owner, "map", {
      connectionId: c.id,
      externalId: repo.id,
      name: repo.name,
      projectId: input.projectId,
      lease,
      generation: c.generation,
      mapping: { installation, fullName: repo.name },
    });
  } finally {
    await githubRpc(db, owner, "read_release", {
      connectionId: c.id,
      lease,
    }).catch(() => undefined);
  }
}
export type GitHubWork = {
  job: { id: string; lease: string; cursor: string | null; attempts: number };
  source: Source & { mapping: { installation: string; fullName: string } };
  connection: GitHubConnection & { credentials: string; user_id: string };
};
export async function workGitHub(db: Database, work: GitHubWork) {
  const { job, source, connection: c } = work,
    fence = { jobId: job.id, lease: job.lease };
  try {
    const old = decrypt<Credentials>(c.credentials),
      credentials = await refreshed(old);
    if (credentials !== old)
      await sync(db, "credentials", {
        ...fence,
        credentials: encrypt(credentials),
      });
    const repo = await repository(
      credentials.access_token,
      source.mapping.installation,
      source.external_id,
    );
    const refs = await githubRpc<TaskReference[]>(db, c.user_id, "references");
    const page = await pullPage(
      repo.token,
      repo.name,
      pageNumber(job.cursor),
      refs,
    );
    await sync(db, "github_page", { ...fence, ...page });
  } catch (error) {
    if (error instanceof Problem && error.status === 409) return true;
    const known = error instanceof ProviderError;
    try {
      await sync(db, "fail", {
        ...fence,
        status: known ? error.kind : "error",
        error: known
          ? error.message
          : "GitHub sync could not finish. Check server setup or retry.",
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

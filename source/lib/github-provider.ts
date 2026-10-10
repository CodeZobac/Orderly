import { createHash, createPrivateKey, sign } from "node:crypto";
import { Problem } from "./problem";
import { ProviderError } from "./providers";
import type { Credentials } from "./integration-types";
import type { PullMetadata, Repository, TaskReference } from "./github-types";

export const GITHUB_VERSION = "2026-03-10";
function env(name: string) {
  if (typeof window !== "undefined")
    throw new Error("GitHub credentials require the server.");
  const value = process.env[name];
  if (!value) throw new Problem(`Configure ${name} on the server.`, 503);
  return value;
}
export function githubOrigin() {
  const value = new URL(env("ORDERLY_ORIGIN"));
  if (value.protocol !== "https:" || value.origin !== env("ORDERLY_ORIGIN"))
    throw new Problem("ORDERLY_ORIGIN must be an exact HTTPS origin.", 503);
  return value.origin;
}
export function githubAuthorization(state: string, verifier: string) {
  const url = new URL("https://github.com/login/oauth/authorize");
  url.search = new URLSearchParams({
    client_id: env("GITHUB_CLIENT_ID"),
    state,
    redirect_uri: `${githubOrigin()}/api/github/callback`,
    scope: "offline_access",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
  }).toString();
  return url.toString();
}
export function githubInstallUrl() {
  const slug = env("GITHUB_APP_SLUG");
  if (!/^[a-zA-Z0-9-]+$/.test(slug))
    throw new Problem("Invalid GITHUB_APP_SLUG.", 503);
  return `https://github.com/apps/${slug}/installations/new`;
}
export function appJwt() {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(
    JSON.stringify({ alg: "RS256", typ: "JWT" }),
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      iat: now - 60,
      exp: now + 540,
      iss: env("GITHUB_CLIENT_ID"),
    }),
  ).toString("base64url");
  return `${header}.${payload}.${sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), createPrivateKey(env("GITHUB_APP_PRIVATE_KEY").replace(/\\n/g, "\n"))).toString("base64url")}`;
}
export function numeric(value: unknown) {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,19}$/.test(value))
    throw new Problem("Choose a valid GitHub ID.");
  if (!Number.isSafeInteger(Number(value)))
    throw new Problem("GitHub ID exceeds supported precision.");
  return value;
}
export function pageNumber(value: unknown) {
  if (value === undefined || value === null || value === "") return 1;
  if (typeof value !== "string" || !/^[1-9][0-9]{0,5}$/.test(value))
    throw new Problem("Invalid page.");
  return Number(value);
}
export async function githubApi<T>(
  token: string,
  path: string,
  data?: unknown,
): Promise<T> {
  const response = await fetch(`https://api.github.com/${path}`, {
    method: data === undefined ? "GET" : "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": GITHUB_VERSION,
      "User-Agent": "Orderly",
      "Content-Type": "application/json",
    },
    body: data === undefined ? undefined : JSON.stringify(data),
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(25000),
  });
  if (!response.ok) {
    const details =
      response.status === 403
        ? ((await response.json().catch(() => ({}))) as { message?: string })
        : {};
    const retry = Number(response.headers.get("retry-after"));
    const reset =
      Number(response.headers.get("x-ratelimit-reset")) * 1000 - Date.now();
    if (
      response.status === 429 ||
      (response.status === 403 &&
        (response.headers.get("x-ratelimit-remaining") === "0" ||
          retry > 0 ||
          /rate limit/i.test(details.message || "")))
    )
      throw new ProviderError(
        "error",
        "GitHub rate limit reached. Sync will retry.",
        Math.max(
          Number.isFinite(retry) ? retry * 1000 : 0,
          Number.isFinite(reset) ? reset : 0,
          60000,
        ),
      );
    if (response.status === 401)
      throw new ProviderError(
        "reconnect",
        "Reconnect GitHub to restore authorization.",
      );
    if ([403, 404, 410, 422].includes(response.status))
      throw new ProviderError(
        "inaccessible",
        "GitHub access is unavailable. Review the installation and repository access.",
      );
    throw new ProviderError(
      "error",
      "GitHub is temporarily unavailable. Sync will retry.",
    );
  }
  return response.json() as Promise<T>;
}
export async function githubExchange(
  input: { code: string; verifier: string } | { refresh: string },
): Promise<Credentials> {
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: env("GITHUB_CLIENT_ID"),
      client_secret: env("GITHUB_CLIENT_SECRET"),
      ...("refresh" in input
        ? { grant_type: "refresh_token", refresh_token: input.refresh }
        : {
            code: input.code,
            code_verifier: input.verifier,
            redirect_uri: `${githubOrigin()}/api/github/callback`,
          }),
    }),
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(25000),
  });
  const value = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
  };
  if (!response.ok || value.error || !value.access_token)
    throw new ProviderError(
      "reconnect",
      "GitHub authorization expired or was declined. Connect again.",
    );
  return {
    access_token: value.access_token,
    refresh_token: value.refresh_token,
    expires_at: value.expires_in
      ? Date.now() + value.expires_in * 1000
      : undefined,
  };
}
type GitHubRepo = { id: number; full_name: string };
export async function repository(
  token: string,
  installation: string,
  repoId: string,
) {
  // The user endpoint proves the intersection of user and app permissions.
  const install = await githubApi<{
    app_id: number;
    suspended_at: string | null;
  }>(appJwt(), `app/installations/${numeric(installation)}`);
  if (String(install.app_id) !== env("GITHUB_APP_ID") || install.suspended_at)
    throw new ProviderError(
      "inaccessible",
      "This GitHub installation is suspended or belongs to another app.",
    );
  const repo = await githubApi<GitHubRepo>(
    token,
    `repositories/${numeric(repoId)}`,
  );
  // Repository membership in this installation is checked by a narrowly scoped token.
  const scoped = await githubApi<{ token: string }>(
    appJwt(),
    `app/installations/${installation}/access_tokens`,
    {
      repository_ids: [Number(repoId)],
      permissions: { metadata: "read", pull_requests: "read" },
    },
  );
  const canonical = await githubApi<GitHubRepo>(
    scoped.token,
    `repositories/${repoId}`,
  );
  if (
    canonical.id !== repo.id ||
    !/^[\w.-]+\/[\w.-]+$/.test(canonical.full_name)
  )
    throw new ProviderError(
      "inaccessible",
      "Repository access changed. Map it again.",
    );
  return {
    id: String(repo.id),
    name: canonical.full_name,
    installation,
    token: scoped.token,
  };
}
export async function repositories(
  token: string,
  installation: string,
  page: number,
) {
  const value = await githubApi<{ repositories: GitHubRepo[] }>(
    token,
    `user/installations/${numeric(installation)}/repositories?per_page=100&page=${page}`,
  );
  return {
    repositories: value.repositories.map(
      (r) =>
        ({
          id: String(r.id),
          name: r.full_name,
          installation,
        }) satisfies Repository,
    ),
    cursor: value.repositories.length === 100 ? String(page + 1) : null,
  };
}
export async function installations(token: string, page: number) {
  const value = await githubApi<{
    installations: {
      id: number;
      account: { login: string };
      suspended_at: string | null;
    }[];
  }>(token, `user/installations?per_page=100&page=${page}`);
  return {
    installations: value.installations
      .filter((i) => !i.suspended_at)
      .map((i) => ({ id: String(i.id), name: i.account.login })),
    cursor: value.installations.length === 100 ? String(page + 1) : null,
  };
}
type RawPull = {
  id: number;
  number: number;
  html_url: string;
  title: string;
  body: string | null;
  user: { login: string } | null;
  head: { ref: string };
  base: { ref: string };
  state: string;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  merged_at: string | null;
};
export function normalizePull(value: RawPull): PullMetadata {
  if (
    !Number.isSafeInteger(value.id) ||
    value.id <= 0 ||
    !Number.isSafeInteger(value.number) ||
    value.number <= 0
  )
    throw new ProviderError("error", "GitHub returned an invalid PR identity.");
  const at = (v: string) => {
    const result = Date.parse(v);
    if (!Number.isFinite(result))
      throw new ProviderError("error", "GitHub returned an invalid timestamp.");
    return result;
  };
  if (
    !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/[1-9][0-9]*$/.test(
      value.html_url,
    )
  )
    throw new ProviderError("error", "GitHub returned an invalid PR URL.");
  return {
    id: String(value.id),
    number: value.number,
    url: value.html_url,
    title: value.title.slice(0, 1000),
    author: value.user?.login || "Deleted user",
    branch: value.head.ref.slice(0, 500),
    base: value.base.ref.slice(0, 500),
    state: value.merged_at
      ? "merged"
      : value.state === "closed"
        ? "closed"
        : "open",
    createdAt: at(value.created_at),
    updatedAt: at(value.updated_at),
    closedAt: value.closed_at ? at(value.closed_at) : null,
    mergedAt: value.merged_at ? at(value.merged_at) : null,
  };
}
export function exactSuggestions(text: string, refs: TaskReference[]) {
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const found = new Map<string, string[]>();
  for (const ref of refs) {
    // No title/fuzzy matching. Boundaries reject partial IDs and URL prefixes.
    const id = new RegExp(
      `(?<![A-Za-z0-9])${escape(ref.external_id)}(?![A-Za-z0-9])`,
      "i",
    );
    const url =
      ref.url && new RegExp(`${escape(ref.url)}(?=$|[\\s)\\]>,;])`, "i");
    if ((url && url.test(text)) || id.test(text)) {
      const reason = `${ref.provider} ${url && url.test(text) ? "URL" : "ID"}: ${url && url.test(text) ? ref.url : ref.external_id}`;
      found.set(ref.task_id, [...(found.get(ref.task_id) || []), reason]);
    }
  }
  return [...found].map(([taskId, reasons]) => ({
    taskId,
    reason: reasons.join("; ").slice(0, 1000),
  }));
}
export async function pullPage(
  token: string,
  repo: string,
  page: number,
  refs: TaskReference[],
) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo))
    throw new Problem("Invalid repository name.");
  const values = await githubApi<RawPull[]>(
    token,
    `repos/${repo}/pulls?state=all&sort=created&direction=asc&per_page=100&page=${page}`,
  );
  return {
    pulls: values.map((value) => ({
      metadata: normalizePull(value),
      suggestions: exactSuggestions(
        `${value.title}\n${value.body || ""}\n${value.head.ref}`,
        refs,
      ),
    })),
    cursor: values.length === 100 ? String(page + 1) : null,
  };
}

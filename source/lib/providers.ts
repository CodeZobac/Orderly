import { createHash } from "node:crypto";
import { Problem } from "./problem";
import type {
  Credentials,
  ExternalMetadata,
  Mapping,
  Property,
  Provider,
  SourceOption,
} from "./integration-types";

export const NOTION_VERSION = "2026-03-11";
// Provider responses are validated at their boundary; unsupported properties are ignored.
type ObjectValue = Record<string, unknown>;
function object(value: unknown): ObjectValue {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as ObjectValue)
    : {};
}
function list(value: unknown): ObjectValue[] {
  return Array.isArray(value) ? value.map(object) : [];
}
function string(value: unknown) {
  return typeof value === "string" ? value : "";
}
function rich(value: unknown) {
  return list(value)
    .map((x) => string(x.plain_text) || string(object(x.text).content))
    .join("");
}
export class ProviderError extends Problem {
  constructor(
    public kind: "reconnect" | "inaccessible" | "remap" | "error",
    message: string,
    public delay = 60000,
  ) {
    super(message, kind === "reconnect" ? 401 : 502);
  }
}
export function config(provider: Provider) {
  if (typeof window !== "undefined")
    throw new Error("Provider access requires the server.");
  const prefix = provider.toUpperCase(),
    id = process.env[`${prefix}_CLIENT_ID`],
    secret = process.env[`${prefix}_CLIENT_SECRET`],
    origin = process.env.ORDERLY_ORIGIN;
  if (!id || !secret || !origin)
    throw new Problem(
      `Configure ${prefix}_CLIENT_ID, ${prefix}_CLIENT_SECRET and ORDERLY_ORIGIN on the server.`,
      503,
    );
  const url = new URL(origin);
  if (
    url.protocol !== "https:" &&
    !(
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(url.hostname)
    )
  )
    throw new Problem("OAuth requires an HTTPS origin.", 503);
  return {
    id,
    secret,
    redirect: `${url.origin}/api/integrations/${provider}/callback`,
  };
}
export function authorization(
  provider: Provider,
  state: string,
  verifier: string,
) {
  const { id, redirect } = config(provider);
  const url = new URL(
    provider === "asana"
      ? "https://app.asana.com/-/oauth_authorize"
      : "https://api.notion.com/v1/oauth/authorize",
  );
  url.search = new URLSearchParams({
    client_id: id,
    redirect_uri: redirect,
    response_type: "code",
    state,
  }).toString();
  if (provider === "asana") {
    url.searchParams.set(
      "scope",
      "projects:read tasks:read workspaces:read users:read webhooks:read webhooks:write webhooks:delete",
    );
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set(
      "code_challenge",
      createHash("sha256").update(verifier).digest("base64url"),
    );
  } else url.searchParams.set("owner", "user");
  return url.toString();
}
async function request(url: string, init: RequestInit): Promise<ObjectValue> {
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(25000),
  });
  if (!response.ok) {
    if (response.status === 401)
      throw new ProviderError(
        "reconnect",
        "Authorization expired or was revoked. Reconnect this provider.",
      );
    if ([403, 404].includes(response.status))
      throw new ProviderError(
        "inaccessible",
        "Source access was removed. Restore access, then resync or choose another source.",
      );
    if (response.status === 429) {
      const retry = response.headers.get("retry-after") || "60";
      const seconds = Number(retry);
      const delay = Number.isFinite(seconds)
        ? seconds * 1000
        : Date.parse(retry) - Date.now();
      throw new ProviderError(
        "error",
        "Provider rate limit reached. Sync will retry automatically.",
        Math.max(1000, Number.isFinite(delay) ? delay : 60000),
      );
    }
    if (response.status === 400)
      throw new ProviderError(
        "remap",
        "Provider rejected this configuration. Reconnect for authorization errors, or remap source properties.",
      );
    throw new ProviderError(
      "error",
      "Provider is temporarily unavailable. Sync will retry automatically.",
    );
  }
  if (response.status === 204) return {};
  return object(await response.json());
}
export async function exchange(
  provider: Provider,
  value: { code?: string; verifier?: string; refresh?: string },
) {
  const { id, secret, redirect } = config(provider);
  const payload: Record<string, string> = value.refresh
    ? { grant_type: "refresh_token", refresh_token: value.refresh }
    : {
        grant_type: "authorization_code",
        code: value.code!,
        redirect_uri: redirect,
      };
  const result = await request(
    provider === "asana"
      ? "https://app.asana.com/-/oauth_token"
      : "https://api.notion.com/v1/oauth/token",
    {
      method: "POST",
      headers:
        provider === "asana"
          ? { "Content-Type": "application/x-www-form-urlencoded" }
          : {
              Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
              "Content-Type": "application/json",
              "Notion-Version": NOTION_VERSION,
            },
      body:
        provider === "asana"
          ? new URLSearchParams({
              ...payload,
              client_id: id,
              client_secret: secret,
              ...(value.verifier ? { code_verifier: value.verifier } : {}),
            }).toString()
          : JSON.stringify(payload),
    },
  ).catch((error) => {
    if (error instanceof ProviderError && error.kind === "remap")
      throw new ProviderError(
        "reconnect",
        "Provider authorization failed. Reconnect this provider.",
      );
    throw error;
  });
  if (!string(result.access_token))
    throw new ProviderError(
      "reconnect",
      "Provider returned no access token. Connect again.",
    );
  const credentials: Credentials = {
    access_token: string(result.access_token),
    refresh_token: string(result.refresh_token) || value.refresh,
    ...(typeof result.expires_in === "number"
      ? { expires_at: Date.now() + result.expires_in * 1000 }
      : {}),
  };
  const account =
    provider === "asana"
      ? string(object(result.data).gid)
      : string(result.workspace_id);
  return {
    credentials,
    account,
    label:
      provider === "asana"
        ? string(object(result.data).name) || "Asana"
        : string(result.workspace_name) || "Notion",
  };
}
export async function api(
  provider: Provider,
  credentials: Credentials,
  path: string,
  payload?: unknown,
  method?: string,
) {
  const base =
    provider === "asana"
      ? "https://app.asana.com/api/1.0/"
      : "https://api.notion.com/v1/";
  return request(base + path, {
    method: method || (payload ? "POST" : "GET"),
    headers: {
      Authorization: `Bearer ${credentials.access_token}`,
      "Content-Type": "application/json",
      ...(provider === "notion" ? { "Notion-Version": NOTION_VERSION } : {}),
    },
    ...(payload ? { body: JSON.stringify(payload) } : {}),
  });
}
export async function discover(
  provider: Provider,
  credentials: Credentials,
  cursor?: string,
  workspace?: string,
) {
  if (provider === "asana") {
    const params = new URLSearchParams({
      limit: "100",
      opt_fields: "name,gid",
      ...(cursor ? { offset: cursor } : {}),
    });
    const path = workspace
      ? `projects?workspace=${encodeURIComponent(workspace)}&${params}`
      : `workspaces?${params}`;
    const result = await api(provider, credentials, path);
    return {
      sources: list(result.data).map((x) => ({
        id: string(x.gid),
        name: string(x.name),
        properties: [],
      })),
      cursor: string(object(result.next_page).offset) || null,
      workspaces: !workspace,
    };
  }
  const result = await api(provider, credentials, "search", {
    filter: { value: "data_source", property: "object" },
    page_size: 100,
    ...(cursor ? { start_cursor: cursor } : {}),
  });
  return {
    sources: list(result.results).map((x) => ({
      id: string(x.id),
      name: rich(x.title) || "Untitled data source",
      properties: properties(x),
    })),
    cursor: result.has_more ? string(result.next_cursor) : null,
    workspaces: false,
  };
}
function properties(source: ObjectValue): Property[] {
  return Object.entries(object(source.properties)).map(([name, value]) => {
    const p = object(value);
    return { id: string(p.id), name, type: string(p.type) };
  });
}
export async function inspect(
  provider: Provider,
  credentials: Credentials,
  id: string,
): Promise<SourceOption> {
  const result = await api(
    provider,
    credentials,
    `${provider === "asana" ? "projects" : "data_sources"}/${encodeURIComponent(id)}`,
  );
  const value = provider === "asana" ? object(result.data) : result;
  if (!string(provider === "asana" ? value.gid : value.id))
    throw new ProviderError(
      "error",
      "Provider returned no source identity. Retry discovery.",
    );
  return {
    id: provider === "asana" ? string(value.gid) : string(value.id),
    name:
      provider === "asana"
        ? string(value.name)
        : rich(value.title) || "Untitled data source",
    properties: provider === "asana" ? [] : properties(value),
    archived: value.archived === true || value.in_trash === true,
  };
}
export function validateMapping(
  provider: Provider,
  source: SourceOption,
  mapping: Mapping,
) {
  if (provider === "asana") return;
  for (const [field, types] of Object.entries({
    title: ["title"],
    status: ["status", "select"],
    assignee: ["people"],
    due: ["date"],
  })) {
    const id = mapping[field as keyof Mapping];
    if (
      (!id && field === "title") ||
      (id &&
        !source.properties.some((p) => p.id === id && types.includes(p.type)))
    )
      throw new ProviderError(
        "remap",
        `The ${field} property changed or is missing. Remap this source using its current properties.`,
      );
  }
}
export function normalizeAsana(
  value: ObjectValue,
  sourceId: string,
  mapping: Mapping,
): ExternalMetadata {
  if (!string(value.gid))
    throw new ProviderError(
      "error",
      "Provider returned a task without an ID. Sync will retry.",
    );
  const memberships = list(value.memberships),
    member = memberships.find(
      (x) => string(object(x.project).gid) === sourceId,
    ),
    section = object(member?.section);
  const sectionId = string(section.gid);
  return {
    id: string(value.gid),
    name: string(value.name),
    url: string(value.permalink_url),
    status: value.completed
      ? "Completed"
      : mapping.sections?.[sectionId] || string(section.name) || "Open",
    section: sectionId || null,
    assignee: string(object(value.assignee).name) || null,
    due: string(value.due_at) || string(value.due_on) || null,
    archived: false,
    ambiguous:
      new Set(
        memberships.map((x) => string(object(x.project).gid)).filter(Boolean),
      ).size > 1,
  };
}
export function normalizeNotion(
  value: ObjectValue,
  mapping: Mapping,
): ExternalMetadata {
  const props = Object.values(object(value.properties)).map(object);
  const get = (id?: string) => props.find((p) => p.id === id) || {};
  const status = get(mapping.status),
    title = get(mapping.title);
  if (!string(value.id) || !title.id || !Array.isArray(title.title))
    throw new ProviderError(
      "remap",
      "Task title is missing from this page. Restore property access or remap this source.",
    );
  return {
    id: string(value.id),
    name: rich(title.title) || "Untitled task",
    url: string(value.url),
    status: string(object(status[string(status.type)]).name) || "Open",
    assignee:
      list(get(mapping.assignee).people)
        .map((x) => string(x.name) || string(x.id))
        .join(", ") || null,
    due: string(object(get(mapping.due).date).start) || null,
    archived: value.in_trash === true || value.archived === true,
    ambiguous: false,
  };
}
export async function importPage(
  provider: Provider,
  credentials: Credentials,
  sourceId: string,
  mapping: Mapping,
  cursor?: string,
) {
  const source = await inspect(provider, credentials, sourceId);
  validateMapping(provider, source, mapping);
  if (provider === "asana") {
    const params = new URLSearchParams({
      project: sourceId,
      completed_since: "1970-01-01T00:00:00.000Z",
      limit: "100",
      opt_fields:
        "gid,name,completed,permalink_url,assignee.name,due_at,due_on,memberships.project.gid,memberships.section.gid,memberships.section.name",
      ...(cursor ? { offset: cursor } : {}),
    });
    const result = await api(provider, credentials, `tasks?${params}`);
    if (
      !Array.isArray(result.data) ||
      (result.next_page && !string(object(result.next_page).offset))
    )
      throw new ProviderError(
        "error",
        "Provider returned an incomplete task page. Sync will retry.",
      );
    return {
      tasks: list(result.data).map((x) => ({
        ...normalizeAsana(x, sourceId, mapping),
        archived: source.archived === true,
      })),
      cursor: string(object(result.next_page).offset) || null,
    };
  }
  const result = await api(
    provider,
    credentials,
    `data_sources/${encodeURIComponent(sourceId)}/query`,
    { page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) },
  );
  if (
    !Array.isArray(result.results) ||
    (result.has_more && !string(result.next_cursor))
  )
    throw new ProviderError(
      "error",
      "Provider returned an incomplete task page. Sync will retry.",
    );
  return {
    tasks: list(result.results).map((x) => normalizeNotion(x, mapping)),
    cursor: result.has_more ? string(result.next_cursor) : null,
  };
}

"use client";
import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { Snapshot } from "@/lib/types";
import type {
  Connection,
  Integrations as State,
  Mapping,
  Provider,
  Source,
  SourceOption,
} from "@/lib/integration-types";
import Link from "next/link";
import { Field, Submit } from "./fields";
import { NotionSourceDialog } from "./notion-source-dialog";
import { NotionWebhookSetup } from "./notion-webhook-setup";

function importStatus(source?: Source) {
  if (!source) return { label: "Accessible", tone: "available" };
  if (source.status === "synced" && source.last_success)
    return { label: "Synced", tone: "synced" };
  if (["queued", "syncing"].includes(source.status))
    return { label: "Import queued", tone: "queued" };
  return { label: "Selected for import", tone: "selected" };
}

async function post(
  input: Record<string, unknown>,
  path = "/api/integrations",
) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const value = await response.json();
  if (!response.ok)
    throw new Error(value.error || "Unable to save integration settings.");
  return value;
}
export function Integrations({
  data,
  refresh,
}: {
  data: Snapshot;
  refresh: () => Promise<void>;
}) {
  const [notionSetup, setNotionSetup] = useState<{
    connection: Connection;
    sourceId: string;
    sourceName: string;
    returnFocus: HTMLElement | null;
  } | null>(null);
  const [state, setState] = useState<State | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Connection | null>(null),
    [options, setOptions] = useState<SourceOption[]>([]),
    [source, setSource] = useState<SourceOption | null>(null);
  const [cursor, setCursor] = useState<string | null>(null),
    [workspace, setWorkspace] = useState<string | undefined>(),
    [workspaces, setWorkspaces] = useState(false),
    [mapping, setMapping] = useState<Mapping>({});
  const load = useCallback(async () => {
    const response = await fetch("/api/integrations", { cache: "no-store" });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error);
    setState(value);
    return value as State;
  }, []);
  useEffect(() => {
    const start = setTimeout(() => {
      void load().catch((e) => setError(e.message));
    }, 0);
    return () => clearTimeout(start);
  }, [load]);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Unable to finish. Retry this action.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function connect(p: Provider) {
    await run(async () => {
      const result = await post({}, `/api/integrations/${p}/connect`);
      window.location.assign(result.url);
    });
  }
  async function discover(c: Connection, next?: string, space?: string) {
    const result = await post({
      action: "discover",
      connectionId: c.id,
      cursor: next,
      workspace: space,
    });
    setSelected(c);
    setSource(null);
    setOptions((old) =>
      next
        ? [
            ...old,
            ...result.sources.filter(
              (x: SourceOption) => !old.some((y) => y.id === x.id),
            ),
          ]
        : result.sources,
    );
    setCursor(result.cursor);
    setWorkspace(space);
    setWorkspaces(result.workspaces);
  }
  async function choose(c: Connection, id: string, prior?: Mapping) {
    if (c.provider === "notion") {
      setNotionSetup({
        connection: c,
        sourceId: id,
        sourceName:
          state?.sources.find(
            (item) => item.connection_id === c.id && item.external_id === id,
          )?.name ||
          options.find((item) => item.id === id)?.name ||
          "Notion board",
        returnFocus:
          document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null,
      });
      return;
    }
    const option: SourceOption = await post({
      action: "inspect",
      connectionId: c.id,
      externalId: id,
    });
    setSelected(c);
    setSource(option);
    const unique = (types: string[]) => {
      const fields = option.properties.filter((property) =>
        types.includes(property.type),
      );
      return fields.length === 1 ? fields[0].id : "";
    };
    const existing = state?.sources.find(
      (item) => item.connection_id === c.id && item.external_id === id,
    );
    setMapping(
      prior ||
        existing?.mapping || {
          title: unique(["title"]),
          status: unique(["status", "select"]),
          assignee: unique(["people"]),
          due: unique(["date"]),
          automation: false,
          doing: [],
        },
    );
  }
  async function saveMap(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    if (!selected || !source) return;
    await run(async () => {
      const sections: Record<string, string> = {};
      if (selected.provider === "asana")
        for (const line of String(values.sections || "")
          .split("\n")
          .filter(Boolean)) {
          const split = line.indexOf("=");
          if (split < 1 || !line.slice(split + 1).trim())
            throw new Error(
              "Section mappings use one section ID = status per line.",
            );
          sections[line.slice(0, split).trim()] = line.slice(split + 1).trim();
        }
      await post({
        action: "map",
        connectionId: selected.id,
        externalId: source.id,
        projectId: values.projectId,
        mapping: selected.provider === "asana" ? { sections } : mapping,
      });
      await load();
      await refresh();
      setSource(null);
    });
  }
  const projectSelect = (
    name: string,
    defaultValue?: string,
    required = true,
  ) => (
    <select name={name} required={required} defaultValue={defaultValue || ""}>
      <option value="" disabled>
        Choose billing project
      </option>
      {data.projects.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name} · {p.currency}
        </option>
      ))}
    </select>
  );
  return (
    <section className="integration-workbench" aria-label="Task integrations">
      <div className="section-head">
        <h2>Connected work</h2>
        <button
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await load();
              await refresh();
            })
          }
        >
          Refresh sync status
        </button>
      </div>
      <p>
        Choose the Notion boards to import as projects, or link a source to an
        existing project. Manage task statuses in Notion and track time here.
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="actions">
        {(["asana", "notion"] as Provider[]).map((p) => (
          <button
            className="primary"
            disabled={busy}
            key={p}
            onClick={() => void connect(p)}
          >
            Connect {p === "asana" ? "Asana" : "Notion"}
          </button>
        ))}
      </div>
      <NotionWebhookSetup />
      {state && !state.notionWebhookConfigured && (
        <p role="status">
          Notion live updates need webhook setup on the server. With the sync
          worker running, periodic synchronization still detects changes, but
          timers may be delayed.
        </p>
      )}
      {!state && <p role="status">Loading connections…</p>}
      {state && !state.connections.length && (
        <p>
          No providers connected. Connect a provider to choose your task
          sources.
        </p>
      )}
      {state?.connections.map((c) => (
        <article className="integration-connection" key={c.id}>
          <h3>
            {c.provider === "asana" ? "Asana" : "Notion"} · {c.label}
          </h3>
          <p>
            Status: {c.status}
            {c.error ? ` · ${c.error}` : ""}
          </p>
          {c.provider === "notion" && (
            <>
              <p>Workspace: {c.identity?.workspace_name || c.label}</p>
              <p>
                Connected person:{" "}
                {c.identity?.user_name ||
                  c.identity?.user_id ||
                  "Reconnect to identify your Notion account"}
              </p>
              {!c.identity?.user_id && (
                <p>
                  Imports remain available. Reconnect to enable timers for tasks
                  assigned to your account.
                </p>
              )}
              <p>
                Access includes only resources shared with this connection.
                Choose boards below to see their fields and select what to
                import.
              </p>
            </>
          )}
          <div className="actions">
            {c.status === "connected" && (
              <button
                disabled={busy}
                onClick={() => void run(() => discover(c))}
              >
                Browse accessible sources
              </button>
            )}
            <button disabled={busy} onClick={() => void connect(c.provider)}>
              Reconnect
            </button>
            {c.status !== "disconnected" && (
              <button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await post({ action: "disconnect", connectionId: c.id });
                    await load();
                    if (selected?.id === c.id) {
                      setSelected(null);
                      setSource(null);
                    }
                  })
                }
              >
                Disconnect
              </button>
            )}
          </div>
          {state.sources
            .filter((s) => s.connection_id === c.id)
            .map((s) => (
              <div className="integration-source" key={s.id}>
                <strong>{s.name}</strong>
                <p>
                  <Link href={`/projects#project-${s.project_id}`}>
                    {data.projects.find((p) => p.id === s.project_id)?.name ||
                      "View linked project"}
                  </Link>{" "}
                  <span
                    className="source-status"
                    data-tone={importStatus(s).tone}
                  >
                    {importStatus(s).label}
                  </span>
                </p>
                <p className="muted">
                  Last successful sync:{" "}
                  {s.last_success
                    ? new Date(s.last_success).toISOString()
                    : "Not yet"}
                </p>
                {c.provider === "notion" && (
                  <p>
                    Automatic timers:{" "}
                    {s.mapping.automation
                      ? "Enabled · assigned to connected person only"
                      : "Off"}
                  </p>
                )}
                {s.error && <p role="status">{s.error}</p>}
                <div className="actions">
                  <button
                    disabled={busy || c.status !== "connected"}
                    onClick={() =>
                      void run(async () => {
                        await post({
                          action: "resync",
                          connectionId: c.id,
                          sourceId: s.id,
                        });
                        await load();
                      })
                    }
                  >
                    Resync
                  </button>
                  <button
                    disabled={busy || c.status !== "connected"}
                    onClick={() =>
                      void run(() => choose(c, s.external_id, s.mapping))
                    }
                  >
                    Remap source
                  </button>
                  {c.provider === "asana" && (
                    <button
                      disabled={busy || c.status !== "connected"}
                      onClick={() =>
                        void run(async () => {
                          await post({
                            action: "webhook",
                            connectionId: c.id,
                            sourceId: s.id,
                            externalId: s.external_id,
                          });
                          await load();
                        })
                      }
                    >
                      {s.webhook_id ? "Renew webhook" : "Enable webhook"}
                    </button>
                  )}
                </div>
              </div>
            ))}
        </article>
      ))}
      {selected && !source && (
        <div className="integration-source-picker">
          <h3>
            {workspaces
              ? "Choose an Asana workspace"
              : `Choose a ${selected.provider === "notion" ? "Notion data source" : "project"}`}
          </h3>
          {options.map((o) => (
            <button
              key={o.id}
              className="source-choice"
              title={o.name}
              disabled={busy}
              onClick={() =>
                void run(() =>
                  workspaces
                    ? discover(selected, undefined, o.id)
                    : choose(selected, o.id),
                )
              }
            >
              <strong>{o.name}</strong>
              <span
                className="source-status"
                data-tone={
                  importStatus(
                    state?.sources.find(
                      (item) =>
                        item.connection_id === selected.id &&
                        item.external_id === o.id,
                    ),
                  ).tone
                }
              >
                {
                  importStatus(
                    state?.sources.find(
                      (item) =>
                        item.connection_id === selected.id &&
                        item.external_id === o.id,
                    ),
                  ).label
                }
              </span>
            </button>
          ))}
          {cursor && (
            <button
              disabled={busy}
              onClick={() =>
                void run(() => discover(selected, cursor, workspace))
              }
            >
              Load more
            </button>
          )}
          {!options.length && (
            <p>
              No accessible sources. Share the Notion database with this
              integration or check Asana workspace access.
            </p>
          )}
        </div>
      )}
      {selected?.provider === "asana" && source && (
        <form
          className="integration-mapping"
          key={source.id}
          onSubmit={saveMap}
        >
          <h3>Map {source.name}</h3>
          <p>
            Imported tasks keep their original billing attribution. Remapping
            applies to newly imported tasks.
          </p>
          <Field label="Orderly billing project">
            {projectSelect(
              "projectId",
              state?.sources.find(
                (item) =>
                  item.connection_id === selected.id &&
                  item.external_id === source.id,
              )?.project_id,
            )}
          </Field>
          {!data.projects.length && (
            <p>Create a billing project in Projects before importing.</p>
          )}
          <Field label="Section status mappings (optional, section ID = status per line)">
            <textarea
              name="sections"
              defaultValue={Object.entries(mapping.sections || {})
                .map(([id, status]) => `${id} = ${status}`)
                .join("\n")}
            />
          </Field>
          <div className="actions">
            <Submit busy={busy} disabled={!data.projects.length}>
              Save mapping & import
            </Submit>
            <button
              type="button"
              disabled={busy}
              onClick={() => setSource(null)}
            >
              Back to sources
            </button>
          </div>
        </form>
      )}
      {notionSetup && (
        <NotionSourceDialog
          key={`${notionSetup.connection.id}-${notionSetup.sourceId}`}
          connection={notionSetup.connection}
          sourceId={notionSetup.sourceId}
          sourceName={notionSetup.sourceName}
          returnFocus={notionSetup.returnFocus}
          existing={state?.sources.find(
            (item) =>
              item.connection_id === notionSetup.connection.id &&
              item.external_id === notionSetup.sourceId,
          )}
          projects={data.projects}
          reload={load}
          refresh={refresh}
          onDismiss={() => setNotionSetup(null)}
        />
      )}
      {state?.tasks.some(
        (t) => !t.task_id || (t.metadata.ambiguous && !t.explicit_link),
      ) && (
        <p role="status">
          Some imported tasks need a billing assignment. Open Imported tasks &
          billing links below to confirm their project.
        </p>
      )}
      {!!state?.tasks.length && (
        <details>
          <summary>
            Imported tasks & billing links ({state.tasks.length})
          </summary>
          {state.tasks.map((t) => (
            <form
              className="integration-mapping"
              key={t.id}
              onSubmit={(event) => {
                event.preventDefault();
                const values = Object.fromEntries(
                  new FormData(event.currentTarget),
                );
                void run(async () => {
                  await post({
                    action: "link",
                    externalTaskId: t.id,
                    ...values,
                  });
                  await load();
                  await refresh();
                });
              }}
            >
              <h3>{t.metadata.name}</h3>
              <p>
                {
                  state.connections.find((c) => c.id === t.connection_id)
                    ?.provider
                }{" "}
                · {t.metadata.status}
                {t.metadata.archived ? " · archived" : ""}
              </p>
              {/^https:\/\//.test(t.metadata.url) && (
                <p>
                  <a href={t.metadata.url} target="_blank" rel="noreferrer">
                    Open in provider
                  </a>
                </p>
              )}
              {t.metadata.ambiguous && !t.explicit_link && (
                <p>
                  Billing assignment required: this Asana task belongs to
                  several projects. Choose one billing project or link an
                  existing task.
                </p>
              )}
              <p>
                Link explicitly before tracking. A task with recorded time keeps
                its existing attribution.
              </p>
              <Field label="Link an Orderly task">
                <select name="taskId" defaultValue={t.task_id || ""}>
                  <option value="">
                    Create one task in the billing project
                  </option>
                  {data.tasks.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name} ·{" "}
                      {data.projects.find((p) => p.id === x.project_id)?.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Billing project (when creating a task)">
                {projectSelect("projectId", undefined, false)}
              </Field>
              <Submit busy={busy}>Confirm assignment</Submit>
            </form>
          ))}
        </details>
      )}
      <details className="integration-sync-help">
        <summary>About synchronization</summary>
        <p className="muted">
          Sync runs while the server worker is active. Notion webhooks require
          setup in the developer portal. Disconnect removes stored credentials
          and retains recorded work.
        </p>
      </details>
    </section>
  );
}

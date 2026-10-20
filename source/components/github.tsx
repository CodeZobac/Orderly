"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { Snapshot } from "@/lib/types";
import type {
  GitHubSnapshot,
  Repository,
  PullRequest,
} from "@/lib/github-types";
import { duration } from "@/lib/time";
import { Field, Submit } from "./fields";
import { Select } from "./select";

async function post(input: Record<string, unknown>, path = "/api/github") {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const value = await response.json();
  if (!response.ok)
    throw new Error(value.error || "Unable to save GitHub settings.");
  return value;
}
export function GitHubEvidence({
  data,
  refresh,
  taskId,
  settings = false,
  remindersOnly = false,
  onStart,
}: {
  data: Snapshot;
  refresh: () => Promise<void>;
  taskId?: string;
  settings?: boolean;
  remindersOnly?: boolean;
  onStart?: (taskId: string) => Promise<boolean>;
}) {
  const [state, setState] = useState<GitHubSnapshot | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [connectionId, setConnectionId] = useState(""),
    [installs, setInstalls] = useState<{ id: string; name: string }[]>([]),
    [installCursor, setInstallCursor] = useState<string | null>(null);
  const [repos, setRepos] = useState<Repository[]>([]),
    [repoCursor, setRepoCursor] = useState<string | null>(null),
    [installation, setInstallation] = useState("");
  const load = useCallback(async () => {
    const response = await fetch("/api/github", { cache: "no-store" });
    const value = await response.json();
    if (!response.ok)
      throw new Error(value.error || "Unable to load GitHub evidence.");
    setState(value);
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => {
      void load().catch((e) => setError(e.message));
    }, 0);
    return () => clearTimeout(timer);
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
  async function mutate(input: Record<string, unknown>) {
    await post(input);
    await load();
    await refresh();
  }
  async function discover(id: string, cursor?: string) {
    const result = await post({
      action: "installations",
      connectionId: id,
      cursor,
    });
    setConnectionId(id);
    setInstalls((old) =>
      cursor ? [...old, ...result.installations] : result.installations,
    );
    setInstallCursor(result.cursor);
    if (!cursor) {
      setRepos([]);
      setInstallation("");
    }
  }
  async function discoverRepos(id: string, cursor?: string) {
    const result = await post({
      action: "repositories",
      connectionId,
      installation: id,
      cursor,
    });
    setInstallation(id);
    setRepos((old) =>
      cursor ? [...old, ...result.repositories] : result.repositories,
    );
    setRepoCursor(result.cursor);
  }
  const taskName = (id: string) =>
    data.tasks.find((t) => t.id === id)?.name || "Task";
  const elapsed = (id: string) =>
    data.entries
      .filter((e) => e.task_id === id && e.end !== null)
      .reduce((sum, e) => sum + e.end! - e.start, 0);
  const taskOptions = data.tasks
    .filter((task) => !task.review_blocked)
    .map((t) => ({
      value: t.id,
      label: t.name,
      group: data.projects.find((p) => p.id === t.project_id)?.name,
    }));
  const projectOptions = data.projects.map((p) => ({
    value: p.id,
    label: p.name,
  }));
  const formData = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    return Object.fromEntries(new FormData(event.currentTarget));
  };
  const activeTimers = data.entries.filter((e) => e.end === null);
  const timerLimit =
    data.user.timer_limit === undefined ? 2 : data.user.timer_limit;
  const atCapacity = timerLimit !== null && activeTimers.length >= timerLimit;
  function pullCard(pr: PullRequest) {
    const links = state!.links.filter((l) => l.pr_id === pr.id),
      confirmed = links.filter((l) => l.status === "confirmed"),
      suggestions = links.filter((l) => l.status === "suggested");
    const source = state!.sources.find((s) => s.id === pr.source_id);
    return (
      <article className="evidence-card" key={pr.id}>
        <div className="section-head">
          <div>
            <span className="eyebrow">
              {source?.name} · #{pr.metadata.number}
            </span>
            <h3>
              <a href={pr.metadata.url} target="_blank" rel="noreferrer">
                {pr.metadata.title}
              </a>
            </h3>
          </div>
          <span className="provider-badge">
            {pr.metadata.state}
            {!pr.available ? " · unavailable" : ""}
          </span>
        </div>
        <p className="muted">
          {pr.metadata.author} · {pr.metadata.branch} → {pr.metadata.base}
        </p>
        {confirmed.length ? (
          <ul className="evidence-links">
            {confirmed.map((l) => (
              <li key={l.task_id}>
                <Link href={`/tasks/${l.task_id}`}>{taskName(l.task_id)}</Link>
                <span>{duration(elapsed(l.task_id))} recorded on task</span>
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(() =>
                      mutate({
                        action: "unlink",
                        prId: pr.id,
                        taskId: l.task_id,
                      }),
                    )
                  }
                >
                  Unlink
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="notice">
            Review reminder: this PR has no confirmed task link.
          </p>
        )}
        {suggestions.length > 0 && (
          <div className="evidence-suggestions">
            <h4>
              {suggestions.length > 1
                ? "Several exact matches — confirm each intended link"
                : "Exact reference — confirm the task link"}
            </h4>
            {suggestions.map((l) => (
              <div key={l.task_id}>
                <Link href={`/tasks/${l.task_id}`}>{taskName(l.task_id)}</Link>
                <p className="muted">{l.reason}</p>
                <div className="button-row">
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run(() =>
                        mutate({
                          action: "link",
                          prId: pr.id,
                          taskId: l.task_id,
                        }),
                      )
                    }
                  >
                    Confirm link
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run(() =>
                        mutate({
                          action: "reject",
                          prId: pr.id,
                          taskId: l.task_id,
                        }),
                      )
                    }
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        <form
          onSubmit={(e) => {
            const input = formData(e);
            void run(() => mutate({ ...input, action: "link", prId: pr.id }));
          }}
        >
          <Field label="Link another task">
            <Select
              name="taskId"
              required
              defaultValue={taskId || ""}
              placeholder="Choose a canonical task"
              options={taskOptions}
            />
          </Field>
          <Submit busy={busy}>Link task</Submit>
        </form>
        {!confirmed.length && (
          <details>
            <summary>Create a local task from this PR</summary>
            <form
              onSubmit={(e) => {
                const input = formData(e);
                void run(() =>
                  mutate({ ...input, action: "local", prId: pr.id }),
                );
              }}
            >
              <Field label="Explicit billing project">
                <Select
                  name="projectId"
                  required
                  placeholder="Choose a billing project"
                  options={projectOptions}
                />
              </Field>
              <Submit busy={busy}>Create and link local task</Submit>
            </form>
          </details>
        )}
        {onStart && (
          <form
            onSubmit={(e) => {
              const input = formData(e);
              void run(async () => {
                if (await onStart(String(input.taskId))) await load();
              });
            }}
          >
            <Field label="Record time on a canonical task">
              <Select
                name="taskId"
                required
                defaultValue={taskId || ""}
                placeholder="Choose a confirmed linked task"
                options={confirmed
                  .filter(
                    (link) =>
                      !data.tasks.find((task) => task.id === link.task_id)
                        ?.review_blocked,
                  )
                  .map((l) => {
                    const running = activeTimers.some(
                      (entry) => entry.task_id === l.task_id,
                    );
                    return {
                      value: l.task_id,
                      label: taskName(l.task_id),
                      hint: running ? "Running" : undefined,
                      disabled: running,
                    };
                  })}
              />
            </Field>
            <Submit busy={busy} disabled={atCapacity}>
              Start timer on selected task
            </Submit>
          </form>
        )}
        <details>
          <summary>PR events and link corrections</summary>
          <ul className="evidence-timeline">
            {state!.events
              .filter((e) => e.pr_id === pr.id)
              .sort((a, b) => a.at - b.at)
              .map((e) => (
                <li key={`${e.kind}:${e.at}`}>
                  <time>
                    {new Date(e.at).toLocaleString(undefined, {
                      timeZone: data.user.timezone,
                    })}
                  </time>
                  <span>PR {e.kind}</span>
                </li>
              ))}
            {state!.audit
              .filter((a) => a.pr_id === pr.id)
              .sort((a, b) => a.at - b.at)
              .map((a, i) => (
                <li key={`audit:${i}`}>
                  <time>
                    {new Date(a.at).toLocaleString(undefined, {
                      timeZone: data.user.timezone,
                    })}
                  </time>
                  <span>
                    {taskName(a.task_id)}: {a.before_status || "unlinked"} →{" "}
                    {a.after_status}
                  </span>
                </li>
              ))}
          </ul>
        </details>
      </article>
    );
  }
  const pulls =
    state?.pulls.filter(
      (p) =>
        !taskId ||
        state.links.some(
          (l) =>
            l.pr_id === p.id && l.task_id === taskId && l.status !== "rejected",
        ),
    ) || [];
  if (remindersOnly) {
    const unlinked = data.tasks.filter(
      (t) =>
        elapsed(t.id) > 0 &&
        !state?.links.some(
          (l) => l.task_id === t.id && l.status === "confirmed",
        ),
    );
    const pullsWithoutTasks =
      state?.pulls.filter(
        (p) =>
          !state.links.some(
            (l) => l.pr_id === p.id && l.status === "confirmed",
          ),
      ) || [];
    return (
      <section className="github-evidence">
        <div className="section-head">
          <h2>Evidence review reminders</h2>
          <Link href="/settings/connections">Review GitHub links</Link>
        </div>
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : !state ? (
          <p role="status">Loading reminders…</p>
        ) : (
          <>
            <p className="muted">
              {unlinked.length} task(s) with recorded time have no confirmed PR
              link. {pullsWithoutTasks.length} imported PR(s) have no confirmed
              task. Links are optional for work without a PR.
            </p>
            {unlinked.length > 0 && (
              <ul>
                {unlinked.map((t) => (
                  <li key={t.id}>
                    <Link href={`/tasks/${t.id}`}>{t.name}</Link> ·{" "}
                    {duration(elapsed(t.id))}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>
    );
  }
  return (
    <section className="github-evidence">
      <div className="section-head">
        <div>
          <span className="eyebrow">Work evidence</span>
          <h2>
            {settings
              ? "GitHub connections & pull requests"
              : "Linked pull requests"}
          </h2>
        </div>
        <button disabled={busy} onClick={() => void run(load)}>
          Refresh evidence
        </button>
      </div>
      <p className="muted">
        Recorded task intervals determine hours. PR events provide context;
        linking work never adds or moves time.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {settings && (
        <>
          <div className="button-row">
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const value = await post({}, "/api/github/connect");
                  window.location.assign(value.url);
                })
              }
            >
              Connect / reconnect GitHub
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const value = await post({ action: "install" });
                  window.open(value.url, "_blank", "noopener,noreferrer");
                })
              }
            >
              Select repositories
            </button>
          </div>
          {state?.connections.map((c) => (
            <div className="evidence-card" key={c.id}>
              <h3>
                {c.label} · {c.status}
              </h3>
              {c.error && <p className="error">{c.error}</p>}
              <div className="button-row">
                <button
                  disabled={busy || c.status !== "connected"}
                  onClick={() => void run(() => discover(c.id))}
                >
                  Choose installation
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(() =>
                      mutate({ action: "disconnect", connectionId: c.id }),
                    )
                  }
                >
                  Disconnect
                </button>
              </div>
            </div>
          ))}
          {installs.length > 0 && (
            <div className="evidence-card">
              <h3>Accessible installations</h3>
              <div className="button-row">
                {installs.map((i) => (
                  <button
                    key={i.id}
                    disabled={busy}
                    onClick={() => void run(() => discoverRepos(i.id))}
                  >
                    {i.name}
                  </button>
                ))}
                {installCursor && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run(() => discover(connectionId, installCursor))
                    }
                  >
                    More installations
                  </button>
                )}
              </div>
            </div>
          )}
          {connectionId && !installs.length && (
            <p className="notice">
              No accessible installation found. Install the App, then choose the
              installation again.
            </p>
          )}
          {repos.length > 0 && (
            <div className="evidence-card">
              <h3>Map a repository to a project</h3>
              <form
                onSubmit={(e) => {
                  const input = formData(e);
                  void run(() =>
                    mutate({
                      ...input,
                      action: "map",
                      connectionId,
                      installation,
                    }),
                  );
                }}
              >
                <Field label="Repository">
                  <Select
                    name="externalId"
                    required
                    placeholder="Choose repository"
                    options={repos.map((r) => ({
                      value: String(r.id),
                      label: r.name,
                    }))}
                  />
                </Field>
                <Field label="Billing project">
                  <Select
                    name="projectId"
                    required
                    placeholder="Choose a billing project"
                    options={projectOptions}
                  />
                </Field>
                <Submit busy={busy}>Map and import pull requests</Submit>
              </form>
              {repoCursor && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(() => discoverRepos(installation, repoCursor))
                  }
                >
                  More repositories
                </button>
              )}
            </div>
          )}
          {state?.sources.map((s) => (
            <div className="evidence-card" key={s.id}>
              <h3>{s.name}</h3>
              <p>
                {data.projects.find((p) => p.id === s.project_id)?.name} ·{" "}
                {s.status}
              </p>
              {s.error && <p className="error">{s.error}</p>}
              <p className="muted">
                {s.last_success
                  ? `Last sync: ${new Date(s.last_success).toLocaleString(undefined, { timeZone: data.user.timezone })}`
                  : "Waiting for the sync worker"}
              </p>
              <button
                disabled={busy}
                onClick={() =>
                  void run(() =>
                    mutate({
                      action: "resync",
                      connectionId: s.connection_id,
                      sourceId: s.id,
                    }),
                  )
                }
              >
                Reconcile repository
              </button>
            </div>
          ))}
        </>
      )}
      {taskId && (
        <div className="evidence-sources">
          <h3>Source task details</h3>
          {data.tasks.find((t) => t.id === taskId)?.external?.length ? (
            data.tasks
              .find((t) => t.id === taskId)!
              .external!.map((e, i) => (
                <p key={i}>
                  <a href={e.url} target="_blank" rel="noreferrer">
                    {e.provider}: {e.name}
                  </a>{" "}
                  · {e.status}
                  {!e.available ? " · unavailable" : ""}
                </p>
              ))
          ) : (
            <p className="muted">Local task; no board source linked.</p>
          )}
          <p>
            {duration(elapsed(taskId))} recorded on this task, counted once
            across all linked PRs.
          </p>
        </div>
      )}
      {state ? (
        pulls.length ? (
          <div className="evidence-grid">{pulls.map(pullCard)}</div>
        ) : (
          <p className="muted">
            {taskId
              ? "No PR evidence linked yet. Link this task from GitHub in Connections."
              : "No imported pull requests yet."}
          </p>
        )
      ) : (
        !error && <p role="status">Loading GitHub evidence…</p>
      )}
    </section>
  );
}

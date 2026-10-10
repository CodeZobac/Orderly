"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { Entry, Snapshot } from "@/lib/types";
import { dailyTotals, dayKey, duration, weekDays } from "@/lib/time";
import { Field, Submit } from "./fields";
import BranchedMenu, { type BranchedMenuItem } from "./branched-menu";
import {
  Rocket01Icon,
  Layers01Icon,
  Download04Icon,
  Settings02Icon,
} from "@hugeicons/core-free-icons";

const WORKSPACE_MENU: BranchedMenuItem[] = [
  {
    label: "Workspace",
    children: [
      { value: "/", href: "/", label: "Today", icon: Rocket01Icon },
      {
        value: "/projects",
        href: "/projects",
        label: "Projects",
        icon: Layers01Icon,
      },
      {
        value: "/timesheet",
        href: "/timesheet",
        label: "Timesheet",
        icon: Download04Icon,
      },
      {
        value: "/settings",
        href: "/settings",
        label: "Settings",
        icon: Settings02Icon,
      },
    ],
  },
];
import { Integrations } from "./integrations";
import { GitHubEvidence } from "./github";

type Input = Record<string, unknown>;
function form(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
  return Object.fromEntries(new FormData(event.currentTarget));
}
function utcValue(value: FormDataEntryValue) {
  return Date.parse(`${value}Z`);
}
function datetime(ms: number) {
  return new Date(ms).toISOString().slice(0, 23);
}

export default function Tracker() {
  const path = usePathname();
  const [data, setData] = useState<Snapshot | null>(null),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [register, setRegister] = useState(false),
    [tick, setTick] = useState(0),
    [offset, setOffset] = useState(0),
    [retry, setRetry] = useState<Input | null>(null),
    [editing, setEditing] = useState<Entry | null>(null),
    [undo, setUndo] = useState<Entry | null>(null),
    [zones, setZones] = useState<string[]>(["UTC"]);
  const accept = useCallback((value: Snapshot) => {
    setData(value);
    setOffset(value.now - Date.now());
  }, []);
  const refreshing = useRef(false);
  const lastRefreshAt = useRef(0);
  const refresh = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    lastRefreshAt.current = Date.now();
    try {
      const response = await fetch("/api/work", { cache: "no-store" });
      if (response.status === 401) {
        setData(null);
        return;
      }
      const value = await response.json();
      if (!response.ok) throw new Error(value.error);
      accept(value);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Unable to load saved data. Check your connection and retry.",
      );
    } finally {
      refreshing.current = false;
      setLoading(false);
    }
  }, [accept]);
  useEffect(() => {
    const initial = setTimeout(() => {
      // ICU timezone lists vary across runtimes; build suggestions after mount
      // and deduplicate because some browsers already include UTC.
      const supported =
        typeof Intl.supportedValuesOf === "function"
          ? Intl.supportedValuesOf("timeZone")
          : [];
      setZones([...new Set(["UTC", ...supported])]);
      void refresh();
    }, 0);
    // Refresh on return to the app, never on an idle polling schedule.
    // Focus and visibility often fire together; dedupe and limit these refreshes.
    const onReturn = () => {
      if (
        document.visibilityState === "visible" &&
        Date.now() - lastRefreshAt.current >= 60000
      )
        void refresh();
    };
    window.addEventListener("focus", onReturn);
    document.addEventListener("visibilitychange", onReturn);
    return () => {
      clearTimeout(initial);
      window.removeEventListener("focus", onReturn);
      document.removeEventListener("visibilitychange", onReturn);
    };
  }, [refresh]);
  useEffect(() => {
    const timer = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  async function save(input: Input) {
    const payload = input.key ? input : { ...input, key: crypto.randomUUID() };
    setBusy(true);
    setError("");
    setRetry(null);
    try {
      const response = await fetch("/api/work", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const value = await response.json();
      if (!response.ok) {
        if (response.status >= 500) setRetry(payload);
        throw new Error(value.error);
      }
      accept(value.data);
      return true;
    } catch (e) {
      if (e instanceof TypeError) setRetry(payload);
      setError(
        e instanceof Error
          ? e.message
          : "Unable to save. Retry with the same request.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function auth(event: FormEvent<HTMLFormElement>) {
    const input = form(event);
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...input,
          action: register ? "register" : "login",
        }),
      });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error);
      await refresh();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Unable to sign in. Check your connection.",
      );
    } finally {
      setBusy(false);
    }
  }
  const status = (
    <>
      {error && (
        <div className="notice error" role="alert">
          <strong>Request failed</strong>
          <p>{error}</p>
          {retry ? (
            <button disabled={busy} onClick={() => void save(retry)}>
              Retry save
            </button>
          ) : (
            <button
              disabled={busy}
              onClick={() => {
                setError("");
                void refresh();
              }}
            >
              Refresh data
            </button>
          )}
        </div>
      )}
    </>
  );
  if (loading)
    return (
      <main className="auth">
        <h1>Orderly</h1>
        <p role="status">Loading your workspace…</p>
        {status}
      </main>
    );
  if (!data)
    return (
      <main className="auth">
        <Link className="wordmark" href="/">
          Orderly<span> / time well recorded</span>
        </Link>
        <section>
          <p className="lede">A clear record of your working day.</p>
          <h1>{register ? "Create your workspace" : "Welcome back"}</h1>
          <p>Clients, tasks, and the time you actually spend.</p>
          {status}
          <form onSubmit={auth}>
            <Field label="Email">
              <input
                name="email"
                type="email"
                autoComplete="email"
                required
                maxLength={254}
              />
            </Field>
            <Field label="Password · 12–128 characters">
              <input
                name="password"
                type="password"
                autoComplete={register ? "new-password" : "current-password"}
                minLength={12}
                maxLength={128}
                required
              />
            </Field>
            <Submit busy={busy}>
              {register ? "Create account" : "Sign in"}
            </Submit>
          </form>
          <button
            className="text-button"
            disabled={busy}
            onClick={() => setRegister(!register)}
          >
            {register
              ? "Already registered? Sign in"
              : "New here? Create account"}
          </button>
        </section>
        <footer>Private workspace. No integrations connected.</footer>
      </main>
    );
  const now = tick ? tick + offset : data.now,
    active = data.entries.find((e) => e.end === null),
    totals = dailyTotals(data.entries, data.user.timezone),
    days = weekDays(now, data.user.timezone),
    week = days.reduce((sum, d) => sum + (totals[d] || 0), 0);
  const taskName = (id: string) =>
    data.tasks.find((t) => t.id === id)?.name || "Task";
  const projectName = (id: string) => {
    const task = data.tasks.find((t) => t.id === id);
    return (
      data.projects.find((p) => p.id === task?.project_id)?.name || "Project"
    );
  };
  const taskSelect = (selected?: string) => (
    <select name="taskId" defaultValue={selected} required>
      <option value="">Choose a task</option>
      {data.tasks.map((t) => (
        <option key={t.id} value={t.id}>
          {projectName(t.id)} / {t.name}
        </option>
      ))}
    </select>
  );
  const view = path.startsWith("/projects")
    ? "Projects"
    : path.startsWith("/tasks/")
      ? "Task"
      : path.startsWith("/timesheet")
        ? "Timesheet"
        : path.startsWith("/settings")
          ? "Settings"
          : "Today";
  const selectedTask = path.startsWith("/tasks/")
    ? data.tasks.find((t) => t.id === path.split("/")[2])
    : null;
  async function create(event: FormEvent<HTMLFormElement>, action: string) {
    const element = event.currentTarget;
    const input = form(event);
    if (await save({ ...input, action })) element.reset();
  }
  function entries(list: Entry[]) {
    return list.length ? (
      <div className="entry-list">
        {list.map((entry) => (
          <article className="entry" key={entry.id}>
            <div>
              <Link className="task-link" href={`/tasks/${entry.task_id}`}>
                {taskName(entry.task_id)}
              </Link>
              <p>
                {projectName(entry.task_id)} ·{" "}
                {entry.billable ? "Billable" : "Non-billable"}
              </p>
              <p>
                {new Intl.DateTimeFormat("en-GB", {
                  timeZone: data!.user.timezone,
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(entry.start)}{" "}
                · {data!.user.timezone}
              </p>
              {entry.notes && <p>{entry.notes}</p>}
            </div>
            <div className="entry-actions">
              <strong className="mono">
                {entry.end === null
                  ? "Running"
                  : duration(entry.end - entry.start)}
              </strong>
              <small>
                {entry.currency} {(entry.rate / 100).toFixed(2)}/h
              </small>
              {entry.end !== null && (
                <div className="actions">
                  <button disabled={busy} onClick={() => setEditing(entry)}>
                    Edit
                  </button>
                  <button
                    disabled={busy || !!retry}
                    onClick={async () => {
                      if (
                        await save({
                          action: "delete",
                          entryId: entry.id,
                          version: entry.version,
                        })
                      )
                        setUndo({ ...entry, version: entry.version + 1 });
                    }}
                  >
                    Delete
                  </button>
                </div>
              )}
            </div>
          </article>
        ))}
      </div>
    ) : (
      <p className="empty">
        No entries yet. Start a task or add a manual interval.
      </p>
    );
  }
  return (
    <div className="workspace">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <aside className="rail">
        <Link className="wordmark" href="/">
          Orderly<span>Freelance time</span>
        </Link>
        <BranchedMenu
          items={WORKSPACE_MENU}
          defaultOpen={[0]}
          activeValue={view === "Task" ? "/projects" : path}
          aria-label="Workspace"
          color="var(--color-ink)"
          accentColor="var(--color-focus)"
          lineColor="var(--color-rule)"
          width={240}
          rowHeight={44}
          indent={32}
          trunk={10}
          radius={8}
          fontSize={14}
        />
        <div className="account">
          <p>{data.user.email}</p>
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const response = await fetch("/api/auth", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ action: "logout" }),
                });
                if (!response.ok) throw new Error("Unable to sign out.");
                setData(null);
              } catch (e) {
                setError(
                  e instanceof Error ? e.message : "Unable to sign out.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            Sign out
          </button>
        </div>
      </aside>
      <main id="main" tabIndex={-1}>
        <header className="page-head">
          <div>
            <p className="date">
              {new Intl.DateTimeFormat("en-GB", {
                timeZone: data.user.timezone,
                dateStyle: "full",
              }).format(now)}
            </p>
            <h1>
              {view === "Task" ? selectedTask?.name || "Task not found" : view}
            </h1>
          </div>
          <span className="timezone">{data.user.timezone}</span>
        </header>
        {status}
        {retry && (
          <p className="notice">
            A save needs retrying. Resolve it before starting another action.
          </p>
        )}
        {undo && (
          <div className="notice" role="status">
            Entry deleted.{" "}
            <button
              disabled={busy}
              onClick={async () => {
                if (
                  await save({
                    action: "restore",
                    entryId: undo.id,
                    version: undo.version,
                  })
                )
                  setUndo(null);
              }}
            >
              Undo
            </button>
            <button onClick={() => setUndo(null)}>Dismiss</button>
          </div>
        )}
        {(view === "Today" || view === "Task") && (
          <>
            <section className="timer-panel">
              <div>
                <p>
                  {active
                    ? `Working on ${taskName(active.task_id)}`
                    : "Ready when you are"}
                </p>
                <div className="clock mono" aria-label="Elapsed timer">
                  {active ? duration(now - active.start) : "00:00:00"}
                </div>
                <p>
                  {active
                    ? projectName(active.task_id)
                    : "Choose a task. Record only the work you do."}
                </p>
              </div>
              {active ? (
                <div>
                  <button
                    className="primary"
                    disabled={busy || !!retry}
                    onClick={() =>
                      void save({ action: "stop", entryId: active.id })
                    }
                  >
                    Stop timer
                  </button>
                  <form
                    className="switch-form"
                    onSubmit={(e) => {
                      const input = form(e);
                      void save({
                        ...input,
                        action: "switch",
                        entryId: active.id,
                      });
                    }}
                  >
                    <Field label="Switch to another task">{taskSelect()}</Field>
                    <Submit busy={busy} disabled={!!retry}>
                      Switch task
                    </Submit>
                  </form>
                </div>
              ) : (
                <form
                  onSubmit={(e) => {
                    const input = form(e);
                    void save({ ...input, action: "start" });
                  }}
                >
                  <Field label="Task">{taskSelect(selectedTask?.id)}</Field>
                  <Submit busy={busy} disabled={!!retry}>
                    Start timer
                  </Submit>
                </form>
              )}
            </section>
            {active && now - active.start > 12 * 3600000 && (
              <p className="notice" role="status">
                This timer has run for over 12 hours. Stop it and review the
                interval; no idle time has been deducted.
              </p>
            )}
            <div className="totals">
              <div>
                <span>Today · finalized</span>
                <strong className="mono">
                  {duration(totals[dayKey(now, data.user.timezone)] || 0)}
                </strong>
              </div>
              <div>
                <span>This week · finalized</span>
                <strong className="mono">{duration(week)}</strong>
              </div>
            </div>
            <section>
              <div className="section-head">
                <h2>{view === "Task" ? "Task history" : "Your tasks"}</h2>
                <Link href="/projects">Manage projects</Link>
              </div>
              {view === "Task" ? (
                <>
                  {selectedTask ? (
                    <>
                      {entries(
                        data.entries.filter(
                          (e) => e.task_id === selectedTask.id,
                        ),
                      )}
                      <GitHubEvidence
                        data={data}
                        refresh={refresh}
                        taskId={selectedTask.id}
                        onStart={async (taskId) =>
                          save({
                            action: active ? "switch" : "start",
                            taskId,
                            ...(active ? { entryId: active.id } : {}),
                          })
                        }
                      />
                    </>
                  ) : (
                    <p>This task does not exist in your workspace.</p>
                  )}
                </>
              ) : data.tasks.length ? (
                <div className="task-list">
                  {data.tasks.map((task) => (
                    <div key={task.id}>
                      <Link href={`/tasks/${task.id}`}>
                        <strong>{task.name}</strong>
                        <span>{projectName(task.id)}</span>
                        {task.external?.map((e, index) => (
                          <span key={`${e.provider}-${index}`}>
                            {e.provider === "asana" ? "Asana" : "Notion"} ·{" "}
                            {e.status}
                            {e.archived || !e.available
                              ? " · archived / unavailable"
                              : ""}
                            {e.ambiguous && !e.explicit
                              ? " · billing assignment required in Settings"
                              : ""}
                          </span>
                        ))}
                      </Link>
                      <button
                        disabled={
                          busy ||
                          !!retry ||
                          active?.task_id === task.id ||
                          task.external?.some((e) => e.ambiguous && !e.explicit)
                        }
                        onClick={() =>
                          void save({
                            action: active ? "switch" : "start",
                            taskId: task.id,
                            ...(active ? { entryId: active.id } : {}),
                          })
                        }
                      >
                        {active?.task_id === task.id
                          ? "Running"
                          : active
                            ? "Switch here"
                            : "Start / resume"}
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="empty">
                  Your workspace is ready.{" "}
                  <Link href="/projects">
                    Create a client, project, and task
                  </Link>{" "}
                  to begin.
                </p>
              )}
            </section>
          </>
        )}
        {view === "Today" && (
          <GitHubEvidence data={data} refresh={refresh} remindersOnly />
        )}
        {view === "Projects" && (
          <>
            <p className="lede">Give each piece of work a home.</p>
            <div className="forms-grid">
              <section>
                <h2>Create a client</h2>
                <form onSubmit={(e) => void create(e, "client")}>
                  <Field label="Client name">
                    <input name="name" required maxLength={200} />
                  </Field>
                  <Submit busy={busy} disabled={!!retry}>
                    Add client
                  </Submit>
                </form>
              </section>
              <section>
                <h2>Create a project</h2>
                <form onSubmit={(e) => void create(e, "project")}>
                  <Field label="Client">
                    <select name="clientId" required>
                      <option value="">Choose a client</option>
                      {data.clients.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Project name">
                    <input name="name" required maxLength={200} />
                  </Field>
                  <div className="form-row">
                    <Field label="Currency">
                      <input
                        name="currency"
                        defaultValue="EUR"
                        pattern="[A-Z]{3}"
                        maxLength={3}
                        required
                      />
                    </Field>
                    <Field label="Hourly rate">
                      <input
                        name="rate"
                        defaultValue="0.00"
                        inputMode="decimal"
                        pattern="[0-9]{1,7}(\.[0-9]{1,2})?"
                        required
                      />
                    </Field>
                  </div>
                  <Submit
                    busy={busy}
                    disabled={!!retry || !data.clients.length}
                  >
                    Add project
                  </Submit>
                </form>
              </section>
              <section>
                <h2>Create a task</h2>
                <form onSubmit={(e) => void create(e, "task")}>
                  <Field label="Project">
                    <select name="projectId" required>
                      <option value="">Choose a project</option>
                      {data.projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Task name">
                    <input name="name" required maxLength={200} />
                  </Field>
                  <Submit
                    busy={busy}
                    disabled={!!retry || !data.projects.length}
                  >
                    Add task
                  </Submit>
                </form>
              </section>
            </div>
            <section>
              <h2>Projects & rates</h2>
              {!data.projects.length && (
                <p className="empty">
                  No projects yet. Add your first client above.
                </p>
              )}
              {data.projects.map((project) => (
                <article className="project" key={project.id}>
                  <div>
                    <h3>{project.name}</h3>
                    <p>
                      {
                        data.clients.find((c) => c.id === project.client_id)
                          ?.name
                      }{" "}
                      · {project.currency} {(project.rate / 100).toFixed(2)}/h
                    </p>
                    {data.tasks
                      .filter((t) => t.project_id === project.id)
                      .map((t) => (
                        <Link
                          className="project-task"
                          key={t.id}
                          href={`/tasks/${t.id}`}
                        >
                          {t.name}
                        </Link>
                      ))}
                  </div>
                  <form
                    onSubmit={(e) => {
                      const input = form(e);
                      void save({
                        ...input,
                        action: "rate",
                        projectId: project.id,
                      });
                    }}
                  >
                    <Field label="New hourly rate">
                      <input
                        name="rate"
                        inputMode="decimal"
                        pattern="[0-9]{1,7}(\.[0-9]{1,2})?"
                        required
                        defaultValue={(project.rate / 100).toFixed(2)}
                      />
                    </Field>
                    <Submit busy={busy} disabled={!!retry}>
                      Update rate
                    </Submit>
                    <small>Existing entries retain their rate.</small>
                  </form>
                </article>
              ))}
            </section>
          </>
        )}
        {view === "Timesheet" && (
          <>
            <div className="section-head">
              <h2>This week</h2>
              <strong className="mono">{duration(week)}</strong>
            </div>
            <div className="week">
              {days.map((day) => (
                <div key={day}>
                  <span>{day.slice(5)}</span>
                  <strong className="mono">{duration(totals[day] || 0)}</strong>
                </div>
              ))}
            </div>
            <p className="muted">
              Finalized time only. Intervals are split at midnight in{" "}
              {data.user.timezone}.
            </p>
            <section className="manual">
              <h2>Add manual time</h2>
              <p>
                Enter exact UTC timestamps. The saved interval is displayed in
                your chosen timezone.
              </p>
              <EntryForm
                taskSelect={taskSelect()}
                busy={busy || !!retry}
                onSave={(input) => save({ ...input, action: "manual" })}
              />
            </section>
            <section>
              <h2>Recorded work</h2>
              {entries(data.entries)}
              <details>
                <summary>Audit history ({data.audit.length})</summary>
                {[...data.audit].reverse().map((a) => (
                  <article className="audit" key={a.id}>
                    <p>
                      {a.action} · {new Date(a.at).toISOString()} · {a.entry_id}
                    </p>
                    <details>
                      <summary>Changes</summary>
                      <pre>
                        {JSON.stringify(
                          {
                            before: a.before_json
                              ? JSON.parse(a.before_json)
                              : null,
                            after: a.after_json
                              ? JSON.parse(a.after_json)
                              : null,
                          },
                          null,
                          2,
                        )}
                      </pre>
                    </details>
                  </article>
                ))}
              </details>
            </section>
          </>
        )}
        {view === "Settings" && (
          <>
            <section className="settings">
              <h2>Your timezone</h2>
              <p>
                Durations use UTC instants. Daily and weekly totals follow this
                timezone, including daylight saving.
              </p>
              <form
                onSubmit={(e) => {
                  const input = form(e);
                  void save({ ...input, action: "timezone" });
                }}
              >
                <Field label="IANA timezone">
                  <input
                    name="timezone"
                    list="zones"
                    defaultValue={data.user.timezone}
                    required
                  />
                  <datalist id="zones">
                    {zones.map((zone) => (
                      <option key={zone} value={zone} />
                    ))}
                  </datalist>
                </Field>
                <Submit busy={busy} disabled={!!retry}>
                  Save timezone
                </Submit>
              </form>
            </section>
            <Integrations data={data} refresh={refresh} />
            <GitHubEvidence
              data={data}
              refresh={refresh}
              settings
              onStart={async (taskId) =>
                save({
                  action: active ? "switch" : "start",
                  taskId,
                  ...(active ? { entryId: active.id } : {}),
                })
              }
            />
          </>
        )}
        {editing && (
          <section className="editor" aria-label="Correct time entry">
            <h2>Correct entry</h2>
            <p>
              Exact UTC timestamps. Each correction is kept in the audit
              history.
            </p>
            <EntryForm
              key={editing.id}
              entry={editing}
              taskSelect={taskSelect(editing.task_id)}
              busy={busy || !!retry}
              onSave={async (input) => {
                const ok = await save({
                  ...input,
                  action: "edit",
                  entryId: editing.id,
                  version: editing.version,
                });
                if (ok) setEditing(null);
                return ok;
              }}
            />
            <button disabled={busy} onClick={() => setEditing(null)}>
              Cancel edit
            </button>
          </section>
        )}
        <footer>Orderly · A record of the work you do.</footer>
      </main>
    </div>
  );
}
function EntryForm({
  entry,
  taskSelect,
  busy,
  onSave,
}: {
  entry?: Entry;
  taskSelect: React.ReactNode;
  busy: boolean;
  onSave: (input: Input) => Promise<boolean>;
}) {
  return (
    <form
      onSubmit={async (e) => {
        const element = e.currentTarget,
          input = form(e);
        const ok = await onSave({
          ...input,
          start: utcValue(input.start),
          end: utcValue(input.end),
          billable: input.billable === "on",
        });
        if (ok && !entry) element.reset();
      }}
    >
      <Field label="Task">{taskSelect}</Field>
      <div className="form-row">
        <Field label="Start · UTC">
          <input
            name="start"
            type="datetime-local"
            step="0.001"
            defaultValue={entry ? datetime(entry.start) : undefined}
            required
          />
        </Field>
        <Field label="End · UTC">
          <input
            name="end"
            type="datetime-local"
            step="0.001"
            defaultValue={entry?.end ? datetime(entry.end) : undefined}
            required
          />
        </Field>
      </div>
      <Field label="Notes">
        <textarea
          name="notes"
          maxLength={2000}
          defaultValue={entry?.notes || ""}
        />
      </Field>
      <label className="checkbox">
        <input
          name="billable"
          type="checkbox"
          defaultChecked={entry ? !!entry.billable : true}
        />
        Billable work
      </label>
      <Submit busy={busy}>{entry ? "Save correction" : "Add entry"}</Submit>
    </form>
  );
}

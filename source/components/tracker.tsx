"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useWorkspace } from "./workspace-provider";
import {
  ElapsedTimer,
  LongTimerNotice,
  useWorkspaceDate,
} from "./workspace-clock";
import type { FormEvent } from "react";
import type { Entry } from "@/lib/types";
import { dayKey, duration, weekDays } from "@/lib/time";
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
        value: "/billing",
        href: "/billing",
        label: "Billing",
        icon: Download04Icon,
      },
    ],
  },
  {
    label: "Settings",
    children: [
      {
        value: "/settings",
        href: "/settings",
        label: "General",
        icon: Settings02Icon,
      },
      {
        value: "/settings/connections",
        href: "/settings/connections",
        label: "Connections",
        icon: Layers01Icon,
      },
    ],
  },
];
import { Integrations } from "./integrations";
import { GitHubEvidence } from "./github";
import { Billing } from "./billing";
import { Operations } from "./operations";
import { Logo } from "./logo";
import { WorkspaceLoader } from "./workspace-loader";
import { TimerPreferences } from "./timer-preferences";
import { ProjectsWorkbench } from "./projects-workbench";

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
  const { data } = useWorkspace();
  return <TrackerView key={data?.user.email ?? "signed-out"} />;
}

function TrackerView() {
  const path = usePathname();
  const {
    data,
    loading,
    busy,
    error,
    retry,
    offset,
    totals,
    refresh,
    save,
    authenticate,
    setError,
  } = useWorkspace();
  const [register, setRegister] = useState(false);
  const [editing, setEditing] = useState<Entry | null>(null);
  const [undo, setUndo] = useState<Entry | null>(null);
  const [zones, setZones] = useState<string[]>(["UTC"]);
  const now = useWorkspaceDate(
    data?.now ?? 0,
    data?.user.timezone ?? "UTC",
    offset,
  );
  const today = dayKey(now, data?.user.timezone ?? "UTC");
  useEffect(() => {
    const initial = setTimeout(() => {
      const supported =
        typeof Intl.supportedValuesOf === "function"
          ? Intl.supportedValuesOf("timeZone")
          : [];
      setZones([...new Set(["UTC", ...supported])]);
    }, 0);
    return () => clearTimeout(initial);
  }, []);
  async function auth(event: FormEvent<HTMLFormElement>) {
    await authenticate({
      ...form(event),
      action: register ? "register" : "login",
    });
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
      <main className="auth workspace-loading">
        <WorkspaceLoader />
        {status}
      </main>
    );
  if (!data)
    return (
      <main className="auth">
        <Link className="wordmark" href="/">
          <Logo />
          <div className="wordmark-copy">
            Orderly<span> / time well recorded</span>
          </div>
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
  const activeTimers = data.entries.filter((e) => e.end === null),
    timerLimit =
      data.user.timer_limit === undefined ? 2 : data.user.timer_limit,
    atCapacity = timerLimit !== null && activeTimers.length >= timerLimit,
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
  const taskSelect = (selected?: string, excludeRunning = false) => (
    <select name="taskId" defaultValue={selected} required>
      <option value="">Choose a task</option>
      {data.tasks.map((t) => (
        <option
          key={t.id}
          value={t.id}
          disabled={
            excludeRunning &&
            activeTimers.some((entry) => entry.task_id === t.id)
          }
        >
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
        : path.startsWith("/billing")
          ? "Billing"
          : path === "/settings/connections"
            ? "Connections"
            : path.startsWith("/settings")
              ? "Settings"
              : "Today";
  const selectedTask = path.startsWith("/tasks/")
    ? data.tasks.find((t) => t.id === path.split("/")[2])
    : null;
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
        <Link className="wordmark" href="/" aria-label="Orderly home">
          <Logo />
          <div className="wordmark-copy">
            Orderly<span>Freelance time</span>
          </div>
        </Link>
        <BranchedMenu
          items={WORKSPACE_MENU}
          defaultOpen={[0, 1]}
          activeValue={view === "Task" ? "/projects" : path}
          aria-label="Workspace"
          color="var(--color-rail-ink)"
          accentColor="var(--color-rail-muted)"
          lineColor="var(--color-rail-rule)"
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
            onClick={() => void authenticate({ action: "logout" })}
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
        {view === "Billing" && <Billing work={data} refreshWork={refresh} />}
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
            <div className="active-timers" aria-label="Running timers">
              {activeTimers.map((entry) => (
                <section
                  className="timer-panel"
                  data-running="true"
                  key={entry.id}
                >
                  <div>
                    <p>Working on {taskName(entry.task_id)}</p>
                    <div
                      className="clock mono"
                      aria-label={`Elapsed time for ${taskName(entry.task_id)}`}
                    >
                      <ElapsedTimer
                        start={entry.start}
                        serverNow={data.now}
                        offset={offset}
                      />
                    </div>
                    <p>{projectName(entry.task_id)}</p>
                    <LongTimerNotice
                      start={entry.start}
                      serverNow={data.now}
                      offset={offset}
                    />
                  </div>
                  <button
                    className="primary"
                    disabled={busy || !!retry}
                    onClick={() =>
                      void save({ action: "stop", entryId: entry.id })
                    }
                  >
                    Stop timer
                  </button>
                </section>
              ))}
            </div>
            <section className="timer-panel">
              <div>
                <h2>
                  {activeTimers.length
                    ? "Start another task"
                    : "Ready when you are"}
                </h2>
                <p>
                  {activeTimers.length} running ·{" "}
                  {timerLimit === null ? "No limit" : `Limit: ${timerLimit}`}
                </p>
                {atCapacity && (
                  <p>
                    Stop a timer or change the limit in{" "}
                    <Link href="/settings">General settings</Link>.
                  </p>
                )}
              </div>
              <form
                onSubmit={(e) => {
                  const input = form(e);
                  void save({ ...input, action: "start" });
                }}
              >
                <Field label="Task">{taskSelect(selectedTask?.id, true)}</Field>
                <Submit
                  busy={busy}
                  disabled={!!retry || atCapacity || !data.tasks.length}
                >
                  Start timer
                </Submit>
              </form>
            </section>
            <div className="totals">
              <div>
                <span>Today · finalized</span>
                <strong className="mono">{duration(totals[today] || 0)}</strong>
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
                            action: "start",
                            taskId,
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
                            {e.assignee ? ` · ${e.assignee}` : ""}
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
                          atCapacity ||
                          activeTimers.some(
                            (entry) => entry.task_id === task.id,
                          ) ||
                          task.external?.some((e) => e.ambiguous && !e.explicit)
                        }
                        onClick={() =>
                          void save({
                            action: "start",
                            taskId: task.id,
                          })
                        }
                      >
                        {activeTimers.some((entry) => entry.task_id === task.id)
                          ? "Running"
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
          <ProjectsWorkbench
            data={data}
            busy={busy}
            blocked={!!retry}
            save={save}
          />
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
            <TimerPreferences
              limit={timerLimit}
              busy={busy || !!retry}
              save={save}
            />
            <Operations />
          </>
        )}
        {view === "Connections" && (
          <>
            <Integrations data={data} refresh={refresh} />
            <GitHubEvidence
              data={data}
              refresh={refresh}
              settings
              onStart={async (taskId) =>
                save({
                  action: "start",
                  taskId,
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

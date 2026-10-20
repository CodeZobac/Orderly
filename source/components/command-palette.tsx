"use client";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
  Briefcase01Icon,
  Folder01Icon,
  Invoice01Icon,
  PlayIcon,
  Search01Icon,
  StopIcon,
  Task01Icon,
  ArrowRight01Icon,
} from "@hugeicons/core-free-icons";
import type { Snapshot } from "@/lib/types";
import { dayKey, duration } from "@/lib/time";
import { Kbd, ModKbd } from "./kbd";
import { Highlight, matches } from "./select";

type Input = Record<string, unknown>;
type Tone = "running" | "done" | "review";
type Action = {
  label: string;
  icon: IconSvgElement;
  run: () => void;
  /** When set, the action is unavailable and this explains why. */
  unavailable?: string;
};
type Item = {
  key: string;
  kind: "task" | "project" | "client";
  title: string;
  meta: string;
  status?: { label: string; tone: Tone };
  haystack: string;
  actions: Action[];
};
type Group = { title: string; items: Item[]; total: number };

/** Billing deep link; `from` widens the period so older unbilled work is included. */
export function billingHref(params: {
  clientId?: string;
  projectId?: string;
  taskId?: string;
  from?: string;
}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params))
    if (value) query.set(key === "taskId" ? "task" : key, value);
  return `/billing?${query}`;
}

const KIND_ICON = {
  task: Task01Icon,
  project: Folder01Icon,
  client: Briefcase01Icon,
} as const;

export function CommandPalette({
  data,
  busy,
  blocked,
  save,
  onTrackProject,
}: {
  data: Snapshot;
  busy: boolean;
  blocked: boolean;
  save: (input: Input) => Promise<boolean>;
  onTrackProject: (projectId: string) => void;
}) {
  const router = useRouter();
  const uid = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const results = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [actionIndex, setActionIndex] = useState(0);

  const show = useCallback(() => {
    const element = dialog.current;
    if (!element || element.open) return;
    setQuery("");
    setActive(0);
    setActionIndex(0);
    element.showModal();
    setOpen(true);
    input.current?.focus();
  }, []);
  const close = useCallback(() => dialog.current?.close(), []);

  // Global shortcut: ⌘K / Ctrl K toggles the palette from anywhere.
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        event.key.toLowerCase() === "k"
      ) {
        event.preventDefault();
        if (dialog.current?.open) close();
        else show();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close, show]);

  const groups = useMemo<Group[]>(() => {
    if (!open) return [];
    const timezone = data.user.timezone;
    const running = data.entries.filter((entry) => entry.end === null);
    const limit =
      data.user.timer_limit === undefined ? 2 : data.user.timer_limit;
    const atCapacity = limit !== null && running.length >= limit;
    const clientName = (id: string) =>
      data.clients.find((client) => client.id === id)?.name || "Client";
    const go = (href: string) => () => {
      close();
      router.push(href);
    };
    const earliest = (taskIds: Set<string>) => {
      let first = Infinity;
      for (const entry of data.entries)
        if (taskIds.has(entry.task_id) && entry.end !== null)
          first = Math.min(first, entry.start);
      return Number.isFinite(first) ? dayKey(first, timezone) : undefined;
    };

    const tasks: Item[] = data.tasks.map((task) => {
      const project = data.projects.find((p) => p.id === task.project_id);
      const entries = data.entries.filter((e) => e.task_id === task.id);
      const timer = entries.find((e) => e.end === null);
      const logged = entries.reduce(
        (sum, e) => sum + (e.end === null ? 0 : e.end - e.start),
        0,
      );
      // Agreed rule: finished = time already logged and no timer running.
      const finished = !timer && entries.some((e) => e.end !== null);
      const needsReview =
        task.review_blocked ||
        !!task.external?.some((e) => e.ambiguous && !e.explicit);
      const start: Action = {
        label: finished ? "Resume timer" : "Start timer",
        icon: PlayIcon,
        run: () => {
          close();
          void save({ action: "start", taskId: task.id });
        },
        unavailable: needsReview
          ? "Needs review in Connections"
          : blocked
            ? "Resolve the pending save first"
            : atCapacity
              ? `Timer limit reached (${limit})`
              : busy
                ? "Saving…"
                : undefined,
      };
      const openTask: Action = {
        label: "Open task",
        icon: ArrowRight01Icon,
        run: go(`/tasks/${task.id}`),
      };
      const summary: Action = {
        label: "Billable summary",
        icon: Invoice01Icon,
        run: go(
          billingHref({
            clientId: project?.client_id,
            projectId: project?.id,
            taskId: task.id,
            from: earliest(new Set([task.id])),
          }),
        ),
      };
      const stop: Action = {
        label: "Stop timer",
        icon: StopIcon,
        run: () => {
          close();
          if (timer) void save({ action: "stop", entryId: timer.id });
        },
        unavailable: blocked || busy ? "Saving…" : undefined,
      };
      const client = project ? clientName(project.client_id) : "";
      return {
        key: `task:${task.id}`,
        kind: "task",
        title: task.name,
        meta: [
          project?.name,
          client,
          logged ? `${duration(logged)} logged` : null,
        ]
          .filter(Boolean)
          .join(" · "),
        status: timer
          ? { label: "Running", tone: "running" }
          : needsReview
            ? { label: "Needs review", tone: "review" }
            : finished
              ? { label: "Done", tone: "done" }
              : undefined,
        haystack: `${task.name} ${project?.name ?? ""} ${client}`,
        actions: timer
          ? [stop, openTask]
          : finished
            ? [summary, start, openTask]
            : [start, openTask],
      };
    });

    const projects: Item[] = data.projects.map((project) => {
      const taskIds = new Set(
        data.tasks.filter((t) => t.project_id === project.id).map((t) => t.id),
      );
      const runningHere = running.filter((e) => taskIds.has(e.task_id)).length;
      const client = clientName(project.client_id);
      return {
        key: `project:${project.id}`,
        kind: "project",
        title: project.name,
        meta: `${client} · ${taskIds.size} ${taskIds.size === 1 ? "task" : "tasks"} · ${project.currency} ${(project.rate / 100).toFixed(2)}/h`,
        status: runningHere
          ? { label: `${runningHere} running`, tone: "running" }
          : undefined,
        haystack: `${project.name} ${client}`,
        actions: [
          {
            label: "Billable items",
            icon: Invoice01Icon,
            run: go(
              billingHref({
                clientId: project.client_id,
                projectId: project.id,
                from: earliest(taskIds),
              }),
            ),
          },
          {
            label: "Track time",
            icon: PlayIcon,
            run: () => {
              close();
              onTrackProject(project.id);
            },
          },
        ],
      };
    });

    const clients: Item[] = data.clients.map((client) => {
      const projectIds = new Set(
        data.projects.filter((p) => p.client_id === client.id).map((p) => p.id),
      );
      const taskIds = new Set(
        data.tasks.filter((t) => projectIds.has(t.project_id)).map((t) => t.id),
      );
      return {
        key: `client:${client.id}`,
        kind: "client",
        title: client.name,
        meta: `${projectIds.size} ${projectIds.size === 1 ? "project" : "projects"}`,
        haystack: client.name,
        actions: [
          {
            label: "Billable items",
            icon: Invoice01Icon,
            run: go(
              billingHref({ clientId: client.id, from: earliest(taskIds) }),
            ),
          },
        ],
      };
    });

    const pick = (title: string, items: Item[], max: number): Group => {
      const hits = items.filter((item) => matches(item.haystack, query));
      return { title, items: hits.slice(0, max), total: hits.length };
    };
    const list = query.trim()
      ? [
          pick("Tasks", tasks, 12),
          pick("Projects", projects, 8),
          pick("Clients", clients, 6),
        ]
      : [
          pick(
            "Running now",
            tasks.filter((t) => t.status?.tone === "running"),
            10,
          ),
          pick("Projects", projects, 8),
          pick("Clients", clients, 6),
        ];
    return list.filter((group) => group.items.length);
  }, [open, data, query, busy, blocked, save, close, router, onTrackProject]);

  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const offsets = useMemo(
    () =>
      groups.map((_, g) =>
        groups.slice(0, g).reduce((sum, x) => sum + x.items.length, 0),
      ),
    [groups],
  );
  const current = flat[Math.min(active, flat.length - 1)];

  useLayoutEffect(() => {
    results.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const run = (item: Item | undefined, index: number) => {
    const action = item?.actions[index];
    if (action && !action.unavailable) action.run();
  };

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const count = current?.actions.length ?? 0;
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp": {
        event.preventDefault();
        if (!flat.length) return;
        const step = event.key === "ArrowDown" ? 1 : -1;
        setActive((i) => (i + step + flat.length) % flat.length);
        setActionIndex(0);
        return;
      }
      case "ArrowRight":
      case "ArrowLeft":
        // Only cycle actions when the caret is at the end, so text editing still works.
        if (
          !count ||
          input.current?.selectionStart !== query.length ||
          (event.key === "ArrowLeft" && actionIndex === 0)
        )
          return;
        event.preventDefault();
        setActionIndex(
          (i) => (i + (event.key === "ArrowRight" ? 1 : -1) + count) % count,
        );
        return;
      case "Tab":
        if (!count) return;
        event.preventDefault();
        setActionIndex((i) => (i + (event.shiftKey ? -1 : 1) + count) % count);
        return;
      case "Enter":
        event.preventDefault();
        run(current, actionIndex);
        return;
      case "Escape":
        if (query) {
          event.preventDefault();
          setQuery("");
          setActive(0);
        }
    }
  }

  const activeAction = current?.actions[actionIndex];
  return (
    <>
      <button
        type="button"
        className="rail-search"
        onClick={show}
        aria-haspopup="dialog"
        aria-keyshortcuts="Meta+K Control+K"
      >
        <HugeiconsIcon icon={Search01Icon} size={18} strokeWidth={2} />
        <span>Search</span>
        <ModKbd keyLabel="K" />
      </button>
      <dialog
        ref={dialog}
        className="command-palette"
        aria-labelledby={`${uid}-title`}
        onClose={() => setOpen(false)}
        onClick={(event) => {
          if (event.target === event.currentTarget) close();
        }}
      >
        <h2 id={`${uid}-title`} className="sr-only">
          Search projects, clients and tasks
        </h2>
        <div className="palette-search">
          <HugeiconsIcon icon={Search01Icon} size={20} strokeWidth={2} />
          <input
            ref={input}
            type="text"
            role="combobox"
            aria-expanded={open}
            aria-controls={`${uid}-results`}
            aria-autocomplete="list"
            aria-activedescendant={
              current ? `${uid}-item-${active}` : undefined
            }
            aria-describedby={`${uid}-hint`}
            placeholder="Search projects, clients and tasks…"
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
              setActionIndex(0);
            }}
            onKeyDown={onKeyDown}
          />
          <button type="button" className="palette-esc" onClick={close}>
            <Kbd>Esc</Kbd>
            <span className="sr-only">Close search</span>
          </button>
        </div>
        <div
          ref={results}
          id={`${uid}-results`}
          className="palette-results"
          role="listbox"
          aria-label="Results"
        >
          {!groups.length && (
            <p className="palette-empty" role="status">
              {query.trim()
                ? `Nothing matches “${query.trim()}”. Try a client, project or task name.`
                : "Your workspace is empty. Create a client, project and task in Projects."}
            </p>
          )}
          {groups.map((group, groupIndex) => (
            <div
              role="group"
              aria-labelledby={`${uid}-${group.title}`}
              key={group.title}
              className="palette-group"
            >
              <div
                className="palette-group-title"
                id={`${uid}-${group.title}`}
                role="presentation"
              >
                <span>{group.title}</span>
                {group.total > group.items.length && (
                  <span>
                    {group.items.length} of {group.total} · keep typing
                  </span>
                )}
              </div>
              {group.items.map((item, itemIndex) => {
                const rowIndex = offsets[groupIndex] + itemIndex;
                const isActive = rowIndex === active;
                const primary = item.actions[0];
                return (
                  <div
                    key={item.key}
                    id={`${uid}-item-${rowIndex}`}
                    data-index={rowIndex}
                    role="option"
                    aria-selected={isActive}
                    aria-label={`${item.title}, ${item.kind}. ${item.meta}.${item.status ? ` ${item.status.label}.` : ""} ${isActive && activeAction ? `Enter: ${activeAction.label}${activeAction.unavailable ? `, unavailable — ${activeAction.unavailable}` : ""}.` : ""}`}
                    className="palette-row"
                    data-active={isActive || undefined}
                    onMouseMove={() => {
                      if (!isActive) {
                        setActive(rowIndex);
                        setActionIndex(0);
                      }
                    }}
                    onClick={() => run(item, 0)}
                    title={primary?.unavailable}
                  >
                    <span className="palette-kind" data-kind={item.kind}>
                      <HugeiconsIcon
                        icon={KIND_ICON[item.kind]}
                        size={18}
                        strokeWidth={1.8}
                      />
                    </span>
                    <span className="palette-text">
                      <strong>
                        <Highlight text={item.title} query={query} />
                      </strong>
                      <span>
                        <Highlight text={item.meta} query={query} />
                      </span>
                    </span>
                    {item.status && (
                      <span
                        className="palette-status"
                        data-tone={item.status.tone}
                      >
                        {item.status.label}
                      </span>
                    )}
                    <span className="palette-actions">
                      {item.actions.map((action, i) => (
                        <button
                          type="button"
                          tabIndex={-1}
                          key={action.label}
                          className={i === 0 ? "primary" : undefined}
                          data-current={
                            (isActive && i === actionIndex) || undefined
                          }
                          aria-disabled={!!action.unavailable || undefined}
                          title={action.unavailable || action.label}
                          onClick={(event) => {
                            event.stopPropagation();
                            run(item, i);
                          }}
                        >
                          <HugeiconsIcon
                            icon={action.icon}
                            size={16}
                            strokeWidth={2}
                          />
                          <span className={i === 0 ? undefined : "sr-only"}>
                            {action.label}
                          </span>
                        </button>
                      ))}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <footer className="palette-footer" id={`${uid}-hint`}>
          <span>
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> move
          </span>
          <span>
            <Kbd>Tab</Kbd> next action
          </span>
          <span>
            <Kbd>Enter</Kbd>{" "}
            {activeAction
              ? activeAction.unavailable
                ? `${activeAction.label} unavailable · ${activeAction.unavailable}`
                : activeAction.label
              : "run"}
          </span>
          <span>
            <Kbd>Esc</Kbd> close
          </span>
        </footer>
      </dialog>
    </>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Project } from "@/lib/types";
import type {
  Connection,
  Integrations,
  Mapping,
  Source,
  SourceOption,
} from "@/lib/integration-types";
import { Field } from "./fields";

const FIELDS = [
  { key: "title", label: "Task name", types: ["title"] },
  { key: "status", label: "Status", types: ["status", "select"] },
  { key: "assignee", label: "Assigned to", types: ["people"] },
  { key: "due", label: "Due date", types: ["date"] },
] as const;

async function request<T>(
  input: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch("/api/integrations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal,
  });
  const value = await response.json();
  if (!response.ok)
    throw new Error(
      value.error || "Unable to finish Notion setup. Please try again.",
    );
  return value as T;
}

export function NotionSourceDialog({
  connection,
  sourceId,
  sourceName,
  existing,
  projects,
  reload,
  refresh,
  onDismiss,
  returnFocus,
}: {
  connection: Connection;
  sourceId: string;
  sourceName: string;
  existing?: Source;
  projects: Project[];
  reload: () => Promise<Integrations>;
  refresh: () => Promise<void>;
  onDismiss: () => void;
  returnFocus: HTMLElement | null;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const stepTitle = useRef<HTMLHeadingElement>(null);
  const initial = useRef({ connection, existing, returnFocus });
  const savingNow = useRef(false);
  const [source, setSource] = useState<SourceOption | null>(null);
  const [mapping, setMapping] = useState<Mapping>({});
  const [step, setStep] = useState<1 | 2>(1);
  const [adjust, setAdjust] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [projectMode, setProjectMode] = useState<"create" | "existing">(
    existing ? "existing" : "create",
  );
  const [projectId, setProjectId] = useState(existing?.project_id || "");
  const [savedSourceId, setSavedSourceId] = useState<string | null>(null);
  const [confirmed, setResult] = useState<Source | null>(null);
  // Follow Connections' fresh state after the first confirmed save refresh.
  const result =
    confirmed && existing?.id === confirmed.id ? existing : confirmed;

  useEffect(() => {
    const node = dialog.current;
    const opener = initial.current.returnFocus;
    node?.showModal();
    title.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      node?.close();
      document.body.style.overflow = previousOverflow;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const { connection: account, existing: saved } = initial.current;
    void request<SourceOption>(
      { action: "inspect", connectionId: account.id, externalId: sourceId },
      controller.signal,
    )
      .then((option) => {
        if (controller.signal.aborted) return;
        const detected: Mapping = { automation: false, doing: [] };
        for (const field of FIELDS) {
          const candidates = option.properties.filter((property) =>
            (field.types as readonly string[]).includes(property.type),
          );
          detected[field.key] = candidates.length === 1 ? candidates[0].id : "";
        }
        const chosen = saved?.mapping || detected;
        setSource(option);
        setMapping({ ...chosen, doing: [...(chosen.doing || [])] });
        setAdjust(
          FIELDS.some((field) => {
            const candidates = option.properties.filter((property) =>
              (field.types as readonly string[]).includes(property.type),
            );
            const value = chosen[field.key];
            return (
              (field.key === "title" && !value) ||
              (!!value &&
                !candidates.some((property) => property.id === value)) ||
              (!value && candidates.length > 1)
            );
          }),
        );
        setLoading(false);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setError(
          reason instanceof Error
            ? reason.message
            : "Unable to load this board. Please try again.",
        );
        setLoading(false);
      });
    return () => controller.abort();
  }, [sourceId, attempt]);

  useEffect(() => {
    stepTitle.current?.focus();
    dialog.current?.querySelector(".notion-dialog-body")?.scrollTo({ top: 0 });
  }, [step]);

  const options =
    source?.properties.find((property) => property.id === mapping.status)
      ?.options || [];
  const displayName = source?.name || sourceName;
  const validField = (key: (typeof FIELDS)[number]["key"]) => {
    const field = FIELDS.find((item) => item.key === key)!;
    return !!source?.properties.some(
      (property) =>
        property.id === mapping[key] &&
        (field.types as readonly string[]).includes(property.type),
    );
  };
  function close() {
    if (!savingNow.current) onDismiss();
  }
  function validateProjectStep() {
    if (projectMode === "existing" && !projectId) {
      setError("Choose the Orderly project for these tasks.");
      return false;
    }
    if (!validField("title")) {
      setAdjust(true);
      setError("Choose the Notion field that contains each task’s name.");
      return false;
    }
    for (const field of FIELDS) {
      if (mapping[field.key] && !validField(field.key)) {
        setAdjust(true);
        setError(
          `Choose a current ${field.label.toLowerCase()} field, or leave it unmapped.`,
        );
        return false;
      }
    }
    return true;
  }
  async function finishRefresh(id: string) {
    const latest = await reload();
    await refresh();
    const saved = latest.sources.find((item) => item.id === id);
    if (!saved)
      throw new Error(
        "Settings were saved, but their current import status could not be loaded. Retry the refresh.",
      );
    setResult(saved);
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!source || savingNow.current || savedSourceId) return;
    setError("");
    if (!validateProjectStep()) {
      setStep(1);
      return;
    }
    if (step === 1) {
      setStep(2);
      return;
    }
    if (mapping.automation) {
      if (!connection.identity?.user_id) {
        setError(
          "Reconnect Notion to identify your account, or turn automatic timers off.",
        );
        return;
      }
      if (!validField("status") || !validField("assignee")) {
        setStep(1);
        setAdjust(true);
        setError(
          "Automatic timers need both Status and Assigned to fields. Choose them below.",
        );
        return;
      }
      if (
        !mapping.doing?.length ||
        mapping.doing.some((id) => !options.some((option) => option.id === id))
      ) {
        setError("Choose at least one current status that means Doing.");
        return;
      }
    }
    savingNow.current = true;
    setSaving(true);
    let committed = false;
    try {
      const id = await request<string>({
        action: "map",
        connectionId: connection.id,
        externalId: source.id,
        projectId: projectMode === "create" ? "" : projectId,
        mapping,
      });
      committed = true;
      setSavedSourceId(id);
      await finishRefresh(id);
    } catch (reason) {
      setError(
        committed
          ? "Your settings were saved. Refresh the import status to see the linked project."
          : reason instanceof Error
            ? reason.message
            : "Unable to save this setup. Please try again.",
      );
    } finally {
      savingNow.current = false;
      setSaving(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      className="notion-source-dialog"
      aria-labelledby="notion-setup-title"
      aria-describedby="notion-setup-description"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom
        )
          close();
      }}
    >
      <form
        className="notion-setup-form"
        onSubmit={(event) => void submit(event)}
        noValidate
        aria-busy={loading || saving}
      >
        <header className="notion-dialog-header">
          <div>
            <p className="muted">
              Notion · {connection.identity?.workspace_name || connection.label}
            </p>
            <h2 id="notion-setup-title" ref={title} tabIndex={-1}>
              {displayName}
            </h2>
          </div>
          <button
            className="dialog-close"
            type="button"
            aria-label="Close Notion setup"
            disabled={saving}
            onClick={close}
          >
            Close <span aria-hidden="true">×</span>
          </button>
          {!savedSourceId && (
            <ol className="setup-steps" aria-label="Setup progress">
              <li aria-current={step === 1 ? "step" : undefined}>
                <span aria-hidden="true">1</span> Project & fields
              </li>
              <li aria-current={step === 2 ? "step" : undefined}>
                <span aria-hidden="true">2</span> Automatic timers
              </li>
            </ol>
          )}
        </header>
        <div className="notion-dialog-body" inert={saving}>
          <p id="notion-setup-description" className="muted">
            {savedSourceId
              ? "Your board’s import settings are saved."
              : step === 1
                ? "Choose where these tasks belong. We’ve matched the available fields for you."
                : "Choose whether changes in Notion should control your timers."}
          </p>
          {error && (
            <p className="dialog-notice" role="alert">
              {error}
            </p>
          )}
          {loading && <p role="status">Loading board details…</p>}
          {!loading && !source && (
            <button
              type="button"
              onClick={() => {
                setError("");
                setLoading(true);
                setAttempt((value) => value + 1);
              }}
            >
              Try again
            </button>
          )}
          {source && !savedSourceId && (
            <h3 ref={stepTitle} tabIndex={-1}>
              {step === 1 ? "Project & task fields" : "Automatic timers"}
            </h3>
          )}
          {source?.archived && (
            <p className="dialog-notice" role="alert">
              This board is archived. Restore it in Notion before importing.
            </p>
          )}
          {source && !savedSourceId && step === 1 && (
            <>
              <fieldset className="setup-project-choice">
                <legend>Orderly project</legend>
                <label>
                  <input
                    type="radio"
                    name="projectMode"
                    value="create"
                    checked={projectMode === "create"}
                    disabled={!!existing}
                    onChange={() => setProjectMode("create")}
                  />
                  <span>
                    Create a project<small>Named {displayName}</small>
                  </span>
                </label>
                <label>
                  <input
                    type="radio"
                    name="projectMode"
                    value="existing"
                    checked={projectMode === "existing"}
                    onChange={() => setProjectMode("existing")}
                  />
                  <span>
                    Use an existing project
                    <small>Keep its current rate and currency</small>
                  </span>
                </label>
              </fieldset>
              {projectMode === "create" ? (
                <p className="setup-hint">
                  Starts at EUR 0.00/hour. You can set the rate in Projects.
                </p>
              ) : (
                <Field label="Project">
                  <select
                    value={projectId}
                    onChange={(event) => setProjectId(event.target.value)}
                  >
                    <option value="">Choose a project</option>
                    {existing &&
                      !projects.some(
                        (project) => project.id === existing.project_id,
                      ) && (
                        <option value={existing.project_id}>
                          Current linked project
                        </option>
                      )}
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name} · {project.currency}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              {existing && (
                <p className="setup-hint">
                  This board already has a linked project. Existing time keeps
                  its original project and rate.
                </p>
              )}
              <section
                className="detected-fields"
                aria-labelledby="detected-fields-title"
              >
                <h3 id="detected-fields-title">Task fields</h3>
                <dl>
                  {FIELDS.map((field) => (
                    <div key={field.key}>
                      <dt>{field.label}</dt>
                      <dd>
                        {source.properties.find(
                          (property) => property.id === mapping[field.key],
                        )?.name ||
                          (field.key === "title"
                            ? "Choose a field"
                            : "Not mapped")}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
              <details
                className="setup-adjust"
                open={adjust}
                onToggle={(event) => setAdjust(event.currentTarget.open)}
              >
                <summary>
                  Adjust fields
                  <span className="disclosure-mark" aria-hidden="true" />
                </summary>
                <div className="setup-field-grid">
                  {FIELDS.map((field) => (
                    <Field
                      key={field.key}
                      label={`${field.label}${field.key === "title" ? "" : " (optional)"}`}
                    >
                      <select
                        value={mapping[field.key] || ""}
                        onChange={(event) =>
                          setMapping((old) => ({
                            ...old,
                            [field.key]: event.target.value,
                            ...(field.key === "status" ? { doing: [] } : {}),
                          }))
                        }
                      >
                        <option value="">
                          {field.key === "title"
                            ? "Choose a field"
                            : "Not mapped"}
                        </option>
                        {source.properties
                          .filter((property) =>
                            (field.types as readonly string[]).includes(
                              property.type,
                            ),
                          )
                          .map((property) => (
                            <option value={property.id} key={property.id}>
                              {property.name}
                            </option>
                          ))}
                      </select>
                    </Field>
                  ))}
                </div>
              </details>
            </>
          )}
          {source && !savedSourceId && step === 2 && (
            <>
              <div className="setup-account">
                <strong>
                  {connection.identity?.user_name ||
                    "Your connected Notion account"}
                </strong>
                <p>
                  Only tasks assigned to this account can start timers
                  automatically.
                </p>
              </div>
              <label className="setup-toggle">
                <input
                  type="checkbox"
                  checked={mapping.automation ?? false}
                  disabled={
                    !connection.identity?.user_id && !mapping.automation
                  }
                  onChange={(event) =>
                    setMapping((old) => ({
                      ...old,
                      automation: event.target.checked,
                    }))
                  }
                />
                <span>
                  Automatic timers
                  <small>
                    Start on Doing. Stop when the task leaves Doing.
                  </small>
                </span>
              </label>
              {!connection.identity?.user_id && (
                <p className="setup-hint">
                  Reconnect Notion in Connections to enable automatic timers.
                  You can still import tasks.
                </p>
              )}
              {mapping.automation && (
                <fieldset className="setup-statuses">
                  <legend>Which statuses mean Doing?</legend>
                  {options.map((option) => (
                    <label className="setup-status-option" key={option.id}>
                      <input
                        type="checkbox"
                        checked={mapping.doing?.includes(option.id) ?? false}
                        onChange={(event) =>
                          setMapping((old) => ({
                            ...old,
                            doing: event.target.checked
                              ? [...(old.doing || []), option.id]
                              : (old.doing || []).filter(
                                  (id) => id !== option.id,
                                ),
                          }))
                        }
                      />
                      <span>{option.name}</span>
                    </label>
                  ))}
                  {!options.length && (
                    <p>
                      Choose a Status field with options in the previous step.
                    </p>
                  )}
                  <p className="setup-hint">
                    Tasks already in Doing won’t start timers during the first
                    import.
                  </p>
                </fieldset>
              )}
              <p className="setup-hint">
                You can change these settings later. All timer limits still
                apply.
              </p>
            </>
          )}
          {savedSourceId && (
            <div className="setup-result" role="status">
              <h3>
                {result
                  ? result.status === "synced" && result.last_success
                    ? "Synced"
                    : result.status === "syncing"
                      ? "Importing tasks…"
                      : result.status === "queued"
                        ? "Import queued"
                        : "Import needs attention"
                  : saving
                    ? "Loading import status…"
                    : "Settings saved"}
              </h3>
              <p>
                {result
                  ? result.status === "synced" && result.last_success
                    ? "The latest synchronization has completed. Your imported tasks are available in Projects."
                    : result.error ||
                      "Your project is linked. Tasks will appear as synchronization finishes."
                  : "The board’s settings are saved. Refresh to see the current import status."}
              </p>
              {result && (
                <Link
                  className="setup-project-link"
                  href={`/projects#project-${result.project_id}`}
                  onClick={close}
                >
                  View project
                </Link>
              )}
            </div>
          )}
        </div>
        <footer className="notion-dialog-footer">
          {savedSourceId ? (
            <>
              {!result && !saving && (
                <button
                  type="button"
                  onClick={() => {
                    if (savingNow.current) return;
                    savingNow.current = true;
                    setSaving(true);
                    setError("");
                    void finishRefresh(savedSourceId)
                      .catch((reason: unknown) =>
                        setError(
                          reason instanceof Error
                            ? reason.message
                            : "Unable to refresh import status.",
                        ),
                      )
                      .finally(() => {
                        savingNow.current = false;
                        setSaving(false);
                      });
                  }}
                >
                  Refresh status
                </button>
              )}
              <button
                type="button"
                className="primary"
                disabled={saving}
                onClick={close}
              >
                {saving ? "Saving…" : "Done"}
              </button>
            </>
          ) : (
            <>
              <button type="button" disabled={saving} onClick={close}>
                Cancel
              </button>
              <div className="notion-dialog-navigation">
                {step === 2 && (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => {
                      setError("");
                      setStep(1);
                    }}
                  >
                    Back
                  </button>
                )}
                <button
                  className="primary"
                  type="submit"
                  disabled={loading || !source || source.archived || saving}
                  aria-busy={saving}
                >
                  {saving
                    ? "Saving…"
                    : step === 1
                      ? "Continue"
                      : "Save & import"}
                </button>
              </div>
            </>
          )}
        </footer>
      </form>
    </dialog>
  );
}

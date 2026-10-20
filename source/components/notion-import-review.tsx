"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { ImportReview, ReviewDecision } from "@/lib/integration-types";

const GROUPS: { key: ReviewDecision; label: string; symbol: string }[] = [
  { key: "ready", label: "Ready", symbol: "✓" },
  { key: "pending", label: "Pending review", symbol: "⚑" },
  { key: "discarded", label: "Discarded", symbol: "×" },
];
export function ReviewCounts({ review }: { review: ImportReview }) {
  const finished = review.state === "complete";
  return (
    <div className="review-counts" aria-label="Import analysis results">
      {GROUPS.map((group) => (
        <span className={`review-flag review-${group.key}`} key={group.key}>
          <span aria-hidden="true">{group.symbol}</span> {group.label}
          <strong>
            {finished
              ? review.items.filter((item) => item.decision === group.key)
                  .length
              : "—"}
          </strong>
        </span>
      ))}
    </div>
  );
}

export function reviewLabel(review: ImportReview) {
  return review.state === "complete"
    ? "Import analyzed"
    : review.state === "error"
      ? "Manual review available"
      : review.state === "collecting"
        ? "Importing tasks before analysis…"
        : "Analyzing task statuses…";
}

/* Hallmark · component: import review · existing Chromatic Precision tokens
 * pre-emit critique: P4 H4 E4 S5 R5 V4 · rendered verification pending
 */
export function NotionImportReview({
  review,
  projectName,
  clientName,
  sourceError,
  onClose,
  reload,
  opener,
}: {
  review: ImportReview;
  projectName: string;
  clientName: string;
  sourceError?: string | null;
  onClose: () => void;
  reload: () => Promise<void>;
  opener: HTMLElement | null;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const returnFocus = useRef(opener);
  const saving = useRef(false);
  const request = useRef<{ body: string; id: string } | null>(null);
  const [draft, setDraft] = useState<Record<string, ReviewDecision>>({});
  const [revision, setRevision] = useState(review.revision);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [conflict, setConflict] = useState(false);
  const editable = review.state === "complete" || review.state === "error";
  const changed = Object.keys(draft).length > 0;

  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    heading.current?.focus();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      node?.close();
      document.body.style.overflow = previous;
      if (returnFocus.current?.isConnected)
        returnFocus.current.focus({ preventScroll: true });
    };
  }, []);

  function close() {
    if (!saving.current) onClose();
  }
  function choose(id: string, decision: ReviewDecision) {
    if (!changed) setRevision(review.revision);
    setDraft((current) => ({ ...current, [id]: decision }));
    setSaved("");
  }
  async function mutate(action: "apply" | "retry") {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError("");
    setSaved("");
    const payload = {
      action,
      sourceId: review.source_id,
      revision,
      decisions: draft,
    };
    const body = JSON.stringify(payload);
    if (request.current?.body !== body)
      request.current = { body, id: crypto.randomUUID() };
    try {
      const response = await fetch("/api/integrations/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, requestId: request.current.id }),
      });
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 409) setConflict(true);
        throw new Error(
          result.error || "Unable to save review. Your draft is retained.",
        );
      }
      if (action === "apply") {
        setDraft({});
        setRevision(result.revision);
      }
      await reload();
      setSaved(
        action === "apply"
          ? "Review changes saved. Accepted tasks are available in your project."
          : "Analysis queued. Manual decisions will be preserved.",
      );
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Unable to save review.",
      );
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      className="notion-source-dialog"
      aria-labelledby="import-review-title"
      aria-describedby="import-review-description"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <div className="notion-setup-form" aria-busy={busy}>
        <header className="notion-dialog-header">
          <div>
            <p>Notion · AI import validator</p>
            <h2 ref={heading} tabIndex={-1} id="import-review-title">
              {review.name}
            </h2>
          </div>
          <button
            type="button"
            aria-label="Close import review"
            disabled={busy}
            onClick={close}
          >
            ×
          </button>
        </header>
        <div className="notion-dialog-body" inert={busy}>
          {sourceError && (
            <p role="alert" className="dialog-notice">
              {sourceError} Close this review to resolve the connection, then
              resume the import.
            </p>
          )}
          <p id="import-review-description">
            {projectName} · {clientName}. Ready and accepted tasks use this
            project’s billing client. Existing billing assignments and time
            history are preserved.
          </p>
          <p role="status" aria-live="polite">
            {reviewLabel(review)}
          </p>
          <ReviewCounts review={review} />
          {review.state !== "complete" && review.state !== "error" && (
            <p className="muted">
              Counts appear after the initial import and status analysis finish.
            </p>
          )}
          <p className="muted">
            Completed tasks are kept in Discarded and hidden from active work.
            Doing tasks await your review. Later tasks import normally without
            AI analysis.
          </p>
          {review.error && (
            <div className="dialog-notice">
              <p>{review.error}</p>
              <button
                disabled={busy || changed}
                onClick={() => void mutate("retry")}
              >
                Retry analysis
              </button>
              <p className="muted">
                Apply or cancel draft changes before retrying.
              </p>
            </div>
          )}
          {error && (
            <p role="alert" className="dialog-notice">
              {error}
            </p>
          )}
          {saved && <p role="status">{saved}</p>}
          {conflict && (
            <button
              onClick={async () => {
                try {
                  await reload();
                  setDraft({});
                  setConflict(false);
                  setError("");
                  request.current = null;
                } catch {
                  setError(
                    "Unable to reload the review. Your draft is retained.",
                  );
                }
              }}
            >
              Reload latest review
            </button>
          )}
          <details
            open={expanded}
            onToggle={(event) => setExpanded(event.currentTarget.open)}
            className="review-disclosure"
          >
            <summary>
              Expand review{changed ? " · Unsaved changes" : ""}
            </summary>
            {GROUPS.map((group) => {
              // Keep rows in their saved group while editing so selection never
              // moves the focused control out from under keyboard users.
              const items = review.items.filter(
                (item) => item.decision === group.key,
              );
              return (
                <section
                  className="review-group"
                  key={group.key}
                  aria-label={group.label}
                >
                  <div className="review-group-heading">
                    <h3 className={`review-flag review-${group.key}`}>
                      <span aria-hidden="true">{group.symbol}</span>{" "}
                      {group.label} {editable ? `(${items.length})` : ""}
                    </h3>
                    {group.key !== "ready" && !!items.length && (
                      <button
                        disabled={!editable || busy || conflict}
                        onClick={() => {
                          if (!changed) setRevision(review.revision);
                          setDraft((current) => ({
                            ...current,
                            ...Object.fromEntries(
                              items.map((item) => [
                                item.external_task_id,
                                "ready" as const,
                              ]),
                            ),
                          }));
                        }}
                      >
                        Accept all
                      </button>
                    )}
                  </div>
                  {!editable ? (
                    <p className="muted">Available when analysis finishes.</p>
                  ) : !items.length ? (
                    <p className="muted">No tasks in this group.</p>
                  ) : (
                    <ul className="review-task-list">
                      {items.map((item) => (
                        <li key={item.external_task_id}>
                          <div>
                            <strong>{item.name}</strong>
                            <p>
                              {item.status || "No status"} · {item.reason}
                            </p>
                            {/^https:\/\//.test(item.url) && (
                              <a
                                href={item.url}
                                target="_blank"
                                rel="noreferrer"
                              >
                                Open in Notion
                              </a>
                            )}
                            {item.conflict && (
                              <p>
                                Accepting keeps its existing billing assignment.
                              </p>
                            )}
                          </div>
                          <label>
                            <span>Review decision</span>
                            <select
                              aria-label={`Decision for ${item.name}`}
                              disabled={busy || conflict}
                              value={
                                draft[item.external_task_id] || item.decision
                              }
                              onChange={(event) =>
                                choose(
                                  item.external_task_id,
                                  event.target.value as ReviewDecision,
                                )
                              }
                            >
                              <option value="ready">Accept · Ready</option>
                              <option value="pending">
                                Hold · Pending review
                              </option>
                              <option value="discarded">
                                Discard · Recoverable
                              </option>
                            </select>
                          </label>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              );
            })}
          </details>
        </div>
        <footer className="notion-dialog-footer">
          <Link
            href={`/projects#project-${review.project_id}`}
            onClick={(event) => {
              if (saving.current) event.preventDefault();
              else close();
            }}
          >
            View project
          </Link>
          <div className="notion-dialog-navigation">
            <button disabled={busy} onClick={close}>
              {changed ? "Cancel" : "Close"}
            </button>
            <button
              className="primary"
              disabled={busy || !editable || !changed || conflict}
              onClick={() => void mutate("apply")}
            >
              {busy ? "Saving…" : "Apply changes"}
            </button>
          </div>
        </footer>
      </div>
    </dialog>
  );
}

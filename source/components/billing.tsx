"use client";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import type { Snapshot } from "@/lib/types";
import type {
  BillingBatch,
  BillingFilters,
  BillingIndex,
  BillingReview,
} from "@/lib/billing-types";
import {
  exactDuration,
  money,
  safeEvidenceUrl,
  taskSubtotals,
} from "@/lib/billing-format";
import { dayKey, nextDay } from "@/lib/time";
import { Field } from "./fields";

type Input = Record<string, unknown>;
export function Billing({
  work,
  refreshWork,
}: {
  work: Snapshot;
  refreshWork: () => Promise<void>;
}) {
  const [index, setIndex] = useState<BillingIndex>({ batches: [], audit: [] });
  const [report, setReport] = useState<BillingBatch | null>(null);
  const [preview, setPreview] = useState<BillingReview | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [retry, setRetry] = useState<Input | null>(null);
  const [reviewed, setReviewed] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const lock = useRef(false);
  const today = dayKey(work.now, work.user.timezone);
  const [filters, setFilters] = useState<BillingFilters>({
    from: today.slice(0, 8) + "01",
    to: dayKey(nextDay(work.now, work.user.timezone), work.user.timezone),
    timezone: work.user.timezone,
    clientId: "",
    projectId: "",
  });
  const loadIndex = useCallback(async () => {
    const response = await fetch("/api/billing", { cache: "no-store" });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error);
    setIndex(value);
    setLoaded(true);
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => {
      void loadIndex().catch((e) => setError(e.message));
    }, 0);
    return () => clearTimeout(timer);
  }, [loadIndex]);
  async function open(id: string) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        `/api/billing?id=${encodeURIComponent(id)}`,
        { cache: "no-store" },
      );
      const value = await response.json();
      if (!response.ok) throw new Error(value.error);
      setReport(value);
      setPreview(null);
      setReviewed([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load report.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function request(input: Input) {
    if (lock.current) return;
    const payload =
      input.command === "preview" || input.key
        ? input
        : { ...input, key: crypto.randomUUID() };
    lock.current = true;
    setBusy(true);
    setError("");
    setRetry(null);
    try {
      const response = await fetch("/api/billing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const value = await response.json();
      if (!response.ok) {
        if (response.status >= 500 && input.command !== "preview")
          setRetry(payload);
        throw new Error(value.error);
      }
      if (input.command === "preview") {
        setPreview(value);
        setReport(null);
      } else if (input.command !== "rate") {
        // A retry may return its original response; always show current status/version.
        const current = await fetch(
          `/api/billing?id=${encodeURIComponent(value.id)}`,
          { cache: "no-store" },
        );
        const saved = await current.json();
        if (!current.ok) throw new Error(saved.error);
        setReport(saved);
        setPreview(null);
        setReviewed([]);
      }
      await loadIndex();
      if (input.command === "rate") await refreshWork();
    } catch (e) {
      if (e instanceof TypeError && input.command !== "preview")
        setRetry(payload);
      setError(
        e instanceof Error
          ? e.message
          : "Unable to save. Retry the same request.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const review = report?.snapshot ?? preview;
  const disabled = busy || !!retry;
  const change = (key: keyof BillingFilters, value: string) =>
    setFilters((f) => ({
      ...f,
      [key]: value,
      ...(key === "clientId" ? { projectId: "" } : {}),
    }));
  const local = (ms: number) =>
    new Intl.DateTimeFormat("en-GB", {
      timeZone: review?.filters.timezone ?? filters.timezone,
      dateStyle: "medium",
      timeStyle: "long",
    }).format(ms);
  const submitRate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    void request({
      command: "rate",
      ...values,
      version: Number(values.version),
    });
  };
  return (
    <div className="billing-workspace">
      <section
        className="panel billing-controls"
        aria-labelledby="billing-period"
      >
        <h2 id="billing-period">Review unbilled work</h2>
        <p>
          Choose local calendar boundaries. The end date is exclusive. Work
          crossing a boundary is split at that instant; finalized allocations
          are excluded.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void request({ command: "preview", filters });
          }}
        >
          <div className="billing-filters">
            <Field label="From (inclusive)">
              <input
                type="date"
                required
                value={filters.from}
                onChange={(e) => change("from", e.target.value)}
              />
            </Field>
            <Field label="To (exclusive)">
              <input
                type="date"
                required
                value={filters.to}
                onChange={(e) => change("to", e.target.value)}
              />
            </Field>
            <Field label="Timezone">
              <input
                required
                value={filters.timezone}
                onChange={(e) => change("timezone", e.target.value)}
              />
            </Field>
            <Field label="Client">
              <select
                value={filters.clientId}
                onChange={(e) => change("clientId", e.target.value)}
              >
                <option value="">All clients</option>
                {work.clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Project">
              <select
                value={filters.projectId}
                onChange={(e) => change("projectId", e.target.value)}
              >
                <option value="">All projects</option>
                {work.projects
                  .filter(
                    (p) =>
                      !filters.clientId || p.client_id === filters.clientId,
                  )
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </Field>
          </div>
          <div className="actions">
            <button disabled={disabled}>Preview period</button>
            <button
              type="button"
              className="primary"
              disabled={disabled}
              onClick={() => void request({ command: "draft", filters })}
            >
              Save draft
            </button>
          </div>
        </form>
      </section>
      {error && (
        <div className="notice error" role="alert">
          <strong>Billing request failed</strong>
          <p>{error}</p>
          {retry ? (
            <button disabled={busy} onClick={() => void request(retry)}>
              Retry request
            </button>
          ) : (
            <button
              disabled={busy}
              onClick={() => {
                void loadIndex().catch((e) => setError(e.message));
              }}
            >
              Reload reports
            </button>
          )}
        </div>
      )}
      {busy && <p role="status">Loading or saving billing work…</p>}
      {review && (
        <section
          className="panel billing-report"
          aria-labelledby="report-title"
        >
          <header className="section-head">
            <div>
              <p className="eyebrow">
                {report?.status ?? "Unsaved preview"} · Billable-work report
              </p>
              <h2 id="report-title">
                {review.filters.from} → {review.filters.to}
              </h2>
              <p>{review.filters.timezone} · End exclusive</p>
              {report && (
                <p className="billing-id">
                  Report {report.id} · revision {report.version}
                </p>
              )}
            </div>
            {report && (
              <div className="actions billing-controls">
                <a
                  className="button"
                  href={`/api/billing/export?id=${encodeURIComponent(report.id)}`}
                >
                  Export CSV
                </a>
                <button onClick={() => window.print()}>Print report</button>
              </div>
            )}
          </header>
          {report?.status === "draft" && (
            <p className="notice">
              Draft — review again after corrections. This is an unbilled-work
              report, not a tax invoice.
            </p>
          )}
          {report?.status === "void" && (
            <p className="notice error">
              VOID · Original totals are historical and excluded from active
              billing. Reason: {report.void_reason}
            </p>
          )}
          {report?.status === "finalized" && (
            <p className="notice">
              Finalized {local(report.finalized_at!)}. Amounts, labels, entry
              revisions and evidence are frozen.
            </p>
          )}
          <p>{review.policy}</p>
          <p>
            Previously allocated in this period:{" "}
            <strong className="mono">
              {exactDuration(review.alreadyAllocatedMs)}
            </strong>
            . Remaining unbilled recorded work is shown below.
          </p>
          <div className="billing-totals">
            {review.totals.map((t) => (
              <article key={t.currency}>
                <h3>
                  {t.currency} {money(t.minorAmount, t.digits)}
                </h3>
                <dl>
                  <dt>Recorded / unbilled</dt>
                  <dd>{exactDuration(t.recordedMs)}</dd>
                  <dt>Billable</dt>
                  <dd>{exactDuration(t.billableMs)}</dd>
                  <dt>Non-billable</dt>
                  <dd>{exactDuration(t.nonBillableMs)}</dd>
                </dl>
              </article>
            ))}
          </div>
          {!review.lines.length && (
            <p>No unbilled stopped entries match this period.</p>
          )}
          {review.issues.length > 0 && (
            <div className="notice error">
              <h3>Resolve before finalizing</h3>
              <ul>
                {review.issues.map((issue) => (
                  <li key={issue.entryId}>
                    {issue.message} Entry {issue.entryId}. Correct it in the{" "}
                    <Link href="/timesheet">timesheet</Link>.
                  </li>
                ))}
              </ul>
            </div>
          )}
          <h3>Task subtotals</h3>
          <div className="billing-subtotals">
            {taskSubtotals(review).map((t) => (
              <article key={`${t.taskId}:${t.currency}`}>
                <strong>
                  {t.client} / {t.project} / {t.task}
                </strong>
                <p>
                  Recorded {exactDuration(t.recordedMs)} · Billed{" "}
                  {exactDuration(t.billedMs)} · {t.currency}{" "}
                  {money(t.minorAmount.toString(), t.digits)}
                </p>
              </article>
            ))}
          </div>
          <h3>Entry allocations and evidence</h3>
          <div className="billing-lines">
            {review.lines.map((line) => (
              <article
                className="billing-line"
                key={`${line.entryId}:${line.start}`}
              >
                <h4>
                  <Link href={`/tasks/${line.taskId}`}>{line.task}</Link>
                </h4>
                <p>
                  {line.client} / {line.project} ·{" "}
                  {line.billable ? "Billable" : "Non-billable"}
                </p>
                <p>
                  {local(line.start)} → {local(line.end)} (exclusive)
                </p>
                <p className="mono">
                  Recorded {exactDuration(line.recordedMs)} · Billed{" "}
                  {exactDuration(line.billedMs)} · {line.currency}{" "}
                  {money(line.minorAmount, line.digits)}
                </p>
                <p>
                  Rate {line.currency} {money(String(line.rate), 2)}/h · Entry
                  revision {line.revision}
                </p>
                <p className="billing-id">
                  {line.entryId} · UTC {new Date(line.start).toISOString()} →{" "}
                  {new Date(line.end).toISOString()}
                </p>
                {line.notes && <p>{line.notes}</p>}
                {line.evidence.length ? (
                  <ul>
                    {line.evidence.map((e, i) => (
                      <li key={i}>
                        {e.kind}:{" "}
                        {safeEvidenceUrl(e.url) ? (
                          <a
                            href={safeEvidenceUrl(e.url)!}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {e.label || e.url}
                          </a>
                        ) : (
                          <span>{e.label || "Unavailable URL"}</span>
                        )}
                        <span className="print-evidence">
                          {" "}
                          {safeEvidenceUrl(e.url)}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>Manual / non-code work · no external evidence required.</p>
                )}
                {review.longEntryIds.includes(line.entryId) && (
                  <div className="notice">
                    Entry exceeds 12 hours.
                    {(!report || report.status === "draft") && (
                      <label className="checkbox billing-controls">
                        <input
                          type="checkbox"
                          checked={reviewed.includes(line.entryId)}
                          onChange={(e) =>
                            setReviewed((ids) =>
                              e.target.checked
                                ? [...ids, line.entryId]
                                : ids.filter((id) => id !== line.entryId),
                            )
                          }
                        />
                        I reviewed this full entry and its interval.
                      </label>
                    )}
                  </div>
                )}
                {(!report || report.status === "draft") && (
                  <details className="billing-controls">
                    <summary>Override entry rate with an audit reason</summary>
                    <form onSubmit={submitRate}>
                      <input
                        type="hidden"
                        name="entryId"
                        value={line.entryId}
                      />
                      <input
                        type="hidden"
                        name="version"
                        value={line.revision}
                      />
                      <Field label={`Hourly rate (${line.currency})`}>
                        <input
                          name="rate"
                          required
                          inputMode="decimal"
                          pattern="[0-9]{1,7}(\\.[0-9]{1,2})?"
                          defaultValue={money(String(line.rate), 2)}
                        />
                      </Field>
                      <Field label="Reason">
                        <input name="reason" required maxLength={2000} />
                      </Field>
                      <button disabled={disabled}>Save override</button>
                      <p>
                        Then refresh this draft or preview to review the new
                        amount.
                      </p>
                    </form>
                  </details>
                )}
              </article>
            ))}
          </div>
          {report?.status === "draft" && (
            <div className="actions billing-controls">
              <button
                disabled={disabled}
                onClick={() =>
                  void request({
                    command: "refresh",
                    batchId: report.id,
                    version: report.version,
                  })
                }
              >
                Refresh draft
              </button>
              <button
                className="primary"
                disabled={
                  disabled ||
                  !!review.issues.length ||
                  !review.lines.length ||
                  review.longEntryIds.some((id) => !reviewed.includes(id))
                }
                onClick={() =>
                  void request({
                    command: "finalize",
                    batchId: report.id,
                    version: report.version,
                    reviewedLong: reviewed,
                  })
                }
              >
                Finalize report
              </button>
            </div>
          )}
          {report?.status === "finalized" && (
            <details className="billing-controls">
              <summary>Void and reissue a correction</summary>
              <p>
                Voiding releases this report’s allocations for a new draft and
                retains its original snapshot. Void other reports using the same
                entry before editing it. Notify recipients of any exported
                report separately.
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const values = Object.fromEntries(
                    new FormData(e.currentTarget),
                  );
                  void request({
                    command: "void",
                    batchId: report.id,
                    version: report.version,
                    reason: values.reason,
                  });
                }}
              >
                <Field label="Void reason">
                  <input name="reason" required maxLength={2000} />
                </Field>
                <button disabled={disabled}>Void this report</button>
              </form>
            </details>
          )}
        </section>
      )}
      <section className="panel billing-controls">
        <div className="section-head">
          <h2>Saved reports</h2>
          <button
            disabled={disabled}
            onClick={() => void loadIndex().catch((e) => setError(e.message))}
          >
            Refresh list
          </button>
        </div>
        <p>
          Filtered by the client, project and overlapping dates selected above.
        </p>
        {!loaded && (
          <p>Load reports to review saved drafts and finalized work.</p>
        )}
        <div className="billing-subtotals">
          {index.batches
            .filter(
              (b) =>
                (!filters.clientId ||
                  b.filters.clientId === filters.clientId ||
                  !b.filters.clientId) &&
                (!filters.projectId ||
                  b.filters.projectId === filters.projectId ||
                  !b.filters.projectId) &&
                b.filters.from < filters.to &&
                b.filters.to > filters.from,
            )
            .map((b) => (
              <article key={b.id}>
                <button disabled={disabled} onClick={() => void open(b.id)}>
                  Open {b.status} report
                </button>
                <p>
                  {b.filters.from} → {b.filters.to} · {b.filters.timezone} ·{" "}
                  {b.id}
                </p>
              </article>
            ))}
        </div>
        <details>
          <summary>Billing audit history ({index.audit.length})</summary>
          <ul>
            {index.audit.map((a) => (
              <li key={a.id}>
                {new Date(a.at).toISOString()} · {a.action} ·{" "}
                {a.batch_id ?? "Entry rate"}
                <pre>{JSON.stringify(a.detail, null, 2)}</pre>
              </li>
            ))}
          </ul>
        </details>
      </section>
    </div>
  );
}

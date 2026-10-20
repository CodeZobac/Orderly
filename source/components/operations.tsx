"use client";
import { useState } from "react";
type OperationsState = {
  now: number;
  sources: {
    id: string;
    name: string;
    provider: string;
    status: string;
    connectionStatus: string;
    lastSuccess: number | null;
    queued: boolean;
    attempts: number;
    availableAt: number | null;
    leaseUntil: number | null;
  }[];
};
export function Operations() {
  const [state, setState] = useState<OperationsState | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function refresh() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/operations", { cache: "no-store" });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error);
      setState(value);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Unable to load sync monitoring.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <div className="section-head">
        <h2>Durable sync monitoring</h2>
        <button disabled={busy} onClick={() => void refresh()}>
          {busy ? "Loading…" : "Refresh job status"}
        </button>
      </div>
      <p>
        Inspect persisted retries and leases. Imports and verified webhooks
        start background processing. A supervised worker handles unattended
        retries and reconciliation. A successful page read does not prove a
        complete import.
      </p>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {state && (
        <>
          <p>Snapshot {new Date(state.now).toISOString()}</p>
          {!state.sources.length && <p>No mapped sources yet.</p>}
          <ul>
            {state.sources.map((s) => (
              <li key={s.id}>
                <strong>
                  {s.provider}: {s.name}
                </strong>
                <p>
                  {s.connectionStatus} · {s.status} ·{" "}
                  {s.queued ? "Queued" : "No pending job"} · Retry attempts{" "}
                  {s.attempts}
                </p>
                <p>
                  Last success{" "}
                  {s.lastSuccess
                    ? new Date(s.lastSuccess).toISOString()
                    : "Not recorded"}
                  {s.queued && s.availableAt
                    ? ` · Next eligible ${new Date(s.availableAt).toISOString()}`
                    : ""}
                  {s.leaseUntil
                    ? ` · Lease expires ${new Date(s.leaseUntil).toISOString()}`
                    : ""}
                </p>
                {s.connectionStatus !== "connected" ||
                s.attempts >= 5 ||
                (s.queued &&
                  s.availableAt !== null &&
                  s.availableAt < state.now - 3600000) ||
                (s.lastSuccess !== null &&
                  s.lastSuccess < state.now - 3600000) ? (
                  <p className="notice">
                    Needs attention — check worker logs, reconnect/remap, or
                    resync this source.
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

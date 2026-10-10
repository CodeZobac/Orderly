"use client";
import { useCallback, useEffect, useState } from "react";
import type { NotionSetupStatus } from "@/lib/notion-webhook-setup";
import { Field } from "./fields";

export function NotionWebhookSetup() {
  const [status, setStatus] = useState<NotionSetupStatus | null>(null),
    [url, setUrl] = useState(""),
    [token, setToken] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [revealed, setRevealed] = useState(false);
  const load = useCallback(async () => {
    const response = await fetch("/api/integrations/notion/setup", {
      cache: "no-store",
    });
    const value = await response.json();
    if (!response.ok)
      throw new Error(value.error || "Unable to load Notion webhook setup.");
    setStatus(value);
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => {
      void load().catch((e) => setError(e.message));
    }, 0);
    return () => clearTimeout(timer);
  }, [load]);
  async function action(name: string) {
    setBusy(true);
    setError("");
    setNotice("");
    setToken("");
    setRevealed(false);
    try {
      const response = await fetch("/api/integrations/notion/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: name }),
      });
      const value = await response.json();
      if (!response.ok)
        throw new Error(
          value.error || "Unable to finish Notion webhook setup.",
        );
      if (name === "begin") {
        setUrl(value.url);
        setNotice(
          "Capture opened for ten minutes. Update the unverified webhook URL in Notion, then resend the token.",
        );
      }
      if (name === "retrieve") {
        setToken(value.token);
        setNotice(
          "Token received. Copy it into Notion and your Vercel server environment.",
        );
      }
      if (name === "discard") {
        setUrl("");
        setNotice("Temporary capture cleared.");
      }
      await load();
    } catch (e) {
      setToken("");
      setError(e instanceof Error ? e.message : "Unable to finish setup.");
    } finally {
      setBusy(false);
    }
  }
  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setNotice(`${label} copied.`);
    } catch {
      setError(
        `Unable to copy. Select the ${label.toLowerCase()} field and copy it manually.`,
      );
    }
  }
  return (
    <details className="integration-mapping">
      <summary>Notion webhook verification</summary>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!status && !error && <p role="status">Loading webhook setup…</p>}
      {status && !status.configured && (
        <>
          <p>
            Enable setup for this account by setting{" "}
            <code>NOTION_WEBHOOK_SETUP_OWNER_ID</code> in Vercel to the account
            ID below, then redeploy.
          </p>
          <Field label="Your Orderly account ID">
            <input readOnly value={status.ownerId} />
          </Field>
          <button onClick={() => void copy(status.ownerId, "Account ID")}>
            Copy account ID
          </button>
        </>
      )}
      {status?.configured && !status.authorized && (
        <p className="muted">
          Webhook verification is available to the deployment owner.
        </p>
      )}
      {status?.authorized && (
        <>
          <p>
            Start capture, update the webhook URL in Notion before verification,
            and click Resend token. Captures expire after ten minutes and belong
            to this sign-in session.
          </p>
          <div className="actions">
            <button disabled={busy} onClick={() => void action("begin")}>
              {status.active
                ? "Restart verification capture"
                : "Start verification capture"}
            </button>
            <button
              disabled={busy || !status.active}
              onClick={() => void action("retrieve")}
            >
              Retrieve verification token
            </button>
            <button
              disabled={busy || !status.active}
              onClick={() => void action("discard")}
            >
              Clear capture
            </button>
          </div>
          {url && (
            <>
              <Field label="Temporary Notion webhook URL">
                <input readOnly value={url} />
              </Field>
              <button
                disabled={busy}
                onClick={() => void copy(url, "Webhook URL")}
              >
                Copy webhook URL
              </button>
            </>
          )}
          {status.active && (
            <p className="muted">
              {status.received
                ? "Verification token received."
                : "Waiting for Notion’s verification request."}{" "}
              Expires {new Date(status.expiresAt!).toLocaleTimeString()}.
            </p>
          )}
          {token && (
            <>
              <Field label="Notion verification token">
                <input
                  type={revealed ? "text" : "password"}
                  value={token}
                  readOnly
                  autoComplete="off"
                />
              </Field>
              <div className="actions">
                <button
                  disabled={busy}
                  onClick={() => void copy(token, "Token")}
                >
                  Copy verification token
                </button>
                <button onClick={() => setRevealed(!revealed)}>
                  {revealed ? "Hide token" : "Reveal token"}
                </button>
                <button
                  onClick={() => {
                    setToken("");
                    setRevealed(false);
                  }}
                >
                  Hide and forget token
                </button>
              </div>
              <p>
                Paste into Notion’s Verify subscription form. In Vercel, set{" "}
                <code>NOTION_WEBHOOK_VERIFICATION_TOKEN</code> to the same value
                and redeploy. Clear the temporary capture when finished. Keep
                the configured webhook URL; its setup parameter does not affect
                signed events.
              </p>
            </>
          )}
        </>
      )}
      {notice && (
        <p className="muted" role="status">
          {notice}
        </p>
      )}
    </details>
  );
}

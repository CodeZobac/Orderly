"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Snapshot } from "@/lib/types";
import { dailyTotals } from "@/lib/time";
import { TimerNotifications } from "./timer-notifications";

type Input = Record<string, unknown>;
type Workspace = {
  data: Snapshot | null;
  loading: boolean;
  busy: boolean;
  error: string;
  retry: Input | null;
  offset: number;
  totals: Record<string, number>;
  refresh: () => Promise<void>;
  refreshTimers: () => Promise<boolean>;
  save: (input: Input) => Promise<boolean>;
  authenticate: (input: Input) => Promise<void>;
  setError: (error: string) => void;
};
const Context = createContext<Workspace | null>(null);

// Fixed measure names and numeric metadata only: no user data in diagnostics.
async function readWork(response: Response, start: number) {
  const headersAt = performance.now();
  const text = await response.text();
  const bodyAt = performance.now();
  try {
    return JSON.parse(text);
  } finally {
    // Diagnostics must never turn a committed save into an apparent failure.
    try {
      performance.clearMeasures("orderly-work");
      performance.measure("orderly-work", {
        start,
        end: performance.now(),
        detail: {
          headersMs: headersAt - start,
          bodyMs: bodyAt - headersAt,
          parseMs: performance.now() - bodyAt,
          bytes: Number(response.headers.get("X-Work-Bytes") || 0),
          mode: response.headers.get("X-Work-Mode"),
          serverTiming: response.headers.get("Server-Timing"),
        },
      });
    } catch {
      /* User Timing options are unavailable in some browsers. */
    }
  }
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState<Input | null>(null);
  const [offset, setOffset] = useState(0);
  const entries = data?.entries;
  const timezone = data?.user.timezone ?? "UTC";
  const totals = useMemo(
    () => (entries ? dailyTotals(entries, timezone) : {}),
    [entries, timezone],
  );
  const epoch = useRef(0);
  const operation = useRef(false);
  const unresolved = useRef<Input | null>(null);
  const pendingGet = useRef<{
    controller: AbortController;
    promise: Promise<void>;
  } | null>(null);
  const lastRefreshAt = useRef(0);
  const successfulRefresh = useRef(-1);
  const invalidate = useCallback(() => {
    epoch.current++;
    pendingGet.current?.controller.abort();
    pendingGet.current = null;
  }, []);
  const clear = useCallback(() => {
    invalidate();
    setData(null);
    setLoading(false);
    setOffset(0);
    setRetry(null);
    unresolved.current = null;
  }, [invalidate]);
  const accept = useCallback((value: Snapshot) => {
    setData(value);
    setOffset(value.now - Date.now());
  }, []);

  const load = useCallback((): Promise<void> => {
    if (pendingGet.current) return pendingGet.current.promise;
    const controller = new AbortController();
    const version = epoch.current;
    const promise = (async () => {
      lastRefreshAt.current = Date.now();
      try {
        const start = performance.now();
        const response = await fetch("/api/work", {
          cache: "no-store",
          signal: controller.signal,
        });
        const value = await readWork(response, start);
        if (version !== epoch.current || controller.signal.aborted) return;
        if (response.status === 401) {
          clear();
          return;
        }
        if (!response.ok) throw new Error(value.error);
        accept(value);
        successfulRefresh.current = version;
        setError("");
      } catch (e) {
        if (version === epoch.current && !controller.signal.aborted)
          setError(
            e instanceof Error ? e.message : "Unable to load saved data.",
          );
      } finally {
        if (pendingGet.current?.controller === controller)
          pendingGet.current = null;
        if (version === epoch.current && !controller.signal.aborted)
          setLoading(false);
      }
    })();
    pendingGet.current = { controller, promise };
    return promise;
  }, [accept, clear]);
  const refresh = useCallback(async () => {
    if (!operation.current) await load();
  }, [load]);
  const refreshTimers = useCallback(async () => {
    if (operation.current || unresolved.current) return false;
    // Event cursors may advance only after a fresh snapshot. Do not reuse a GET
    // that began before the event or overwrite a newer interactive mutation.
    invalidate();
    const version = epoch.current;
    await load();
    return epoch.current === version && successfulRefresh.current === version;
  }, [invalidate, load]);

  useEffect(() => {
    const initial = setTimeout(() => void refresh(), 0);
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
      invalidate();
    };
  }, [refresh, invalidate]);

  async function save(input: Input) {
    if (operation.current) return false;
    if (unresolved.current && input.key !== unresolved.current.key) {
      setError("Retry the pending save before starting another action.");
      return false;
    }
    const payload = input.key ? input : { ...input, key: crypto.randomUUID() };
    operation.current = true;
    invalidate();
    const version = epoch.current;
    setBusy(true);
    setError("");
    setRetry(null);
    unresolved.current = null;
    try {
      const start = performance.now();
      const response = await fetch("/api/work", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const value = await readWork(response, start);
      if (version !== epoch.current) return false;
      if (response.status === 401) {
        clear();
        setError(value.error);
        return false;
      }
      if (!response.ok) {
        if (response.status >= 500) {
          setRetry(payload);
          unresolved.current = payload;
        }
        throw new Error(value.error);
      }
      accept(value.data);
      return true;
    } catch (e) {
      if (version !== epoch.current) return false;
      // Network/invalid response failures leave the commit outcome uncertain.
      if (e instanceof TypeError || e instanceof SyntaxError) {
        setRetry(payload);
        unresolved.current = payload;
      }
      setError(
        e instanceof Error
          ? e.message
          : "Unable to save. Retry the same request.",
      );
      return false;
    } finally {
      operation.current = false;
      setBusy(false);
      window.dispatchEvent(new Event("orderly-timer-change"));
    }
  }
  async function authenticate(input: Input) {
    if (operation.current) return;
    operation.current = true;
    clear();
    const version = epoch.current;
    setBusy(true);
    setError("");
    setLoading(false);
    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const value = await response.json();
      if (version !== epoch.current) return;
      if (!response.ok) throw new Error(value.error);
      if (input.action !== "logout") await load();
    } catch (e) {
      if (version === epoch.current)
        setError(e instanceof Error ? e.message : "Unable to authenticate.");
    } finally {
      operation.current = false;
      setBusy(false);
    }
  }
  return (
    <Context.Provider
      value={{
        data,
        loading,
        busy,
        error,
        retry,
        offset,
        totals,
        refresh,
        refreshTimers,
        save,
        authenticate,
        setError,
      }}
    >
      {children}
      <TimerNotifications />
    </Context.Provider>
  );
}

export function useWorkspace() {
  const value = useContext(Context);
  if (!value) throw new Error("WorkspaceProvider is required.");
  return value;
}

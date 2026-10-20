"use client";
import { useEffect, useRef, useState } from "react";
import { useWorkspace } from "./workspace-provider";

type TimerEvent = {
  id: string;
  kind: string;
  origin: string;
  message: string;
  at: number;
};

// Mounted once per signed-in account. Private event data stays in memory.
export function TimerNotifications() {
  const { data } = useWorkspace();
  return data ? <AccountNotifications key={data.user.email} /> : null;
}

function AccountNotifications() {
  const { refreshTimers, busy, retry } = useWorkspace();
  const [events, setEvents] = useState<TimerEvent[]>([]);
  const [soundBlocked, setSoundBlocked] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  const unavailable = useRef(false);
  const refreshRef = useRef(refreshTimers);
  useEffect(() => {
    unavailable.current = busy || !!retry;
    refreshRef.current = refreshTimers;
    if (!busy && !retry)
      window.dispatchEvent(new Event("orderly-timer-change"));
  }, [busy, retry, refreshTimers]);

  useEffect(() => {
    const player = new Audio("/sounds/timer-change.wav");
    audio.current = player;
    let cancelled = false;
    let pending = false;
    let sounds = 0;
    let playing = false;
    let cursor = "0";
    const deliveryToken = crypto.randomUUID();
    const seen = new Set<string>();
    const controller = new AbortController();
    const playNext = () => {
      if (cancelled || playing || sounds === 0) return;
      sounds--;
      playing = true;
      player.currentTime = 0;
      void player.play().catch(() => {
        playing = false;
        sounds = 0;
        if (!cancelled) setSoundBlocked(true);
      });
    };
    const onEnded = () => {
      playing = false;
      playNext();
    };
    player.addEventListener("ended", onEnded);
    async function poll() {
      if (
        pending ||
        unavailable.current ||
        document.visibilityState !== "visible"
      )
        return;
      pending = true;
      try {
        const response = await fetch(`/api/timer-events?cursor=${cursor}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) return;
        const value: {
          cursor: string;
          changed: boolean;
          pending: TimerEvent[];
        } = await response.json();
        if (cancelled || unavailable.current) return;
        if (value.changed && !(await refreshRef.current())) return;
        if (cancelled || unavailable.current) return;
        cursor = value.cursor;
        if (!value.pending.length || document.visibilityState !== "visible")
          return;
        const claim = await fetch("/api/timer-events", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "claim",
            token: deliveryToken,
            ids: value.pending.map((event) => event.id),
          }),
          signal: controller.signal,
        });
        if (!claim.ok) return;
        const claimed: TimerEvent[] = await claim.json();
        if (cancelled) return;
        const fresh = claimed.filter((event) => !seen.has(event.id));
        fresh.forEach((event) => seen.add(event.id));
        setEvents((old) => [...old, ...fresh]);
        // Queue one short alert for each external change without cutting off
        // earlier sounds when several tasks change in the same sync page.
        sounds += fresh.filter((event) => event.origin !== "orderly").length;
        playNext();
        if (claimed.length)
          await fetch("/api/timer-events", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "ack",
              token: deliveryToken,
              ids: claimed.map((event) => event.id),
            }),
            signal: controller.signal,
          });
      } catch {
        /* Offline events remain durable for the next successful poll. */
      } finally {
        pending = false;
      }
    }
    const onReturn = () => {
      void poll();
    };
    const interval = setInterval(onReturn, 5000);
    window.addEventListener("focus", onReturn);
    window.addEventListener("orderly-timer-change", onReturn);
    document.addEventListener("visibilitychange", onReturn);
    void poll();
    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(interval);
      player.pause();
      player.removeEventListener("ended", onEnded);
      audio.current = null;
      window.removeEventListener("focus", onReturn);
      window.removeEventListener("orderly-timer-change", onReturn);
      document.removeEventListener("visibilitychange", onReturn);
    };
  }, []);

  return (
    <aside className="timer-toasts" aria-label="Timer notifications">
      <div role="status" aria-live="polite" aria-relevant="additions">
        {events.map((event) => (
          <div className="timer-toast" key={event.id}>
            <p>{event.message}</p>
            <button
              aria-label={`Dismiss: ${event.message}`}
              onClick={() =>
                setEvents((old) => old.filter((item) => item.id !== event.id))
              }
            >
              Dismiss
            </button>
          </div>
        ))}
      </div>
      {soundBlocked && (
        <div className="timer-toast">
          <p>Your browser needs permission to play timer alerts.</p>
          <button
            onClick={() => {
              void audio.current
                ?.play()
                .then(() => setSoundBlocked(false))
                .catch(() => setSoundBlocked(true));
            }}
          >
            Enable sound
          </button>
        </div>
      )}
    </aside>
  );
}

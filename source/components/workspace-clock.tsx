"use client";
import { useEffect, useState } from "react";
import { dayKey, duration } from "@/lib/time";

function useClock(serverNow: number, offset: number) {
  const [clock, setClock] = useState({ source: serverNow, now: serverNow });
  useEffect(() => {
    const timer = setInterval(
      () => setClock({ source: serverNow, now: Date.now() + offset }),
      1000,
    );
    return () => clearInterval(timer);
  }, [serverNow, offset]);
  return clock.source === serverNow ? clock.now : serverNow;
}

// The workspace rerenders on a date change, not on every elapsed second.
export function useWorkspaceDate(
  serverNow: number,
  timezone: string,
  offset: number,
) {
  const [clock, setClock] = useState({ source: serverNow, now: serverNow });
  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now() + offset;
      setClock((previous) =>
        previous.source !== serverNow ||
        dayKey(previous.now, timezone) !== dayKey(now, timezone)
          ? { source: serverNow, now }
          : previous,
      );
    }, 1000);
    return () => clearInterval(timer);
  }, [serverNow, timezone, offset]);
  return clock.source === serverNow ? clock.now : serverNow;
}

type ClockProps = { start: number; serverNow: number; offset: number };
export function ElapsedTimer({ start, serverNow, offset }: ClockProps) {
  return duration(useClock(serverNow, offset) - start);
}
export function LongTimerNotice({ start, serverNow, offset }: ClockProps) {
  const now = useClock(serverNow, offset);
  return now - start > 12 * 3600000 ? (
    <p className="notice" role="status">
      This timer has run for over 12 hours. Stop it and review the interval; no
      idle time has been deducted.
    </p>
  ) : null;
}

/** Earnings so far in integer minor units, rounded half up like billing. */
export function earnedMinor(elapsedMs: number, rateMinorPerHour: number) {
  if (elapsedMs <= 0 || rateMinorPerHour <= 0) return 0;
  const numerator = BigInt(Math.floor(elapsedMs)) * BigInt(rateMinorPerHour);
  return Number((numerator * BigInt(2) + BigInt(3600000)) / BigInt(7200000));
}
export function formatMinor(currency: string, minor: number) {
  return `${currency} ${(minor / 100).toFixed(2)}`;
}
type AmountProps = ClockProps & { rate: number; currency: string };
/** Live estimate for a running timer; the billing preview stays authoritative. */
export function RunningAmount({
  start,
  serverNow,
  offset,
  rate,
  currency,
}: AmountProps) {
  const now = useClock(serverNow, offset);
  return formatMinor(currency, earnedMinor(now - start, rate));
}

import type { Entry } from "./types";
export function dayKey(instant: number, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}
// Binary search the next local date boundary: works across 23/25-hour DST days.
export function nextDay(instant: number, timezone: string) {
  const day = dayKey(instant, timezone);
  let low = instant + 1,
    high = instant + 48 * 3600000;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (dayKey(mid, timezone) === day) low = mid + 1;
    else high = mid;
  }
  return low;
}
export function dailyTotals(entries: Entry[], timezone: string) {
  const totals: Record<string, number> = {};
  for (const entry of entries) {
    if (entry.end === null) continue;
    let cursor = entry.start;
    while (cursor < entry.end) {
      const end = Math.min(entry.end, nextDay(cursor, timezone));
      const day = dayKey(cursor, timezone);
      totals[day] = (totals[day] || 0) + end - cursor;
      cursor = end;
    }
  }
  return totals;
}
export function weekDays(instant: number, timezone: string) {
  const date = new Date(`${dayKey(instant, timezone)}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(date);
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });
}
export function duration(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 3600)
    .toString()
    .padStart(2, "0")}:${Math.floor((seconds / 60) % 60)
    .toString()
    .padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
}

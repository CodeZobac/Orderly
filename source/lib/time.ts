import type { Entry } from "./types";
const dayFormatters = new Map<string, Intl.DateTimeFormat>();
export function dayKey(instant: number, timezone: string) {
  let formatter = dayFormatters.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    // Bound the cache on the server, where users can choose many timezones.
    if (dayFormatters.size >= 64)
      dayFormatters.delete(dayFormatters.keys().next().value!);
    dayFormatters.set(timezone, formatter);
  }
  return formatter.format(instant);
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
  const boundaries = new Map<string, number>();
  for (const entry of entries) {
    if (entry.end === null) continue;
    let cursor = entry.start;
    while (cursor < entry.end) {
      const day = dayKey(cursor, timezone);
      // Most intervals finish on the same local date: no boundary search needed.
      // Only split overnight intervals, sharing each date boundary across entries.
      let end = entry.end;
      if (dayKey(entry.end - 1, timezone) !== day) {
        let boundary = boundaries.get(day);
        if (boundary === undefined) {
          boundary = nextDay(cursor, timezone);
          boundaries.set(day, boundary);
        }
        end = Math.min(entry.end, boundary);
      }
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

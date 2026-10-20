import type { BillingReview } from "./billing-types";
// Never convert monetary strings to floating point, including large exports.
export function money(minor: string, digits: number) {
  const value = BigInt(minor),
    negative = value < BigInt(0);
  const raw = (negative ? -value : value).toString().padStart(digits + 1, "0");
  return `${negative ? "-" : ""}${digits ? `${raw.slice(0, -digits)}.${raw.slice(-digits)}` : raw}`;
}
export function exactDuration(ms: number) {
  const hours = Math.floor(ms / 3600000),
    minutes = Math.floor(ms / 60000) % 60;
  const seconds = Math.floor(ms / 1000) % 60,
    milliseconds = ms % 1000;
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}`;
}
export function safeEvidenceUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}
export function csvCell(value: unknown) {
  let text = String(value ?? "");
  // Leading whitespace/control characters can conceal a spreadsheet formula.
  if (/^[\s\u0000-\u001f]*[=+@-]/u.test(text) || /^[\t\r\n]/u.test(text))
    text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
export function billingCsv(review: BillingReview, id: string, status: string) {
  const rows: unknown[][] = [
    [
      "Report",
      "Status",
      "Client",
      "Project",
      "Task",
      "Entry ID",
      "Revision",
      "Start UTC",
      "End UTC (exclusive)",
      "Recorded ms",
      "Billed ms",
      "Billable",
      "Currency",
      "Hourly rate",
      "Amount",
      "Exact minor numerator",
      "Exact denominator",
      "Evidence URLs",
      "Notes",
      "Policy",
    ],
  ];
  for (const line of review.lines)
    rows.push([
      id,
      status,
      line.client,
      line.project,
      line.task,
      line.entryId,
      line.revision,
      new Date(line.start).toISOString(),
      new Date(line.end).toISOString(),
      line.recordedMs,
      line.billedMs,
      line.billable,
      line.currency,
      money(String(line.rate), 2),
      money(line.minorAmount, line.digits),
      line.numerator,
      line.denominator,
      line.evidence
        .map((e) => safeEvidenceUrl(e.url))
        .filter(Boolean)
        .join(" | "),
      line.notes,
      review.policy,
    ]);
  for (const total of review.totals)
    rows.push([
      id,
      status,
      "TOTAL",
      "",
      "",
      "",
      "",
      "",
      "",
      total.recordedMs,
      total.billableMs,
      "",
      total.currency,
      "",
      money(total.minorAmount, total.digits),
      "",
      "",
      "",
      "",
      review.policy,
    ]);
  return (
    "\uFEFF" +
    rows.map((row) => row.map(csvCell).join(",")).join("\r\n") +
    "\r\n"
  );
}
export function taskSubtotals(review: BillingReview) {
  const groups = new Map<
    string,
    {
      taskId: string;
      task: string;
      project: string;
      client: string;
      currency: string;
      digits: number;
      recordedMs: number;
      billedMs: number;
      minorAmount: bigint;
    }
  >();
  for (const line of review.lines) {
    const key = `${line.taskId}:${line.currency}`;
    const group = groups.get(key) ?? {
      taskId: line.taskId,
      task: line.task,
      project: line.project,
      client: line.client,
      currency: line.currency,
      digits: line.digits,
      recordedMs: 0,
      billedMs: 0,
      minorAmount: BigInt(0),
    };
    group.recordedMs += line.recordedMs;
    group.billedMs += line.billedMs;
    group.minorAmount += BigInt(line.minorAmount);
    groups.set(key, group);
  }
  return [...groups.values()];
}

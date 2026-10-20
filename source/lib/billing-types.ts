export type BillingFilters = {
  from: string;
  to: string;
  timezone: string;
  clientId: string;
  projectId: string;
};
export type BillingLine = {
  entryId: string;
  revision: number;
  taskId: string;
  task: string;
  projectId: string;
  project: string;
  clientId: string;
  client: string;
  start: number;
  end: number;
  sourceStart: number;
  sourceEnd: number;
  recordedMs: number;
  billedMs: number;
  billable: boolean;
  rate: number;
  currency: string;
  digits: number;
  notes: string;
  numerator: string;
  denominator: string;
  minorAmount: string;
  evidence: { kind: string; label: string; url: string }[];
};
export type BillingTotal = {
  currency: string;
  digits: number;
  recordedMs: number;
  billableMs: number;
  nonBillableMs: number;
  minorAmount: string;
};
export type BillingReview = {
  filters: BillingFilters;
  start: number;
  end: number;
  policy: string;
  lines: BillingLine[];
  totals: BillingTotal[];
  issues: { entryId: string; message: string }[];
  longEntryIds: string[];
  alreadyAllocatedMs: number;
};
export type BillingBatch = {
  id: string;
  status: "draft" | "finalized" | "void";
  filters: BillingFilters;
  snapshot: BillingReview;
  version: number;
  created_at: number;
  finalized_at: number | null;
  voided_at: number | null;
  void_reason: string | null;
};
export type BillingAudit = {
  id: string;
  batch_id: string | null;
  action: string;
  detail: Record<string, unknown>;
  at: number;
};
export type BillingIndex = {
  batches: Omit<BillingBatch, "snapshot">[];
  audit: BillingAudit[];
};

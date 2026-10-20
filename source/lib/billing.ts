import type { Database } from "./db";
import { Problem } from "./problem";
import type {
  BillingBatch,
  BillingFilters,
  BillingIndex,
  BillingReview,
} from "./billing-types";
export function validateBillingFilters(
  value: unknown,
): asserts value is BillingFilters {
  if (!value || typeof value !== "object")
    throw new Problem("Choose report filters.");
  const filters = value as BillingFilters;
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(filters.from) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(filters.to)
  )
    throw new Problem("Choose valid period dates.");
  try {
    new Intl.DateTimeFormat("en", { timeZone: filters.timezone });
  } catch {
    throw new Problem("Choose a valid timezone.");
  }
  if (
    typeof filters.clientId !== "string" ||
    typeof filters.projectId !== "string"
  )
    throw new Problem("Choose valid filters.");
}
export async function billing<T = BillingBatch>(
  db: Database,
  owner: string,
  command: string,
  input: Record<string, unknown> = {},
): Promise<T> {
  if (
    ![
      "list",
      "get",
      "preview",
      "draft",
      "refresh",
      "finalize",
      "void",
      "rate",
    ].includes(command)
  )
    throw new Problem("Unknown billing action.");
  if (command === "preview" || command === "draft")
    validateBillingFilters(input.filters);
  return db.rpc<T>("orderly_billing", { owner, command, input });
}
export const listBilling = (db: Database, owner: string) =>
  billing<BillingIndex>(db, owner, "list");
export const previewBilling = (
  db: Database,
  owner: string,
  filters: BillingFilters,
) => billing<BillingReview>(db, owner, "preview", { filters });

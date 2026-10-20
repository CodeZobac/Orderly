import { cookies } from "next/headers";
import { authenticate } from "@/lib/auth";
import { database } from "@/lib/db";
import { billing } from "@/lib/billing";
import { billingCsv } from "@/lib/billing-format";
import { failure } from "@/lib/http";
export async function GET(request: Request) {
  try {
    const db = database(),
      owner = await authenticate(
        db,
        (await cookies()).get("orderly_session")?.value,
      );
    const report = await billing(db, owner, "get", {
      batchId: new URL(request.url).searchParams.get("id"),
    });
    return new Response(billingCsv(report.snapshot, report.id, report.status), {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="orderly-${report.status}-${report.id.replace(/[^a-zA-Z0-9-]/g, "")}.csv"`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return failure(error);
  }
}

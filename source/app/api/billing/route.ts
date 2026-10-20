import { cookies } from "next/headers";
import { authenticate } from "@/lib/auth";
import { database } from "@/lib/db";
import { billing, listBilling } from "@/lib/billing";
import { body, failure, originCheck } from "@/lib/http";
export async function GET(request: Request) {
  try {
    const db = database(),
      owner = await authenticate(
        db,
        (await cookies()).get("orderly_session")?.value,
      );
    const id = new URL(request.url).searchParams.get("id");
    const result = id
      ? await billing(db, owner, "get", { batchId: id })
      : await listBilling(db, owner);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: Request) {
  try {
    originCheck(request);
    const db = database(),
      owner = await authenticate(
        db,
        (await cookies()).get("orderly_session")?.value,
      );
    const { command, ...input } = await body(request);
    const result = await billing(db, owner, String(command), input);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error);
  }
}

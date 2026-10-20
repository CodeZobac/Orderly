import { cookies } from "next/headers";
import { authenticate } from "@/lib/auth";
import { database } from "@/lib/db";
import { failure } from "@/lib/http";
export async function GET() {
  try {
    const db = database(),
      owner = await authenticate(
        db,
        (await cookies()).get("orderly_session")?.value,
      );
    return Response.json(await db.rpc("orderly_operations", { owner }), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return failure(error);
  }
}

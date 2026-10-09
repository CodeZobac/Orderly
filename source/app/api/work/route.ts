import { cookies } from "next/headers";
import { authenticate } from "@/lib/auth";
import { database } from "@/lib/db";
import { mutate, snapshot } from "@/lib/domain";
import { originCheck, body, failure } from "@/lib/http";
export async function GET() {
  try {
    const db = database(),
      user = await authenticate(
        db,
        (await cookies()).get("orderly_session")?.value,
      );
    return Response.json(await snapshot(db, user), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: Request) {
  try {
    originCheck(request);
    const db = database(),
      user = await authenticate(
        db,
        (await cookies()).get("orderly_session")?.value,
      );
    const result = await mutate(db, user, await body(request));
    return Response.json(
      { result, data: await snapshot(db, user) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return failure(error);
  }
}

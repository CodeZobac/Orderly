import { cookies } from "next/headers";
import { authenticate } from "@/lib/auth";
import { database } from "@/lib/db";
import { body, failure, originCheck } from "@/lib/http";
import { githubAction, githubRpc } from "@/lib/github";
async function identity() {
  const db = database();
  return {
    db,
    owner: await authenticate(
      db,
      (await cookies()).get("orderly_session")?.value,
    ),
  };
}
export async function GET() {
  try {
    const { db, owner } = await identity();
    return Response.json(await githubRpc(db, owner, "list"), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: Request) {
  try {
    originCheck(request);
    const { db, owner } = await identity();
    return Response.json(await githubAction(db, owner, await body(request)), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return failure(error);
  }
}

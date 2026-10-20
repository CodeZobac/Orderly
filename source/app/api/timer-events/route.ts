import { cookies } from "next/headers";
import { authenticate } from "@/lib/auth";
import { database } from "@/lib/db";
import { body, failure, originCheck } from "@/lib/http";
import { Problem } from "@/lib/problem";

async function identity() {
  const db = database();
  const owner = await authenticate(
    db,
    (await cookies()).get("orderly_session")?.value,
  );
  return { db, owner };
}

export async function GET(request: Request) {
  try {
    const cursor = new URL(request.url).searchParams.get("cursor") || "0";
    if (!/^\d{1,18}$/.test(cursor)) throw new Problem("Invalid event cursor.");
    const { db, owner } = await identity();
    return Response.json(
      await db.rpc("orderly_timer_events", {
        owner,
        command: "list",
        input: { cursor },
      }),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    originCheck(request);
    const input = await body(request);
    if (
      !Array.isArray(input.ids) ||
      input.ids.length > 100 ||
      input.ids.some((id) => typeof id !== "string" || !/^\d{1,18}$/.test(id))
    )
      throw new Problem("Choose valid timer notifications.");
    if (
      typeof input.token !== "string" ||
      !/^[a-zA-Z0-9-]{1,100}$/.test(input.token) ||
      !["claim", "ack"].includes(String(input.action))
    )
      throw new Problem("Choose a valid notification delivery action.");
    const { db, owner } = await identity();
    return Response.json(
      await db.rpc("orderly_timer_events", {
        owner,
        command: String(input.action),
        input: { ids: input.ids, token: input.token },
      }),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return failure(error);
  }
}

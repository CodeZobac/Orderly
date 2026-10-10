import { cookies } from "next/headers";
import { authenticate } from "@/lib/auth";
import { database } from "@/lib/db";
import { body, failure, originCheck } from "@/lib/http";
import {
  beginNotionSetup,
  discardNotionSetup,
  retrieveNotionToken,
  setupStatus,
} from "@/lib/notion-webhook-setup";
import { Problem } from "@/lib/problem";
const headers = {
  "Cache-Control": "no-store, private",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};
async function identity() {
  const db = database(),
    session = (await cookies()).get("orderly_session")?.value;
  const owner = await authenticate(db, session);
  return { db, owner, session: session! };
}
export async function GET() {
  try {
    const { db, owner, session } = await identity();
    return Response.json(await setupStatus(db, owner, session), { headers });
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: Request) {
  try {
    originCheck(request);
    const { db, owner, session } = await identity(),
      input = await body(request);
    if (input.action === "begin")
      return Response.json(
        await beginNotionSetup(db, owner, session, request.url),
        { headers },
      );
    if (input.action === "retrieve")
      return Response.json(await retrieveNotionToken(db, owner, session), {
        headers,
      });
    if (input.action === "discard")
      return Response.json(await discardNotionSetup(db, owner, session), {
        headers,
      });
    throw new Problem("Unknown Notion setup action.");
  } catch (error) {
    return failure(error);
  }
}

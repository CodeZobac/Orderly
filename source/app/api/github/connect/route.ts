import { cookies } from "next/headers";
import { authenticate } from "@/lib/auth";
import { database } from "@/lib/db";
import { beginGitHub } from "@/lib/github";
import { failure, originCheck } from "@/lib/http";
export async function POST(request: Request) {
  try {
    originCheck(request);
    const jar = await cookies(),
      db = database(),
      session = jar.get("orderly_session")?.value;
    const owner = await authenticate(db, session);
    const result = await beginGitHub(db, owner, session!);
    jar.set("orderly_oauth_github", result.state, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/api/github/callback",
      maxAge: 600,
    });
    return Response.json(
      { url: result.url },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return failure(error);
  }
}

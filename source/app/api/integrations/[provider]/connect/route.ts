import { cookies } from "next/headers";
import { authenticate } from "@/lib/auth";
import { database } from "@/lib/db";
import { beginAuthorization, provider } from "@/lib/integrations";
import { failure, originCheck } from "@/lib/http";
export async function POST(
  request: Request,
  context: { params: Promise<{ provider: string }> },
) {
  try {
    originCheck(request);
    const p = provider((await context.params).provider),
      db = database(),
      jar = await cookies();
    const owner = await authenticate(db, jar.get("orderly_session")?.value);
    const result = await beginAuthorization(
      db,
      owner,
      p,
      jar.get("orderly_session")!.value,
    );
    // Separate Lax callback cookie: the independent auth cookie remains Strict.
    jar.set(`orderly_oauth_${p}`, result.state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: `/api/integrations/${p}/callback`,
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

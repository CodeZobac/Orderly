import { cookies } from "next/headers";
import { database } from "@/lib/db";
import { equal } from "@/lib/integration-crypto";
import { finishAuthorization, provider } from "@/lib/integrations";
import { failure } from "@/lib/http";
import { Problem } from "@/lib/problem";
export async function GET(
  request: Request,
  context: { params: Promise<{ provider: string }> },
) {
  try {
    const p = provider((await context.params).provider),
      params = new URL(request.url).searchParams,
      jar = await cookies();
    const state = params.get("state"),
      bound = jar.get(`orderly_oauth_${p}`)?.value;
    if (!state || !bound || !equal(state, bound))
      throw new Problem("Invalid authorization callback. Connect again.", 403);
    jar.set(`orderly_oauth_${p}`, "", {
      path: `/api/integrations/${p}/callback`,
      maxAge: 0,
    });
    const code = params.get("code");
    if (!code || params.has("error"))
      throw new Problem(
        "Authorization was cancelled. Connect again from Settings.",
      );
    await finishAuthorization(database(), p, state, code);
    return Response.redirect(`${process.env.ORDERLY_ORIGIN}/settings`, 303);
  } catch (error) {
    return failure(error);
  }
}

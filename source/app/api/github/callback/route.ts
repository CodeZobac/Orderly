import { cookies } from "next/headers";
import { database } from "@/lib/db";
import { finishGitHub } from "@/lib/github";
import { githubOrigin } from "@/lib/github-provider";
import { equal } from "@/lib/integration-crypto";
import { failure } from "@/lib/http";
import { Problem } from "@/lib/problem";
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams,
      jar = await cookies();
    const state = params.get("state"),
      bound = jar.get("orderly_oauth_github")?.value;
    if (!state || !bound || !equal(state, bound))
      throw new Problem("Invalid GitHub callback. Connect again.", 403);
    jar.set("orderly_oauth_github", "", {
      path: "/api/github/callback",
      maxAge: 0,
    });
    const code = params.get("code");
    if (!code || params.has("error"))
      throw new Problem(
        "GitHub authorization was cancelled. Connect again from Settings.",
      );
    await finishGitHub(database(), state, code);
    return Response.redirect(`${githubOrigin()}/settings`, 303);
  } catch (error) {
    return failure(error);
  }
}

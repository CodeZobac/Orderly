import { cookies } from "next/headers";
import { database } from "@/lib/db";
import { signIn, tokenHash } from "@/lib/auth";
import { originCheck, body, failure } from "@/lib/http";
export async function POST(request: Request) {
  try {
    originCheck(request);
    const input = await body(request),
      jar = await cookies(),
      db = database();
    if (input.action === "logout") {
      const token = jar.get("orderly_session")?.value;
      if (token)
        await db.rpc("orderly_auth", {
          command: "logout",
          input: { token: tokenHash(token) },
        });
      jar.delete("orderly_session");
    } else {
      const token = await signIn(db, input.action, input.email, input.password);
      jar.set("orderly_session", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        path: "/",
        maxAge: 30 * 86400,
      });
    }
    return Response.json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}

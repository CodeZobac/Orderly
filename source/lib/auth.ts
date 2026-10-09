import {
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import type { Database } from "./db";
import { Problem } from "./domain";

export function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
export async function authenticate(db: Database, token: string | undefined) {
  if (!token) throw new Problem("Sign in to continue.", 401);
  return db.rpc<string>("orderly_auth", {
    command: "session",
    input: { token: tokenHash(token), now: Date.now() },
  });
}
export async function signIn(
  db: Database,
  action: unknown,
  email: unknown,
  password: unknown,
) {
  if (
    (action !== "register" && action !== "login") ||
    typeof email !== "string" ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    email.length > 254 ||
    typeof password !== "string" ||
    password.length < 12 ||
    password.length > 128
  )
    throw new Problem("Use a valid email and a password of 12–128 characters.");
  email = email.toLowerCase().trim();
  const now = Date.now();
  await db.rpc("orderly_auth", { command: "attempt", input: { email, now } });
  const user = await db.rpc<{ id: string; password: string } | null>(
    "orderly_auth",
    { command: "credential", input: { email } },
  );
  let id: string;
  let encoded: string | undefined;
  if (action === "register") {
    if (user)
      throw new Problem("Unable to create this account. Try signing in.", 409);
    const salt = randomBytes(16).toString("hex");
    encoded = `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
    id = randomUUID();
  } else {
    const [salt, hash] = String(
      user?.password || "00000000000000000000000000000000:" + "00".repeat(64),
    ).split(":");
    const expected = Buffer.from(hash, "hex");
    const actual = scryptSync(password, salt, 64);
    if (
      expected.length !== actual.length ||
      !timingSafeEqual(actual, expected) ||
      !user
    )
      throw new Problem("Email or password is incorrect.", 401);
    id = user.id;
  }
  const token = randomBytes(32).toString("hex");
  await db.rpc("orderly_auth", {
    command: action === "register" ? "register" : "login",
    input: {
      id,
      email,
      password: encoded,
      token: tokenHash(token),
      expires: now + 30 * 86400000,
    },
  });
  return token;
}

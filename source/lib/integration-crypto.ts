import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { Problem } from "./problem";

function key() {
  if (typeof window !== "undefined")
    throw new Error("Integration secrets require the server.");
  const value = process.env.ORDERLY_INTEGRATION_KEY || "";
  if (!/^[a-fA-F0-9]{64}$/.test(value))
    throw new Problem(
      "Configure ORDERLY_INTEGRATION_KEY (32 bytes in hex) on the server.",
      503,
    );
  return Buffer.from(value, "hex");
}
export function encrypt(value: unknown) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    data.toString("base64url"),
  ].join(".");
}
export function decrypt<T>(value: string): T {
  const [version, iv, tag, data] = value.split(".");
  if (version !== "v1" || !iv || !tag || !data)
    throw new Problem(
      "Credential storage is invalid. Reconnect this provider.",
      503,
    );
  const cipher = createDecipheriv(
    "aes-256-gcm",
    key(),
    Buffer.from(iv, "base64url"),
  );
  cipher.setAuthTag(Buffer.from(tag, "base64url"));
  return JSON.parse(
    Buffer.concat([
      cipher.update(Buffer.from(data, "base64url")),
      cipher.final(),
    ]).toString("utf8"),
  ) as T;
}
export function equal(a: string, b: string) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export function signature(
  raw: string,
  secret: string,
  supplied: string | null,
  prefix = "",
) {
  return (
    !!supplied &&
    equal(
      prefix + createHmac("sha256", secret).update(raw).digest("hex"),
      supplied,
    )
  );
}

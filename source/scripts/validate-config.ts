// Offline validation only; does not connect to any provider/database or print values.
import { loadEnvConfig } from "@next/env";
import { createPrivateKey } from "node:crypto";
loadEnvConfig(process.cwd());
const errors: string[] = [];
const required = [
  "SUPABASE_URL",
  "SUPABASE_SECRET_KEY",
  "ORDERLY_ORIGIN",
  "ORDERLY_INTEGRATION_KEY",
  "ASANA_CLIENT_ID",
  "ASANA_CLIENT_SECRET",
  "NOTION_CLIENT_ID",
  "NOTION_CLIENT_SECRET",
  "NOTION_WEBHOOK_VERIFICATION_TOKEN",
  "GITHUB_APP_ID",
  "GITHUB_APP_SLUG",
  "GITHUB_CLIENT_ID",
  "GITHUB_CLIENT_SECRET",
  "GITHUB_APP_PRIVATE_KEY",
  "GITHUB_WEBHOOK_SECRET",
];
for (const name of required)
  if (!process.env[name]?.trim()) errors.push(`${name}: missing`);
function https(name: string, originOnly = false) {
  if (!process.env[name]) return;
  try {
    const url = new URL(process.env[name]!);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      (originOnly && url.origin !== process.env[name])
    )
      throw new Error();
  } catch {
    errors.push(
      `${name}: requires ${originOnly ? "an exact HTTPS origin" : "an HTTPS URL"}`,
    );
  }
}
https("ORDERLY_ORIGIN", true);
https("SUPABASE_URL");
if (
  process.env.ORDERLY_INTEGRATION_KEY &&
  !/^[a-fA-F0-9]{64}$/.test(process.env.ORDERLY_INTEGRATION_KEY)
)
  errors.push("ORDERLY_INTEGRATION_KEY: requires 32 bytes in hex");
if (
  process.env.SUPABASE_SECRET_KEY &&
  !/^(sb_secret_|eyJ)/.test(process.env.SUPABASE_SECRET_KEY)
)
  errors.push(
    "SUPABASE_SECRET_KEY: requires a server secret or legacy service-role JWT",
  );
if (process.env.GITHUB_APP_ID && !/^[1-9]\d*$/.test(process.env.GITHUB_APP_ID))
  errors.push("GITHUB_APP_ID: requires a numeric App ID");
if (process.env.GITHUB_APP_PRIVATE_KEY) {
  try {
    if (
      createPrivateKey(process.env.GITHUB_APP_PRIVATE_KEY.replace(/\\n/g, "\n"))
        .asymmetricKeyType !== "rsa"
    )
      throw new Error();
  } catch {
    errors.push("GITHUB_APP_PRIVATE_KEY: requires an RSA private key");
  }
}
for (const name of Object.keys(process.env))
  if (
    name.startsWith("NEXT_PUBLIC_") &&
    /SECRET|PRIVATE|INTEGRATION_KEY|TOKEN/.test(name)
  )
    errors.push(`${name}: server credential must not be public`);
if (errors.length) {
  console.error("Release configuration incomplete:\n" + errors.join("\n"));
  process.exitCode = 1;
} else
  console.log(
    "Release configuration syntax is valid. Live access, callback registration, migrations, worker health and backups still require verification.",
  );

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Problem } from "./problem";
export interface Database {
  rpc<T>(name: string, args: Record<string, unknown>): Promise<T>;
}
export class MissingRpc extends Problem {
  constructor(public readonly rpcName: string) {
    super(
      "Apply the pending Supabase migrations before using this operation.",
      503,
    );
  }
}
export function openDatabase(
  url = process.env.SUPABASE_URL,
  secret = process.env.SUPABASE_SECRET_KEY,
): Database {
  let client: SupabaseClient | undefined;
  return {
    async rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
      if (typeof window !== "undefined")
        throw new Error("Private database access requires the server.");
      if (
        !url ||
        !secret ||
        (!secret.startsWith("sb_secret_") && !secret.startsWith("eyJ"))
      )
        throw new Problem(
          "Database setup is incomplete. Add SUPABASE_SECRET_KEY on the server.",
          503,
        );
      const parsed = new URL(url);
      if (
        parsed.protocol !== "https:" &&
        !(
          parsed.protocol === "http:" &&
          ["localhost", "127.0.0.1"].includes(parsed.hostname)
        )
      )
        throw new Problem("Database URL must use HTTPS.", 503);
      client ??= createClient(url.replace(/\/rest\/v1\/?$/, ""), secret, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      });
      const { data, error } = await client.rpc(name, args);
      if (error) {
        if (error.code === "PGRST202") throw new MissingRpc(name);
        if (error.code === "P0001" && /^ORDERLY:\d{3}:/.test(error.message)) {
          const [, status, ...message] = error.message.split(":");
          throw new Problem(message.join(":"), Number(status));
        }
        throw new Problem(
          "Database unavailable. Check server credentials and apply the Supabase migrations.",
          503,
        );
      }
      return data as T;
    },
  };
}
let instance: Database | undefined;
export function database() {
  return (instance ??= openDatabase());
}

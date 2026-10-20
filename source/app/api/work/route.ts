import { cookies } from "next/headers";
import { database } from "@/lib/db";
import { work } from "@/lib/work";
import { originCheck, body, failure } from "@/lib/http";

async function handle(request?: Request) {
  const started = performance.now();
  try {
    if (request) originCheck(request);
    const input = request ? await body(request) : undefined;
    const result = await work(
      database(),
      (await cookies()).get("orderly_session")?.value,
      input,
    );
    const rpcMs = performance.now() - started;
    const encodedAt = performance.now();
    const text = JSON.stringify(
      request ? { result: result.result, data: result.data } : result.data,
    );
    const encodeMs = performance.now() - encodedAt;
    const timing = result.timing;
    return new Response(text, {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "X-Work-Bytes": String(Buffer.byteLength(text)),
        "X-Work-Mode": result.mode,
        "Server-Timing": [
          `work;dur=${rpcMs.toFixed(2)}`,
          `auth;dur=${timing.auth.toFixed(2)}`,
          `mutation;dur=${timing.mutation.toFixed(2)}`,
          `snapshot;dur=${timing.snapshot.toFixed(2)}`,
          `serialize;dur=${encodeMs.toFixed(2)}`,
          `total;dur=${(performance.now() - started).toFixed(2)}`,
        ].join(", "),
      },
    });
  } catch (error) {
    const response = failure(error);
    response.headers.set(
      "Server-Timing",
      `total;dur=${(performance.now() - started).toFixed(2)}`,
    );
    return response;
  }
}
export async function GET() {
  return handle();
}
export async function POST(request: Request) {
  return handle(request);
}

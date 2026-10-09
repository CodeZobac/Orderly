import { Problem } from "./domain";
export function originCheck(request: Request) {
  const expected = process.env.ORDERLY_ORIGIN || new URL(request.url).origin;
  if (request.headers.get("origin") !== expected)
    throw new Problem("Request origin rejected.", 403);
}
export async function body(request: Request) {
  const raw = await request.text();
  if (raw.length > 12000) throw new Problem("Request too large.", 413);
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new Problem("Invalid JSON request.");
  }
}
export function failure(error: unknown) {
  const known = error instanceof Problem;
  if (!known)
    console.error(
      "Orderly operation failed:",
      error instanceof Error ? error.name : "unknown",
    );
  return Response.json(
    {
      error: known
        ? error.message
        : "Unable to save. Your last saved data is unchanged. Retry the request.",
    },
    {
      status: known ? error.status : 500,
      headers: { "Cache-Control": "no-store" },
    },
  );
}

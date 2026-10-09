// Test-only PostgREST facade. Runs real migration SQL in embedded PostgreSQL.
import { createServer } from "node:http";
import { postgresFixture } from "./postgres";
async function main() {
  const { pg, db } = await postgresFixture();
  const server = createServer(async (req, res) => {
    if (req.url === "/health") {
      res.end("ready");
      return;
    }
    if (req.headers.apikey !== "sb_secret_fixture_only") {
      res.writeHead(403);
      res.end(JSON.stringify({ code: "42501", message: "Permission denied" }));
      return;
    }
    const name = req.url?.match(/^\/rest\/v1\/rpc\/(orderly_[a-z]+)$/)?.[1];
    if (!name || req.method !== "POST") {
      res.writeHead(404);
      res.end();
      return;
    }
    try {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const result = await db.rpc(name, JSON.parse(raw));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (error) {
      const e = error as Error & { status?: number };
      res.writeHead(e.status || 500, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          code: e.status ? "P0001" : "XX000",
          message: e.status ? `ORDERLY:${e.status}:${e.message}` : e.message,
        }),
      );
    }
  });
  server.listen(Number(process.env.ORDERLY_RPC_PORT || 3001), "127.0.0.1");
  async function stop() {
    server.close();
    await pg.close();
    process.exit(0);
  }
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}
main().catch(() => {
  console.error("PostgreSQL test fixture failed to start.");
  process.exitCode = 1;
});

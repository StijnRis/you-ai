/**
 * A throwaway Postgres for local development, with nothing to install.
 *
 * PGlite is Postgres compiled to WASM; this exposes it on the normal wire
 * protocol, so `DATABASE_URL=postgresql://postgres@localhost:5433/postgres`
 * works with drizzle, psql and everything else. Data lives in .pglite/ and can
 * be deleted at any time.
 *
 * Production is Neon — this exists so `pnpm dev` needs no Docker daemon.
 *
 *   pnpm dev:db
 */
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

const PORT = Number(process.env.DEV_DB_PORT ?? 5433);

async function main() {
  const db = await PGlite.create({ dataDir: ".pglite" });
  const server = new PGLiteSocketServer({ db, port: PORT, host: "127.0.0.1" });

  await server.start();
  console.log(`PGlite listening on postgresql://postgres@127.0.0.1:${PORT}/postgres`);
  console.log("Data in .pglite/ — delete it to start over. Ctrl-C to stop.");

  const shutdown = async () => {
    await server.stop();
    await db.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

void main();

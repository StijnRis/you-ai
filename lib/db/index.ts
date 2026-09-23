import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

type Database = ReturnType<typeof drizzle<typeof schema>>;

declare global {
  var __youaiSql: ReturnType<typeof postgres> | undefined;
  var __youaiDb: Database | undefined;
}

function connect(): Database {
  if (globalThis.__youaiDb) return globalThis.__youaiDb;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.");
  }

  /*
   * One pool per process. Next's dev server re-evaluates modules on every edit,
   * so without the global we would leak a pool per reload and exhaust the
   * connection limit within a few saves.
   */
  const client =
    globalThis.__youaiSql ??
    postgres(connectionString, {
      // Overridable because the right number depends on where this runs: a few
      // per serverless instance against Neon's pooler, but exactly one against
      // the PGlite dev server, which serves a single connection at a time.
      max: Number(process.env.DATABASE_POOL_MAX ?? (process.env.NODE_ENV === "production" ? 5 : 2)),
      idle_timeout: 20,
      prepare: false, // required when connecting through a transaction pooler
    });

  const instance = drizzle(client, { schema });

  globalThis.__youaiSql = client;
  globalThis.__youaiDb = instance;
  return instance;
}

/**
 * Connecting is deferred to the first query rather than done on import: `next
 * build` loads every module to trace routes, and a build should not need a
 * reachable database.
 */
export const db = new Proxy({} as Database, {
  get: (_target, property, receiver) => Reflect.get(connect(), property, receiver),
  has: (_target, property) => Reflect.has(connect(), property),
  // Drizzle identifies a database by walking its prototype chain, and the
  // Auth.js adapter uses that to pick its dialect. Without this trap the proxy
  // looks like a bare object and the adapter refuses it.
  getPrototypeOf: () => Reflect.getPrototypeOf(connect()),
});

export * from "./schema";

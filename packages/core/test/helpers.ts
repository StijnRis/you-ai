import { readFileSync } from "node:fs";
import path from "node:path";
import initSqlJs from "sql.js";
import { drizzle } from "drizzle-orm/sql-js";
import { migrate } from "drizzle-orm/sql-js/migrator";
import * as schema from "@youai/db/schema";
import { setDb, type Database } from "@youai/db";

/** Repo-root test fixtures, shared with the app's end-to-end tests. */
export function fixture(name: string): string {
  return readFileSync(path.join(import.meta.dirname, "../../../test/fixtures", name), "utf8");
}

/**
 * A fresh in-memory SQLite with the app's real migrations applied, installed
 * as the `db` every core module uses. sql.js is SQLite compiled to wasm and
 * synchronous like expo-sqlite, so the same SQL runs here as on the device.
 */
export async function useTestDb(): Promise<void> {
  const SQL = await initSqlJs();
  const sqlite = new SQL.Database();
  sqlite.run("PRAGMA foreign_keys = ON;");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: path.join(import.meta.dirname, "../../db/drizzle") });
  // Same sync SQLite dialect as the Expo driver; only the client differs.
  setDb(db as unknown as Database);
}

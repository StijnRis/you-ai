import type { ExpoSQLiteDatabase } from "drizzle-orm/expo-sqlite";
import * as schema from "./schema";

export type Database = ExpoSQLiteDatabase<typeof schema>;

let instance: Database | null = null;

/**
 * The app opens the SQLite file (it owns expo-sqlite) and hands the drizzle
 * instance over once at startup. Everything else — core logic, AI tools —
 * imports `db` from here, so none of it depends on Expo directly.
 */
export function setDb(database: Database): void {
  instance = database;
}

export function getDb(): Database {
  if (!instance) throw new Error("Database not initialised: call setDb() at app start.");
  return instance;
}

/** Lazy handle, so modules can import `db` at load time before `setDb` runs. */
export const db = new Proxy({} as Database, {
  get: (_target, property) => {
    const target = getDb();
    const value = Reflect.get(target, property, target);
    return typeof value === "function" ? value.bind(target) : value;
  },
  has: (_target, property) => Reflect.has(getDb(), property),
  getPrototypeOf: () => Reflect.getPrototypeOf(getDb()),
});

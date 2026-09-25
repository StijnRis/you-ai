import { drizzle } from "drizzle-orm/expo-sqlite";
import { migrate } from "drizzle-orm/expo-sqlite/migrator";
import { Platform } from "react-native";
import { openDatabaseAsync, openDatabaseSync } from "expo-sqlite";
import * as schema from "@youai/db/schema";
import { setDb } from "@youai/db";
import migrations from "@youai/db/migrations";
import { seedBuiltins } from "@youai/core/seed";

let ready: Promise<void> | null = null;

/**
 * Open the on-device database, bring its schema up to date and load the
 * built-in conversions. Idempotent: every caller (the root layout, the
 * background task) awaits the same promise.
 */
export function openDatabase(): Promise<void> {
  ready ??= (async () => {
    if (Platform.OS === "web") {
      // On web SQLite lives in a worker that cannot boot while the main thread
      // spin-waits on a sync call. Start it (and its storage) asynchronously
      // first; after that the sync calls Drizzle makes return quickly.
      const warmup = await openDatabaseAsync(":memory:");
      await warmup.closeAsync();
    }
    const sqlite = openDatabaseSync("youai.db");
    sqlite.execSync("PRAGMA foreign_keys = ON;");
    const db = drizzle(sqlite, { schema });
    await migrate(db, migrations);
    setDb(db);
    await seedBuiltins();
  })();
  return ready;
}

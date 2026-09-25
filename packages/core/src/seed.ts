import { db, mappingSpecs } from "@youai/db";
import { builtinSpecs } from "./mapping/builtin";

/**
 * Make sure the built-in conversions exist in the local database. Runs on
 * every app start after migrations; it is an upsert, so a new app version's
 * improved built-ins replace the old ones. Fingerprints are learned, not
 * seeded: a built-in picks them up the first time it matches a real file.
 */
export async function seedBuiltins(): Promise<void> {
  for (const spec of builtinSpecs) {
    await db
      .insert(mappingSpecs)
      .values({ key: spec.key, name: spec.name, provider: spec.provider, origin: "builtin", spec })
      .onConflictDoUpdate({
        target: mappingSpecs.key,
        set: { spec, name: spec.name, provider: spec.provider, updatedAt: new Date() },
      });
  }
}

import { inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { appSettings } from "@/lib/db/schema";
import {
  SETTINGS,
  SETTING_KEYS,
  settingDefaults,
  type SettingKey,
  type Settings,
} from "@/lib/settings-def";

export { SETTINGS, SETTING_KEYS, type SettingKey, type Settings };

/**
 * Reading and writing the instance settings. Server-only: the definitions live
 * in `settings-def.ts` so the admin form can import them without this file's
 * database dependency.
 */

/**
 * Every setting, with stored values layered over the defaults. A stored value
 * that no longer validates — because an option's type changed — falls back to
 * the default rather than taking a page down.
 */
export async function getSettings(): Promise<Settings> {
  const merged = settingDefaults();

  let rows: { key: string; value: unknown }[] = [];
  try {
    rows = await db
      .select({ key: appSettings.key, value: appSettings.value })
      .from(appSettings)
      .where(inArray(appSettings.key, SETTING_KEYS));
  } catch {
    // Before the first migration there is no table yet; defaults are correct.
    return merged;
  }

  for (const row of rows) {
    const definition = SETTINGS[row.key as SettingKey];
    if (!definition) continue;
    const parsed = definition.schema.safeParse(row.value);
    if (parsed.success) {
      (merged as Record<string, unknown>)[row.key] = parsed.data;
    }
  }
  return merged;
}

export async function getSetting<K extends SettingKey>(key: K): Promise<Settings[K]> {
  return (await getSettings())[key];
}

/** Validate and store one option. Returns the error message if it is invalid. */
export async function setSetting(
  key: SettingKey,
  value: unknown,
  updatedBy: string,
): Promise<string | null> {
  const definition = SETTINGS[key];
  if (!definition) return "unknown setting";

  const parsed = definition.schema.safeParse(value);
  if (!parsed.success) return parsed.error.issues[0]?.message ?? "invalid value";

  await db
    .insert(appSettings)
    .values({ key, value: parsed.data, updatedBy, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: parsed.data, updatedBy, updatedAt: new Date() },
    });
  return null;
}

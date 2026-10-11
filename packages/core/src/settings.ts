import { inArray } from "drizzle-orm";
import { z } from "zod";
import { db, settings } from "@youai/db";
import { DEFAULT_AI_BASE_URL } from "./ai/models";
import { DEFAULT_CHAT_MODEL } from "./ai/provider";

/**
 * Preferences for the person on this device, stored in the local `settings`
 * table. Replaces the old per-user columns and the admin-only app settings.
 *
 * Adding an option means adding one entry here; the settings screen, validation
 * and save path all derive from it. API keys are NOT settings — they live in
 * secure storage (see the mobile app's `lib/keys.ts`).
 */
export const SETTINGS = {
  timezone: {
    label: "Timezone",
    help: "Decides which calendar day an event belongs to.",
    schema: z.string().min(1).max(64),
    default: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  },
  latitude: {
    label: "Latitude",
    help: "Used for the weather source.",
    schema: z.number().min(-90).max(90).nullable(),
    default: null as number | null,
  },
  longitude: {
    label: "Longitude",
    help: "Used for the weather source.",
    schema: z.number().min(-180).max(180).nullable(),
    default: null as number | null,
  },
  moodReminderHour: {
    label: "Daily mood reminder",
    help: "Hour of the day (0-23) for the mood notification. Empty turns it off.",
    schema: z.number().int().min(0).max(23).nullable(),
    default: 20 as number | null,
  },
  workerUrl: {
    label: "Server URL",
    help: "The you-ai worker that relays AI, search and OAuth calls.",
    schema: z.string().url(),
    default: "http://localhost:8787",
  },
  allowInference: {
    label: "Let the model write conversions",
    help: "When off, an unrecognised file format is rejected instead of being sent to the model.",
    schema: z.boolean(),
    default: true,
  },
  aiBaseUrl: {
    label: "AI provider URL",
    help: "Any OpenAI-compatible API, e.g. https://api.openai.com/v1, https://openrouter.ai/api/v1, https://api.groq.com/openai/v1.",
    schema: z.string().url(),
    default: DEFAULT_AI_BASE_URL,
  },
  chatModel: {
    label: "Chat model",
    help: "Model id as your provider names it, e.g. gpt-4o-mini or meta-llama/llama-3.3-70b-instruct.",
    schema: z.string().min(1).max(200),
    default: DEFAULT_CHAT_MODEL,
  },
  correlationMinOverlap: {
    label: "Minimum overlapping days",
    help: "How many days two metrics must share before a correlation is reported.",
    schema: z.number().int().min(5).max(365),
    default: 21,
  },
  correlationMaxLag: {
    label: "Maximum lag (days)",
    help: "How far to shift one metric against another when looking for delayed effects.",
    schema: z.number().int().min(0).max(14),
    default: 3,
  },
  correlationAlpha: {
    label: "Significance threshold",
    help: "Applied to the p-value after the multiple-comparison correction.",
    schema: z.number().min(0.001).max(0.2),
    default: 0.05,
  },
} as const;

export type SettingKey = keyof typeof SETTINGS;
export type Settings = { [K in SettingKey]: z.infer<(typeof SETTINGS)[K]["schema"]> };

export const SETTING_KEYS = Object.keys(SETTINGS) as SettingKey[];

export function settingDefaults(): Settings {
  const out = {} as Record<string, unknown>;
  for (const key of SETTING_KEYS) out[key] = SETTINGS[key].default;
  return out as Settings;
}

/** Every setting, stored values layered over defaults; invalid stored values fall back. */
export async function getSettings(): Promise<Settings> {
  const merged = settingDefaults() as Record<string, unknown>;
  const rows = await db
    .select({ key: settings.key, value: settings.value })
    .from(settings)
    .where(inArray(settings.key, SETTING_KEYS));

  for (const row of rows) {
    const definition = SETTINGS[row.key as SettingKey];
    const parsed = definition?.schema.safeParse(row.value);
    if (parsed?.success) merged[row.key] = parsed.data;
  }
  return merged as Settings;
}

export async function getSetting<K extends SettingKey>(key: K): Promise<Settings[K]> {
  return (await getSettings())[key];
}

/** Validate and store one option. Returns the error message if it is invalid. */
export async function setSetting(key: SettingKey, value: unknown): Promise<string | null> {
  const definition = SETTINGS[key];
  if (!definition) return "unknown setting";

  const parsed = definition.schema.safeParse(value);
  if (!parsed.success) return parsed.error.issues[0]?.message ?? "invalid value";

  await db
    .insert(settings)
    .values({ key, value: parsed.data, updatedAt: new Date() })
    .onConflictDoUpdate({ target: settings.key, set: { value: parsed.data, updatedAt: new Date() } });
  return null;
}

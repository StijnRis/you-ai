import { z } from "zod";

/**
 * The catalogue of instance-wide options: pure data, no database.
 *
 * Kept apart from `settings.ts` because the admin form is a client component
 * and needs the labels, types and help text — importing the accessors would
 * drag the Postgres driver into the browser bundle.
 *
 * Adding an option means adding one entry here. The form, the validation and
 * the save path all derive from it.
 */
export const SETTINGS = {
  allowRegistration: {
    label: "Allow new sign-ups",
    help: "When off, the registration form is closed. Existing accounts, and OAuth sign-ins for accounts that already exist, keep working.",
    schema: z.boolean(),
    default: true,
  },
  allowInference: {
    label: "Let the model write conversions",
    help: "When off, an unrecognised file format is rejected instead of being sent to Nebius. Known formats and built-ins are unaffected.",
    schema: z.boolean(),
    default: true,
  },
  defaultTimezone: {
    label: "Default timezone",
    help: "Given to new accounts that do not report their own. Decides which calendar day an event belongs to, so it is worth getting right.",
    schema: z.string().min(1).max(64),
    default: "Europe/Madrid",
  },
  maxUploadMb: {
    label: "Maximum upload size (MB)",
    help: "Uploads stream through the API route, so keep this under your host's request-body limit (4.5MB on Vercel).",
    schema: z.number().int().min(1).max(200),
    default: 20,
  },
  chatModel: {
    label: "Chat model",
    help: "Any model your Nebius Token Factory key can reach. Leave as the default unless you know you want another.",
    schema: z.string().min(1).max(200),
    default: "Qwen/Qwen3-235B-A22B-Instruct-2507",
  },
  correlationMinOverlap: {
    label: "Minimum overlapping days",
    help: "How many days two metrics must share before a correlation between them is reported at all.",
    schema: z.number().int().min(5).max(365),
    default: 21,
  },
  correlationMaxLag: {
    label: "Maximum lag (days)",
    help: "How far to shift one metric against another when looking for delayed effects, such as sleep showing up in the next day's mood.",
    schema: z.number().int().min(0).max(14),
    default: 3,
  },
  correlationAlpha: {
    label: "Significance threshold",
    help: "Applied to the p-value after the multiple-comparison correction. Lower means fewer, stronger findings.",
    schema: z.number().min(0.001).max(0.2),
    default: 0.05,
  },
} as const;

export type SettingKey = keyof typeof SETTINGS;
export type Settings = { [K in SettingKey]: z.infer<(typeof SETTINGS)[K]["schema"]> };

export const SETTING_KEYS = Object.keys(SETTINGS) as SettingKey[];

export function settingDefaults(): Settings {
  const out = {} as Settings;
  for (const key of SETTING_KEYS) {
    (out as Record<string, unknown>)[key] = SETTINGS[key].default;
  }
  return out;
}

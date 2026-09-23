import { generateObject, NoObjectGeneratedError } from "ai";
import { reasoningModel, assertModelConfigured } from "@/lib/ai/provider";
import { mappingSpecSchema, type MappingSpec } from "@/lib/mapping/spec";
import { detectionForPrompt, type Detection } from "@/lib/mapping/detect";
import { applySpecToRecords } from "@/lib/mapping/apply";

/**
 * Writing a conversion for a format nobody has seen before.
 *
 * The model never writes code and never touches the database — it fills in a
 * MappingSpec, which Zod validates and which we then dry-run against the real
 * sample rows. If the dry run produces nothing, the spec is wrong no matter how
 * plausible it looked, and we retry with the failure fed back in.
 */

const SYSTEM = `You convert personal-data exports into a normalised event stream.

You are given the shape of one file from someone's data export: its format, its
field names, and a few real records. You return a MappingSpec — a declarative
JSON description of how each record becomes one or more events. You never write
code; every transformation must be expressed with the provided transform ops.

The event store is deliberately generic. Every event has a timestamp, a type
key, and a value. There is no table per metric.

Rules:
- Emit one entry per genuinely distinct measurement. A daily-summary CSV with
  columns for steps, calories and distance produces three emits, not one.
- Prefer these existing type keys when the data matches, so imports from
  different services line up on the same series:
  steps, distance, calories, active_energy, move_minutes, workout_duration,
  workout_distance, sleep_duration, sleep_efficiency, resting_heart_rate,
  heart_rate, body_mass, mood, energy, focus_time, screen_time, tracks_played,
  weather.temp_max, weather.temp_min, weather.precipitation, weather.sunshine.
  Invent a new lowercase snake_case key only when nothing above fits.
- Always give typeMeta for every emit, with a human label and a real unit.
- aggregation is how a day's events collapse into one number: sum for counts
  and durations, avg for rates like heart rate, last for standing values like
  weight, max for peaks.
- polarity: 1 when more is better, -1 when less is better, 0 when neither.
- Normalise units: metres to km (divide by 1000), seconds to minutes (divide by
  60), millilitres to litres. Set the unit in typeMeta to match what you emit.
- Use skipWhen to drop padding rows — exports are full of empty and zero cells.
- Set correlatable false for identifiers, names and free text.
- requiredFields in match must be field names that actually appear in the
  sample, and should be the ones that identify this format.
- Use format "date" for bare calendar days (2024-03-01) and "iso" for full
  timestamps. Use epoch_s / epoch_ms only when the value is a bare number.
- When the measurement is the length of the record rather than a column — a
  sleep session or a workout given only as a start and an end — set
  endTimestamp and give the value as { "derived": "duration_min" }. Do not
  invent a constant value for these.
- If a field holds the UTC offset the record was made at ("UTC+0100", "+01:00"),
  set the spec's top-level zoneOffset to it and set timezone to "utc". That is
  what decides which calendar day an event belongs to, and it is the difference
  between a holiday abroad landing on the right day and being shifted.
- Only set timezone "local" when the timestamps are plainly wall-clock readings
  with no offset recorded anywhere in the file.`;

export type InferenceResult = {
  spec: MappingSpec;
  /** Events the spec produced against the sample, for the review screen. */
  preview: ReturnType<typeof applySpecToRecords>;
  attempts: number;
};

export async function inferSpec(
  detection: Detection,
  options: { timezone: string; maxAttempts?: number },
): Promise<InferenceResult> {
  assertModelConfigured();

  const maxAttempts = options.maxAttempts ?? 2;
  const described = detectionForPrompt(detection);
  let lastProblem: string | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const prompt = [
      `Here is the file to write a conversion for:`,
      "```json",
      JSON.stringify(described, null, 2),
      "```",
      lastProblem
        ? `\nYour previous attempt did not work: ${lastProblem}\nFix it. Check that every path you reference is one of the field names listed above, spelled exactly.`
        : "",
    ].join("\n");

    let spec: MappingSpec;
    try {
      const { object } = await generateObject({
        model: reasoningModel(),
        schema: mappingSpecSchema,
        system: SYSTEM,
        prompt,
        temperature: attempt === 1 ? 0 : 0.3,
      });
      spec = object;
    } catch (error) {
      if (NoObjectGeneratedError.isInstance(error) && attempt < maxAttempts) {
        lastProblem = "the JSON you returned did not match the required schema";
        continue;
      }
      throw error;
    }

    // The reader comes from detection, not from the model — we already know how
    // to parse the file, and a wrong delimiter would silently produce garbage.
    spec.reader = detection.reader;

    const preview = applySpecToRecords(detection.sample, spec, {
      timezone: options.timezone,
    });

    if (preview.events.length > 0) {
      return { spec, preview, attempts: attempt };
    }

    lastProblem = describeEmptyPreview(preview, detection);
    if (attempt === maxAttempts) {
      // Hand back the last spec anyway — the review screen shows that it
      // produced nothing, which is more useful than a bare error.
      return { spec, preview, attempts: attempt };
    }
  }

  throw new Error("could not infer a conversion for this file");
}

function describeEmptyPreview(
  preview: ReturnType<typeof applySpecToRecords>,
  detection: Detection,
): string {
  const parts = [`it produced 0 events from ${preview.recordsRead} sample records`];
  if (preview.errors.length) {
    parts.push(`errors: ${preview.errors.slice(0, 3).map((e) => e.message).join("; ")}`);
  }
  parts.push(`the available field names are exactly: ${detection.fields.join(", ")}`);
  return parts.join(". ");
}

import { z } from "zod";

/**
 * A MappingSpec describes how one file shape turns into events. It is *data*,
 * never code: it can be stored in Postgres, diffed, rendered in the UI, edited
 * by hand, and written by a model — none of which is safe with arbitrary JS.
 *
 * Every escape hatch is a closed set. If a format needs something this cannot
 * express, the right move is to add a transform op here, not to allow eval.
 */

export const SCALAR = z.union([z.string(), z.number(), z.boolean(), z.null()]);

/** The closed set of value manipulations a spec may ask for. */
export const transformSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("toNumber") }),
  z.object({ op: z.literal("toString") }),
  z.object({ op: z.literal("trim") }),
  z.object({ op: z.literal("lowercase") }),
  z.object({ op: z.literal("uppercase") }),
  z.object({ op: z.literal("multiply"), by: z.number() }),
  z.object({ op: z.literal("divide"), by: z.number() }),
  z.object({ op: z.literal("add"), value: z.number() }),
  z.object({ op: z.literal("round"), decimals: z.number().int().min(0).max(6).default(0) }),
  z.object({ op: z.literal("clamp"), min: z.number().optional(), max: z.number().optional() }),
  /** Regex-free literal replacement, applied to every occurrence. */
  z.object({ op: z.literal("replace"), find: z.string(), with: z.string() }),
  /** Extract with a regex; `group` picks the capture group. */
  z.object({ op: z.literal("extract"), pattern: z.string(), group: z.number().int().default(1) }),
  /** Lookup table, e.g. sleep stage names to minutes, or Yes/No to 1/0. */
  z.object({
    op: z.literal("map"),
    table: z.record(z.string(), SCALAR),
    fallback: SCALAR.optional(),
  }),
  z.object({ op: z.literal("defaultTo"), value: SCALAR }),
]);

export type Transform = z.infer<typeof transformSchema>;

/**
 * Where one piece of an event comes from. Either a field on the source record
 * (dot/bracket path, so nested JSON works) or a literal constant, then run
 * through zero or more transforms.
 */
export const fieldSchema = z
  .object({
    /** Dot path into the record: "activity.steps", "Sleep[0].duration". */
    path: z.string().optional(),
    /** A fixed value instead of reading the record. */
    const: SCALAR.optional(),
    /** First non-empty of several paths — dumps are inconsistent about naming. */
    coalesce: z.array(z.string()).optional(),
    /**
     * Read the event's own computed length instead of a column. Sleep and
     * workout records routinely give only a start and an end, and the
     * measurement *is* the span between them.
     */
    derived: z.enum(["duration_s", "duration_min"]).optional(),
    transforms: z.array(transformSchema).default([]),
  })
  .refine(
    (f) =>
      f.path !== undefined ||
      f.const !== undefined ||
      f.coalesce !== undefined ||
      f.derived !== undefined,
    { message: "a field must set one of: path, const, coalesce, derived" },
  );

export type FieldSpec = z.infer<typeof fieldSchema>;

/** How to turn a source value into an instant. */
export const timeFieldSchema = fieldSchema.and(
  z.object({
    /**
     * "iso" parses anything Date.parse handles. "epoch_s"/"epoch_ms" read
     * numbers. "date" treats the value as a bare calendar day (no clock time),
     * anchored at noon local so timezone shifts never move it across midnight.
     */
    format: z.enum(["iso", "epoch_s", "epoch_ms", "date"]).default("iso"),
  }),
);

/**
 * Describes an event type the spec introduces, so importing an unknown format
 * registers its metadata rather than leaving bare keys in the store.
 */
export const typeMetaSchema = z.object({
  label: z.string(),
  unit: z.string().optional(),
  description: z.string().optional(),
  valueKind: z.enum(["numeric", "duration", "boolean", "categorical", "text"]).default("numeric"),
  aggregation: z.enum(["sum", "avg", "min", "max", "last", "count"]).default("sum"),
  polarity: z.number().int().min(-1).max(1).default(0),
  category: z.string().optional(),
  correlatable: z.boolean().default(true),
});

export type TypeMeta = z.infer<typeof typeMetaSchema>;

/** One source record may produce several events — a CSV row with many columns. */
/**
 * A record-level condition. Formats like Apple Health put every metric in the
 * same element and distinguish them by an attribute, so an emit needs to be
 * able to say "only rows where type is HKQuantityTypeIdentifierStepCount".
 */
export const whereSchema = z.object({
  path: z.string(),
  equals: SCALAR.optional(),
  in: z.array(SCALAR).optional(),
  contains: z.string().optional(),
});

export type WhereSpec = z.infer<typeof whereSchema>;

export const emitSchema = z.object({
  type: z.string().min(1), // event type key
  typeMeta: typeMetaSchema.optional(),
  /** Only emit for records matching this condition. */
  where: whereSchema.optional(),
  value: fieldSchema.optional(),
  valueText: fieldSchema.optional(),
  /** Event length in seconds. */
  duration: fieldSchema.optional(),
  /** Overrides the record-level timestamp for this emit only. */
  timestamp: timeFieldSchema.optional(),
  endTimestamp: timeFieldSchema.optional(),
  /**
   * Which end of the event decides the day it counts towards. Sleep is the
   * reason this exists: a night is credited to the morning you woke up, so two
   * sleeps either side of one midnight do not pile onto the same date and read
   * as a nineteen-hour night.
   */
  dateFrom: z.enum(["start", "end"]).optional(),
  /** Extra context kept on the event but not used for correlation. */
  meta: z.record(z.string(), fieldSchema).optional(),
  /** Source-provided stable id, when the dump has one. */
  externalId: fieldSchema.optional(),
  /** Drop the event when the chosen field is empty/zero — dumps are full of padding rows. */
  skipWhen: z
    .object({
      path: z.string(),
      is: z.enum(["empty", "zero", "emptyOrZero", "notNumeric"]),
    })
    .optional(),
});

export type EmitSpec = z.infer<typeof emitSchema>;

export const readerSchema = z.discriminatedUnion("format", [
  z.object({
    format: z.literal("csv"),
    delimiter: z.string().default(","),
    header: z.boolean().default(true),
    /** Rows to drop before the header — some exports prepend a title block. */
    skipLines: z.number().int().min(0).default(0),
  }),
  z.object({
    format: z.literal("json"),
    /** Dot path to the array of records; omit when the root is the array. */
    recordsPath: z.string().optional(),
  }),
  z.object({ format: z.literal("ndjson") }),
  z.object({
    format: z.literal("xml"),
    /** Dot path to the repeated element, e.g. "HealthData.Record". */
    recordsPath: z.string(),
  }),
]);

export const mappingSpecSchema = z.object({
  /** Stable identifier, also the DB key: "google-fit.daily-activity". */
  key: z
    .string()
    .min(3)
    .regex(/^[a-z0-9]+(?:[-.][a-z0-9]+)*$/, "use lowercase dotted-kebab, e.g. fitbit.sleep"),
  name: z.string().min(1),
  provider: z.string().min(1),
  description: z.string().optional(),
  /** How this spec recognises a file it can handle. */
  match: z.object({
    /** Case-insensitive regex tested against the filename. */
    filenamePattern: z.string().optional(),
    /** Every one of these must be present in the record's fields. */
    requiredFields: z.array(z.string()).default([]),
  }),
  reader: readerSchema,
  /**
   * "local" reads naive timestamps as the user's own wall clock; "utc" reads
   * them as UTC. Dumps rarely say which, so this is worth getting right.
   */
  timezone: z.enum(["local", "utc"]).default("local"),
  /**
   * Where the record itself says which UTC offset it was recorded at, e.g.
   * Samsung Health's `time_offset` ("UTC+0100"). When present it decides the
   * calendar day an event belongs to, in place of the user's profile timezone —
   * so a week in Sydney buckets onto Sydney's days rather than Amsterdam's.
   * Accepts "UTC+0100", "+01:00", "-0500", or a plain number of minutes.
   */
  zoneOffset: fieldSchema.optional(),
  /** Record-level timestamp, inherited by every emit that omits its own. */
  timestamp: timeFieldSchema,
  emit: z.array(emitSchema).min(1),
});

export type MappingSpec = z.infer<typeof mappingSpecSchema>;

/** The shape handed to the model, minus the fields we fill in ourselves. */
export const inferredSpecSchema = mappingSpecSchema;

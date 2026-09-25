import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/*
 * The on-device store. One local person per database, so unlike the old
 * server schema there is no `user` table and no `user_id` column anywhere.
 *
 * SQLite has no enums, dates or jsonb: enum-ish columns are text with a TS
 * union, instants are integer milliseconds (`timestamp_ms` mode) and structured
 * values are JSON text (`json` mode). Calendar days stay YYYY-MM-DD text, which
 * sorts and compares correctly as a string.
 */

export const AGGREGATIONS = ["sum", "avg", "min", "max", "last", "count"] as const;
export const VALUE_KINDS = ["numeric", "duration", "boolean", "categorical", "text"] as const;
export const IMPORT_STATUSES = [
  "detecting",
  "awaiting_review",
  "applying",
  "done",
  "failed",
  /** Recognised as part of a known export, and deliberately not imported. */
  "skipped",
] as const;

export type Aggregation = (typeof AGGREGATIONS)[number];
export type ValueKind = (typeof VALUE_KINDS)[number];
export type ImportStatus = (typeof IMPORT_STATUSES)[number];

const now = sql`(unixepoch() * 1000)`;
const uuid = () => crypto.randomUUID();

/* -------------------------------------------------------------------------- */
/*  Local settings                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Key/value preferences for the person using this device: timezone, location,
 * reminder time, worker URL. Replaces the old `user` columns and `app_settings`.
 * API keys do NOT live here — they go in secure storage.
 */
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value", { mode: "json" }).$type<unknown>().notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(now),
});

/* -------------------------------------------------------------------------- */
/*  The generic event store                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The metadata half of the two-table design: one row per kind of thing that can
 * be measured. `events` carries only the measurement itself.
 */
export const eventTypes = sqliteTable(
  "event_types",
  {
    key: text("key").primaryKey(), // "steps", "weather.temp_max", "mood"
    label: text("label").notNull(),
    description: text("description"),
    unit: text("unit"),
    valueKind: text("value_kind", { enum: VALUE_KINDS }).notNull().default("numeric"),
    /** How several events of the same type on the same day collapse into one number. */
    aggregation: text("aggregation", { enum: AGGREGATIONS }).notNull().default("sum"),
    /** 1 = higher is better, -1 = lower is better, 0 = neither. */
    polarity: integer("polarity").notNull().default(0),
    category: text("category"), // activity | sleep | mood | environment | media | productivity
    color: text("color"),
    icon: text("icon"),
    /** Excluded from correlation scans (IDs, free text, etc). */
    correlatable: integer("correlatable", { mode: "boolean" }).notNull().default(true),
    meta: text("meta", { mode: "json" }).$type<Record<string, unknown>>().notNull().default({}),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(now),
  },
  (t) => [index("event_types_category_idx").on(t.category)],
);

/** A connected adapter instance: one uploaded dump, or one live API hookup. */
export const sources = sqliteTable("sources", {
  id: text("id").primaryKey().$defaultFn(uuid),
  /** "import" = data dump, "api" = we pull it ourselves. */
  kind: text("kind", { enum: ["import", "api"] }).notNull(),
  provider: text("provider").notNull(),
  label: text("label").notNull(),
  config: text("config", { mode: "json" }).$type<Record<string, unknown>>().notNull().default({}),
  lastSyncAt: integer("last_sync_at", { mode: "timestamp_ms" }),
  lastSyncError: text("last_sync_error"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(now),
});

/**
 * One row per observation, whatever it measures. `value` holds the number for
 * numeric/duration/boolean kinds; `valueText` holds the label for categorical.
 */
export const events = sqliteTable(
  "events",
  {
    id: text("id").primaryKey().$defaultFn(uuid),
    typeKey: text("type_key")
      .notNull()
      .references(() => eventTypes.key, { onDelete: "cascade" }),
    startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
    endedAt: integer("ended_at", { mode: "timestamp_ms" }),
    durationS: integer("duration_s"),
    value: real("value"),
    valueText: text("value_text"),
    /** The calendar day this event belongs to in the person's timezone, resolved at ingest. */
    localDate: text("local_date").notNull(),
    meta: text("meta", { mode: "json" }).$type<Record<string, unknown>>().notNull().default({}),
    sourceId: text("source_id").references(() => sources.id, { onDelete: "set null" }),
    /** Stable identity, so re-importing an overlapping dump updates instead of duplicating. */
    dedupeKey: text("dedupe_key").notNull(),
    ingestedAt: integer("ingested_at", { mode: "timestamp_ms" }).notNull().default(now),
  },
  (t) => [
    uniqueIndex("events_dedupe_idx").on(t.dedupeKey),
    index("events_series_idx").on(t.typeKey, t.localDate),
    index("events_time_idx").on(t.startedAt),
  ],
);

/**
 * Daily rollup, derived from `events` via the type's aggregation rule. The
 * correlation engine reads only this table, so it stays fast as events grow.
 */
export const dailyMetrics = sqliteTable(
  "daily_metrics",
  {
    localDate: text("local_date").notNull(),
    typeKey: text("type_key")
      .notNull()
      .references(() => eventTypes.key, { onDelete: "cascade" }),
    value: real("value").notNull(),
    sampleCount: integer("sample_count").notNull().default(1),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(now),
  },
  (t) => [
    primaryKey({ columns: [t.localDate, t.typeKey] }),
    index("daily_metrics_type_idx").on(t.typeKey, t.localDate),
  ],
);

/* -------------------------------------------------------------------------- */
/*  Import pipeline: fingerprints, conversions, runs                          */
/* -------------------------------------------------------------------------- */

/**
 * A conversion, stored as data rather than code: a declarative description of
 * how one file shape becomes events. Built-ins ship with the app; the rest are
 * authored by the model on first sight of an unknown format.
 *
 * `spec` is typed loosely here to keep this package free of core imports;
 * core casts it to `MappingSpec`.
 */
export const mappingSpecs = sqliteTable(
  "mapping_specs",
  {
    id: text("id").primaryKey().$defaultFn(uuid),
    key: text("key").notNull(),
    name: text("name").notNull(),
    provider: text("provider").notNull(),
    origin: text("origin", { enum: ["builtin", "inferred", "manual"] }).notNull(),
    spec: text("spec", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    /** Bumped whenever the spec is edited; old imports keep their version. */
    version: integer("version").notNull().default(1),
    timesUsed: integer("times_used").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(now),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(now),
  },
  (t) => [uniqueIndex("mapping_specs_key_idx").on(t.key)],
);

/** Which file shapes a conversion is known to handle (one spec, many fingerprints). */
export const specFingerprints = sqliteTable(
  "spec_fingerprints",
  {
    id: text("id").primaryKey().$defaultFn(uuid),
    /** Format plus sorted field names, hashed. */
    fingerprint: text("fingerprint").notNull(),
    specId: text("spec_id")
      .notNull()
      .references(() => mappingSpecs.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(now),
  },
  (t) => [uniqueIndex("spec_fingerprints_unique").on(t.fingerprint)],
);

/** One imported file and what became of it. */
export const imports = sqliteTable(
  "imports",
  {
    id: text("id").primaryKey().$defaultFn(uuid),
    sourceId: text("source_id").references(() => sources.id, { onDelete: "set null" }),
    filename: text("filename").notNull(),
    byteSize: integer("byte_size").notNull(),
    status: text("status", { enum: IMPORT_STATUSES }).notNull().default("detecting"),
    /** Format, field names, fingerprint and a few sample records. */
    detection: text("detection", { mode: "json" }).$type<Record<string, unknown>>(),
    mappingSpecId: text("mapping_spec_id").references(() => mappingSpecs.id, {
      onDelete: "set null",
    }),
    /** How the spec was chosen: reused by fingerprint, or freshly inferred. */
    matchKind: text("match_kind", { enum: ["fingerprint", "builtin", "inferred", "skipped"] }),
    stats: text("stats", { mode: "json" }).$type<Record<string, unknown>>(),
    error: text("error"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(now),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
  },
  (t) => [index("imports_created_idx").on(t.createdAt)],
);

/** The imported bytes, kept so a spec can be edited and re-applied. */
export const importBlobs = sqliteTable("import_blobs", {
  importId: text("import_id")
    .primaryKey()
    .references(() => imports.id, { onDelete: "cascade" }),
  contentType: text("content_type").notNull(),
  content: text("content").notNull(), // base64 for binary formats, raw text otherwise
  encoding: text("encoding", { enum: ["utf8", "base64"] }).notNull().default("utf8"),
});

/* -------------------------------------------------------------------------- */
/*  Experiments: change one thing for a while, then measure what moved        */
/* -------------------------------------------------------------------------- */

/** A web page the model read while designing an experiment. */
export type ExperimentSource = { title: string; url: string };

/** The model's read of a finished experiment, kept apart from the person's own `conclusion`. */
export type ExperimentEvaluation = {
  verdict: "helped" | "no_change" | "worsened" | "inconclusive";
  headline: string;
  detail: string;
  perMetric: { metric: string; note: string }[];
  recommendation: string;
  caveat: string | null;
};

/**
 * A self-experiment. The data window is `startDate`..`endDate`; the baseline is
 * the same number of days immediately before. Only abandonment is stored as a
 * status — scheduled/running/finished follow from the dates.
 */
export const experiments = sqliteTable(
  "experiments",
  {
    id: text("id").primaryKey().$defaultFn(uuid),
    title: text("title").notNull(),
    intervention: text("intervention").notNull(),
    hypothesis: text("hypothesis").notNull(),
    rationale: text("rationale"),
    sources: text("sources", { mode: "json" }).$type<ExperimentSource[]>().notNull().default([]),
    targetMetrics: text("target_metrics", { mode: "json" }).$type<string[]>().notNull().default([]),
    startDate: text("start_date").notNull(),
    endDate: text("end_date").notNull(),
    status: text("status", { enum: ["active", "abandoned"] }).notNull().default("active"),
    conclusion: text("conclusion"),
    evaluation: text("evaluation", { mode: "json" }).$type<ExperimentEvaluation | null>(),
    evaluatedAt: integer("evaluated_at", { mode: "timestamp_ms" }),
    createdBy: text("created_by", { enum: ["ai", "user"] }).notNull().default("ai"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(now),
  },
  (t) => [index("experiments_start_idx").on(t.startDate)],
);

/** Did they actually do it that day? */
export const experimentCheckins = sqliteTable(
  "experiment_checkins",
  {
    experimentId: text("experiment_id")
      .notNull()
      .references(() => experiments.id, { onDelete: "cascade" }),
    localDate: text("local_date").notNull(),
    done: integer("done", { mode: "boolean" }).notNull().default(true),
    note: text("note"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(now),
  },
  (t) => [primaryKey({ columns: [t.experimentId, t.localDate] })],
);

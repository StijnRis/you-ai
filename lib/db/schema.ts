import {
  boolean,
  pgEnum,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { AdapterAccountType } from "next-auth/adapters";
import type { MappingSpec } from "@/lib/mapping/spec";

export const ROLES = ["user", "admin"] as const;
export type Role = (typeof ROLES)[number];

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

/*
 * Real Postgres enums rather than text columns: the database refuses a bad
 * value even if something writes to it outside this codebase, and `role` in
 * particular decides who reaches the admin screen.
 */
export const roleEnum = pgEnum("role", ROLES);
export const aggregationEnum = pgEnum("aggregation", AGGREGATIONS);
export const valueKindEnum = pgEnum("value_kind", VALUE_KINDS);
export const importStatusEnum = pgEnum("import_status", IMPORT_STATUSES);

/* -------------------------------------------------------------------------- */
/*  Auth.js tables (shape dictated by @auth/drizzle-adapter)                   */
/* -------------------------------------------------------------------------- */

export const users = pgTable("user", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: timestamp("emailVerified", { mode: "date", withTimezone: true }),
  image: text("image"),
  /**
   * bcrypt hash. Null for accounts that only ever sign in with Google or
   * GitHub, and never selected into anything that reaches the client.
   */
  passwordHash: text("password_hash"),
  role: roleEnum("role").notNull().default("user"),
  /** Set by an admin to block sign-in without destroying the account's data. */
  disabledAt: timestamp("disabled_at", { withTimezone: true }),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  // YouAI additions: everything time-bucketed is resolved in this zone.
  timezone: text("timezone").notNull().default("UTC"),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const accounts = pgTable(
  "account",
  {
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccountType>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("providerAccountId").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (t) => [primaryKey({ columns: [t.provider, t.providerAccountId] })],
);

export const sessions = pgTable("session", {
  sessionToken: text("sessionToken").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date", withTimezone: true }).notNull(),
});

export const verificationTokens = pgTable(
  "verificationToken",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date", withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.token] })],
);

/* -------------------------------------------------------------------------- */
/*  The generic event store                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The metadata half of the two-table design: one row per kind of thing that can
 * be measured. `events` carries only the measurement itself.
 */
export const eventTypes = pgTable(
  "event_types",
  {
    key: text("key").primaryKey(), // "steps", "weather.temp_max", "mood"
    label: text("label").notNull(),
    description: text("description"),
    unit: text("unit"), // "steps", "°C", "min", "bpm"
    valueKind: valueKindEnum("value_kind").notNull().default("numeric"),
    /**
     * How several events of the same type on the same day collapse into that
     * day's single number. Steps sum, resting heart rate averages, weight takes
     * the last reading.
     */
    aggregation: aggregationEnum("aggregation").notNull().default("sum"),
    /** 1 = higher is better, -1 = lower is better, 0 = neither. */
    polarity: smallint("polarity").notNull().default(0),
    category: text("category"), // activity | sleep | mood | environment | media | productivity
    color: text("color"),
    icon: text("icon"),
    /** Excluded from correlation scans (IDs, free text, etc). */
    correlatable: boolean("correlatable").notNull().default(true),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("event_types_category_idx").on(t.category)],
);

/** A connected adapter instance: one uploaded dump, or one live API hookup. */
export const sources = pgTable(
  "sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** "import" = data dump, "api" = we pull it ourselves. */
    kind: text("kind", { enum: ["import", "api"] }).notNull(),
    provider: text("provider").notNull(), // "open-meteo", "google-fit", "apple-health"
    label: text("label").notNull(),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    lastSyncError: text("last_sync_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sources_user_idx").on(t.userId)],
);

/**
 * One row per observation, whatever it measures. `value` holds the number for
 * numeric/duration/boolean kinds; `valueText` holds the label for categorical.
 */
export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    typeKey: text("type_key")
      .notNull()
      .references(() => eventTypes.key, { onDelete: "cascade" }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    durationS: integer("duration_s"),
    value: doublePrecision("value"),
    valueText: text("value_text"),
    /**
     * The calendar day this event belongs to in the user's timezone, resolved
     * once at ingest so day-bucketed queries never re-derive it.
     */
    localDate: date("local_date").notNull(),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    sourceId: uuid("source_id").references(() => sources.id, { onDelete: "set null" }),
    /**
     * Stable identity for an observation, so re-importing an overlapping dump
     * updates rows instead of duplicating them.
     */
    dedupeKey: text("dedupe_key").notNull(),
    ingestedAt: timestamp("ingested_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("events_dedupe_idx").on(t.userId, t.dedupeKey),
    index("events_series_idx").on(t.userId, t.typeKey, t.localDate),
    index("events_time_idx").on(t.userId, t.startedAt),
  ],
);

/**
 * Daily rollup, derived from `events` via the type's aggregation rule. The
 * correlation engine reads only this table, so it stays fast as events grow.
 */
export const dailyMetrics = pgTable(
  "daily_metrics",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    localDate: date("local_date").notNull(),
    typeKey: text("type_key")
      .notNull()
      .references(() => eventTypes.key, { onDelete: "cascade" }),
    value: doublePrecision("value").notNull(),
    sampleCount: integer("sample_count").notNull().default(1),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.localDate, t.typeKey] }),
    index("daily_metrics_type_idx").on(t.userId, t.typeKey, t.localDate),
  ],
);

/* -------------------------------------------------------------------------- */
/*  Import pipeline: fingerprints, conversions, runs                          */
/* -------------------------------------------------------------------------- */

/**
 * A conversion, stored as data rather than code: a declarative description of
 * how one file shape becomes events. Built-ins ship with the app; the rest are
 * authored by the model on first sight of an unknown format, then reused
 * forever after by fingerprint.
 */
export const mappingSpecs = pgTable(
  "mapping_specs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** null = built-in, shared by every user. */
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    key: text("key").notNull(), // "google-fit.daily-activity"
    name: text("name").notNull(),
    provider: text("provider").notNull(),
    origin: text("origin", { enum: ["builtin", "inferred", "manual"] }).notNull(),
    spec: jsonb("spec").$type<MappingSpec>().notNull(),
    /** Bumped whenever the spec is edited; old imports keep their version. */
    version: integer("version").notNull().default(1),
    timesUsed: integer("times_used").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("mapping_specs_key_idx").on(t.key)],
);

/**
 * Which file shapes a conversion is known to handle.
 *
 * Separate from `mapping_specs` because the relationship is one-to-many: the
 * same Google Fit conversion handles exports whose column sets differ slightly
 * between years, and each of those is its own fingerprint.
 */
export const specFingerprints = pgTable(
  "spec_fingerprints",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** null = learned for a built-in, so every user benefits. */
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    /** Format plus sorted field names, hashed. */
    fingerprint: text("fingerprint").notNull(),
    specId: uuid("spec_id")
      .notNull()
      .references(() => mappingSpecs.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // NULLS NOT DISTINCT so a built-in's shared row (user_id null) cannot be
    // inserted twice — by default Postgres treats every NULL as unique.
    unique("spec_fingerprints_unique").on(t.userId, t.fingerprint).nullsNotDistinct(),
    index("spec_fingerprints_lookup_idx").on(t.fingerprint),
  ],
);

/** One uploaded file and what became of it. */
export const imports = pgTable(
  "imports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id").references(() => sources.id, { onDelete: "set null" }),
    filename: text("filename").notNull(),
    byteSize: integer("byte_size").notNull(),
    status: importStatusEnum("status").notNull().default("detecting"),
    /** Format, field names, fingerprint and a few sample records. */
    detection: jsonb("detection").$type<Record<string, unknown>>(),
    mappingSpecId: uuid("mapping_spec_id").references(() => mappingSpecs.id, {
      onDelete: "set null",
    }),
    /** How the spec was chosen: reused by fingerprint, or freshly inferred. */
    matchKind: text("match_kind", {
      enum: ["fingerprint", "builtin", "inferred", "skipped"],
    }),
    stats: jsonb("stats").$type<Record<string, unknown>>(),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [index("imports_user_idx").on(t.userId, t.createdAt)],
);

/**
 * The uploaded bytes, kept so a spec can be edited and re-applied without
 * asking the user to upload the same dump again.
 */
export const importBlobs = pgTable("import_blobs", {
  importId: uuid("import_id")
    .primaryKey()
    .references(() => imports.id, { onDelete: "cascade" }),
  contentType: text("content_type").notNull(),
  content: text("content").notNull(), // base64 for binary formats, raw text otherwise
  encoding: text("encoding", { enum: ["utf8", "base64"] }).notNull().default("utf8"),
});

/* -------------------------------------------------------------------------- */
/*  Application settings                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Instance-wide options an admin can change without a redeploy. Key/value
 * rather than a column per option, so adding one is an insert instead of a
 * migration — the same reasoning behind `event_types`.
 */
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
});

/* -------------------------------------------------------------------------- */
/*  Experiments: change one thing for a while, then measure what moved        */
/* -------------------------------------------------------------------------- */

/** A web page the model read while designing an experiment. */
export type ExperimentSource = { title: string; url: string };

/**
 * The model's read of a finished experiment. Kept apart from `conclusion`,
 * which is the person's own words: the two can disagree, and that disagreement
 * is worth being able to see.
 */
export type ExperimentEvaluation = {
  verdict: "helped" | "no_change" | "worsened" | "inconclusive";
  headline: string;
  detail: string;
  perMetric: { metric: string; note: string }[];
  recommendation: string;
  caveat: string | null;
};

/**
 * A self-experiment: "cold shower every morning for a week". The data window
 * is the calendar days from `startDate` to `endDate`; the baseline is the same
 * number of days immediately before, so the comparison is against how this
 * person was doing right beforehand rather than against some population norm.
 *
 * Only abandonment is stored as a status. Whether an experiment is scheduled,
 * running or finished follows from its dates, so it can never go stale.
 */
export const experiments = pgTable(
  "experiments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    /** What to actually do each day: "2–3 minutes of cold water at the end of the morning shower". */
    intervention: text("intervention").notNull(),
    /** The expected effect, stated so it can be proved wrong. */
    hypothesis: text("hypothesis").notNull(),
    /** Why this is worth trying — usually a summary of what the research found. */
    rationale: text("rationale"),
    sources: jsonb("sources").$type<ExperimentSource[]>().notNull().default([]),
    /** Metric keys whose change decides whether it worked. */
    targetMetrics: jsonb("target_metrics").$type<string[]>().notNull().default([]),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    status: text("status").$type<"active" | "abandoned">().notNull().default("active"),
    /** What the person concluded once it was over, in their own words. */
    conclusion: text("conclusion"),
    /** The model's verdict on whether it worked, written once and stored. */
    evaluation: jsonb("evaluation").$type<ExperimentEvaluation | null>(),
    evaluatedAt: timestamp("evaluated_at", { withTimezone: true }),
    createdBy: text("created_by").$type<"ai" | "user">().notNull().default("ai"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("experiments_user_idx").on(t.userId, t.startDate)],
);

/**
 * Did they actually do it that day? Kept apart from `events` so that ticking a
 * box never registers a global event type per experiment, and so the analysis
 * can separate "days on the protocol" from "days in the window".
 */
export const experimentCheckins = pgTable(
  "experiment_checkins",
  {
    experimentId: uuid("experiment_id")
      .notNull()
      .references(() => experiments.id, { onDelete: "cascade" }),
    localDate: date("local_date").notNull(),
    done: boolean("done").notNull().default(true),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.experimentId, t.localDate] })],
);

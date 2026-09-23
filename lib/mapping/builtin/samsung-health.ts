import type { MappingSpec, TypeMeta } from "@/lib/mapping/spec";

/**
 * Samsung Health — the "Download personal data" export.
 *
 * The export is a folder of forty-odd CSVs, one per table, and every one of
 * them shares the same three quirks:
 *
 *   1. a preamble line ("com.samsung.shealth.sleep,7006011,11") above the real
 *      header, which is why every reader here sets `skipLines: 1`;
 *   2. column names that are fully-qualified and therefore full of dots
 *      ("com.samsung.health.sleep.start_time") — `getPath` matches those
 *      literally rather than walking them as nested paths;
 *   3. timestamps written in UTC with the recording offset kept in a separate
 *      `time_offset` column ("UTC+0100").
 *
 * That third point decides which calendar day an event lands on, so each spec
 * points `zoneOffset` at its own offset column. The export in hand contains a
 * fortnight in Australia; without it, those nights bucket ten hours early and
 * every sleep reading lands on the wrong day.
 *
 * Day-level tables are the exception: their `day_time` is already local
 * midnight, so they are read as bare calendar dates and need no offset.
 */

const READER = { format: "csv", delimiter: ",", header: true, skipLines: 1 } as const;

/** Samsung names every file `<table>.<export timestamp>.csv`, possibly in a folder. */
function filenameFor(table: string): string {
  return `(^|/)${table.replace(/\./g, "\\.")}\\.\\d+\\.csv$`;
}

const meta = (m: Partial<TypeMeta> & { label: string }): TypeMeta => ({
  unit: undefined,
  description: undefined,
  valueKind: "numeric",
  aggregation: "sum",
  polarity: 0,
  category: undefined,
  correlatable: true,
  ...m,
});

/* -------------------------------------------------------------------------- */
/*  Daily activity — the canonical source for steps, distance and calories     */
/* -------------------------------------------------------------------------- */

/**
 * Three tables in the export carry daily step totals: this one,
 * `step_daily_trend` and `tracker.pedometer_day_summary`. They agree to the
 * step on every day they share, but the latter two repeat each day once per
 * device — summing them would triple the year. This one has exactly one row
 * per day and the widest coverage, so it is the only one that emits the shared
 * keys; the other two are recognised and skipped.
 */
const activityDaySummary: MappingSpec = {
  key: "samsung-health.activity-day-summary",
  name: "Samsung Health — daily activity",
  provider: "Samsung Health",
  description:
    "One row per calendar day: steps, distance, calories, active and exercise time, floors and Samsung's own activity score. The canonical daily source, chosen over step_daily_trend and pedometer_day_summary because it has one row per day rather than one per device.",
  match: {
    filenamePattern: filenameFor("com.samsung.shealth.activity.day_summary"),
    requiredFields: ["day_time", "step_count", "exercise_time", "move_hourly_count", "active_time"],
  },
  reader: READER,
  timezone: "local",
  // `day_time` is already local midnight, so it is a plain calendar day.
  timestamp: { path: "day_time", format: "date", transforms: [] },
  emit: [
    {
      type: "steps",
      typeMeta: meta({ label: "Steps", unit: "steps", polarity: 1, category: "activity" }),
      value: { path: "step_count", transforms: [{ op: "toNumber" }] },
      externalId: { path: "day_time", transforms: [] },
      skipWhen: { path: "step_count", is: "emptyOrZero" },
    },
    {
      type: "distance",
      typeMeta: meta({ label: "Distance", unit: "km", polarity: 1, category: "activity" }),
      // Samsung reports metres.
      value: {
        path: "distance",
        transforms: [{ op: "toNumber" }, { op: "divide", by: 1000 }, { op: "round", decimals: 2 }],
      },
      externalId: { path: "day_time", transforms: [] },
      skipWhen: { path: "distance", is: "emptyOrZero" },
    },
    {
      type: "calories",
      typeMeta: meta({ label: "Active calories", unit: "kcal", category: "activity" }),
      value: { path: "calorie", transforms: [{ op: "toNumber" }, { op: "round", decimals: 0 }] },
      externalId: { path: "day_time", transforms: [] },
      skipWhen: { path: "calorie", is: "emptyOrZero" },
    },
    {
      type: "active_minutes",
      typeMeta: meta({
        label: "Active time",
        unit: "min",
        valueKind: "duration",
        polarity: 1,
        category: "activity",
      }),
      // Milliseconds in the export.
      value: {
        path: "active_time",
        transforms: [{ op: "toNumber" }, { op: "divide", by: 60000 }, { op: "round", decimals: 0 }],
      },
      externalId: { path: "day_time", transforms: [] },
      skipWhen: { path: "active_time", is: "emptyOrZero" },
    },
    {
      type: "exercise_minutes",
      typeMeta: meta({
        label: "Exercise time",
        unit: "min",
        valueKind: "duration",
        polarity: 1,
        category: "activity",
      }),
      value: {
        path: "exercise_time",
        transforms: [{ op: "toNumber" }, { op: "divide", by: 60000 }, { op: "round", decimals: 0 }],
      },
      externalId: { path: "day_time", transforms: [] },
      skipWhen: { path: "exercise_time", is: "emptyOrZero" },
    },
    {
      type: "floors",
      typeMeta: meta({ label: "Floors climbed", unit: "floors", polarity: 1, category: "activity" }),
      value: { path: "floor_count", transforms: [{ op: "toNumber" }, { op: "round", decimals: 0 }] },
      externalId: { path: "day_time", transforms: [] },
      skipWhen: { path: "floor_count", is: "emptyOrZero" },
    },
    {
      type: "activity_score",
      typeMeta: meta({
        label: "Activity score",
        unit: "points",
        aggregation: "last",
        polarity: 1,
        category: "activity",
      }),
      value: { path: "score", transforms: [{ op: "toNumber" }] },
      externalId: { path: "day_time", transforms: [] },
      skipWhen: { path: "score", is: "emptyOrZero" },
    },
  ],
};

/** Resting calories, which the daily activity table does not carry. */
const caloriesBurned: MappingSpec = {
  key: "samsung-health.calories-burned",
  name: "Samsung Health — resting calories",
  provider: "Samsung Health",
  description:
    "Daily basal expenditure. Only the resting figure is imported: this table's active_calorie is the same number the daily activity table already reports.",
  match: {
    filenamePattern: filenameFor("com.samsung.shealth.calories_burned.details"),
    requiredFields: [
      "com.samsung.shealth.calories_burned.rest_calorie",
      "com.samsung.shealth.calories_burned.day_time",
    ],
  },
  reader: READER,
  timezone: "local",
  timestamp: { path: "com.samsung.shealth.calories_burned.day_time", format: "date", transforms: [] },
  emit: [
    {
      type: "calories_rest",
      typeMeta: meta({ label: "Resting calories", unit: "kcal", category: "activity" }),
      value: {
        path: "com.samsung.shealth.calories_burned.rest_calorie",
        transforms: [{ op: "toNumber" }, { op: "round", decimals: 0 }],
      },
      externalId: { path: "com.samsung.shealth.calories_burned.day_time", transforms: [] },
      skipWhen: { path: "com.samsung.shealth.calories_burned.rest_calorie", is: "emptyOrZero" },
    },
  ],
};

/* -------------------------------------------------------------------------- */
/*  Sleep                                                                      */
/* -------------------------------------------------------------------------- */

const sleep: MappingSpec = {
  key: "samsung-health.sleep",
  name: "Samsung Health — sleep sessions",
  provider: "Samsung Health",
  description:
    "One row per sleep session. Roughly a third of the sessions leave sleep_duration blank, so the duration is derived from the start and end times instead — the same number, and it keeps those nights.",
  match: {
    filenamePattern: filenameFor("com.samsung.shealth.sleep"),
    requiredFields: [
      "com.samsung.health.sleep.start_time",
      "com.samsung.health.sleep.end_time",
      "sleep_score",
      "efficiency",
    ],
  },
  reader: READER,
  timezone: "utc",
  zoneOffset: { path: "com.samsung.health.sleep.time_offset", transforms: [] },
  timestamp: { path: "com.samsung.health.sleep.start_time", format: "iso", transforms: [] },
  emit: [
    {
      type: "sleep_duration",
      typeMeta: meta({
        label: "Sleep",
        unit: "min",
        valueKind: "duration",
        polarity: 1,
        category: "sleep",
      }),
      endTimestamp: { path: "com.samsung.health.sleep.end_time", format: "iso", transforms: [] },
      dateFrom: "end",
      value: { derived: "duration_min", transforms: [{ op: "round", decimals: 0 }] },
      externalId: { path: "com.samsung.health.sleep.datauuid", transforms: [] },
      meta: {
        cycles: { path: "sleep_cycle", transforms: [] },
        latency: { path: "sleep_latency", transforms: [] },
      },
    },
    {
      type: "sleep_score",
      typeMeta: meta({
        label: "Sleep score",
        unit: "points",
        aggregation: "avg",
        polarity: 1,
        category: "sleep",
      }),
      endTimestamp: { path: "com.samsung.health.sleep.end_time", format: "iso", transforms: [] },
      dateFrom: "end",
      value: { path: "sleep_score", transforms: [{ op: "toNumber" }] },
      externalId: { path: "com.samsung.health.sleep.datauuid", transforms: [] },
      skipWhen: { path: "sleep_score", is: "notNumeric" },
    },
    {
      type: "sleep_efficiency",
      typeMeta: meta({
        label: "Sleep efficiency",
        unit: "%",
        aggregation: "avg",
        polarity: 1,
        category: "sleep",
      }),
      endTimestamp: { path: "com.samsung.health.sleep.end_time", format: "iso", transforms: [] },
      dateFrom: "end",
      value: { path: "efficiency", transforms: [{ op: "toNumber" }, { op: "round", decimals: 1 }] },
      externalId: { path: "com.samsung.health.sleep.datauuid", transforms: [] },
      skipWhen: { path: "efficiency", is: "emptyOrZero" },
    },
    {
      type: "sleep_mental_recovery",
      typeMeta: meta({
        label: "Mental recovery",
        unit: "%",
        aggregation: "avg",
        polarity: 1,
        category: "sleep",
      }),
      endTimestamp: { path: "com.samsung.health.sleep.end_time", format: "iso", transforms: [] },
      dateFrom: "end",
      value: { path: "mental_recovery", transforms: [{ op: "toNumber" }, { op: "round", decimals: 1 }] },
      externalId: { path: "com.samsung.health.sleep.datauuid", transforms: [] },
      skipWhen: { path: "mental_recovery", is: "emptyOrZero" },
    },
    {
      type: "sleep_physical_recovery",
      typeMeta: meta({
        label: "Physical recovery",
        unit: "%",
        aggregation: "avg",
        polarity: 1,
        category: "sleep",
      }),
      endTimestamp: { path: "com.samsung.health.sleep.end_time", format: "iso", transforms: [] },
      dateFrom: "end",
      value: {
        path: "physical_recovery",
        transforms: [{ op: "toNumber" }, { op: "round", decimals: 1 }],
      },
      externalId: { path: "com.samsung.health.sleep.datauuid", transforms: [] },
      skipWhen: { path: "physical_recovery", is: "emptyOrZero" },
    },
  ],
};

/**
 * Per-stage sleep segments. Each row is one stretch of one stage, so the
 * minutes in a stage are the summed spans — which is exactly what the daily
 * rollup does with an aggregation of `sum`.
 */
const sleepStageTypes: { code: string; key: string; label: string; polarity: -1 | 0 | 1 }[] = [
  { code: "40001", key: "sleep_awake", label: "Awake in bed", polarity: -1 },
  { code: "40002", key: "sleep_light", label: "Light sleep", polarity: 0 },
  { code: "40003", key: "sleep_deep", label: "Deep sleep", polarity: 1 },
  { code: "40004", key: "sleep_rem", label: "REM sleep", polarity: 1 },
];

const sleepStage: MappingSpec = {
  key: "samsung-health.sleep-stage",
  name: "Samsung Health — sleep stages",
  provider: "Samsung Health",
  description:
    "One row per stretch of one sleep stage. The measurement is the span itself, so each stage's value is derived from its start and end.",
  match: {
    filenamePattern: filenameFor("com.samsung.health.sleep_stage"),
    requiredFields: ["sleep_id", "stage", "start_time", "end_time"],
  },
  reader: READER,
  timezone: "utc",
  zoneOffset: { path: "time_offset", transforms: [] },
  timestamp: { path: "start_time", format: "iso", transforms: [] },
  emit: sleepStageTypes.map(({ code, key, label, polarity }) => ({
    type: key,
    typeMeta: meta({
      label,
      unit: "min",
      valueKind: "duration" as const,
      polarity,
      category: "sleep",
    }),
    where: { path: "stage", equals: code },
    endTimestamp: { path: "end_time", format: "iso" as const, transforms: [] },
    value: { derived: "duration_min" as const, transforms: [{ op: "round" as const, decimals: 1 }] },
    externalId: { path: "datauuid", transforms: [] },
  })),
};

/* -------------------------------------------------------------------------- */
/*  Vitals                                                                     */
/* -------------------------------------------------------------------------- */

const heartRate: MappingSpec = {
  key: "samsung-health.heart-rate",
  name: "Samsung Health — heart rate",
  provider: "Samsung Health",
  description:
    "Spot heart-rate readings from the watch, several thousand a year. The daily average is the useful series; the daily minimum stands in for resting heart rate.",
  match: {
    filenamePattern: filenameFor("com.samsung.shealth.tracker.heart_rate"),
    requiredFields: [
      "com.samsung.health.heart_rate.heart_rate",
      "com.samsung.health.heart_rate.start_time",
    ],
  },
  reader: READER,
  timezone: "utc",
  zoneOffset: { path: "com.samsung.health.heart_rate.time_offset", transforms: [] },
  timestamp: { path: "com.samsung.health.heart_rate.start_time", format: "iso", transforms: [] },
  emit: [
    {
      type: "heart_rate",
      typeMeta: meta({
        label: "Heart rate",
        unit: "bpm",
        aggregation: "avg",
        category: "health",
      }),
      value: {
        path: "com.samsung.health.heart_rate.heart_rate",
        transforms: [{ op: "toNumber" }, { op: "round", decimals: 0 }],
      },
      externalId: { path: "com.samsung.health.heart_rate.datauuid", transforms: [] },
      skipWhen: { path: "com.samsung.health.heart_rate.heart_rate", is: "emptyOrZero" },
    },
    {
      type: "heart_rate_min",
      typeMeta: meta({
        label: "Lowest heart rate",
        unit: "bpm",
        aggregation: "min",
        polarity: -1,
        category: "health",
      }),
      value: {
        path: "com.samsung.health.heart_rate.min",
        transforms: [{ op: "toNumber" }, { op: "round", decimals: 0 }],
      },
      externalId: { path: "com.samsung.health.heart_rate.datauuid", transforms: [] },
      skipWhen: { path: "com.samsung.health.heart_rate.min", is: "emptyOrZero" },
    },
    {
      type: "heart_rate_max",
      typeMeta: meta({
        label: "Peak heart rate",
        unit: "bpm",
        aggregation: "max",
        category: "health",
      }),
      value: {
        path: "com.samsung.health.heart_rate.max",
        transforms: [{ op: "toNumber" }, { op: "round", decimals: 0 }],
      },
      externalId: { path: "com.samsung.health.heart_rate.datauuid", transforms: [] },
      skipWhen: { path: "com.samsung.health.heart_rate.max", is: "emptyOrZero" },
    },
  ],
};

const stress: MappingSpec = {
  key: "samsung-health.stress",
  name: "Samsung Health — stress",
  provider: "Samsung Health",
  description: "Watch stress readings on Samsung's 0–100 scale.",
  match: {
    filenamePattern: filenameFor("com.samsung.shealth.stress"),
    requiredFields: ["score", "algorithm", "start_time", "end_time", "time_offset"],
  },
  reader: READER,
  timezone: "utc",
  zoneOffset: { path: "time_offset", transforms: [] },
  timestamp: { path: "start_time", format: "iso", transforms: [] },
  emit: [
    {
      type: "stress",
      typeMeta: meta({
        label: "Stress",
        unit: "points",
        aggregation: "avg",
        polarity: -1,
        category: "health",
      }),
      value: { path: "score", transforms: [{ op: "toNumber" }, { op: "round", decimals: 1 }] },
      externalId: { path: "datauuid", transforms: [] },
      // A zero score means the reading failed, not that the user was serene.
      skipWhen: { path: "score", is: "emptyOrZero" },
    },
  ],
};

const oxygenSaturation: MappingSpec = {
  key: "samsung-health.oxygen-saturation",
  name: "Samsung Health — blood oxygen",
  provider: "Samsung Health",
  match: {
    filenamePattern: filenameFor("com.samsung.shealth.tracker.oxygen_saturation"),
    requiredFields: [
      "com.samsung.health.oxygen_saturation.spo2",
      "com.samsung.health.oxygen_saturation.start_time",
    ],
  },
  reader: READER,
  timezone: "utc",
  zoneOffset: { path: "com.samsung.health.oxygen_saturation.time_offset", transforms: [] },
  timestamp: {
    path: "com.samsung.health.oxygen_saturation.start_time",
    format: "iso",
    transforms: [],
  },
  emit: [
    {
      type: "spo2",
      typeMeta: meta({
        label: "Blood oxygen",
        unit: "%",
        aggregation: "avg",
        polarity: 1,
        category: "health",
      }),
      value: {
        path: "com.samsung.health.oxygen_saturation.spo2",
        transforms: [{ op: "toNumber" }, { op: "round", decimals: 1 }],
      },
      externalId: { path: "com.samsung.health.oxygen_saturation.datauuid", transforms: [] },
      skipWhen: { path: "com.samsung.health.oxygen_saturation.spo2", is: "emptyOrZero" },
    },
  ],
};

const respiratoryRate: MappingSpec = {
  key: "samsung-health.respiratory-rate",
  name: "Samsung Health — respiratory rate",
  provider: "Samsung Health",
  match: {
    filenamePattern: filenameFor("com.samsung.health.respiratory_rate"),
    requiredFields: ["average", "lower_limit", "upper_limit", "pplib_version", "start_time"],
  },
  reader: READER,
  timezone: "utc",
  zoneOffset: { path: "time_offset", transforms: [] },
  timestamp: { path: "start_time", format: "iso", transforms: [] },
  emit: [
    {
      type: "respiratory_rate",
      typeMeta: meta({
        label: "Respiratory rate",
        unit: "breaths/min",
        aggregation: "avg",
        category: "health",
      }),
      value: { path: "average", transforms: [{ op: "toNumber" }, { op: "round", decimals: 1 }] },
      externalId: { path: "datauuid", transforms: [] },
      skipWhen: { path: "average", is: "emptyOrZero" },
    },
  ],
};

/* -------------------------------------------------------------------------- */
/*  Body                                                                       */
/* -------------------------------------------------------------------------- */

const weight: MappingSpec = {
  key: "samsung-health.weight",
  name: "Samsung Health — body composition",
  provider: "Samsung Health",
  match: {
    filenamePattern: filenameFor("com.samsung.health.weight"),
    requiredFields: ["weight", "body_fat", "skeletal_muscle_mass", "height", "start_time"],
  },
  reader: READER,
  timezone: "utc",
  zoneOffset: { path: "time_offset", transforms: [] },
  timestamp: { path: "start_time", format: "iso", transforms: [] },
  emit: [
    {
      type: "body_mass",
      typeMeta: meta({
        label: "Weight",
        unit: "kg",
        aggregation: "last",
        category: "body",
      }),
      value: { path: "weight", transforms: [{ op: "toNumber" }, { op: "round", decimals: 2 }] },
      externalId: { path: "datauuid", transforms: [] },
      skipWhen: { path: "weight", is: "emptyOrZero" },
    },
    {
      type: "body_fat_pct",
      typeMeta: meta({
        label: "Body fat",
        unit: "%",
        aggregation: "last",
        polarity: -1,
        category: "body",
      }),
      value: { path: "body_fat", transforms: [{ op: "toNumber" }, { op: "round", decimals: 2 }] },
      externalId: { path: "datauuid", transforms: [] },
      skipWhen: { path: "body_fat", is: "emptyOrZero" },
    },
    {
      type: "skeletal_muscle_mass",
      typeMeta: meta({
        label: "Skeletal muscle",
        unit: "kg",
        aggregation: "last",
        polarity: 1,
        category: "body",
      }),
      value: {
        path: "skeletal_muscle_mass",
        transforms: [{ op: "toNumber" }, { op: "round", decimals: 2 }],
      },
      externalId: { path: "datauuid", transforms: [] },
      skipWhen: { path: "skeletal_muscle_mass", is: "emptyOrZero" },
    },
    {
      type: "basal_metabolic_rate",
      typeMeta: meta({
        label: "Basal metabolic rate",
        unit: "kcal",
        aggregation: "last",
        category: "body",
      }),
      value: {
        path: "basal_metabolic_rate",
        transforms: [{ op: "toNumber" }, { op: "round", decimals: 0 }],
      },
      externalId: { path: "datauuid", transforms: [] },
      skipWhen: { path: "basal_metabolic_rate", is: "emptyOrZero" },
    },
  ],
};

const height: MappingSpec = {
  key: "samsung-health.height",
  name: "Samsung Health — height",
  provider: "Samsung Health",
  match: {
    filenamePattern: filenameFor("com.samsung.health.height"),
    requiredFields: ["height", "start_time", "datauuid"],
  },
  reader: READER,
  timezone: "utc",
  zoneOffset: { path: "time_offset", transforms: [] },
  timestamp: { path: "start_time", format: "iso", transforms: [] },
  emit: [
    {
      type: "body_height",
      typeMeta: meta({
        label: "Height",
        unit: "cm",
        aggregation: "last",
        category: "body",
        // A constant is not something to correlate anything against.
        correlatable: false,
      }),
      value: { path: "height", transforms: [{ op: "toNumber" }, { op: "round", decimals: 1 }] },
      externalId: { path: "datauuid", transforms: [] },
      skipWhen: { path: "height", is: "emptyOrZero" },
    },
  ],
};

/* -------------------------------------------------------------------------- */
/*  Workouts                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Samsung identifies activities by numeric code. Only the codes confirmed
 * against this export are named — 11007 is pinned by the `best_records` table,
 * which labels the same session `tracker.sport_cycling`. Anything else is
 * reported as "Other" with the raw code kept on the event, rather than guessed
 * at; the conversion is editable, so a code can be named once and for good.
 */
const EXERCISE_TYPES: Record<string, string> = {
  "0": "Other",
  "1001": "Walking",
  "1002": "Running",
  "11007": "Cycling",
};

const exercise: MappingSpec = {
  key: "samsung-health.exercise",
  name: "Samsung Health — workouts",
  provider: "Samsung Health",
  description:
    "One row per recorded workout: duration, distance, calories, mean and peak heart rate, and the activity type.",
  match: {
    filenamePattern: filenameFor("com.samsung.shealth.exercise"),
    requiredFields: [
      "com.samsung.health.exercise.exercise_type",
      "com.samsung.health.exercise.duration",
      "com.samsung.health.exercise.start_time",
    ],
  },
  reader: READER,
  timezone: "utc",
  zoneOffset: { path: "com.samsung.health.exercise.time_offset", transforms: [] },
  timestamp: { path: "com.samsung.health.exercise.start_time", format: "iso", transforms: [] },
  emit: [
    {
      type: "workout_duration",
      typeMeta: meta({
        label: "Workout time",
        unit: "min",
        valueKind: "duration",
        polarity: 1,
        category: "activity",
      }),
      // Milliseconds in the export.
      value: {
        path: "com.samsung.health.exercise.duration",
        transforms: [{ op: "toNumber" }, { op: "divide", by: 60000 }, { op: "round", decimals: 1 }],
      },
      duration: {
        path: "com.samsung.health.exercise.duration",
        transforms: [{ op: "toNumber" }, { op: "divide", by: 1000 }, { op: "round", decimals: 0 }],
      },
      endTimestamp: { path: "com.samsung.health.exercise.end_time", format: "iso", transforms: [] },
      externalId: { path: "com.samsung.health.exercise.datauuid", transforms: [] },
      skipWhen: { path: "com.samsung.health.exercise.duration", is: "emptyOrZero" },
    },
    {
      type: "workout_distance",
      typeMeta: meta({
        label: "Workout distance",
        unit: "km",
        polarity: 1,
        category: "activity",
      }),
      value: {
        path: "com.samsung.health.exercise.distance",
        transforms: [{ op: "toNumber" }, { op: "divide", by: 1000 }, { op: "round", decimals: 2 }],
      },
      externalId: { path: "com.samsung.health.exercise.datauuid", transforms: [] },
      skipWhen: { path: "com.samsung.health.exercise.distance", is: "emptyOrZero" },
    },
    {
      type: "workout_calories",
      typeMeta: meta({ label: "Workout calories", unit: "kcal", polarity: 1, category: "activity" }),
      value: {
        path: "com.samsung.health.exercise.calorie",
        transforms: [{ op: "toNumber" }, { op: "round", decimals: 0 }],
      },
      externalId: { path: "com.samsung.health.exercise.datauuid", transforms: [] },
      skipWhen: { path: "com.samsung.health.exercise.calorie", is: "emptyOrZero" },
    },
    {
      type: "workout_mean_heart_rate",
      typeMeta: meta({
        label: "Workout mean heart rate",
        unit: "bpm",
        aggregation: "avg",
        category: "activity",
      }),
      value: {
        path: "com.samsung.health.exercise.mean_heart_rate",
        transforms: [{ op: "toNumber" }, { op: "round", decimals: 0 }],
      },
      externalId: { path: "com.samsung.health.exercise.datauuid", transforms: [] },
      skipWhen: { path: "com.samsung.health.exercise.mean_heart_rate", is: "emptyOrZero" },
    },
    {
      type: "workout_type",
      typeMeta: meta({
        label: "Workout type",
        valueKind: "categorical",
        aggregation: "count",
        correlatable: false,
        category: "activity",
      }),
      valueText: {
        path: "com.samsung.health.exercise.exercise_type",
        transforms: [{ op: "map", table: EXERCISE_TYPES, fallback: "Other" }],
      },
      externalId: { path: "com.samsung.health.exercise.datauuid", transforms: [] },
      meta: {
        code: { path: "com.samsung.health.exercise.exercise_type", transforms: [] },
      },
      skipWhen: { path: "com.samsung.health.exercise.exercise_type", is: "empty" },
    },
  ],
};

/** The weather Samsung recorded at the start of a workout. */
const exerciseWeather: MappingSpec = {
  key: "samsung-health.exercise-weather",
  name: "Samsung Health — weather at workout",
  provider: "Samsung Health",
  description:
    "A spot weather observation taken when a workout began. Deliberately kept on its own keys rather than the daily weather.* series an API adapter fills, because one reading at 08:14 is not a day's summary.",
  match: {
    filenamePattern: filenameFor("com.samsung.shealth.exercise.weather"),
    requiredFields: ["temperature", "humidity", "wind_speed", "exercise_id", "start_time"],
  },
  reader: READER,
  timezone: "utc",
  zoneOffset: { path: "time_offset", transforms: [] },
  timestamp: { path: "start_time", format: "iso", transforms: [] },
  emit: [
    {
      type: "weather.temp_observed",
      typeMeta: meta({
        label: "Temperature at workout",
        unit: "°C",
        aggregation: "avg",
        category: "weather",
      }),
      value: { path: "temperature", transforms: [{ op: "toNumber" }, { op: "round", decimals: 1 }] },
      externalId: { path: "datauuid", transforms: [] },
      skipWhen: { path: "temperature", is: "empty" },
    },
    {
      type: "weather.humidity",
      typeMeta: meta({
        label: "Humidity at workout",
        unit: "%",
        aggregation: "avg",
        category: "weather",
      }),
      value: { path: "humidity", transforms: [{ op: "toNumber" }] },
      externalId: { path: "datauuid", transforms: [] },
      skipWhen: { path: "humidity", is: "emptyOrZero" },
    },
    {
      type: "weather.condition",
      typeMeta: meta({
        label: "Conditions at workout",
        valueKind: "categorical",
        aggregation: "count",
        correlatable: false,
        category: "weather",
      }),
      valueText: { path: "phrase", transforms: [{ op: "trim" }] },
      externalId: { path: "datauuid", transforms: [] },
      skipWhen: { path: "phrase", is: "empty" },
    },
  ],
};

/** Samsung's own composite daily wellbeing score. */
const vitalityScore: MappingSpec = {
  key: "samsung-health.vitality-score",
  name: "Samsung Health — energy score",
  provider: "Samsung Health",
  match: {
    filenamePattern: filenameFor("com.samsung.shealth.vitality_score"),
    requiredFields: ["total_score", "shr_score", "shrv_score", "day_time"],
  },
  reader: READER,
  timezone: "local",
  timestamp: { path: "day_time", format: "date", transforms: [] },
  emit: [
    {
      type: "vitality_score",
      typeMeta: meta({
        label: "Energy score",
        unit: "points",
        aggregation: "last",
        polarity: 1,
        category: "health",
      }),
      value: { path: "total_score", transforms: [{ op: "toNumber" }, { op: "round", decimals: 1 }] },
      externalId: { path: "day_time", transforms: [] },
      skipWhen: { path: "total_score", is: "emptyOrZero" },
    },
  ],
};

export const samsungHealthSpecs: MappingSpec[] = [
  activityDaySummary,
  caloriesBurned,
  sleep,
  sleepStage,
  heartRate,
  stress,
  oxygenSaturation,
  respiratoryRate,
  weight,
  height,
  exercise,
  exerciseWeather,
  vitalityScore,
];

/**
 * Tables that are recognised on purpose and deliberately not imported.
 *
 * A Samsung export is mostly bookkeeping — badges, goal history, service
 * status — plus a few tables whose numbers are already imported from a better
 * source. Without this list every one of them would be handed to the model to
 * write a conversion for, which costs a request each and produces series
 * nobody wants, or silently double-counts a year of steps.
 */
export const samsungHealthIgnored: { pattern: string; reason: string }[] = [
  {
    pattern: filenameFor("com.samsung.shealth.step_daily_trend"),
    reason: "Daily steps are imported from the activity day summary, which has one row per day rather than one per device.",
  },
  {
    pattern: filenameFor("com.samsung.shealth.tracker.pedometer_day_summary"),
    reason: "Duplicates the activity day summary once per device; importing it would multiply every day's step count.",
  },
  {
    pattern: filenameFor("com.samsung.shealth.tracker.pedometer_step_count"),
    reason: "Ten-minute step bins behind the daily totals already imported.",
  },
  {
    pattern: filenameFor("com.samsung.shealth.tracker.floors_day_summary"),
    reason: "Daily floors are imported from the activity day summary.",
  },
  {
    pattern: filenameFor("com.samsung.health.floors_climbed"),
    reason: "Individual flights behind the daily floor count already imported.",
  },
  {
    pattern: filenameFor("com.samsung.shealth.sleep_combined"),
    reason: "A view over the sleep sessions already imported.",
  },
  {
    pattern: filenameFor("com.samsung.health.hrv"),
    reason: "Carries no readings of its own — the values live in a separate binning_data file the export does not include.",
  },
  {
    pattern: filenameFor("com.samsung.health.movement"),
    reason: "Carries no readings of its own — the values live in a separate binning_data file the export does not include.",
  },
  {
    pattern: filenameFor("com.samsung.health.ecg"),
    reason: "ECG waveforms are stored as attached PDFs, not as a series.",
  },
  {
    pattern: filenameFor("com.samsung.shealth.stress.histogram"),
    reason: "A distribution of the stress readings already imported.",
  },
  {
    pattern: filenameFor("com.samsung.shealth.sleep_raw_data"),
    reason: "Raw sensor traces behind the sleep sessions already imported.",
  },
  // Settings, goals, awards and other bookkeeping: no measurements at all.
  {
    pattern:
      "(^|/)com\\.samsung\\.shealth\\.(badge|rewards|report|best_records|goal_history|activity\\.goal|sleep_goal|breathing|activity_level|insight\\.milestones|social\\.service_status|tracker\\.pedometer_recommendation|exercise\\.custom_exercise|exercise\\.recovery_heart_rate|exercise\\.periodization_training_program|exercise\\.periodization_training_schedule)\\.\\d+\\.csv$",
    reason: "Goals, awards and app settings rather than measurements.",
  },
];

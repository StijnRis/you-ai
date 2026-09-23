import type { MappingSpec } from "@/lib/mapping/spec";

/**
 * Conversions that ship with the app. These are the same shape as the ones the
 * model writes for unknown formats — they just happen to be hand-checked, so a
 * common export is right on the first try instead of being inferred.
 */

const appleHealth: MappingSpec = {
  key: "apple-health.records",
  name: "Apple Health — export.xml",
  provider: "Apple Health",
  description:
    "The Record elements of an Apple Health export. Every metric lives in the same element and is told apart by its `type` attribute, so each metric gets its own filtered emit.",
  match: {
    filenamePattern: "export.*\\.xml$",
    requiredFields: ["type", "startDate", "value"],
  },
  reader: { format: "xml", recordsPath: "HealthData.Record" },
  timezone: "local",
  timestamp: { path: "startDate", format: "iso", transforms: [] },
  emit: [
    {
      type: "steps",
      where: { path: "type", equals: "HKQuantityTypeIdentifierStepCount" },
      typeMeta: {
        label: "Steps",
        unit: "steps",
        valueKind: "numeric",
        aggregation: "sum",
        polarity: 1,
        category: "activity",
        correlatable: true,
      },
      value: { path: "value", transforms: [{ op: "toNumber" }] },
      endTimestamp: { path: "endDate", format: "iso", transforms: [] },
      externalId: { coalesce: ["startDate"], transforms: [] },
      skipWhen: { path: "value", is: "notNumeric" },
    },
    {
      type: "active_energy",
      where: { path: "type", equals: "HKQuantityTypeIdentifierActiveEnergyBurned" },
      typeMeta: {
        label: "Active energy",
        unit: "kcal",
        valueKind: "numeric",
        aggregation: "sum",
        polarity: 1,
        category: "activity",
        correlatable: true,
      },
      value: { path: "value", transforms: [{ op: "toNumber" }] },
      skipWhen: { path: "value", is: "notNumeric" },
    },
    {
      type: "resting_heart_rate",
      where: { path: "type", equals: "HKQuantityTypeIdentifierRestingHeartRate" },
      typeMeta: {
        label: "Resting heart rate",
        unit: "bpm",
        valueKind: "numeric",
        aggregation: "avg",
        polarity: -1,
        category: "health",
        correlatable: true,
      },
      value: { path: "value", transforms: [{ op: "toNumber" }] },
      skipWhen: { path: "value", is: "notNumeric" },
    },
    {
      type: "body_mass",
      where: { path: "type", equals: "HKQuantityTypeIdentifierBodyMass" },
      typeMeta: {
        label: "Weight",
        unit: "kg",
        valueKind: "numeric",
        aggregation: "last",
        polarity: 0,
        category: "health",
        correlatable: true,
      },
      value: { path: "value", transforms: [{ op: "toNumber" }] },
      skipWhen: { path: "value", is: "notNumeric" },
    },
    {
      type: "sleep_duration",
      where: { path: "type", equals: "HKCategoryTypeIdentifierSleepAnalysis" },
      typeMeta: {
        label: "Sleep",
        unit: "min",
        valueKind: "duration",
        aggregation: "sum",
        polarity: 1,
        category: "sleep",
        correlatable: true,
      },
      // Sleep records carry no numeric value — the duration is the span
      // between start and end, so derive minutes from the two timestamps.
      timestamp: { path: "startDate", format: "iso", transforms: [] },
      endTimestamp: { path: "endDate", format: "iso", transforms: [] },
      value: { const: 1, transforms: [] },
      meta: { stage: { path: "value", transforms: [] } },
    },
  ],
};

const googleFitDaily: MappingSpec = {
  key: "google-fit.daily-activity",
  name: "Google Fit — Daily activity metrics",
  provider: "Google Fit",
  description:
    "The per-day summary CSV from a Google Takeout of Fit. One row per calendar day, one column per metric.",
  match: {
    filenamePattern: "daily.?activity.?metrics.*\\.csv$",
    requiredFields: ["Date"],
  },
  reader: { format: "csv", delimiter: ",", header: true, skipLines: 0 },
  timezone: "local",
  timestamp: { path: "Date", format: "date", transforms: [] },
  emit: [
    {
      type: "steps",
      typeMeta: {
        label: "Steps",
        unit: "steps",
        valueKind: "numeric",
        aggregation: "sum",
        polarity: 1,
        category: "activity",
        correlatable: true,
      },
      value: { path: "Step count", transforms: [{ op: "toNumber" }] },
      skipWhen: { path: "Step count", is: "empty" },
    },
    {
      type: "move_minutes",
      typeMeta: {
        label: "Move minutes",
        unit: "min",
        valueKind: "duration",
        aggregation: "sum",
        polarity: 1,
        category: "activity",
        correlatable: true,
      },
      value: { path: "Move Minutes count", transforms: [{ op: "toNumber" }] },
      skipWhen: { path: "Move Minutes count", is: "empty" },
    },
    {
      type: "calories",
      typeMeta: {
        label: "Calories burned",
        unit: "kcal",
        valueKind: "numeric",
        aggregation: "sum",
        polarity: 0,
        category: "activity",
        correlatable: true,
      },
      value: { path: "Calories (kcal)", transforms: [{ op: "toNumber" }, { op: "round", decimals: 0 }] },
      skipWhen: { path: "Calories (kcal)", is: "empty" },
    },
    {
      type: "distance",
      typeMeta: {
        label: "Distance",
        unit: "km",
        valueKind: "numeric",
        aggregation: "sum",
        polarity: 1,
        category: "activity",
        correlatable: true,
      },
      // Takeout reports metres; the store keeps kilometres.
      value: {
        path: "Distance (m)",
        transforms: [{ op: "toNumber" }, { op: "divide", by: 1000 }, { op: "round", decimals: 2 }],
      },
      skipWhen: { path: "Distance (m)", is: "emptyOrZero" },
    },
    {
      type: "heart_points",
      typeMeta: {
        label: "Heart points",
        unit: "points",
        valueKind: "numeric",
        aggregation: "sum",
        polarity: 1,
        category: "activity",
        correlatable: true,
      },
      value: { path: "Heart Points", transforms: [{ op: "toNumber" }] },
      skipWhen: { path: "Heart Points", is: "empty" },
    },
  ],
};

const stravaActivities: MappingSpec = {
  key: "strava.activities",
  name: "Strava — activities.csv",
  provider: "Strava",
  description:
    "The activity index from a Strava bulk export. One row per workout, giving a duration, a distance and a categorical activity type.",
  match: {
    filenamePattern: "activities.*\\.csv$",
    requiredFields: ["Activity Date", "Activity Type"],
  },
  reader: { format: "csv", delimiter: ",", header: true, skipLines: 0 },
  timezone: "local",
  timestamp: { path: "Activity Date", format: "iso", transforms: [] },
  emit: [
    {
      type: "workout_duration",
      typeMeta: {
        label: "Workout time",
        unit: "min",
        valueKind: "duration",
        aggregation: "sum",
        polarity: 1,
        category: "activity",
        correlatable: true,
      },
      value: {
        path: "Elapsed Time",
        transforms: [{ op: "toNumber" }, { op: "divide", by: 60 }, { op: "round", decimals: 1 }],
      },
      duration: { path: "Elapsed Time", transforms: [{ op: "toNumber" }] },
      externalId: { path: "Activity ID", transforms: [] },
      meta: { name: { path: "Activity Name", transforms: [] } },
      skipWhen: { path: "Elapsed Time", is: "emptyOrZero" },
    },
    {
      type: "workout_distance",
      typeMeta: {
        label: "Workout distance",
        unit: "km",
        valueKind: "numeric",
        aggregation: "sum",
        polarity: 1,
        category: "activity",
        correlatable: true,
      },
      value: { path: "Distance", transforms: [{ op: "toNumber" }, { op: "round", decimals: 2 }] },
      externalId: { path: "Activity ID", transforms: [] },
      skipWhen: { path: "Distance", is: "emptyOrZero" },
    },
    {
      type: "workout_type",
      typeMeta: {
        label: "Workout type",
        valueKind: "categorical",
        aggregation: "count",
        polarity: 0,
        category: "activity",
        correlatable: false,
      },
      valueText: { path: "Activity Type", transforms: [{ op: "trim" }] },
      externalId: { path: "Activity ID", transforms: [] },
      skipWhen: { path: "Activity Type", is: "empty" },
    },
  ],
};

export const builtinSpecs: MappingSpec[] = [appleHealth, googleFitDaily, stravaActivities];

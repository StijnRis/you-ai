import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  eventTypes,
  experimentCheckins,
  experiments,
  type ExperimentEvaluation,
  type ExperimentSource,
} from "@/lib/db/schema";
import { getDailySeries } from "@/lib/db/queries";
import { localDateOf } from "@/lib/events/time";
import {
  analyzeExperiment,
  phaseOf,
  windowsFor,
  type ExperimentReport,
  type MetricMeta,
} from "@/lib/experiments/analyze";

/**
 * Persistence for experiments. Every function takes the user id and filters
 * on it, so an experiment id guessed from another account finds nothing.
 */

export type ExperimentRow = typeof experiments.$inferSelect;

export function todayFor(timezone: string): string {
  return localDateOf(new Date(), timezone);
}

export async function listExperiments(userId: string): Promise<ExperimentRow[]> {
  return db
    .select()
    .from(experiments)
    .where(eq(experiments.userId, userId))
    .orderBy(desc(experiments.startDate), desc(experiments.createdAt));
}

export async function getExperiment(userId: string, id: string): Promise<ExperimentRow | null> {
  if (!isUuid(id)) return null;
  const [row] = await db
    .select()
    .from(experiments)
    .where(and(eq(experiments.id, id), eq(experiments.userId, userId)))
    .limit(1);
  return row ?? null;
}

export type NewExperiment = {
  title: string;
  intervention: string;
  hypothesis: string;
  rationale?: string | null;
  sources?: ExperimentSource[];
  targetMetrics: string[];
  startDate: string;
  endDate: string;
  createdBy: "ai" | "user";
};

export async function createExperiment(userId: string, input: NewExperiment): Promise<ExperimentRow> {
  const [row] = await db
    .insert(experiments)
    .values({
      userId,
      title: input.title,
      intervention: input.intervention,
      hypothesis: input.hypothesis,
      rationale: input.rationale ?? null,
      sources: input.sources ?? [],
      targetMetrics: [...new Set(input.targetMetrics)],
      startDate: input.startDate,
      endDate: input.endDate,
      createdBy: input.createdBy,
    })
    .returning();
  return row;
}

export async function updateExperiment(
  userId: string,
  id: string,
  patch: Partial<Pick<ExperimentRow, "status" | "conclusion" | "endDate" | "targetMetrics">>,
): Promise<ExperimentRow | null> {
  if (!isUuid(id)) return null;
  const [row] = await db
    .update(experiments)
    .set(patch)
    .where(and(eq(experiments.id, id), eq(experiments.userId, userId)))
    .returning();
  return row ?? null;
}

/**
 * An experiment that has run its course and not been evaluated yet. This is
 * what the count on the Experiments tab is for: the whole point of running one
 * is reading the result, and without a nudge a finished experiment is simply
 * forgotten.
 */
export function awaitsEvaluation(
  row: Pick<ExperimentRow, "status" | "endDate" | "evaluation">,
  today: string,
): boolean {
  return row.status === "active" && today > row.endDate && row.evaluation === null;
}

/** How many finished experiments are waiting to be looked at. */
export async function countAwaitingEvaluation(
  userId: string,
  timezone: string,
): Promise<number> {
  const today = todayFor(timezone);
  const rows = await db
    .select({
      status: experiments.status,
      endDate: experiments.endDate,
      evaluation: experiments.evaluation,
    })
    .from(experiments)
    .where(and(eq(experiments.userId, userId), eq(experiments.status, "active")));

  return rows.filter((row) => awaitsEvaluation(row, today)).length;
}

export async function saveEvaluation(
  userId: string,
  id: string,
  evaluation: ExperimentEvaluation,
): Promise<ExperimentRow | null> {
  if (!isUuid(id)) return null;
  const [row] = await db
    .update(experiments)
    .set({ evaluation, evaluatedAt: new Date() })
    .where(and(eq(experiments.id, id), eq(experiments.userId, userId)))
    .returning();
  return row ?? null;
}

export type ExperimentAction = "end_now" | "abandon" | "conclude";

/**
 * The state changes a person (or the model on their behalf) can make. Ending
 * early only ever pulls the end date in, and ending one that has not started
 * yet abandons it — an end date before the start would make no sense.
 */
export async function changeExperiment(
  user: { userId: string; timezone: string },
  id: string,
  action: ExperimentAction,
  conclusion?: string | null,
): Promise<ExperimentRow | null> {
  const experiment = await getExperiment(user.userId, id);
  if (!experiment) return null;

  if (action === "conclude") {
    return updateExperiment(user.userId, id, { conclusion: conclusion?.trim() || null });
  }
  const today = todayFor(user.timezone);
  if (action === "abandon" || today < experiment.startDate) {
    return updateExperiment(user.userId, id, { status: "abandoned" });
  }
  if (today < experiment.endDate) return updateExperiment(user.userId, id, { endDate: today });
  return experiment;
}

export async function deleteExperiment(userId: string, id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  const rows = await db
    .delete(experiments)
    .where(and(eq(experiments.id, id), eq(experiments.userId, userId)))
    .returning({ id: experiments.id });
  return rows.length > 0;
}

export async function listCheckins(experimentId: string) {
  return db
    .select()
    .from(experimentCheckins)
    .where(eq(experimentCheckins.experimentId, experimentId))
    .orderBy(asc(experimentCheckins.localDate));
}

/** Record (or overwrite) whether the intervention happened on a given day. */
export async function setCheckin(
  userId: string,
  experimentId: string,
  localDate: string,
  done: boolean,
  note?: string | null,
): Promise<"saved" | "not_found" | "outside_window"> {
  const experiment = await getExperiment(userId, experimentId);
  if (!experiment) return "not_found";
  if (localDate < experiment.startDate || localDate > experiment.endDate) return "outside_window";

  await db
    .insert(experimentCheckins)
    .values({ experimentId, localDate, done, note: note ?? null })
    .onConflictDoUpdate({
      target: [experimentCheckins.experimentId, experimentCheckins.localDate],
      set: { done, note: note ?? null },
    });
  return "saved";
}

export type ExperimentWithReport = {
  experiment: ExperimentRow;
  phase: ReturnType<typeof phaseOf>;
  today: string;
  checkins: Awaited<ReturnType<typeof listCheckins>>;
  report: ExperimentReport;
};

/** Everything the detail page and the model's analysis tool need, in one call. */
export async function getExperimentReport(
  userId: string,
  id: string,
  timezone: string,
): Promise<ExperimentWithReport | null> {
  const experiment = await getExperiment(userId, id);
  if (!experiment) return null;

  const today = todayFor(timezone);
  const windows = windowsFor(experiment, today);
  const to = windows.after?.to ?? windows.during?.to ?? windows.baseline.to;

  const [series, checkins, meta] = await Promise.all([
    experiment.targetMetrics.length
      ? getDailySeries(userId, { typeKeys: experiment.targetMetrics, from: windows.baseline.from, to })
      : Promise.resolve([]),
    listCheckins(experiment.id),
    metricMeta(experiment.targetMetrics),
  ]);

  const report = analyzeExperiment({
    experiment,
    today,
    series,
    meta,
    targetMetrics: experiment.targetMetrics,
    doneDates: new Set(checkins.filter((c) => c.done).map((c) => c.localDate)),
  });

  return { experiment, phase: phaseOf(experiment, today), today, checkins, report };
}

async function metricMeta(keys: string[]): Promise<Map<string, MetricMeta>> {
  if (keys.length === 0) return new Map();
  const rows = await db
    .select({
      key: eventTypes.key,
      label: eventTypes.label,
      unit: eventTypes.unit,
      polarity: eventTypes.polarity,
    })
    .from(eventTypes)
    .where(inArray(eventTypes.key, keys));
  return new Map(rows.map((row) => [row.key, row]));
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

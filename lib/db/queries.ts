import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  dailyMetrics,
  eventTypes,
  events,
  imports,
  mappingSpecs,
  sources,
  specFingerprints,
} from "@/lib/db/schema";
import type { DailySeries } from "@/lib/stats/correlate";

export type EventTypeRow = typeof eventTypes.$inferSelect;

export async function listEventTypes(): Promise<EventTypeRow[]> {
  return db.select().from(eventTypes).orderBy(asc(eventTypes.category), asc(eventTypes.label));
}

/**
 * Pull daily series for the correlation engine. One query for every metric,
 * turned into per-metric maps here rather than looping queries per type.
 */
export async function getDailySeries(
  userId: string,
  options: { typeKeys?: string[]; from?: string; to?: string } = {},
): Promise<DailySeries[]> {
  const filters = [eq(dailyMetrics.userId, userId)];
  if (options.typeKeys?.length) filters.push(inArray(dailyMetrics.typeKey, options.typeKeys));
  if (options.from) filters.push(gte(dailyMetrics.localDate, options.from));
  if (options.to) filters.push(lte(dailyMetrics.localDate, options.to));

  const rows = await db
    .select({
      typeKey: dailyMetrics.typeKey,
      localDate: dailyMetrics.localDate,
      value: dailyMetrics.value,
    })
    .from(dailyMetrics)
    .where(and(...filters))
    .orderBy(asc(dailyMetrics.localDate));

  const byType = new Map<string, DailySeries>();
  for (const row of rows) {
    let series = byType.get(row.typeKey);
    if (!series) {
      series = { typeKey: row.typeKey, points: new Map() };
      byType.set(row.typeKey, series);
    }
    series.points.set(row.localDate, row.value);
  }
  return [...byType.values()];
}

export type MetricOverview = EventTypeRow & {
  days: number;
  firstDate: string | null;
  lastDate: string | null;
  latestValue: number | null;
  average: number | null;
};

/** Everything the dashboard and the model's `list_metrics` tool need. */
export async function getMetricOverview(userId: string): Promise<MetricOverview[]> {
  const rows = await db
    .select({
      type: eventTypes,
      days: sql<number>`count(${dailyMetrics.localDate})::int`,
      firstDate: sql<string | null>`min(${dailyMetrics.localDate})::text`,
      lastDate: sql<string | null>`max(${dailyMetrics.localDate})::text`,
      average: sql<number | null>`avg(${dailyMetrics.value})`,
      latestValue: sql<number | null>`(array_agg(${dailyMetrics.value} order by ${dailyMetrics.localDate} desc))[1]`,
    })
    .from(dailyMetrics)
    .innerJoin(eventTypes, eq(eventTypes.key, dailyMetrics.typeKey))
    .where(eq(dailyMetrics.userId, userId))
    .groupBy(eventTypes.key)
    .orderBy(desc(sql`count(${dailyMetrics.localDate})`));

  return rows.map((row) => ({
    ...row.type,
    days: row.days,
    firstDate: row.firstDate,
    lastDate: row.lastDate,
    latestValue: row.latestValue,
    average: row.average,
  }));
}

/** Overall span of a user's data, for defaulting date ranges. */
export async function getDataRange(
  userId: string,
): Promise<{ from: string; to: string; days: number } | null> {
  const [row] = await db
    .select({
      from: sql<string | null>`min(${dailyMetrics.localDate})::text`,
      to: sql<string | null>`max(${dailyMetrics.localDate})::text`,
      days: sql<number>`count(distinct ${dailyMetrics.localDate})::int`,
    })
    .from(dailyMetrics)
    .where(eq(dailyMetrics.userId, userId));

  if (!row?.from || !row.to) return null;
  return { from: row.from, to: row.to, days: row.days };
}

export async function listSources(userId: string) {
  const [rows, counts] = await Promise.all([
    db.select().from(sources).where(eq(sources.userId, userId)).orderBy(desc(sources.createdAt)),
    getEventCounts(userId),
  ]);
  const bySource = new Map<string, number>();
  for (const count of counts) {
    if (count.sourceId) bySource.set(count.sourceId, (bySource.get(count.sourceId) ?? 0) + count.events);
  }
  return rows.map((row) => ({ ...row, eventCount: bySource.get(row.id) ?? 0 }));
}

/** Event counts per metric per source — the raw material of the Data page. */
export async function getEventCounts(userId: string) {
  return db
    .select({
      typeKey: events.typeKey,
      sourceId: events.sourceId,
      events: sql<number>`count(*)::int`,
    })
    .from(events)
    .where(eq(events.userId, userId))
    .groupBy(events.typeKey, events.sourceId);
}

export async function listImports(userId: string, limit = 50) {
  return db
    .select({
      id: imports.id,
      filename: imports.filename,
      byteSize: imports.byteSize,
      status: imports.status,
      matchKind: imports.matchKind,
      stats: imports.stats,
      error: imports.error,
      createdAt: imports.createdAt,
      specName: mappingSpecs.name,
      specKey: mappingSpecs.key,
      specId: mappingSpecs.id,
    })
    .from(imports)
    .leftJoin(mappingSpecs, eq(mappingSpecs.id, imports.mappingSpecId))
    .where(eq(imports.userId, userId))
    .orderBy(desc(imports.createdAt))
    .limit(limit);
}

/** Built-in conversions plus the ones this user's imports have produced. */
export async function listMappingSpecs(userId: string) {
  return db
    .select()
    .from(mappingSpecs)
    .where(sql`${mappingSpecs.userId} is null or ${mappingSpecs.userId} = ${userId}`)
    .orderBy(asc(mappingSpecs.provider), asc(mappingSpecs.name));
}

export async function getMappingSpec(userId: string, id: string) {
  const [row] = await db
    .select()
    .from(mappingSpecs)
    .where(
      and(
        eq(mappingSpecs.id, id),
        sql`${mappingSpecs.userId} is null or ${mappingSpecs.userId} = ${userId}`,
      ),
    )
    .limit(1);
  return row ?? null;
}

/** The file shapes a conversion has proved it can handle. */
export async function getSpecFingerprints(specId: string) {
  return db
    .select({ fingerprint: specFingerprints.fingerprint, createdAt: specFingerprints.createdAt })
    .from(specFingerprints)
    .where(eq(specFingerprints.specId, specId))
    .orderBy(asc(specFingerprints.createdAt));
}

/** Raw events for a window — what the chat reaches for when a day looks odd. */
export async function listEvents(
  userId: string,
  options: { typeKeys?: string[]; from?: string; to?: string; limit?: number },
) {
  const filters = [eq(events.userId, userId)];
  if (options.typeKeys?.length) filters.push(inArray(events.typeKey, options.typeKeys));
  if (options.from) filters.push(gte(events.localDate, options.from));
  if (options.to) filters.push(lte(events.localDate, options.to));

  return db
    .select({
      typeKey: events.typeKey,
      startedAt: events.startedAt,
      localDate: events.localDate,
      value: events.value,
      valueText: events.valueText,
      durationS: events.durationS,
      meta: events.meta,
    })
    .from(events)
    .where(and(...filters))
    .orderBy(desc(events.startedAt))
    .limit(Math.min(options.limit ?? 100, 500));
}

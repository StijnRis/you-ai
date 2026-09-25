import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import {
  db,
  dailyMetrics,
  eventTypes,
  events,
  imports,
  mappingSpecs,
  sources,
  specFingerprints,
} from "@youai/db";
import type { DailySeries } from "../stats/correlate";
import type { MappingSpec } from "../mapping/spec";

export type EventTypeRow = typeof eventTypes.$inferSelect;

export async function listEventTypes(): Promise<EventTypeRow[]> {
  return db.select().from(eventTypes).orderBy(asc(eventTypes.category), asc(eventTypes.label));
}

/**
 * Pull daily series for the correlation engine. One query for every metric,
 * turned into per-metric maps here rather than looping queries per type.
 */
export async function getDailySeries(
  options: { typeKeys?: string[]; from?: string; to?: string } = {},
): Promise<DailySeries[]> {
  const filters = [];
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
    .where(filters.length ? and(...filters) : undefined)
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
export async function getMetricOverview(): Promise<MetricOverview[]> {
  const rows = await db
    .select({
      type: eventTypes,
      days: sql<number>`count(${dailyMetrics.localDate})`,
      firstDate: sql<string | null>`min(${dailyMetrics.localDate})`,
      lastDate: sql<string | null>`max(${dailyMetrics.localDate})`,
      average: sql<number | null>`avg(${dailyMetrics.value})`,
      // SQLite has no array_agg: pick the value on the latest day with a correlated subquery.
      latestValue: sql<number | null>`(
        select d2.value from daily_metrics d2
        where d2.type_key = ${eventTypes.key}
        order by d2.local_date desc limit 1
      )`,
    })
    .from(dailyMetrics)
    .innerJoin(eventTypes, eq(eventTypes.key, dailyMetrics.typeKey))
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

/** Overall span of the data, for defaulting date ranges. */
export async function getDataRange(): Promise<{ from: string; to: string; days: number } | null> {
  const [row] = await db
    .select({
      from: sql<string | null>`min(${dailyMetrics.localDate})`,
      to: sql<string | null>`max(${dailyMetrics.localDate})`,
      days: sql<number>`count(distinct ${dailyMetrics.localDate})`,
    })
    .from(dailyMetrics);

  if (!row?.from || !row.to) return null;
  return { from: row.from, to: row.to, days: row.days };
}

export async function listSources() {
  const [rows, counts] = await Promise.all([
    db.select().from(sources).orderBy(desc(sources.createdAt)),
    getEventCounts(),
  ]);
  const bySource = new Map<string, number>();
  for (const count of counts) {
    if (count.sourceId) bySource.set(count.sourceId, (bySource.get(count.sourceId) ?? 0) + count.events);
  }
  return rows.map((row) => ({ ...row, eventCount: bySource.get(row.id) ?? 0 }));
}

/** Event counts per metric per source — the raw material of the Data page. */
export async function getEventCounts() {
  return db
    .select({
      typeKey: events.typeKey,
      sourceId: events.sourceId,
      events: sql<number>`count(*)`,
    })
    .from(events)
    .groupBy(events.typeKey, events.sourceId);
}

export async function listImports(limit = 50) {
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
    .orderBy(desc(imports.createdAt))
    .limit(limit);
}

export type MappingSpecRow = Omit<typeof mappingSpecs.$inferSelect, "spec"> & { spec: MappingSpec };

/** Built-in conversions plus the ones imports on this device have produced. */
export async function listMappingSpecs(): Promise<MappingSpecRow[]> {
  const rows = await db
    .select()
    .from(mappingSpecs)
    .orderBy(asc(mappingSpecs.provider), asc(mappingSpecs.name));
  return rows as MappingSpecRow[];
}

export async function getMappingSpec(id: string): Promise<MappingSpecRow | null> {
  const [row] = await db.select().from(mappingSpecs).where(eq(mappingSpecs.id, id)).limit(1);
  return (row as MappingSpecRow | undefined) ?? null;
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
export async function listEvents(options: {
  typeKeys?: string[];
  from?: string;
  to?: string;
  limit?: number;
}) {
  const filters = [];
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
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(events.startedAt))
    .limit(Math.min(options.limit ?? 100, 500));
}

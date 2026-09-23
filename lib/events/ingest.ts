import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { events, eventTypes } from "@/lib/db/schema";
import type { NormalizedEvent } from "@/lib/mapping/apply";
import type { TypeMeta } from "@/lib/mapping/spec";

export type IngestResult = {
  inserted: number;
  typesRegistered: number;
  daysTouched: number;
  dateRange: { from: string; to: string } | null;
};

const CHUNK = 1000;

/**
 * Write events into the store and refresh the affected days of the rollup.
 *
 * Idempotent by `dedupeKey`: re-importing an overlapping export updates the
 * rows it already wrote rather than doubling every number.
 */
export async function ingestEvents(
  userId: string,
  incoming: NormalizedEvent[],
  options: { sourceId?: string | null; types?: Map<string, TypeMeta> } = {},
): Promise<IngestResult> {
  if (incoming.length === 0) {
    return { inserted: 0, typesRegistered: 0, daysTouched: 0, dateRange: null };
  }

  const typesRegistered = await registerTypes(options.types, incoming);
  const deduped = dedupe(incoming);

  let inserted = 0;
  for (let i = 0; i < deduped.length; i += CHUNK) {
    const chunk = deduped.slice(i, i + CHUNK);
    const rows = await db
      .insert(events)
      .values(
        chunk.map((event) => ({
          userId,
          typeKey: event.typeKey,
          startedAt: event.startedAt,
          endedAt: event.endedAt,
          durationS: event.durationS,
          value: event.value,
          valueText: event.valueText,
          localDate: event.localDate,
          meta: event.meta,
          sourceId: options.sourceId ?? null,
          dedupeKey: event.dedupeKey,
        })),
      )
      .onConflictDoUpdate({
        target: [events.userId, events.dedupeKey],
        set: {
          value: sql`excluded.value`,
          valueText: sql`excluded.value_text`,
          endedAt: sql`excluded.ended_at`,
          durationS: sql`excluded.duration_s`,
          localDate: sql`excluded.local_date`,
          meta: sql`excluded.meta`,
          sourceId: sql`excluded.source_id`,
          ingestedAt: sql`now()`,
        },
      })
      .returning({ id: events.id });
    inserted += rows.length;
  }

  const days = [...new Set(deduped.map((event) => event.localDate))].sort();
  await refreshDailyMetrics(userId, days);

  return {
    inserted,
    typesRegistered,
    daysTouched: days.length,
    dateRange: days.length ? { from: days[0], to: days[days.length - 1] } : null,
  };
}

/**
 * Two rows of the same export can collapse onto one dedupeKey. Postgres rejects
 * an ON CONFLICT batch that conflicts with itself, so settle it here — last one
 * wins, matching what a second import would do.
 */
function dedupe(incoming: NormalizedEvent[]): NormalizedEvent[] {
  const byKey = new Map<string, NormalizedEvent>();
  for (const event of incoming) byKey.set(event.dedupeKey, event);
  return [...byKey.values()];
}

/**
 * Make sure every type referenced by these events exists. Metadata from a spec
 * fills in real labels and units; anything else gets a readable placeholder so
 * the foreign key holds and the UI has something to show.
 */
async function registerTypes(
  declared: Map<string, TypeMeta> | undefined,
  incoming: NormalizedEvent[],
): Promise<number> {
  const keys = new Set(incoming.map((event) => event.typeKey));
  if (keys.size === 0) return 0;

  const values = [...keys].map((key) => {
    const meta = declared?.get(key);
    return {
      key,
      label: meta?.label ?? humanize(key),
      description: meta?.description ?? null,
      unit: meta?.unit ?? null,
      valueKind: meta?.valueKind ?? ("numeric" as const),
      aggregation: meta?.aggregation ?? ("sum" as const),
      polarity: meta?.polarity ?? 0,
      category: meta?.category ?? null,
      correlatable: meta?.correlatable ?? true,
    };
  });

  // Existing types keep their settings: a user may have corrected a label or
  // aggregation, and a later import must not silently revert that.
  const rows = await db
    .insert(eventTypes)
    .values(values)
    .onConflictDoNothing({ target: eventTypes.key })
    .returning({ key: eventTypes.key });

  return rows.length;
}

function humanize(key: string): string {
  const last = key.split(".").pop() ?? key;
  return last.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

/**
 * Recompute the daily rollup for specific days, collapsing each day's events
 * with that type's own aggregation rule.
 */
export async function refreshDailyMetrics(userId: string, days: string[]): Promise<void> {
  const safe = days.filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(day));
  if (safe.length === 0) return;

  for (let i = 0; i < safe.length; i += 500) {
    const batch = safe.slice(i, i + 500);
    const dayList = sql.raw(batch.map((day) => `'${day}'::date`).join(","));
    await db.execute(sql`
      insert into daily_metrics (user_id, local_date, type_key, value, sample_count, updated_at)
      select * from (${rollupSelect(userId, sql`and e.local_date in (${dayList})`)}) as rollup
      where rollup.value is not null
      on conflict (user_id, local_date, type_key) do update
        set value = excluded.value,
            sample_count = excluded.sample_count,
            updated_at = now()
    `);
  }
}

/** Rebuild the entire rollup for a user — used after a conversion is edited. */
export async function rebuildAllDailyMetrics(userId: string): Promise<void> {
  await db.execute(sql`delete from daily_metrics where user_id = ${userId}`);
  await db.execute(sql`
    insert into daily_metrics (user_id, local_date, type_key, value, sample_count, updated_at)
    select * from (${rollupSelect(userId, sql``)}) as rollup
    where rollup.value is not null
  `);
}

/**
 * The aggregation itself. Each type carries its own rule, so the CASE picks the
 * right collapse per series in a single pass rather than one query per metric.
 */
function rollupSelect(userId: string, dayFilter: ReturnType<typeof sql>) {
  return sql`
    select
      e.user_id,
      e.local_date,
      e.type_key,
      case t.aggregation
        when 'sum'   then sum(e.value)
        when 'avg'   then avg(e.value)
        when 'min'   then min(e.value)
        when 'max'   then max(e.value)
        when 'count' then count(e.id)::double precision
        when 'last'  then (array_agg(e.value order by e.started_at desc))[1]
      end as value,
      count(e.id)::int as sample_count,
      now() as updated_at
    from events e
    join event_types t on t.key = e.type_key
    where e.user_id = ${userId}
      and (e.value is not null or t.aggregation = 'count')
      ${dayFilter}
    group by e.user_id, e.local_date, e.type_key, t.aggregation
  `;
}

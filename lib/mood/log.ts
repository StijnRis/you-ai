import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { events } from "@/lib/db/schema";
import { ingestEvents } from "@/lib/events/ingest";
import { localDateOf } from "@/lib/events/time";
import { MOOD_MAX, MOOD_MIN, MOOD_TYPE_KEY, MOOD_TYPE_META } from "@/lib/mood/types";

export type MoodEntry = {
  id: string;
  value: number;
  note: string | null;
  startedAt: Date;
  localDate: string;
  manual: boolean;
};

/**
 * Record one manual check-in.
 *
 * Goes through the same ingest path as an adapter, so a hand-logged mood and a
 * synced one are the same kind of row and land in the same daily rollup. The
 * dedupe key is minute-resolution: logging twice in the same minute corrects
 * the entry, while a second check-in later in the day is its own reading and
 * the type's `avg` aggregation blends them.
 */
export async function logMood(params: {
  userId: string;
  timezone: string;
  value: number;
  note?: string | null;
  at?: Date;
}): Promise<{ localDate: string; value: number }> {
  const value = Math.round(clamp(params.value, MOOD_MIN, MOOD_MAX) * 10) / 10;
  const at = params.at ?? new Date();
  const localDate = localDateOf(at, params.timezone);
  const minute = at.toISOString().slice(0, 16);

  await ingestEvents(
    params.userId,
    [
      {
        typeKey: MOOD_TYPE_KEY,
        startedAt: at,
        endedAt: null,
        durationS: null,
        value,
        valueText: null,
        localDate,
        meta: { manual: true, ...(params.note ? { note: params.note } : {}) },
        dedupeKey: `manual:${MOOD_TYPE_KEY}:${minute}`,
      },
    ],
    { types: new Map([[MOOD_TYPE_KEY, MOOD_TYPE_META]]) },
  );

  return { localDate, value };
}

/** Most recent check-ins, newest first — manual and synced alike. */
export async function recentMoodEntries(userId: string, limit = 10): Promise<MoodEntry[]> {
  const rows = await db
    .select({
      id: events.id,
      value: events.value,
      startedAt: events.startedAt,
      localDate: events.localDate,
      meta: events.meta,
    })
    .from(events)
    .where(and(eq(events.userId, userId), eq(events.typeKey, MOOD_TYPE_KEY)))
    .orderBy(desc(events.startedAt))
    .limit(limit);

  return rows
    .filter((row): row is typeof row & { value: number } => row.value !== null)
    .map((row) => ({
      id: row.id,
      value: row.value,
      note: typeof row.meta.note === "string" ? row.meta.note : null,
      startedAt: row.startedAt,
      localDate: row.localDate,
      manual: row.meta.manual === true,
    }));
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

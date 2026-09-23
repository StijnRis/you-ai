import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { sources } from "@/lib/db/schema";
import { getAdapter } from "@/lib/adapters";
import { ingestEvents } from "@/lib/events/ingest";
import { shiftLocalDate } from "@/lib/events/time";
import { localDateOf } from "@/lib/events/time";
import type { TypeMeta } from "@/lib/mapping/spec";

export type SyncResult = {
  sourceId: string;
  provider: string;
  from: string;
  to: string;
  eventsStored: number;
  daysTouched: number;
};

/**
 * Pull a window from a live API source and put it through the same ingest path
 * an import uses. Defaults to a backfill on first sync and a short catch-up
 * window afterwards, since providers revise recent days.
 */
export async function syncSource(params: {
  userId: string;
  timezone: string;
  sourceId: string;
  from?: string;
  to?: string;
}): Promise<SyncResult> {
  const [source] = await db
    .select()
    .from(sources)
    .where(eq(sources.id, params.sourceId))
    .limit(1);

  if (!source || source.userId !== params.userId) throw new Error("Source not found.");
  if (source.kind !== "api") throw new Error("This source is a data import, not a live API.");

  const adapter = getAdapter(source.provider);
  if (!adapter) throw new Error(`No adapter registered for "${source.provider}".`);

  const today = localDateOf(new Date(), params.timezone);
  const to = params.to ?? today;
  const from =
    params.from ??
    // First sync backfills a year so there is something to correlate against
    // straight away; later syncs only revisit the last fortnight.
    (source.lastSyncAt ? shiftLocalDate(to, -14) : shiftLocalDate(to, -365));

  try {
    const config = adapter.validateConfig(source.config);
    const fetched = await adapter.fetch({ config, from, to, timezone: params.timezone });
    const events = Array.isArray(fetched) ? fetched : fetched.events;
    const label = Array.isArray(fetched) ? undefined : fetched.label;

    const types = new Map<string, TypeMeta>(Object.entries(adapter.types));
    const ingested = await ingestEvents(params.userId, events, {
      sourceId: source.id,
      types,
    });

    await db
      .update(sources)
      .set({ lastSyncAt: new Date(), lastSyncError: null, ...(label ? { label } : {}) })
      .where(eq(sources.id, source.id));

    return {
      sourceId: source.id,
      provider: source.provider,
      from,
      to,
      eventsStored: ingested.inserted,
      daysTouched: ingested.daysTouched,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db
      .update(sources)
      .set({ lastSyncError: message })
      .where(eq(sources.id, source.id));
    throw error;
  }
}

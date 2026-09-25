import { eq } from "drizzle-orm";
import { db, events, sources } from "@youai/db";
import { getAdapter } from "./index";
import { syncSource, type SyncResult } from "./sync";
import { listSources } from "../db/queries";
import { rebuildAllDailyMetrics } from "../events/ingest";

/**
 * Connecting, reconfiguring and disconnecting live API sources — what the old
 * /api/sources routes did, now called directly by the app.
 */

export type SourceRow = typeof sources.$inferSelect;

export type SourceChange = {
  source: SourceRow;
  sync?: SyncResult;
  /** The source was saved, but the first pull failed (bad coordinate, provider blip). */
  syncError?: string;
};

export async function connectSource(params: {
  provider: string;
  label?: string;
  config: Record<string, unknown>;
  timezone: string;
  syncNow?: boolean;
}): Promise<SourceChange> {
  const adapter = getAdapter(params.provider);
  if (!adapter) throw new Error(`Unknown provider "${params.provider}".`);

  const existing = await listSources();
  if (!adapter.multiple && existing.some((s) => s.kind === "api" && s.provider === adapter.provider)) {
    throw new Error(`${adapter.label} is already connected.`);
  }

  const config = adapter.validateConfig(params.config as never) as Record<string, unknown>;
  const [created] = await db
    .insert(sources)
    .values({ kind: "api", provider: adapter.provider, label: params.label ?? adapter.label, config })
    .returning();

  if (params.syncNow === false) return { source: created };
  try {
    return { source: created, sync: await syncSource({ timezone: params.timezone, sourceId: created.id }) };
  } catch (error) {
    return { source: created, syncError: messageOf(error) };
  }
}

/**
 * Change a source's settings, e.g. a new location for the weather. Readings
 * from the old settings are dropped and the history is backfilled again, so
 * two places' weather never get averaged into one series.
 */
export async function reconfigureSource(params: {
  sourceId: string;
  config: unknown;
  label?: string;
  timezone: string;
}): Promise<SourceChange> {
  const [source] = await db.select().from(sources).where(eq(sources.id, params.sourceId)).limit(1);
  if (!source) throw new Error("Source not found.");
  const adapter = getAdapter(source.provider);
  if (!adapter) throw new Error("Unknown provider.");

  const config = adapter.validateConfig(params.config as never) as Record<string, unknown>;
  const [updated] = await db
    .update(sources)
    .set({ config, label: params.label || source.label, lastSyncAt: null, lastSyncError: null })
    .where(eq(sources.id, source.id))
    .returning();
  await db.delete(events).where(eq(events.sourceId, source.id));
  await rebuildAllDailyMetrics();

  try {
    return { source: updated, sync: await syncSource({ timezone: params.timezone, sourceId: source.id }) };
  } catch (error) {
    return { source: updated, syncError: messageOf(error) };
  }
}

/** Store fields on an existing source's config without resyncing, e.g. a fresh OAuth token. */
export async function patchSourceConfig(sourceId: string, patch: Record<string, unknown>) {
  const [source] = await db.select().from(sources).where(eq(sources.id, sourceId)).limit(1);
  if (!source) throw new Error("Source not found.");
  await db
    .update(sources)
    .set({ config: { ...source.config, ...patch }, lastSyncError: null })
    .where(eq(sources.id, sourceId));
}

/**
 * Sample data is made up, so it goes with its source. Real sources keep their
 * events and lose the link (`source_id` is ON DELETE SET NULL), so
 * disconnecting drops the credentials without throwing away history.
 */
export async function disconnectSource(sourceId: string): Promise<void> {
  const [source] = await db.select().from(sources).where(eq(sources.id, sourceId)).limit(1);
  if (!source) return;
  if (source.provider === "demo") {
    await db.delete(events).where(eq(events.sourceId, source.id));
  }
  await db.delete(sources).where(eq(sources.id, source.id));
  if (source.provider === "demo") await rebuildAllDailyMetrics();
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

import { and, eq } from "drizzle-orm";
import { getUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { events, sources } from "@/lib/db/schema";
import { rebuildAllDailyMetrics } from "@/lib/events/ingest";
import { getAdapter } from "@/lib/adapters";
import { syncSource } from "@/lib/adapters/sync";

export const maxDuration = 120;

/**
 * Change a source's settings, e.g. a new location for the weather. Readings
 * from the old settings are dropped and the history is backfilled again, so
 * two places' weather never get averaged into one series.
 */
export async function PATCH(request: Request, context: RouteContext<"/api/sources/[id]">) {
  const user = await getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as { config?: unknown; label?: string };

  const [source] = await db
    .select()
    .from(sources)
    .where(and(eq(sources.id, id), eq(sources.userId, user.id)))
    .limit(1);
  if (!source) return Response.json({ error: "Source not found." }, { status: 404 });

  const adapter = getAdapter(source.provider);
  if (!adapter) return Response.json({ error: "Unknown provider." }, { status: 400 });

  let config;
  try {
    config = adapter.validateConfig(body.config as never) as Record<string, unknown>;
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }

  await db
    .update(sources)
    .set({ config, label: body.label || source.label, lastSyncAt: null, lastSyncError: null })
    .where(eq(sources.id, source.id));
  await db.delete(events).where(and(eq(events.userId, user.id), eq(events.sourceId, source.id)));
  await rebuildAllDailyMetrics(user.id);

  try {
    const sync = await syncSource({ userId: user.id, timezone: user.timezone, sourceId: source.id });
    return Response.json({ sync });
  } catch (error) {
    return Response.json({ syncError: error instanceof Error ? error.message : String(error) }, { status: 207 });
  }
}

export async function DELETE(_request: Request, context: RouteContext<"/api/sources/[id]">) {
  const user = await getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { id } = await context.params;

  const [source] = await db
    .select()
    .from(sources)
    .where(and(eq(sources.id, id), eq(sources.userId, user.id)))
    .limit(1);
  if (!source) return Response.json({ error: "Source not found." }, { status: 404 });

  // Sample data is made up, so it goes with its source. Real sources keep
  // their events and lose the link (`source_id` is ON DELETE SET NULL), so
  // disconnecting drops the credentials without throwing away history you
  // have already correlated against.
  if (source.provider === "demo") {
    await db.delete(events).where(and(eq(events.userId, user.id), eq(events.sourceId, source.id)));
  }
  await db.delete(sources).where(eq(sources.id, source.id));
  if (source.provider === "demo") await rebuildAllDailyMetrics(user.id);

  return Response.json({ source });
}

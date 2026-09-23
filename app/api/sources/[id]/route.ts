import { and, eq } from "drizzle-orm";
import { getUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { events, sources } from "@/lib/db/schema";
import { rebuildAllDailyMetrics } from "@/lib/events/ingest";

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

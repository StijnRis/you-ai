import { and, eq } from "drizzle-orm";
import { getUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { sources } from "@/lib/db/schema";

export async function DELETE(_request: Request, context: RouteContext<"/api/sources/[id]">) {
  const user = await getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { id } = await context.params;

  // Events keep their rows and lose the link (`source_id` is ON DELETE SET
  // NULL), so disconnecting drops the credentials without throwing away
  // history you have already correlated against.
  const [deleted] = await db
    .delete(sources)
    .where(and(eq(sources.id, id), eq(sources.userId, user.id)))
    .returning();

  if (!deleted) return Response.json({ error: "Source not found." }, { status: 404 });

  return Response.json({ source: deleted });
}

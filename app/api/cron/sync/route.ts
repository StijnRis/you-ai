import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { sources, users } from "@/lib/db/schema";
import { syncSource } from "@/lib/adapters/sync";

export const maxDuration = 300;

/**
 * Nightly refresh of every live API source. Scheduled by Vercel Cron (see
 * vercel.json), which sends CRON_SECRET as a bearer token.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authorized =
    secret && request.headers.get("authorization") === `Bearer ${secret}`;

  if (!authorized) return new Response("Unauthorized", { status: 401 });

  const rows = await db
    .select({ source: sources, timezone: users.timezone })
    .from(sources)
    .innerJoin(users, eq(users.id, sources.userId))
    .where(eq(sources.kind, "api"));

  const results: unknown[] = [];
  for (const row of rows) {
    try {
      results.push(
        await syncSource({
          userId: row.source.userId,
          timezone: row.timezone,
          sourceId: row.source.id,
        }),
      );
    } catch (error) {
      // One user's bad config must not stop everyone else's sync.
      results.push({
        sourceId: row.source.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return Response.json({ synced: results.length, results });
}

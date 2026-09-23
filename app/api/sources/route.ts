import { z } from "zod";
import { getUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { sources } from "@/lib/db/schema";
import { getAdapter } from "@/lib/adapters";
import { listSources } from "@/lib/db/queries";
import { syncSource } from "@/lib/adapters/sync";

const createSchema = z.object({
  provider: z.string(),
  label: z.string().min(1).optional(),
  config: z.record(z.string(), z.unknown()),
  /** Pull data immediately rather than waiting for the nightly cron. */
  syncNow: z.boolean().default(true),
});

export async function GET() {
  const user = await getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  return Response.json({ sources: await listSources(user.id) });
}

export async function POST(request: Request) {
  const user = await getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const parsed = createSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: "Invalid source", issues: parsed.error.issues }, { status: 400 });
  }

  const adapter = getAdapter(parsed.data.provider);
  if (!adapter) {
    return Response.json({ error: `Unknown provider "${parsed.data.provider}".` }, { status: 400 });
  }

  const existing = await listSources(user.id);
  if (existing.some((source) => source.kind === "api" && source.provider === adapter.provider)) {
    return Response.json({ error: `${adapter.label} is already connected.` }, { status: 409 });
  }

  let config;
  try {
    config = adapter.validateConfig(parsed.data.config);
  } catch (error) {
    return Response.json({ error: messageOf(error) }, { status: 400 });
  }

  const [created] = await db
    .insert(sources)
    .values({
      userId: user.id,
      kind: "api",
      provider: adapter.provider,
      label: parsed.data.label ?? adapter.label,
      config: config as Record<string, unknown>,
    })
    .returning();

  if (!parsed.data.syncNow) return Response.json({ source: created });

  try {
    const result = await syncSource({
      userId: user.id,
      timezone: user.timezone,
      sourceId: created.id,
    });
    return Response.json({ source: created, sync: result });
  } catch (error) {
    // The source is still worth keeping — a failed first sync is usually a bad
    // coordinate or a provider blip, and retrying is one click.
    return Response.json({ source: created, syncError: messageOf(error) }, { status: 207 });
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

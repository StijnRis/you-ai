import { getUser } from "@/lib/auth";
import { mappingSpecSchema } from "@/lib/mapping/spec";
import { previewSpec, reapplyImport } from "@/lib/import/run";

export const maxDuration = 300;

/**
 * Re-run a stored upload with an edited conversion. `preview: true` computes
 * the result without writing anything, so a spec can be corrected and checked
 * before it touches the event store.
 */
export async function POST(request: Request, context: RouteContext<"/api/import/[id]/reapply">) {
  const user = await getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { id } = await context.params;
  const body = await request.json();
  const parsed = mappingSpecSchema.safeParse(body.spec);

  if (!parsed.success) {
    return Response.json(
      { error: "That conversion is not valid.", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    if (body.preview) {
      const result = await previewSpec({
        userId: user.id,
        timezone: user.timezone,
        importId: id,
        spec: parsed.data,
      });
      return Response.json({
        preview: result.events.slice(0, 25),
        recordsRead: result.recordsRead,
        skipped: result.skipped,
        errors: result.errors.slice(0, 10),
      });
    }

    const stats = await reapplyImport({
      userId: user.id,
      timezone: user.timezone,
      importId: id,
      spec: parsed.data,
    });
    return Response.json({ stats });
  } catch (error) {
    return Response.json({ error: messageOf(error) }, { status: 400 });
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

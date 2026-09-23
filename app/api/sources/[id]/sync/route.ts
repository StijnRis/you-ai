import { getUser } from "@/lib/auth";
import { syncSource } from "@/lib/adapters/sync";

export const maxDuration = 120;

export async function POST(request: Request, context: RouteContext<"/api/sources/[id]/sync">) {
  const user = await getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));

  try {
    const result = await syncSource({
      userId: user.id,
      timezone: user.timezone,
      sourceId: id,
      from: body.from,
      to: body.to,
    });
    return Response.json({ sync: result });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}

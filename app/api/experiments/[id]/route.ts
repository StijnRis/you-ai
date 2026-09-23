import { z } from "zod";
import { getUser } from "@/lib/auth";
import { changeExperiment, deleteExperiment } from "@/lib/experiments/store";

const patchSchema = z.object({
  action: z.enum(["end_now", "abandon", "conclude"]),
  conclusion: z.string().max(2000).optional(),
});

export async function PATCH(request: Request, context: RouteContext<"/api/experiments/[id]">) {
  const user = await getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Invalid change", issues: parsed.error.issues }, { status: 400 });
  }

  const { id } = await context.params;
  const row = await changeExperiment(
    { userId: user.id, timezone: user.timezone },
    id,
    parsed.data.action,
    parsed.data.conclusion,
  );
  if (!row) return Response.json({ error: "Experiment not found" }, { status: 404 });
  return Response.json({ experiment: row });
}

export async function DELETE(_request: Request, context: RouteContext<"/api/experiments/[id]">) {
  const user = await getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { id } = await context.params;
  const deleted = await deleteExperiment(user.id, id);
  if (!deleted) return Response.json({ error: "Experiment not found" }, { status: 404 });
  return Response.json({ deleted: true });
}

import { z } from "zod";
import { getUser } from "@/lib/auth";
import { setCheckin, todayFor } from "@/lib/experiments/store";

const checkinSchema = z.object({
  /** Defaults to today in the user's timezone, which is almost always what's meant. */
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  done: z.boolean(),
  note: z.string().max(500).optional(),
});

export async function POST(request: Request, context: RouteContext<"/api/experiments/[id]/checkin">) {
  const user = await getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const parsed = checkinSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Invalid check-in", issues: parsed.error.issues }, { status: 400 });
  }

  const today = todayFor(user.timezone);
  const date = parsed.data.date ?? today;
  if (date > today) {
    return Response.json({ error: "Cannot check in for a day that hasn't happened yet." }, { status: 400 });
  }

  const { id } = await context.params;
  const outcome = await setCheckin(user.id, id, date, parsed.data.done, parsed.data.note);
  if (outcome === "not_found") return Response.json({ error: "Experiment not found" }, { status: 404 });
  if (outcome === "outside_window") {
    return Response.json({ error: "That day is outside the experiment's dates." }, { status: 400 });
  }
  return Response.json({ date, done: parsed.data.done });
}

import { z } from "zod";
import { eq } from "drizzle-orm";
import { getUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { logMood } from "@/lib/mood/log";
import { MOOD_MAX, MOOD_MIN } from "@/lib/mood/types";

const logSchema = z.object({
  value: z.number().min(MOOD_MIN).max(MOOD_MAX),
  note: z.string().trim().max(280).optional(),
});

export async function POST(request: Request) {
  const user = await getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const parsed = logSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Mood must be a number from 1 to 10." }, { status: 400 });
  }

  const result = await logMood({
    userId: user.id,
    timezone: user.timezone,
    value: parsed.data.value,
    note: parsed.data.note || null,
  });

  return Response.json({ logged: result });
}

const prefsSchema = z.object({
  /** 0-23 in the user's own timezone, or null to switch the email off. */
  moodEmailHour: z.number().int().min(0).max(23).nullable(),
});

export async function PATCH(request: Request) {
  const user = await getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const parsed = prefsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Pick an hour from 0 to 23, or turn the email off." }, { status: 400 });
  }

  await db
    .update(users)
    .set({ moodEmailHour: parsed.data.moodEmailHour })
    .where(eq(users.id, user.id));

  return Response.json({ moodEmailHour: parsed.data.moodEmailHour });
}

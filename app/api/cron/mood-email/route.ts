import { isNotNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { localDateOf } from "@/lib/events/time";
import { renderMoodDigest } from "@/lib/email/mood-digest";
import { resendConfigured, sendEmail } from "@/lib/email/resend";
import { getMoodStats } from "@/lib/mood/stats";

export const maxDuration = 300;

/**
 * The daily mood email.
 *
 * Runs every hour (see vercel.json) and sends to the users whose chosen hour
 * has just arrived *in their own timezone* — that is what lets everyone pick
 * their own time off a single schedule. `mood_email_hour` being null means
 * they have turned it off.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authorized = secret && request.headers.get("authorization") === `Bearer ${secret}`;
  if (!authorized) return new Response("Unauthorized", { status: 401 });

  if (!resendConfigured()) {
    return Response.json({ skipped: "RESEND_API_KEY is not set." }, { status: 503 });
  }

  const now = new Date();
  const appUrl = process.env.APP_URL ?? "https://youai.nl";

  const candidates = await db
    .select({
      id: users.id,
      email: users.email,
      timezone: users.timezone,
      hour: users.moodEmailHour,
      disabledAt: users.disabledAt,
    })
    .from(users)
    .where(isNotNull(users.moodEmailHour));

  const sent: string[] = [];
  const failed: { userId: string; error: string }[] = [];
  let skipped = 0;

  for (const user of candidates) {
    if (!user.email || user.disabledAt || user.hour === null) {
      skipped += 1;
      continue;
    }
    if (localHourOf(now, user.timezone) !== user.hour) {
      skipped += 1;
      continue;
    }

    try {
      const today = localDateOf(now, user.timezone);
      const stats = await getMoodStats(user.id, today);
      const digest = renderMoodDigest({ stats, today, appUrl });

      await sendEmail({
        to: user.email,
        subject: digest.subject,
        html: digest.html,
        text: digest.text,
      });
      sent.push(user.id);
    } catch (error) {
      // One bad address must not stop the rest of the hour's batch.
      failed.push({
        userId: user.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return Response.json({ sent: sent.length, skipped, failed });
}

/** Hour 0-23 that `instant` falls on, as seen from `timeZone`. */
function localHourOf(instant: Date, timeZone: string): number {
  try {
    const hour = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      hour12: false,
    }).format(instant);
    return Number(hour) % 24;
  } catch {
    return instant.getUTCHours();
  }
}

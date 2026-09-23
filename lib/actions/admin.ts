"use server";

import { and, count, eq, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { accounts, dailyMetrics, events, imports, sources, users } from "@/lib/db/schema";
import { localDateOf } from "@/lib/events/time";
import { renderMoodDigest } from "@/lib/email/mood-digest";
import { resendConfigured, sendEmail } from "@/lib/email/resend";
import { getMoodStats } from "@/lib/mood/stats";
import { setSetting } from "@/lib/settings";
import { SETTINGS, SETTING_KEYS } from "@/lib/settings-def";
import type { ActionState } from "@/lib/actions/account";

/**
 * Admin actions.
 *
 * Every one re-checks `requireAdmin()` rather than trusting that the page that
 * rendered the button did — a server action is a public endpoint, and the only
 * thing standing between it and the internet is this call.
 */

export type AdminAccount = {
  id: string;
  name: string | null;
  email: string | null;
  role: "user" | "admin";
  image: string | null;
  timezone: string;
  disabledAt: Date | null;
  lastSeenAt: Date | null;
  createdAt: Date;
  hasPassword: boolean;
  providers: string[];
  eventCount: number;
  sourceCount: number;
  importCount: number;
};

/** Every account, with enough context to decide what to do about it. */
export async function listAccounts(): Promise<AdminAccount[]> {
  await requireAdmin();

  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      image: users.image,
      timezone: users.timezone,
      disabledAt: users.disabledAt,
      lastSeenAt: users.lastSeenAt,
      createdAt: users.createdAt,
      hasPassword: sql<boolean>`(${users.passwordHash} is not null)`,
      providers: sql<string[]>`coalesce(array_agg(distinct ${accounts.provider}) filter (where ${accounts.provider} is not null), '{}')`,
      eventCount: sql<number>`(select count(*) from ${events} where ${events.userId} = ${users.id})::int`,
      sourceCount: sql<number>`(select count(*) from ${sources} where ${sources.userId} = ${users.id})::int`,
      importCount: sql<number>`(select count(*) from ${imports} where ${imports.userId} = ${users.id})::int`,
    })
    .from(users)
    .leftJoin(accounts, eq(accounts.userId, users.id))
    .groupBy(users.id)
    .orderBy(sql`${users.createdAt} desc`);

  return rows.map((row) => ({
    ...row,
    providers: [...(row.providers ?? [])].filter(Boolean).sort(),
  }));
}

export type InstanceStats = {
  accounts: number;
  admins: number;
  disabled: number;
  events: number;
  metricDays: number;
  imports: number;
  sources: number;
};

export async function getInstanceStats(): Promise<InstanceStats> {
  await requireAdmin();

  const [[accountRow], [eventRow], [dayRow], [importRow], [sourceRow]] = await Promise.all([
    db
      .select({
        total: count(),
        admins: sql<number>`count(*) filter (where ${users.role} = 'admin')::int`,
        disabled: sql<number>`count(*) filter (where ${users.disabledAt} is not null)::int`,
      })
      .from(users),
    db.select({ total: count() }).from(events),
    db.select({ total: count() }).from(dailyMetrics),
    db.select({ total: count() }).from(imports),
    db.select({ total: count() }).from(sources),
  ]);

  return {
    accounts: accountRow?.total ?? 0,
    admins: accountRow?.admins ?? 0,
    disabled: accountRow?.disabled ?? 0,
    events: eventRow?.total ?? 0,
    metricDays: dayRow?.total ?? 0,
    imports: importRow?.total ?? 0,
    sources: sourceRow?.total ?? 0,
  };
}

/* -------------------------------------------------------------------------- */
/*  Mutations                                                                 */
/* -------------------------------------------------------------------------- */

/** Refuse to remove the last admin, whichever route is taken to do it. */
async function wouldOrphanInstance(targetId: string): Promise<boolean> {
  const [other] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "admin"), ne(users.id, targetId), sql`${users.disabledAt} is null`))
    .limit(1);
  return !other;
}

const idSchema = z.string().min(1);

export async function setRoleAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireAdmin();

  const id = idSchema.safeParse(formData.get("userId"));
  const role = z.enum(["user", "admin"]).safeParse(formData.get("role"));
  if (!id.success || !role.success) return { error: "Bad request." };

  const target = await db.query.users.findFirst({
    where: eq(users.id, id.data),
    columns: { role: true, email: true },
  });
  if (!target) return { error: "That account no longer exists." };

  if (role.data === "user" && target.role === "admin" && (await wouldOrphanInstance(id.data))) {
    return { error: "That is the last active admin — promote someone else first." };
  }
  if (id.data === admin.id && role.data === "user") {
    return { error: "Demoting yourself would lock you out of this page. Ask another admin." };
  }

  await db.update(users).set({ role: role.data }).where(eq(users.id, id.data));
  revalidatePath("/admin");
  return { success: `${target.email} is now ${role.data === "admin" ? "an admin" : "a regular user"}.` };
}

export async function setDisabledAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireAdmin();

  const id = idSchema.safeParse(formData.get("userId"));
  const disabled = formData.get("disabled") === "1";
  if (!id.success) return { error: "Bad request." };
  if (id.data === admin.id) return { error: "You cannot disable your own account." };

  const target = await db.query.users.findFirst({
    where: eq(users.id, id.data),
    columns: { email: true, role: true },
  });
  if (!target) return { error: "That account no longer exists." };

  if (disabled && target.role === "admin" && (await wouldOrphanInstance(id.data))) {
    return { error: "That is the last active admin — promote someone else first." };
  }

  await db
    .update(users)
    .set({ disabledAt: disabled ? new Date() : null })
    .where(eq(users.id, id.data));

  revalidatePath("/admin");
  return {
    success: disabled
      ? `${target.email} can no longer sign in. Their data is untouched.`
      : `${target.email} can sign in again.`,
  };
}

/**
 * Delete another account and everything it owns. The cascade on `user` takes
 * the events, daily metrics, sources, imports and inferred conversions with it.
 */
export async function deleteAccountAsAdminAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireAdmin();

  const id = idSchema.safeParse(formData.get("userId"));
  if (!id.success) return { error: "Bad request." };
  if (id.data === admin.id) {
    return { error: "Delete your own account from your profile, so the confirmation is explicit." };
  }

  const target = await db.query.users.findFirst({
    where: eq(users.id, id.data),
    columns: { email: true, role: true },
  });
  if (!target) return { error: "That account no longer exists." };

  // Typing the address is the confirmation — this destroys every event, import
  // and correlation that account ever had.
  const confirmation = String(formData.get("confirm") ?? "").trim().toLowerCase();
  if (confirmation !== (target.email ?? "").toLowerCase()) {
    return { error: "Type the account's email exactly to confirm." };
  }
  if (target.role === "admin" && (await wouldOrphanInstance(id.data))) {
    return { error: "That is the last active admin — promote someone else first." };
  }

  await db.delete(users).where(eq(users.id, id.data));
  revalidatePath("/admin");
  return { success: `Deleted ${target.email} and everything they had stored.` };
}

export async function updateSettingsAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireAdmin();
  const problems: string[] = [];

  for (const key of SETTING_KEYS) {
    const definition = SETTINGS[key];
    const raw = formData.get(key);

    // A checkbox that is off sends nothing at all, which is the "false" case.
    const value =
      typeof definition.default === "boolean"
        ? raw === "on" || raw === "1" || raw === "true"
        : typeof definition.default === "number"
          ? Number(raw)
          : typeof raw === "string"
            ? raw.trim()
            : raw;

    const error = await setSetting(key, value, admin.id);
    if (error) problems.push(`${definition.label}: ${error}`);
  }

  revalidatePath("/admin");
  return problems.length ? { error: problems.join(" · ") } : { success: "Settings saved." };
}

/**
 * Send the daily mood email to everyone who has it switched on, right now,
 * instead of waiting for each person's hour to come round.
 *
 * Opting out is still honoured: `mood_email_hour` being null means off, and a
 * disabled account or one with no address is skipped. An admin button is for
 * testing and for the occasional nudge — not a way around someone's choice.
 */
export async function sendMoodEmailsAction(): Promise<ActionState> {
  await requireAdmin();

  if (!resendConfigured()) {
    return { error: "RESEND_API_KEY is not set on this deployment." };
  }

  const recipients = await db
    .select({
      id: users.id,
      email: users.email,
      timezone: users.timezone,
      hour: users.moodEmailHour,
      disabledAt: users.disabledAt,
    })
    .from(users);

  const now = new Date();
  const appUrl = process.env.APP_URL ?? "https://youai.nl";
  const problems: string[] = [];
  let sent = 0;
  let skipped = 0;

  for (const recipient of recipients) {
    if (!recipient.email || recipient.disabledAt || recipient.hour === null) {
      skipped += 1;
      continue;
    }

    try {
      const today = localDateOf(now, recipient.timezone);
      const stats = await getMoodStats(recipient.id, today);
      const digest = renderMoodDigest({ stats, today, appUrl });

      await sendEmail({
        to: recipient.email,
        subject: digest.subject,
        html: digest.html,
        text: digest.text,
      });
      sent += 1;
    } catch (error) {
      // One bad address must not stop the rest of the broadcast.
      problems.push(`${recipient.email}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  revalidatePath("/admin");

  const summary = `Sent ${sent} ${sent === 1 ? "email" : "emails"}${skipped ? `, skipped ${skipped} (opted out or no address)` : ""}.`;
  return problems.length
    ? { error: `${summary} ${problems.length} failed — ${problems.slice(0, 3).join(" · ")}` }
    : { success: summary };
}

/** How many people would receive a broadcast right now. */
export async function countMoodEmailRecipients(): Promise<number> {
  await requireAdmin();
  const [row] = await db
    .select({ total: count() })
    .from(users)
    .where(and(isNotNull(users.moodEmailHour), isNull(users.disabledAt), isNotNull(users.email)));
  return row?.total ?? 0;
}

"use server";

import { and, eq, ne } from "drizzle-orm";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AuthError } from "next-auth";
import { ADMIN_EMAIL, requireUser, signIn, signOut } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { emailSchema, hashPassword, passwordSchema, verifyPassword } from "@/lib/password";
import { getSetting } from "@/lib/settings";
import { isValidTimezone } from "@/lib/events/time";

export type ActionState = { error?: string; success?: string };

/* -------------------------------------------------------------------------- */
/*  Registration and sign-in                                                  */
/* -------------------------------------------------------------------------- */

const registerSchema = z
  .object({
    name: z.string().trim().min(1, "tell us your name").max(80),
    email: emailSchema,
    password: passwordSchema,
    confirm: z.string(),
    timezone: z.string().max(64).optional(),
  })
  .refine((data) => data.password === data.confirm, {
    message: "the two passwords do not match",
    path: ["confirm"],
  });

export async function registerAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  if (!(await getSetting("allowRegistration"))) {
    return { error: "New sign-ups are closed at the moment." };
  }

  const parsed = registerSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
    confirm: formData.get("confirm"),
    timezone: formData.get("timezone") || undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  }

  const { name, email, password } = parsed.data;

  const existing = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (existing) {
    // Deliberately explicit rather than vague: this form is public, so the
    // address is already known to whoever typed it, and "that email is taken"
    // is far more useful than a generic failure.
    return { error: "There is already an account with that email. Sign in instead." };
  }

  await db.insert(users).values({
    name,
    email,
    passwordHash: await hashPassword(password),
    // The configured admin address becomes an admin however it signs up.
    role: email === ADMIN_EMAIL ? "admin" : "user",
    timezone: parsed.data.timezone || (await getSetting("defaultTimezone")),
    emailVerified: null, // verification is off on purpose — see the README
  });

  // signIn redirects on success, which throws NEXT_REDIRECT; let it through.
  await signIn("credentials", { email, password, redirectTo: "/dashboard" });
  return {};
}

export async function signInAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = formData.get("email");
  const password = formData.get("password");

  try {
    await signIn("credentials", { email, password, redirectTo: "/dashboard" });
    return {};
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: "That email and password do not match an account." };
    }
    throw error; // NEXT_REDIRECT and anything genuinely unexpected
  }
}

export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: "/signin" });
}

/* -------------------------------------------------------------------------- */
/*  Profile                                                                   */
/* -------------------------------------------------------------------------- */

const profileSchema = z.object({
  name: z.string().trim().min(1, "a name is required").max(80),
  timezone: z.string().trim().min(1).max(64),
  latitude: z.coerce.number().min(-90).max(90).nullable(),
  longitude: z.coerce.number().min(-180).max(180).nullable(),
});

export async function updateProfileAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();

  const raw = {
    name: formData.get("name"),
    timezone: formData.get("timezone"),
    latitude: formData.get("latitude") === "" ? null : formData.get("latitude"),
    longitude: formData.get("longitude") === "" ? null : formData.get("longitude"),
  };

  const parsed = profileSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  }

  if (!isValidTimezone(parsed.data.timezone)) {
    return { error: `"${parsed.data.timezone}" is not a timezone this system knows.` };
  }

  await db
    .update(users)
    .set({
      name: parsed.data.name,
      timezone: parsed.data.timezone,
      latitude: parsed.data.latitude,
      longitude: parsed.data.longitude,
    })
    .where(eq(users.id, user.id));

  revalidatePath("/profile");
  return {
    success:
      parsed.data.timezone !== user.timezone
        ? "Saved. Changing your timezone only affects data imported from now on — re-import to re-bucket the old days."
        : "Saved.",
  };
}

const passwordChangeSchema = z
  .object({
    current: z.string().optional(),
    password: passwordSchema,
    confirm: z.string(),
  })
  .refine((data) => data.password === data.confirm, {
    message: "the two passwords do not match",
    path: ["confirm"],
  });

export async function changePasswordAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();

  const parsed = passwordChangeSchema.safeParse({
    current: formData.get("current") ?? undefined,
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  }

  const row = await db.query.users.findFirst({
    where: eq(users.id, user.id),
    columns: { passwordHash: true },
  });

  // An account created through Google or GitHub has no password yet, so it can
  // set one without proving an old one it never had.
  if (row?.passwordHash) {
    const ok = await verifyPassword(parsed.data.current ?? "", row.passwordHash);
    if (!ok) return { error: "Your current password is not right." };
  }

  await db
    .update(users)
    .set({ passwordHash: await hashPassword(parsed.data.password) })
    .where(eq(users.id, user.id));

  return { success: row?.passwordHash ? "Password changed." : "Password set." };
}

/**
 * Delete your own account. Everything hangs off `user` with ON DELETE CASCADE —
 * events, imports, sources, daily metrics and any conversions the model wrote
 * for you — so one delete takes all of it.
 */
export async function deleteAccountAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();

  const row = await db.query.users.findFirst({
    where: eq(users.id, user.id),
    columns: { email: true, role: true },
  });
  if (!row) return { error: "Account not found." };

  // Typing the address is the confirmation; a button alone is too easy to hit.
  const confirmation = String(formData.get("confirm") ?? "").trim().toLowerCase();
  if (confirmation !== (row.email ?? "").toLowerCase()) {
    return { error: "Type your email address exactly to confirm." };
  }

  if (row.role === "admin") {
    const [other] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.role, "admin"), ne(users.id, user.id)))
      .limit(1);
    if (!other) {
      return {
        error:
          "You are the only admin. Promote someone else first, or nobody will be able to manage the instance.",
      };
    }
  }

  await db.delete(users).where(eq(users.id, user.id));
  await signOut({ redirectTo: "/signin" });
  redirect("/signin");
}

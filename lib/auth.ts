import NextAuth, { type DefaultSession } from "next-auth";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { accounts, sessions, users, verificationTokens, type Role } from "@/lib/db/schema";
import { emailSchema, fakeVerify, verifyPassword } from "@/lib/password";

declare module "next-auth" {
  interface Session {
    user: { id: string; role: Role; timezone: string } & DefaultSession["user"];
  }
}

/** The one account that is an admin, by email. */
export const ADMIN_EMAIL = (process.env.ADMIN_EMAIL ?? "admin@youai.nl").toLowerCase();

export const googleConfigured = Boolean(
  process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET,
);
export const githubConfigured = Boolean(
  process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET,
);

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  /*
   * JWT rather than database sessions, because a Credentials provider cannot
   * use database sessions. The adapter still persists users and linked OAuth
   * accounts; only the session itself lives in the cookie.
   */
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 30 },
  pages: { signIn: "/signin", error: "/signin" },
  providers: [
    Credentials({
      id: "credentials",
      name: "Email and password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(raw) {
        const email = emailSchema.safeParse(raw?.email);
        const password = typeof raw?.password === "string" ? raw.password : "";

        if (!email.success || !password) {
          await fakeVerify();
          return null;
        }

        const user = await db.query.users.findFirst({
          where: eq(users.email, email.data),
        });

        if (!user) {
          // Same work as a real check, so a missing account and a wrong
          // password are indistinguishable from the outside.
          await fakeVerify();
          return null;
        }
        if (user.disabledAt) return null;
        if (!(await verifyPassword(password, user.passwordHash))) return null;

        return user;
      },
    }),
    ...(googleConfigured
      ? [
          Google({
            clientId: process.env.AUTH_GOOGLE_ID,
            clientSecret: process.env.AUTH_GOOGLE_SECRET,
            /*
             * Links a Google sign-in to an existing account with the same
             * address. Auth.js calls this dangerous because with an unverified
             * provider it would allow takeover by claiming someone's address —
             * Google and GitHub both verify, so the risk here is that *our* own
             * sign-up does not. Someone could register a@b.com they do not own,
             * and the real owner's Google sign-in would join that account.
             * Accepted for ease of sign-up; turn this off to close it.
             */
            allowDangerousEmailAccountLinking: true,
          }),
        ]
      : []),
    ...(githubConfigured
      ? [
          GitHub({
            clientId: process.env.AUTH_GITHUB_ID,
            clientSecret: process.env.AUTH_GITHUB_SECRET,
            allowDangerousEmailAccountLinking: true,
          }),
        ]
      : []),
  ],
  callbacks: {
    async signIn({ user }) {
      // Blocks OAuth sign-in for a disabled account; the credentials path has
      // already checked this in authorize().
      if (!user?.id) return true;
      const row = await db.query.users.findFirst({
        where: eq(users.id, user.id),
        columns: { disabledAt: true },
      });
      return !row?.disabledAt;
    },

    async jwt({ token, user, trigger }) {
      if (user?.id) token.sub = user.id;
      if (!token.sub) return token;

      // Re-read on sign-in and on an explicit session update, so a role change
      // or a new timezone takes effect without waiting for the token to expire.
      if (user || trigger === "update" || token.role === undefined) {
        const row = await db.query.users.findFirst({
          where: eq(users.id, token.sub),
          columns: { role: true, timezone: true, email: true },
        });
        token.role = row?.role ?? "user";
        token.timezone = row?.timezone ?? "UTC";
      }
      return token;
    },

    async session({ session, token }) {
      if (!token.sub) return session;
      session.user.id = token.sub;
      session.user.role = (token.role as Role) ?? "user";
      // The timezone decides which calendar day every event lands on, so it
      // travels with the session rather than being re-read on every query.
      session.user.timezone = (token.timezone as string) ?? "UTC";
      return session;
    },
  },
  events: {
    async signIn({ user }) {
      if (!user?.id) return;
      await db
        .update(users)
        .set({ lastSeenAt: new Date() })
        .where(eq(users.id, user.id));
    },
    /**
     * A brand-new account gets the admin role if its address is the configured
     * admin address. Doing it here covers every route in — credentials sign-up,
     * Google and GitHub alike.
     */
    async createUser({ user }) {
      if (!user.id || !user.email) return;
      if (user.email.toLowerCase() !== ADMIN_EMAIL) return;
      await db.update(users).set({ role: "admin" }).where(eq(users.id, user.id));
    },
  },
});

export type SessionUser = { id: string; role: Role; timezone: string };

/** The signed-in user, or null — for route handlers that return JSON. */
export async function getUser(): Promise<SessionUser | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  return {
    id: session.user.id,
    role: session.user.role ?? "user",
    timezone: session.user.timezone ?? "UTC",
  };
}

/** The signed-in user, or a redirect to the sign-in page. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getUser();
  if (!user) redirect("/signin");
  return user;
}

/** The signed-in admin, or a redirect. */
export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "admin") redirect("/dashboard");
  return user;
}

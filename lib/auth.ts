import NextAuth, { type DefaultSession } from "next-auth";
import GitHub from "next-auth/providers/github";
import Credentials from "next-auth/providers/credentials";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { accounts, sessions, users, verificationTokens } from "@/lib/db/schema";

declare module "next-auth" {
  interface Session {
    user: { id: string; timezone: string } & DefaultSession["user"];
  }
}

const DEMO_EMAIL = "demo@youai.local";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  // JWT rather than database sessions, so the credentials-based demo login and
  // GitHub OAuth can coexist. The adapter still persists users and accounts.
  session: { strategy: "jwt" },
  pages: { signIn: "/signin" },
  providers: [
    GitHub({
      clientId: process.env.AUTH_GITHUB_ID,
      clientSecret: process.env.AUTH_GITHUB_SECRET,
    }),
    Credentials({
      id: "demo",
      name: "Demo account",
      credentials: {},
      async authorize() {
        if (process.env.ALLOW_DEMO_LOGIN !== "1") return null;

        const existing = await db.query.users.findFirst({
          where: eq(users.email, DEMO_EMAIL),
        });
        if (existing) return existing;

        const [created] = await db
          .insert(users)
          .values({ email: DEMO_EMAIL, name: "Demo", timezone: "Europe/Madrid" })
          .returning();
        return created;
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user?.id) token.sub = user.id;
      return token;
    },
    async session({ session, token }) {
      if (!token.sub) return session;
      session.user.id = token.sub;

      // The timezone decides which calendar day every event lands on, so it
      // travels with the session rather than being re-read on every query.
      const row = await db.query.users.findFirst({
        where: eq(users.id, token.sub),
        columns: { timezone: true },
      });
      session.user.timezone = row?.timezone ?? "UTC";
      return session;
    },
  },
});

export type SessionUser = { id: string; timezone: string };

/** The signed-in user, or null — for route handlers that return JSON. */
export async function getUser(): Promise<SessionUser | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  return { id: session.user.id, timezone: session.user.timezone ?? "UTC" };
}

/** The signed-in user, or a redirect to the sign-in page. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getUser();
  if (!user) redirect("/signin");
  return user;
}

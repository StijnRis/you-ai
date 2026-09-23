import { AuthError } from "next-auth";
import { NextResponse, type NextRequest } from "next/server";
import { signIn } from "@/lib/auth";

/**
 * One-click login for demos: /login-link?username=demo@x.com&password=...
 *
 * The credentials sit in the URL (and so in browser history and server logs),
 * so only share links for a throwaway demo account.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const email = params.get("username") ?? params.get("email");
  const password = params.get("password");
  // Only same-site paths, so the link can't bounce people to another domain.
  const next = params.get("next");
  const redirectTo = next?.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";

  try {
    // Throws NEXT_REDIRECT with the session cookie set on success.
    await signIn("credentials", { email, password, redirectTo });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.redirect(new URL("/signin?error=CredentialsSignin", request.url));
    }
    throw error;
  }
  return NextResponse.redirect(new URL(redirectTo, request.url));
}

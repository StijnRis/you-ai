import Link from "next/link";
import { redirect } from "next/navigation";
import { getUser, googleConfigured, githubConfigured } from "@/lib/auth";
import { registerAction } from "@/lib/actions/account";
import { RegisterForm } from "@/components/auth-forms";
import { OAuthButtons } from "@/components/oauth-buttons";
import { getSettings } from "@/lib/settings";

export default async function RegisterPage() {
  if (await getUser()) redirect("/dashboard");
  const settings = await getSettings();

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-16">
      <Link href="/signin" className="mb-8 text-2xl font-semibold tracking-tight">
        You<span className="text-accent">AI</span>
      </Link>

      <div className="rounded-2xl border border-border bg-surface p-7 shadow-sm">
        <h1 className="text-lg font-semibold tracking-tight">Create an account</h1>
        <p className="mt-1 mb-6 text-sm text-muted">
          No email to confirm — you are in as soon as you submit.
        </p>

        {settings.allowRegistration ? (
          <>
            <RegisterForm action={registerAction} defaultTimezone={settings.defaultTimezone} />
            <div className="mt-5">
              <OAuthButtons google={googleConfigured} github={githubConfigured} />
            </div>
          </>
        ) : (
          <div className="space-y-4">
            <p className="rounded-lg border border-border bg-surface-2 px-3 py-2.5 text-sm text-muted">
              New sign-ups are closed on this instance. Ask an admin to open them.
            </p>
            <Link href="/signin" className="text-sm font-medium text-accent hover:underline">
              Back to sign in
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

import { redirect } from "next/navigation";
import { Activity, CloudSun, MessageSquare } from "lucide-react";
import { getUser, signIn } from "@/lib/auth";

export default async function SignInPage() {
  if (await getUser()) redirect("/dashboard");

  const demoEnabled = process.env.ALLOW_DEMO_LOGIN === "1";
  const githubConfigured = Boolean(process.env.AUTH_GITHUB_ID);

  return (
    <div className="mx-auto flex min-h-dvh max-w-5xl flex-col justify-center px-6 py-16">
      <div className="grid gap-12 md:grid-cols-2 md:items-center">
        <div className="rise">
          <h1 className="text-3xl font-semibold tracking-tight">
            You<span className="text-accent">AI</span>
          </h1>
          <p className="mt-3 max-w-md text-lg leading-relaxed text-muted">
            Bring every service you already use into one event store, find the patterns
            hiding across them, and ask questions in plain language.
          </p>

          <ul className="mt-8 space-y-4 text-sm">
            <Feature icon={<Activity className="size-4" />} title="Import anything">
              Drop in an export from any service. Unfamiliar formats get a conversion
              written for them once, then reused.
            </Feature>
            <Feature icon={<CloudSun className="size-4" />} title="Pull what you can't export">
              Live adapters fill the gaps — weather, to start with.
            </Feature>
            <Feature icon={<MessageSquare className="size-4" />} title="Ask, don't dig">
              A model with real query tools, so the numbers come from your data rather
              than from its imagination.
            </Feature>
          </ul>
        </div>

        <div className="rounded-2xl border border-border bg-surface p-7 shadow-sm">
          <h2 className="text-lg font-semibold tracking-tight">Sign in</h2>
          <p className="mt-1 text-sm text-muted">Your data stays in your own database.</p>

          <div className="mt-6 space-y-3">
            {githubConfigured ? (
              <form
                action={async () => {
                  "use server";
                  await signIn("github", { redirectTo: "/dashboard" });
                }}
              >
                <button
                  type="submit"
                  className="w-full rounded-lg bg-text px-4 py-2.5 text-sm font-medium text-bg transition-opacity hover:opacity-90"
                >
                  Continue with GitHub
                </button>
              </form>
            ) : (
              <p className="rounded-lg border border-border bg-surface-2 px-3 py-2.5 text-xs text-muted">
                GitHub sign-in is not configured. Set <code className="font-mono">AUTH_GITHUB_ID</code>{" "}
                and <code className="font-mono">AUTH_GITHUB_SECRET</code> to enable it.
              </p>
            )}

            {demoEnabled ? (
              <form
                action={async () => {
                  "use server";
                  await signIn("demo", { redirectTo: "/dashboard" });
                }}
              >
                <button
                  type="submit"
                  className="w-full rounded-lg border border-border px-4 py-2.5 text-sm font-medium transition-colors hover:bg-surface-2"
                >
                  Continue as demo user
                </button>
              </form>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function Feature({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
        {icon}
      </span>
      <span>
        <strong className="font-medium">{title}.</strong>{" "}
        <span className="text-muted">{children}</span>
      </span>
    </li>
  );
}

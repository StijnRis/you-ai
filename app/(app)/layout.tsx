import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { Nav } from "@/components/nav";
import { countAwaitingEvaluation } from "@/lib/experiments/store";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  // A finished experiment nobody reads is a wasted week, so the count follows
  // the person around the app until they look at it.
  const awaitingEvaluation = await countAwaitingEvaluation(user.id, user.timezone).catch(() => 0);

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b border-border bg-bg/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 sm:px-6">
          <Link href="/dashboard" className="text-base font-semibold tracking-tight">
            You<span className="text-accent">AI</span>
          </Link>
          <Nav
            isAdmin={user.role === "admin"}
            badges={{ "/experiments": awaitingEvaluation }}
          />
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">{children}</main>

      <footer className="mx-auto max-w-6xl px-4 pb-10 text-xs text-subtle sm:px-6">
        All times in {user.timezone}.
      </footer>
    </div>
  );
}

import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { signOut } from "@/lib/auth";
import { Nav } from "@/components/nav";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b border-border bg-bg/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 sm:px-6">
          <Link href="/dashboard" className="text-base font-semibold tracking-tight">
            You<span className="text-accent">AI</span>
          </Link>
          <Nav />
          <form
            className="ml-auto"
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/signin" });
            }}
          >
            <button
              type="submit"
              className="rounded-lg px-2.5 py-1.5 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-text"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">{children}</main>

      <footer className="mx-auto max-w-6xl px-4 pb-10 text-xs text-subtle sm:px-6">
        All times in {user.timezone}.
      </footer>
    </div>
  );
}

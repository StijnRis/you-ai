"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Database,
  FileUp,
  FlaskConical,
  LayoutDashboard,
  MessageSquare,
  Plug,
  Shield,
  UserRound,
  Wand2,
} from "lucide-react";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/insights", label: "Insights", icon: BarChart3 },
  { href: "/data", label: "Data", icon: Database },
  { href: "/chat", label: "Chat", icon: MessageSquare },
  { href: "/experiments", label: "Experiments", icon: FlaskConical },
  { href: "/import", label: "Import", icon: FileUp },
  { href: "/sources", label: "Sources", icon: Plug },
  { href: "/conversions", label: "Conversions", icon: Wand2 },
  { href: "/profile", label: "Profile", icon: UserRound },
];

const ADMIN_LINK = { href: "/admin", label: "Admin", icon: Shield };

export function Nav({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  const links = isAdmin ? [...LINKS, ADMIN_LINK] : LINKS;

  return (
    <nav className="flex gap-0.5 overflow-x-auto" aria-label="Main">
      {links.map((link) => {
        const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
        const Icon = link.icon;
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors",
              active
                ? "bg-surface-2 text-text"
                : "text-muted hover:bg-surface-2/60 hover:text-text",
            )}
          >
            <Icon className="size-4" aria-hidden />
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}

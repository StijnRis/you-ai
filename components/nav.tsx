"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  FileUp,
  LayoutDashboard,
  MessageSquare,
  Plug,
  Wand2,
} from "lucide-react";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/insights", label: "Insights", icon: BarChart3 },
  { href: "/chat", label: "Chat", icon: MessageSquare },
  { href: "/import", label: "Import", icon: FileUp },
  { href: "/sources", label: "Sources", icon: Plug },
  { href: "/conversions", label: "Conversions", icon: Wand2 },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <nav className="flex gap-0.5 overflow-x-auto" aria-label="Main">
      {LINKS.map((link) => {
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

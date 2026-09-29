"use client";

import { Activity, Coins, Images, LayoutDashboard, ListVideo, Package, Receipt, ScrollText, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/admin", label: "Overview", short: "Overview", icon: LayoutDashboard },
  { href: "/admin/jobs", label: "Jobs", short: "Jobs", icon: ListVideo },
  { href: "/admin/gallery", label: "Gallery", short: "Gallery", icon: Images },
  { href: "/admin/users", label: "Users", short: "Users", icon: Users },
  { href: "/admin/credits", label: "Credits", short: "Credits", icon: Coins },
  { href: "/admin/catalog", label: "Catalog", short: "Catalog", icon: Package },
  { href: "/admin/billing", label: "Billing", short: "Billing", icon: Receipt },
  { href: "/admin/health", label: "Service health", short: "Health", icon: Activity },
  { href: "/admin/audit", label: "Audit log", short: "Audit", icon: ScrollText },
];

/** A row of tabs on phones, an icon rail with short labels on desktop. */
export function AdminNav() {
  const path = usePathname();
  const current = useRef<HTMLAnchorElement>(null);
  // On phones the tab row scrolls; keep the current page in view.
  useEffect(() => {
    current.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [path]);
  return (
    <nav aria-label="Admin" className="flex gap-1 overflow-x-auto px-3 pb-2 [scrollbar-width:none] lg:flex-col lg:items-stretch lg:overflow-visible lg:px-2 lg:pb-0">
      {LINKS.map(({ href, label, short, icon: Icon }) => {
        const active = href === "/admin" ? path === "/admin" : path.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            ref={active ? current : undefined}
            title={label}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm whitespace-nowrap transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none lg:flex-col lg:gap-1 lg:px-1 lg:py-2.5 lg:text-[11px]",
              active ? "bg-panel-raised text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-4 shrink-0 lg:size-5" aria-hidden />
            <span className="lg:hidden">{label}</span>
            <span className="max-lg:hidden">{short}</span>
          </Link>
        );
      })}
    </nav>
  );
}

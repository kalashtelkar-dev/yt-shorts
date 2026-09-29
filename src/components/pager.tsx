import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Paging for server-rendered lists: the page lives in the URL, so it works without JavaScript and can be shared.

/** Rows per page for lists paged in memory. Database lists page in their queries. */
export const PAGE_SIZE = 20;

/** `?page=` (or another name) as a 0-based page number. */
export const pageParam = (v: string | undefined) => Math.max(0, Math.floor(Number(v) || 0));

/** One page of an in-memory list. */
export function pageOf<T>(list: T[], page: number, size = PAGE_SIZE) {
  return { rows: list.slice(page * size, (page + 1) * size), hasMore: list.length > (page + 1) * size };
}

/** Previous / Next, always shown so every list reads the same. `params` keeps the rest of the query (filters, other pagers). */
export function Pager({ page, hasMore, params, param = "page" }: { page: number; hasMore: boolean; params: Record<string, string | undefined>; param?: string }) {
  const href = (p: number) => {
    const q = new URLSearchParams(Object.entries({ ...params, [param]: p ? String(p) : undefined }).filter(([, v]) => v) as [string, string][]).toString();
    return q ? `?${q}` : "?";
  };
  const button = buttonVariants({ variant: "outline", className: "gap-1" });
  const off = cn(button, "pointer-events-none opacity-40");
  return (
    <nav className="flex items-center justify-between gap-3 pt-4" aria-label="Pages">
      {page > 0 ? (
        <Link href={href(page - 1)} className={button} rel="prev">
          <ChevronLeft aria-hidden /> Previous
        </Link>
      ) : (
        <span className={off} aria-disabled="true">
          <ChevronLeft aria-hidden /> Previous
        </span>
      )}
      <span className="font-mono text-xs text-muted-foreground tabular">Page {page + 1}</span>
      {hasMore ? (
        <Link href={href(page + 1)} className={button} rel="next">
          Next <ChevronRight aria-hidden />
        </Link>
      ) : (
        <span className={off} aria-disabled="true">
          Next <ChevronRight aria-hidden />
        </span>
      )}
    </nav>
  );
}


import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Small server-safe building blocks for admin pages.

const JOB_STATUS: Record<string, { label: string; className: string }> = {
  queued: { label: "Queued", className: "text-muted-foreground" },
  starting: { label: "Starting", className: "text-muted-foreground" },
  running: { label: "Running", className: "text-foreground" },
  succeeded: { label: "Succeeded", className: "text-success" },
  failed: { label: "Failed", className: "text-danger" },
  canceled: { label: "Canceled", className: "text-muted-foreground" },
};

/** Status as a dot + word, never colour alone. */
export function JobStatus({ status }: { status: string }) {
  const s = JOB_STATUS[status] ?? { label: status, className: "text-muted-foreground" };
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap", s.className)}>
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {s.label}
    </span>
  );
}

export function PageHeader({ title, back, children }: { title: string; back?: { href: string; label: string }; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      {back && (
        <Link
          href={back.href}
          className="-ml-1 flex items-center gap-1.5 self-start rounded px-1 py-1 text-sm text-muted-foreground hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <ArrowLeft className="size-4" aria-hidden /> {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="min-w-0 text-2xl font-semibold tracking-tight break-words">{title}</h1>
        {children}
      </div>
    </div>
  );
}

export function Panel({ title, children, className }: { title?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-xl border bg-panel", className)}>
      {title && <h2 className="border-b px-4 py-3 text-sm font-medium">{title}</h2>}
      <div className="p-4">{children}</div>
    </section>
  );
}

/** Horizontal scroll stays inside the table, never the page. */
export function Table({ children }: { children: React.ReactNode }) {
  return (
    <div className="-mx-4 overflow-x-auto px-4">
      <table className="w-full min-w-[640px] border-collapse text-left text-sm [&_td]:border-t [&_td]:px-3 [&_td]:py-2.5 [&_td]:align-top [&_th]:px-3 [&_th]:pb-2 [&_th]:text-xs [&_th]:font-medium [&_th]:text-muted-foreground">
        {children}
      </table>
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-6 text-center text-sm text-muted-foreground">{children}</p>;
}

export function UserLabel({ id, email, isAnonymous }: { id: string; email: string; isAnonymous: boolean }) {
  return (
    <Link href={`/admin/users/${id}`} className="hover:underline">
      {isAnonymous ? <span className="text-muted-foreground">Guest · {id.slice(0, 8)}</span> : email}
    </Link>
  );
}

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

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5 text-sm">
      <span className="font-medium">{label}</span>
      {children}
    </label>
  );
}

export const selectClass =
  "select-field h-11 w-full rounded-lg border border-input bg-panel-raised pl-3 text-base transition-colors outline-none hover:border-muted-foreground/50 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 sm:h-10 sm:text-sm";

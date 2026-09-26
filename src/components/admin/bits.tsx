import Link from "next/link";
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

export function PageHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {children}
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

export function Pager({ page, hasMore, params }: { page: number; hasMore: boolean; params: Record<string, string | undefined> }) {
  if (page === 0 && !hasMore) return null;
  const href = (p: number) => `?${new URLSearchParams(Object.entries({ ...params, page: String(p) }).filter(([, v]) => v) as [string, string][])}`;
  return (
    <nav className="flex justify-between pt-3 text-sm" aria-label="Pages">
      {page > 0 ? <Link href={href(page - 1)} className="text-muted-foreground hover:text-foreground">Previous</Link> : <span />}
      {hasMore && <Link href={href(page + 1)} className="text-muted-foreground hover:text-foreground">Next</Link>}
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
  "h-11 w-full rounded-lg border border-input bg-panel-raised px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 sm:h-10";

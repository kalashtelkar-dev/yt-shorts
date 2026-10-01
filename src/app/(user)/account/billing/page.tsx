import type { Metadata } from "next";
import Link from "next/link";
import { BackLink } from "@/components/back-link";
import { notFound, redirect } from "next/navigation";
import { Pager, pageParam } from "@/components/pager";
import { buttonVariants } from "@/components/ui/button";
import { env } from "@/config/env";
import { rupees } from "@/lib/billing";
import { formatClock, formatCredits, formatWhen } from "@/lib/format";
import { cn } from "@/lib/utils";
import { billingTotals, creditFeed, type FeedFilter, type FeedRow } from "@/server/billing";
import { getViewer, viewerBalance } from "@/server/session";

export const metadata: Metadata = { title: "Billing", robots: { index: false, follow: false } };

const FILTERS: { key: FeedFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "purchases", label: "Purchases" },
  { key: "montages", label: "Montages" },
];

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ show?: string; page?: string }> }) {
  if (env.AUTH_MODE !== "full") notFound();
  const viewer = await getViewer();
  if (!viewer || viewer.isAnonymous) redirect("/sign-in");
  const sp = await searchParams;
  const filter = FILTERS.find((f) => f.key === sp.show)?.key ?? "all";
  const page = pageParam(sp.page);
  const [balance, totals, feed] = await Promise.all([viewerBalance(viewer), billingTotals(viewer.id), creditFeed(viewer.id, filter, page)]);

  return (
    <div data-backdrop="credits" className="flex flex-col gap-6">
      <BackLink href="/account">Account</BackLink>

      <div className="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)] lg:items-start lg:gap-10">
        <aside className="flex flex-col gap-4 lg:sticky lg:top-8" aria-label="Summary">
          <div className="flex items-end justify-between gap-4 lg:flex-col lg:items-start">
            <h1 className="font-display text-2xl sm:text-3xl">Billing</h1>
            {env.PAYMENTS_ENABLED && (
              <Link href="/account" className={cn(buttonVariants(), "lg:hidden")}>
                Add credits
              </Link>
            )}
          </div>
          <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-xl border bg-border lg:grid-cols-1">
            {[
              ["Credits now", formatCredits(balance)],
              ["Paid", rupees(totals.paidPaise)],
              ["Used on montages", formatCredits(totals.creditsUsed)],
            ].map(([k, v]) => (
              <div key={k} className="flex flex-col gap-1 bg-panel p-3 lg:p-4">
                <dt className="text-xs text-muted-foreground">{k}</dt>
                <dd className="font-mono text-lg tabular lg:text-2xl">{v}</dd>
              </div>
            ))}
          </dl>
          {env.PAYMENTS_ENABLED && (
            <Link href="/account" className={cn(buttonVariants({ size: "lg" }), "max-lg:hidden")}>
              Add credits
            </Link>
          )}
        </aside>

        <section className="flex min-w-0 flex-col gap-4" aria-label="History">
          <nav aria-label="Show" className="-mx-4 -my-1 flex gap-2 overflow-x-auto px-4 py-1 [scrollbar-width:none] sm:mx-0 sm:px-1">
            {FILTERS.map((f) => (
              <Link
                key={f.key}
                href={f.key === "all" ? "/account/billing" : `/account/billing?show=${f.key}`}
                aria-current={f.key === filter ? "page" : undefined}
                className={cn(
                  "flex h-10 shrink-0 items-center rounded-full border px-4 text-sm transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                  f.key === filter ? "border-transparent bg-panel-raised text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {f.label}
              </Link>
            ))}
          </nav>

          {feed.rows.length === 0 ? (
            <div className="flex flex-col items-start gap-4 rounded-xl border bg-panel p-6">
              <p className="text-muted-foreground">{page > 0 ? "No more entries." : filter === "all" ? "Nothing here yet. Credits you buy and use show up here." : "Nothing here for this filter yet."}</p>
              <Link href="/create" className={buttonVariants({ size: "lg" })}>
                Make a montage
              </Link>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border">
              <div className="hidden grid-cols-[minmax(0,1fr)_9rem_6rem_6rem] gap-4 border-b bg-panel px-4 py-2.5 text-xs text-muted-foreground md:grid">
                <span>What</span>
                <span>When</span>
                <span className="text-right">Credits</span>
                <span className="text-right">Balance after</span>
              </div>
              <ol>
                {feed.rows.map((r) => (
                  <Row key={r.id} r={r} />
                ))}
              </ol>
            </div>
          )}
          <Pager page={page} hasMore={feed.hasMore} params={{ show: filter === "all" ? undefined : filter }} />
          <p className="text-xs text-muted-foreground md:hidden">The small number under each change is your balance after it.</p>
        </section>
      </div>
    </div>
  );
}

function describe(r: FeedRow): { title: string; sub: string | null } {
  switch (r.kind) {
    case "purchase":
      return { title: `Bought ${r.amountPaise ? rupees(r.amountPaise) : "credits"}`, sub: r.method ? r.method.toUpperCase() === "UPI" ? "UPI" : r.method : null };
    case "grant":
      return { title: "Welcome credits", sub: "for creating your account" };
    case "charge":
      return { title: `${r.styleTitle ?? "Montage"}${r.durationSec ? `, ${r.durationSec} s` : ""}`, sub: r.runMs ? `${formatClock(r.runMs)} of editing` : null };
    case "refund":
      return { title: "Refund", sub: r.styleTitle };
    case "admin_add":
      return { title: "Added by support", sub: null };
    case "admin_remove":
      return { title: "Removed by support", sub: null };
    case "transfer":
      return { title: r.delta >= 0 ? "Moved from your guest session" : "Moved to your account", sub: null };
    default:
      return { title: "Adjustment", sub: null };
  }
}

function Row({ r }: { r: FeedRow }) {
  const { title, sub } = describe(r);
  const tone = r.delta > 0 ? "text-success" : r.delta < 0 ? "text-foreground" : "text-muted-foreground";
  const change = r.delta > 0 ? `+${formatCredits(r.delta)}` : r.delta < 0 ? `−${formatCredits(-r.delta)}` : "0";
  const when = formatWhen(r.at);
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 border-b px-4 py-3 last:border-b-0 md:grid-cols-[minmax(0,1fr)_9rem_6rem_6rem]">
      <div className="flex min-w-0 items-start gap-3">
        <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", r.delta > 0 ? "bg-success" : r.delta < 0 ? "bg-danger" : "bg-input")} aria-hidden />
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate font-medium">
            {r.jobId ? (
              <Link href={`/jobs/${r.jobId}`} className="rounded hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
                {title}
              </Link>
            ) : (
              title
            )}
          </span>
          <span className="truncate text-sm text-muted-foreground">
            <span className="md:hidden">
              {when}
              {sub && ", "}
            </span>
            {sub}
          </span>
          {r.invoiceId && (
            <Link href={`/account/billing/invoices/${r.invoiceId}`} className="self-start rounded text-sm underline underline-offset-4 hover:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
              Invoice {r.invoiceNumber}
            </Link>
          )}
        </div>
      </div>
      <span className="hidden text-sm text-muted-foreground md:block">{when}</span>
      <span className="flex flex-col items-end md:contents">
        <span className={cn("font-mono tabular md:text-right", tone)}>{change}</span>
        <span className="font-mono text-xs text-muted-foreground tabular md:text-right md:text-sm">{formatCredits(r.balanceAfter)}</span>
      </span>
    </li>
  );
}

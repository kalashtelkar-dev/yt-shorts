import Link from "next/link";
import { PageHeader, Panel } from "@/components/admin/bits";
import { formatClock, formatCredits, formatRupees, formatWhen } from "@/lib/format";
import { requireAdmin } from "@/server/admin/guard";
import { ongoingIncidents, overviewStats } from "@/server/admin/queries";

export const dynamic = "force-dynamic";

const rate = (ok: number, bad: number) => (ok + bad ? `${Math.round((ok / (ok + bad)) * 100)}%` : "—");

export default async function Overview() {
  await requireAdmin();
  const [{ today, week, recentFailures }, open] = await Promise.all([overviewStats(), ongoingIncidents()]);

  const tiles = [
    { label: "Jobs today", value: String(today.total), sub: `${week.total} in 7 days · ${today.running} running now` },
    { label: "Success rate", value: rate(today.succeeded, today.failed), sub: `${rate(week.succeeded, week.failed)} over 7 days` },
    { label: "Average run time", value: today.avgRunMs ? formatClock(today.avgRunMs) : "—", sub: `${week.avgRunMs ? formatClock(week.avgRunMs) : "—"} over 7 days` },
    { label: "Credits used", value: formatCredits(today.creditsUsed), sub: `${formatCredits(week.creditsUsed)} over 7 days` },
    { label: "Compute cost", value: formatRupees(today.costPaise), sub: `${formatRupees(week.costPaise)} over 7 days` },
  ];

  return (
    <>
      <PageHeader title="Overview">
        <Link
          href="/admin/health"
          className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm ${open.length ? "border-danger/50 bg-danger/10 text-danger" : "text-muted-foreground hover:text-foreground"}`}
        >
          <span className={`size-2 ${open.length ? "bg-danger" : "rounded-full bg-success"}`} aria-hidden />
          {open.length ? `${open.length} ongoing incident${open.length === 1 ? "" : "s"}` : "All systems operational"}
        </Link>
      </PageHeader>
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {tiles.map((t) => (
          <div key={t.label} className="flex flex-col gap-1 rounded-xl border bg-panel p-4">
            <dt className="text-sm text-muted-foreground">{t.label}</dt>
            <dd className="font-mono text-3xl font-medium tabular">{t.value}</dd>
            <dd className="text-xs text-muted-foreground">{t.sub}</dd>
          </div>
        ))}
      </dl>
      <p className="-mt-3 text-xs text-muted-foreground">Today is counted from midnight IST. Credits used = charged minus refunded.</p>

      <Panel title="Recent failures">
        {recentFailures.length === 0 ? (
          <p className="text-sm text-muted-foreground">No failed jobs. </p>
        ) : (
          <ul className="flex flex-col divide-y">
            {recentFailures.map((j) => (
              <li key={j.id}>
                <Link href={`/admin/jobs/${j.id}`} className="flex flex-col gap-1 py-2.5 hover:text-foreground sm:flex-row sm:items-baseline sm:gap-4">
                  <span className="shrink-0 font-mono text-xs text-muted-foreground tabular">{formatWhen(j.createdAt.toISOString())}</span>
                  <span className="shrink-0 text-sm">{j.catalogSlug}</span>
                  <span className="truncate font-mono text-xs text-danger">{j.errorRaw ?? "no error recorded"}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <Link href="/admin/jobs?status=failed" className="mt-3 inline-flex rounded text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
          See all failed jobs
        </Link>
      </Panel>
    </>
  );
}

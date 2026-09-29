"use client";

import { RotateCw } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { formatClock, formatTime, formatWhen } from "@/lib/format";
import { formatPct, RANGES, type Range } from "@/lib/uptime";
import { cn } from "@/lib/utils";
import type { HealthView } from "@/lib/health";
import { Pager } from "@/components/pager";
import { BucketStrip, STATUS_LABEL, StatusMark, TIER_LABEL, type ViewStatus } from "./shared";

// React Flow stays out of every other bundle.
const HealthGraph = dynamic(() => import("./graph"), { ssr: false, loading: () => <div className="h-[420px] animate-pulse rounded-lg bg-panel-raised/40 motion-reduce:animate-none" /> });

export function HealthDashboard({ view }: { view: HealthView }) {
  const router = useRouter();
  const [selected, setSelected] = useState<string | null>(null);
  const { bucketMs, label } = RANGES[view.range];
  const now = Date.parse(view.generatedAt);

  useEffect(() => {
    const t = setInterval(() => router.refresh(), 30_000);
    return () => clearInterval(t);
  }, [router]);

  const tiers = new Set(view.probes.map((p) => p.tier)).size;
  const count = (s: ViewStatus) => view.probes.filter((p) => p.status === s).length;
  const stale = !view.workerAlive || !view.lastSweepAt || Date.parse(view.generatedAt) - Date.parse(view.lastSweepAt) > 90_000;
  const sel = view.probes.find((p) => p.id === selected) ?? null;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Service health</h1>
          <p className="text-sm text-muted-foreground">
            {view.probes.length} checks across {tiers} tiers, only the services this app uses. The worker runs every check every 30 s.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground tabular">
            <RotateCw className="size-3" aria-hidden />
            {view.lastSweepAt ? formatTime(view.lastSweepAt) : "never"}
          </span>
          <nav className="flex overflow-hidden rounded-md border" aria-label="Time range">
            {(Object.keys(RANGES) as Range[]).map((r) => (
              <Link
                key={r}
                href={`?range=${r}`}
                aria-current={r === view.range ? "page" : undefined}
                className={cn("px-3 py-1.5 font-mono text-xs", r === view.range ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
              >
                {r.replace("h", " h").replace("d", " d")}
              </Link>
            ))}
          </nav>
        </div>
      </div>

      {view.incidents.ongoing.length > 0 && (
        <section role="alert" className="flex flex-col gap-2 rounded-lg border border-danger/50 bg-danger/10 px-4 py-3" aria-label="Ongoing incidents">
          {view.incidents.ongoing.map((i) => (
            <p key={i.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <StatusMark status={i.severity} />
              <span className="font-medium">{i.name}</span>
              <span className={i.severity === "down" ? "text-danger" : "text-warning"}>{i.severity === "down" ? "is down" : "is degraded"}</span>
              <span className="text-muted-foreground">· for {formatClock(now - Date.parse(i.startedAt))} since {formatTime(i.startedAt)}</span>
              {i.message && <span className="truncate font-mono text-xs text-muted-foreground">· {i.message}</span>}
            </p>
          ))}
        </section>
      )}

      {stale && (
        <p role="alert" className="rounded-lg border border-danger/50 bg-danger/10 px-4 py-3 text-sm text-danger">
          {view.workerAlive ? "No health checks in the last 90 seconds." : "The worker isn't running, so health checks are paused."} What you see below may be out of date.
        </p>
      )}

      <section className="flex flex-col gap-3 rounded-xl border bg-panel p-4 sm:p-5" aria-label="Fleet uptime">
        <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-mono text-4xl font-medium tabular">{formatPct(view.fleet.uptime)}</span>
          <span className="text-sm text-muted-foreground">
            fleet uptime · {label} · worst of {view.fleet.criticalCount} critical checks
          </span>
        </p>
        <BucketStrip
          buckets={view.fleet.buckets}
          bucketMs={bucketMs}
          now={now}
          label={`Fleet uptime, ${label}`}
          extra={(i) => (view.fleet.troubled[i]?.length ? [`Affected: ${view.fleet.troubled[i].join(", ")}`] : [])}
        />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{view.range === "24h" ? "24 hours ago" : view.range === "7d" ? "7 days ago" : "90 days ago"}</span>
          <span>now</span>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
        <section className="hidden overflow-hidden rounded-xl border bg-panel p-2 md:block" aria-label="Service map">
          <HealthGraph probes={view.probes} selected={selected} onSelect={setSelected} rangeLabel={label} />
          <p className="px-2 pb-1 text-xs text-muted-foreground">Hover a service for details, click it for recent checks. Dots show traffic flowing on healthy links.</p>
        </section>

        <aside className="flex flex-col gap-4 rounded-xl border bg-panel p-4" aria-live="polite">
          {sel ? (
            <>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h2 className="font-medium">{sel.name}</h2>
                  <p className="text-xs text-muted-foreground">
                    {TIER_LABEL[sel.tier]}
                    {sel.critical ? " · critical" : ""}
                  </p>
                </div>
                <button type="button" onClick={() => setSelected(null)} className="rounded px-2 py-1 text-xs text-muted-foreground hover:text-foreground">
                  Close
                </button>
              </div>
              <p className="flex items-center gap-2 text-sm">
                <StatusMark status={sel.status as ViewStatus} />
                {STATUS_LABEL[sel.status as ViewStatus]}
                {sel.latencyMs !== null && <span className="ml-auto font-mono text-xs text-muted-foreground tabular">{sel.latencyMs} ms</span>}
              </p>
              {sel.message && <p className="rounded-md bg-background p-2 font-mono text-xs break-words text-muted-foreground">{sel.message}</p>}
              <div>
                <h3 className="mb-2 text-xs text-muted-foreground">Last {sel.recent.length} checks</h3>
                <ol className="flex max-h-80 flex-col gap-1 overflow-y-auto font-mono text-xs">
                  {sel.recent.map((r) => (
                    <li key={r.at} className="flex items-center gap-2">
                      <StatusMark status={r.status} />
                      <span className="tabular text-muted-foreground">{formatTime(r.at)}</span>
                      <span className="tabular">{r.latencyMs ?? "—"} ms</span>
                      {r.message && r.status !== "up" && <span className="truncate text-muted-foreground" title={r.message}>{r.message}</span>}
                    </li>
                  ))}
                </ol>
              </div>
            </>
          ) : (
            <>
              <h2 className="font-medium">Summary</h2>
              <dl className="grid grid-cols-[1fr_auto] gap-y-2 text-sm">
                <dt className="text-muted-foreground">Checks</dt>
                <dd className="text-right font-mono tabular">{view.probes.length}</dd>
                <dt className="text-muted-foreground">Operational</dt>
                <dd className="text-right font-mono text-success tabular">{count("up")}</dd>
                <dt className="text-muted-foreground">Degraded</dt>
                <dd className={cn("text-right font-mono tabular", count("degraded") && "text-warning")}>{count("degraded")}</dd>
                <dt className="text-muted-foreground">Down</dt>
                <dd className={cn("text-right font-mono tabular", count("down") && "text-danger")}>{count("down")}</dd>
                <dt className="text-muted-foreground">Not configured</dt>
                <dd className="text-right font-mono tabular">{count("not_configured")}</dd>
                <dt className="border-t pt-2 text-muted-foreground">Checked</dt>
                <dd className="border-t pt-2 text-right font-mono tabular">every 30 s</dd>
              </dl>
              <ul className="flex flex-wrap gap-x-4 gap-y-2 border-t pt-3 text-xs text-muted-foreground">
                {(["up", "degraded", "down", "not_configured"] as ViewStatus[]).map((s) => (
                  <li key={s} className="flex items-center gap-1.5">
                    <StatusMark status={s} />
                    {STATUS_LABEL[s]}
                  </li>
                ))}
              </ul>
            </>
          )}
        </aside>
      </div>

      <section className="flex flex-col gap-3" aria-label="Uptime per service">
        <h2 className="text-sm font-medium">
          Uptime <span className="font-normal text-muted-foreground">· {label}</span>
        </h2>
        <ul className="flex flex-col divide-y rounded-xl border bg-panel">
          {view.probes.map((p) => (
            <li key={p.id} className="grid grid-cols-1 items-center gap-3 px-4 py-3 md:grid-cols-[200px_minmax(0,1fr)_110px]">
              <div className="flex flex-col">
                <span className="flex items-center gap-2 text-sm">
                  <StatusMark status={p.status as ViewStatus} />
                  {p.name}
                  <span className="sr-only">: {STATUS_LABEL[p.status as ViewStatus]}</span>
                </span>
                <span className="pl-4 text-[10px] tracking-wide text-muted-foreground uppercase">{TIER_LABEL[p.tier]}</span>
              </div>
              <BucketStrip buckets={p.buckets} counts={p.counts} bucketMs={bucketMs} now={now} label={`${p.name}, ${label}`} className="h-6" />
              <div className="flex flex-row items-baseline justify-between gap-2 md:flex-col md:items-end md:gap-0">
                <span className="font-mono text-sm tabular">{p.status === "not_configured" ? "—" : formatPct(p.uptime)}</span>
                <span className="text-xs text-muted-foreground">
                  {p.status === "not_configured" ? "not configured" : p.downBuckets ? `${p.downBuckets} down` : "none down"}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3" aria-label="Incidents">
        <h2 className="text-sm font-medium">
          Incidents <span className="font-normal text-muted-foreground">· last 30 days</span>
        </h2>
        {view.incidents.ongoing.length + view.incidents.recent.length === 0 && view.incidents.page === 0 ? (
          <p className="rounded-xl border bg-panel px-4 py-6 text-center text-sm text-muted-foreground">No incidents in the last 30 days.</p>
        ) : (
          <ul className="flex flex-col divide-y rounded-xl border bg-panel">
            {[...view.incidents.ongoing, ...view.incidents.recent].map((i) => {
              const end = i.resolvedAt ? Date.parse(i.resolvedAt) : now;
              return (
                <li key={i.id} className="grid grid-cols-1 gap-1 px-4 py-3 text-sm md:grid-cols-[220px_140px_minmax(0,1fr)_150px] md:items-center md:gap-4">
                  <span className="flex items-center gap-2">
                    <StatusMark status={i.severity} />
                    <span className="font-medium">{i.name}</span>
                    <span className={cn("text-xs", i.severity === "down" ? "text-danger" : "text-warning")}>{i.severity === "down" ? "Down" : "Degraded"}</span>
                  </span>
                  <span className="font-mono text-xs text-muted-foreground tabular">{formatWhen(i.startedAt)}</span>
                  <span className="truncate font-mono text-xs text-muted-foreground" title={i.message ?? undefined}>
                    {i.message ?? "—"}
                  </span>
                  <span className={cn("font-mono text-xs tabular md:text-right", i.resolvedAt ? "text-muted-foreground" : "text-danger")}>
                    {i.resolvedAt ? `Resolved after ${formatClock(end - Date.parse(i.startedAt))}` : `Ongoing · ${formatClock(end - Date.parse(i.startedAt))}`}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        <Pager page={view.incidents.page} hasMore={view.incidents.hasMore} params={{ range: view.range === "24h" ? undefined : view.range }} param="ip" />
      </section>
    </>
  );
}

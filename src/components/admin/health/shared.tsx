import { cn } from "@/lib/utils";
import type { BucketStatus } from "@/lib/uptime";

export type ViewStatus = "up" | "degraded" | "down" | "not_configured" | "unknown";

export const STATUS_LABEL: Record<ViewStatus, string> = {
  up: "Operational",
  degraded: "Degraded",
  down: "Down",
  not_configured: "Not configured",
  unknown: "No data yet",
};

export const TIER_LABEL: Record<string, string> = {
  app: "App",
  data: "Data",
  queue: "Queue",
  engine: "Gateway",
  storage: "Storage",
  workers: "Engine worker",
};

/** Status marker: shape differs as well as colour (dot, triangle, square, ring), so it never relies on colour alone. */
export function StatusMark({ status, className }: { status: ViewStatus; className?: string }) {
  if (status === "degraded")
    return (
      <svg viewBox="0 0 10 10" className={cn("size-2.5 shrink-0 fill-warning", className)} aria-hidden>
        <path d="M5 0.5 9.6 9.5H0.4z" />
      </svg>
    );
  if (status === "down") return <span className={cn("size-2 shrink-0 bg-danger", className)} aria-hidden />;
  if (status === "up") return <span className={cn("size-2 shrink-0 rounded-full bg-success", className)} aria-hidden />;
  return <span className={cn("size-2 shrink-0 rounded-full border border-muted-foreground", className)} aria-hidden />;
}

const BAR: Record<BucketStatus, string> = { none: "bg-panel-raised", up: "bg-success", degraded: "bg-warning", down: "bg-danger" };

// Fixed timezone and a server-provided "now", so server and browser render identical tooltips.
const fmtDay = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
const fmtTime = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });

export function BucketStrip({ buckets, bucketMs, now, label, className }: { buckets: BucketStatus[]; bucketMs: number; now: number; label: string; className?: string }) {
  const down = buckets.filter((b) => b === "down").length;
  return (
    <div className={cn("flex h-7 items-stretch gap-[2px]", className)} role="img" aria-label={`${label}: ${down ? `${down} bucket${down === 1 ? "" : "s"} with downtime` : "no downtime"}`}>
      {buckets.map((b, i) => {
        const end = now - (buckets.length - 1 - i) * bucketMs;
        const start = new Date(end - bucketMs);
        const when = bucketMs >= 86_400_000 ? fmtDay.format(start) : fmtTime.format(start);
        return <span key={i} className={cn("min-w-0 flex-1 rounded-[2px]", BAR[b])} title={`${when}: ${b === "none" ? "no data" : STATUS_LABEL[b]}`} />;
      })}
    </div>
  );
}

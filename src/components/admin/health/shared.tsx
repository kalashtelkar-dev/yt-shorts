"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { BucketStatus, Counts } from "@/lib/uptime";

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
  email: "Email",
  payments: "Payments",
  engine: "Gateway",
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
const fmtTime = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });

const fmtClock = new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });

/** Uptime bars with a hover card per bucket: time slot, status, check counts and optional extra lines. */
export function BucketStrip({
  buckets,
  bucketMs,
  now,
  label,
  counts,
  extra,
  className,
}: {
  buckets: BucketStatus[];
  bucketMs: number;
  now: number;
  label: string;
  counts?: Counts[];
  extra?: (i: number) => string[];
  className?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const down = buckets.filter((b) => b === "down").length;
  const n = buckets.length;

  const slot = (i: number) => {
    const end = new Date(now - (n - 1 - i) * bucketMs);
    const start = new Date(end.getTime() - bucketMs);
    return bucketMs >= 86_400_000 ? fmtDay.format(start) : `${fmtTime.format(start)} – ${fmtClock.format(end)}`;
  };

  return (
    <div className="relative" onMouseLeave={() => setHover(null)}>
      <div
        className={cn("flex h-7 items-stretch gap-[2px]", className)}
        role="img"
        aria-label={`${label}: ${down ? `${down} bucket${down === 1 ? "" : "s"} with downtime` : "no downtime"}`}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setHover(Math.min(n - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * n))));
        }}
      >
        {buckets.map((b, i) => (
          <span key={i} className={cn("min-w-0 flex-1 rounded-[2px] transition-opacity", BAR[b], hover !== null && hover !== i && "opacity-60")} />
        ))}
      </div>
      {hover !== null && (
        <div
          className="pointer-events-none absolute bottom-full z-20 mb-2 w-max max-w-64 rounded-md border bg-popover px-3 py-2 text-xs shadow-lg"
          style={{
            left: `${((hover + 0.5) / n) * 100}%`,
            transform: `translateX(${hover / n < 0.15 ? "-10%" : hover / n > 0.85 ? "-90%" : "-50%"})`,
          }}
        >
          <p className="font-mono text-muted-foreground tabular">{slot(hover)}</p>
          <p className="mt-1 flex items-center gap-1.5 font-medium">
            {buckets[hover] !== "none" && <StatusMark status={buckets[hover]} />}
            {buckets[hover] === "none" ? "No checks" : STATUS_LABEL[buckets[hover]]}
          </p>
          {counts?.[hover] && counts[hover].checks > 0 && (
            <p className="mt-1 font-mono text-muted-foreground tabular">
              {counts[hover].checks} checks · {counts[hover].up} up
              {counts[hover].degraded ? ` · ${counts[hover].degraded} slow` : ""}
              {counts[hover].down ? ` · ${counts[hover].down} down` : ""}
            </p>
          )}
          {extra?.(hover).map((line) => (
            <p key={line} className="mt-1 text-muted-foreground">
              {line}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

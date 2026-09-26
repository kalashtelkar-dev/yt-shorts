// Uptime bucketing (PLAN.md §6). Pure, shared by server and client.

export type ProbeStatus = "up" | "degraded" | "down" | "not_configured";
export type BucketStatus = "none" | "up" | "degraded" | "down";
export type Range = "24h" | "7d" | "90d";

export const RANGES: Record<Range, { buckets: number; bucketMs: number; label: string }> = {
  "24h": { buckets: 96, bucketMs: 15 * 60_000, label: "last 24 hours" },
  "7d": { buckets: 84, bucketMs: 2 * 3_600_000, label: "last 7 days" },
  "90d": { buckets: 90, bucketMs: 86_400_000, label: "last 90 days" },
};

export type Counts = { checks: number; up: number; degraded: number; down: number };

/**
 * A bucket is "up" when at least 99% of its checks were available (degraded still counts as
 * available: slow, not broken). Mostly-degraded buckets show amber. No checks = no data.
 * "Not configured" checks are never counted.
 */
export function bucketStatus(c: Counts): BucketStatus {
  if (c.checks === 0) return "none";
  if ((c.up + c.degraded) / c.checks < 0.99) return "down";
  return c.degraded / c.checks >= 0.5 ? "degraded" : "up";
}

/** Share of available checks over the whole range, or null with no data. */
export function uptimeOf(buckets: Counts[]): number | null {
  const t = buckets.reduce((a, b) => ({ checks: a.checks + b.checks, ok: a.ok + b.up + b.degraded }), { checks: 0, ok: 0 });
  return t.checks ? t.ok / t.checks : null;
}

const RANK: Record<BucketStatus, number> = { none: 0, up: 1, degraded: 2, down: 3 };

/** Fleet = worst of the critical probes, bucket by bucket (a missing bucket doesn't hide a failing one). */
export function worstOf(series: BucketStatus[][]): BucketStatus[] {
  if (!series.length) return [];
  return series[0].map((_, i) => series.reduce<BucketStatus>((w, s) => (RANK[s[i]] > RANK[w] ? s[i] : w), "none"));
}

/** Fleet uptime = the lowest uptime among critical probes. */
export function fleetUptime(uptimes: (number | null)[]): number | null {
  const known = uptimes.filter((u): u is number => u !== null);
  return known.length ? Math.min(...known) : null;
}

export const formatPct = (u: number | null) => (u === null ? "—" : `${(Math.floor(u * 10_000) / 100).toFixed(2)}%`);

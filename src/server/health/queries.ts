import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { redis } from "@/server/redis";
import { bucketStatus, fleetUptime, RANGES, uptimeOf, worstOf, type Counts, type ProbeStatus, type Range } from "@/lib/uptime";
import { probeCatalog } from ".";
import { HEARTBEAT_KEY } from "./probes/worker";
import type { HealthView, IncidentView, ProbeView } from "@/lib/health";
import { and, desc, gte, isNotNull, isNull } from "drizzle-orm";
import { incidents } from "@/db/schema";

const empty = (): Counts => ({ checks: 0, up: 0, degraded: 0, down: 0 });

const INCIDENTS_PAGE = 10;

export async function healthView(range: Range, incidentPage = 0): Promise<HealthView> {
  const probes = await probeCatalog();
  const ids = probes.map((p) => p.id);
  const { buckets: n, bucketMs } = RANGES[range];
  const now = Date.now();
  const start = now - n * bucketMs;
  const idList = sql.join(ids.map((id) => sql`${id}`), sql`, `);

  const [latest, recent, counts, beat] = await Promise.all([
    db.execute<{ probe_id: string; status: ProbeStatus; latency_ms: number | null; message: string | null; checked_at: Date }>(sql`
      select distinct on (probe_id) probe_id, status, latency_ms, message, checked_at
      from probe_results where probe_id in (${idList}) and checked_at > now() - interval '1 day'
      order by probe_id, checked_at desc`),
    db.execute<{ probe_id: string; status: ProbeStatus; latency_ms: number | null; message: string | null; checked_at: Date }>(sql`
      select probe_id, status, latency_ms, message, checked_at from (
        select *, row_number() over (partition by probe_id order by checked_at desc) as rn
        from probe_results where probe_id in (${idList}) and checked_at > now() - interval '1 day'
      ) r where rn <= 50 order by checked_at desc`),
    range === "90d"
      ? db.execute<{ probe_id: string; idx: number; checks: number; up: number; degraded: number; down: number }>(sql`
          select probe_id, (${n - 1}::int - (current_date - day::date))::int as idx, checks, up, degraded, down
          from probe_daily where probe_id in (${idList}) and day::date > current_date - ${n}::int`)
      : db.execute<{ probe_id: string; idx: number; checks: number; up: number; degraded: number; down: number }>(sql`
          select probe_id,
            floor((extract(epoch from checked_at) * 1000 - ${start}) / ${bucketMs})::int as idx,
            count(*) filter (where status <> 'not_configured')::int as checks,
            count(*) filter (where status = 'up')::int as up,
            count(*) filter (where status = 'degraded')::int as degraded,
            count(*) filter (where status = 'down')::int as down
          from probe_results
          where probe_id in (${idList}) and checked_at >= to_timestamp(${start / 1000})
          group by 1, 2`),
    redis.get(HEARTBEAT_KEY),
  ]);
  // Ongoing incidents always show; resolved ones from the last 30 days are paged.
  const [ongoingRows, resolvedRows] = await Promise.all([
    db.select().from(incidents).where(isNull(incidents.resolvedAt)).orderBy(desc(incidents.startedAt)),
    db
      .select()
      .from(incidents)
      .where(and(isNotNull(incidents.resolvedAt), gte(incidents.startedAt, new Date(now - 30 * 86_400_000))))
      .orderBy(desc(incidents.startedAt))
      .limit(INCIDENTS_PAGE + 1)
      .offset(incidentPage * INCIDENTS_PAGE),
  ]);

  const byProbe = new Map<string, Counts[]>(ids.map((id) => [id, Array.from({ length: n }, empty)]));
  for (const r of counts) {
    const arr = byProbe.get(r.probe_id);
    if (arr && r.idx >= 0 && r.idx < n) arr[r.idx] = { checks: r.checks, up: r.up, degraded: r.degraded, down: r.down };
  }
  const latestBy = new Map(latest.map((r) => [r.probe_id, r]));

  const views: ProbeView[] = probes.map((p) => {
    const c = byProbe.get(p.id)!;
    const buckets = c.map(bucketStatus);
    const l = latestBy.get(p.id);
    return {
      id: p.id,
      name: p.name,
      tier: p.tier,
      critical: p.critical,
      status: l?.status ?? "unknown",
      latencyMs: l?.latency_ms ?? null,
      message: l?.message ?? null,
      checkedAt: l ? new Date(l.checked_at).toISOString() : null,
      buckets,
      counts: c,
      uptime: uptimeOf(c),
      downBuckets: buckets.filter((b) => b === "down").length,
      recent: recent
        .filter((r) => r.probe_id === p.id)
        .map((r) => ({ at: new Date(r.checked_at).toISOString(), status: r.status, latencyMs: r.latency_ms, message: r.message })),
    };
  });

  const critical = views.filter((v) => v.critical && v.status !== "not_configured");
  const lastSweep = latest.reduce<Date | null>((m, r) => (!m || new Date(r.checked_at) > m ? new Date(r.checked_at) : m), null);
  const names = new Map(probes.map((p) => [p.id, p.name]));
  const toIncident = (i: typeof incidents.$inferSelect): IncidentView => ({
    id: i.id,
    probeId: i.probeId,
    name: names.get(i.probeId) ?? i.probeId,
    severity: i.severity === "down" ? "down" : "degraded",
    startedAt: i.startedAt.toISOString(),
    resolvedAt: i.resolvedAt?.toISOString() ?? null,
    message: i.lastMessage,
  });
  return {
    range,
    probes: views,
    fleet: {
      uptime: fleetUptime(critical.map((v) => v.uptime)),
      buckets: worstOf(critical.map((v) => v.buckets)),
      criticalCount: critical.length,
      troubled: Array.from({ length: n }, (_, i) => critical.filter((v) => v.buckets[i] === "down" || v.buckets[i] === "degraded").map((v) => v.name)),
    },
    incidents: {
      ongoing: ongoingRows.map(toIncident),
      recent: resolvedRows.slice(0, INCIDENTS_PAGE).map(toIncident),
      page: incidentPage,
      hasMore: resolvedRows.length > INCIDENTS_PAGE,
    },
    lastSweepAt: lastSweep?.toISOString() ?? null,
    workerAlive: !!beat && now - Number(beat) < 60_000,
    generatedAt: new Date(now).toISOString(),
  };
}

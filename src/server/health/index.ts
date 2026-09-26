import "server-only";
import { eq, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { catalogItems, probeDaily, probeResults } from "@/db/schema";
import { enginex } from "@/server/enginex/client";
import type { FleetStatus } from "@/server/enginex/types";
import { engineProbe } from "./probes/engines";
import { enginexProbe } from "./probes/enginex";
import { postgresProbe } from "./probes/postgres";
import { queueProbe } from "./probes/queue";
import { redisProbe } from "./probes/redis";
import { storageProbe } from "./probes/storage";
import { webProbe } from "./probes/web";
import { workerProbe } from "./probes/worker";
import type { Probe, ProbeResult, SweepContext } from "./types";

// Only what the app actually uses (SMTP and Razorpay join with milestones 10 and 12).
const STATIC_PROBES: Probe[] = [webProbe, workerProbe, postgresProbe, redisProbe, queueProbe, enginexProbe, storageProbe];

const TIMEOUT_MS = 5000;
const ENGINE_CACHE_MS = 10 * 60_000;
const RAW_KEEP_DAYS = 8;
const DAILY_KEEP_DAYS = 90;

let engineCache: { at: number; engines: string[] } | null = null;

/**
 * Engines used by the pipelines of enabled catalog items, read from their graphs.
 * Scheduler-evaluated nodes (e.g. "util") aren't workers, so only engines Engine X knows count.
 */
export async function usedEngines(): Promise<string[]> {
  if (engineCache && Date.now() - engineCache.at < ENGINE_CACHE_MS) return engineCache.engines;
  const client = enginex();
  const items = await db.select({ templateId: catalogItems.templateId }).from(catalogItems).where(eq(catalogItems.enabled, true));
  const [fleet, pipelines] = await Promise.all([client.fleetStatus(), Promise.allSettled(items.map((i) => client.getPipeline(i.templateId)))]);
  const engines = new Set<string>();
  for (const p of pipelines) {
    if (p.status !== "fulfilled") continue;
    const nodes = ((p.value.raw as { graph?: { nodes?: { kind?: string; engine?: string }[] } }).graph?.nodes ?? []);
    for (const n of nodes) if (n.kind === "engine" && n.engine && fleet.known.includes(n.engine)) engines.add(n.engine);
  }
  const list = [...engines].sort();
  // Keep the previous list if Engine X was unreachable, rather than dropping every engine probe.
  if (list.length || !engineCache) engineCache = { at: Date.now(), engines: list };
  return engineCache.engines;
}

/** Every probe currently in play, in display order. */
export async function probeCatalog(): Promise<Probe[]> {
  const engines = await usedEngines().catch(() => engineCache?.engines ?? []);
  return [...STATIC_PROBES, ...engines.map(engineProbe)];
}

function redact(msg: string) {
  return msg.replace(/ek_(live|test)_\w+/g, "ek_***").slice(0, 300);
}

/** Runs one probe with the 5 s limit; slow → degraded, error or timeout → down. */
export async function runProbe(p: Probe, ctx: SweepContext): Promise<ProbeResult & { latencyMs: number | null }> {
  const t = performance.now();
  try {
    const result = await Promise.race([
      p.run(ctx),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`Timed out after ${TIMEOUT_MS / 1000} s`)), TIMEOUT_MS)),
    ]);
    const latencyMs = p.derived ? null : Math.round(performance.now() - t);
    const status = result.status === "up" && p.degradedMs && latencyMs !== null && latencyMs > p.degradedMs ? "degraded" : result.status;
    return { ...result, status, latencyMs, message: result.message ?? (status === "degraded" ? `Slow: ${latencyMs} ms` : null) };
  } catch (e) {
    return { status: "down", latencyMs: Math.round(performance.now() - t), message: redact(e instanceof Error ? e.message : String(e)) };
  }
}

let lastCleanup = 0;

/** The worker calls this every 30 s. */
export async function runHealthSweep(now = new Date()) {
  let fleet: Promise<FleetStatus> | null = null;
  const ctx: SweepContext = { fleet: () => (fleet ??= enginex().fleetStatus()) };
  const probes = await probeCatalog();
  const results = await Promise.all(probes.map(async (p) => ({ probe: p, result: await runProbe(p, ctx) })));

  const day = now.toISOString().slice(0, 10);
  await db.transaction(async (tx) => {
    await tx.insert(probeResults).values(
      results.map(({ probe, result }) => ({ probeId: probe.id, status: result.status, latencyMs: result.latencyMs, message: result.message ?? null, checkedAt: now })),
    );
    for (const { probe, result } of results) {
      if (result.status === "not_configured") continue;
      const add = { checks: 1, up: result.status === "up" ? 1 : 0, degraded: result.status === "degraded" ? 1 : 0, down: result.status === "down" ? 1 : 0 };
      await tx
        .insert(probeDaily)
        .values({ probeId: probe.id, day, ...add })
        .onConflictDoUpdate({
          target: [probeDaily.probeId, probeDaily.day],
          set: {
            checks: sql`${probeDaily.checks} + ${add.checks}`,
            up: sql`${probeDaily.up} + ${add.up}`,
            degraded: sql`${probeDaily.degraded} + ${add.degraded}`,
            down: sql`${probeDaily.down} + ${add.down}`,
          },
        });
    }
  });

  if (now.getTime() - lastCleanup > 3_600_000) {
    lastCleanup = now.getTime();
    await db.delete(probeResults).where(lt(probeResults.checkedAt, new Date(now.getTime() - RAW_KEEP_DAYS * 86_400_000)));
    await db.delete(probeDaily).where(lt(probeDaily.day, new Date(now.getTime() - DAILY_KEEP_DAYS * 86_400_000).toISOString().slice(0, 10)));
  }
  return results;
}

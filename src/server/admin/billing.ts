import "server-only";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { adminAuditLog, catalogItems, settings } from "@/db/schema";
import type { ActionResult } from "@/lib/jobs";
import { getSettings } from "@/server/settings";
import type { Admin } from "./guard";

export const settingsInput = z.strictObject({
  costPaisePerSecond: z.number().int().min(0).max(100_000),
  sellPaisePerCredit: z.number().int().min(1).max(100_000).nullable(),
  starterCredits: z.number().int().min(0).max(1_000_000),
  maxUploadMb: z.number().int().min(1).max(20_000),
  maxConcurrentJobsPerUser: z.number().int().min(1).max(50),
  maxRunMinutes: z.number().int().min(5).max(24 * 60),
});

export async function updateSettings(admin: Admin, raw: unknown): Promise<ActionResult<null>> {
  const parsed = settingsInput.safeParse(raw);
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    return { ok: false, error: { code: "invalid", message: `${String(i.path[0] ?? "Form")}: ${i.message}`, field: String(i.path[0] ?? "") } };
  }
  const before = await getSettings();
  await db.transaction(async (tx) => {
    await tx.update(settings).set(parsed.data).where(eq(settings.id, 1));
    const { updatedAt: _b, ...prev } = before;
    await tx.insert(adminAuditLog).values({ adminId: admin.id, action: "settings.update", target: "settings", before: prev, after: parsed.data });
  });
  return { ok: true, data: null };
}

export type CostRow = {
  slug: string;
  title: string;
  durationSec: number;
  jobs: number;
  succeeded: number;
  medianRunMs: number | null;
  costPaise: number;
  failedCostPaise: number;
  netCredits: number;
  price: number | null;
};

/**
 * What each style and length cost in compute vs what it earned, over the last `days` days.
 * Net credits = charges that weren't refunded. Failed runs still cost compute; that cost is
 * spread over successful montages when working out cost per montage.
 */
export async function costReport(days = 30) {
  const s = await getSettings();
  const result = await db.execute<{
    slug: string;
    duration_sec: number;
    jobs: number;
    succeeded: number;
    median_run_ms: number | null;
    cost_paise: number;
    failed_cost_paise: number;
    net_credits: number;
  }>(sql`
    select j.catalog_slug as slug, j.duration_sec,
      count(*)::int as jobs,
      count(*) filter (where j.status = 'succeeded')::int as succeeded,
      (percentile_cont(0.5) within group (order by j.run_ms) filter (where j.status = 'succeeded'))::int as median_run_ms,
      coalesce(sum(j.compute_cost_paise), 0)::int as cost_paise,
      coalesce(sum(j.compute_cost_paise) filter (where j.status <> 'succeeded'), 0)::int as failed_cost_paise,
      coalesce(sum(j.charged_credits) filter (
        where j.status = 'succeeded' and not exists (select 1 from credit_ledger l where l.job_id = j.id and l.kind = 'refund')
      ), 0)::int as net_credits
    from jobs j
    where j.created_at >= now() - make_interval(days => ${days})
      and j.status in ('succeeded', 'failed', 'canceled')
    group by j.catalog_slug, j.duration_sec
    order by j.catalog_slug, j.duration_sec`);
  const items = await db.select({ slug: catalogItems.slug, title: catalogItems.title, prices: catalogItems.prices }).from(catalogItems);
  const bySlug = new Map(items.map((i) => [i.slug, i]));

  const rows: CostRow[] = result.map((r) => ({
    slug: r.slug,
    title: bySlug.get(r.slug)?.title ?? r.slug,
    durationSec: r.duration_sec,
    jobs: r.jobs,
    succeeded: r.succeeded,
    medianRunMs: r.median_run_ms,
    costPaise: r.cost_paise,
    failedCostPaise: r.failed_cost_paise,
    netCredits: r.net_credits,
    price: bySlug.get(r.slug)?.prices[String(r.duration_sec)] ?? null,
  }));
  const totals = rows.reduce(
    (t, r) => ({ costPaise: t.costPaise + r.costPaise, failedCostPaise: t.failedCostPaise + r.failedCostPaise, netCredits: t.netCredits + r.netCredits, jobs: t.jobs + r.jobs }),
    { costPaise: 0, failedCostPaise: 0, netCredits: 0, jobs: 0 },
  );
  return { rows, totals, sellPaisePerCredit: s.sellPaisePerCredit, costPaisePerSecond: s.costPaisePerSecond, days };
}

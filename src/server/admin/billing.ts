import "server-only";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { adminAuditLog, catalogItems, settings, type CreditRange } from "@/db/schema";
import { GSTIN_RE } from "@/lib/billing";
import type { ActionResult } from "@/lib/jobs";
import { getSettings } from "@/server/settings";
import type { Admin } from "./guard";

const text = (max: number) => z.string().trim().max(max).optional().transform((v) => v || undefined);
export const sellerInput = z.strictObject({
  legalName: text(120),
  address: text(300),
  stateCode: z.string().trim().regex(/^\d{2}$/, "Use the 2-digit GST state code").optional().or(z.literal("").transform(() => undefined)),
  gstin: z.string().trim().toUpperCase().regex(GSTIN_RE, "That GSTIN doesn't look right").optional().or(z.literal("").transform(() => undefined)),
  pan: z.string().trim().toUpperCase().regex(/^[A-Z]{5}\d{4}[A-Z]$/, "That PAN doesn't look right").optional().or(z.literal("").transform(() => undefined)),
  email: z.email().optional().or(z.literal("").transform(() => undefined)),
  phone: text(30),
  website: text(120),
  sac: z.string().trim().regex(/^\d{4,8}$/, "SAC codes are 4 to 8 digits").optional().or(z.literal("").transform(() => undefined)),
  signatory: text(80),
});

export const settingsInput = z.strictObject({
  costPaisePerSecond: z.number().int().min(0).max(100_000),
  sellPaisePerCredit: z.number().int().min(1).max(100_000),
  minPurchasePaise: z.number().int().min(100).max(10_000_000),
  maxPurchasePaise: z.number().int().min(100).max(10_000_000),
  gstRateBps: z.number().int().min(0).max(5000),
  seller: sellerInput,
  starterCredits: z.number().int().min(0).max(1_000_000),
  maxUploadMb: z.number().int().min(1).max(20_000),
  maxConcurrentJobsPerUser: z.number().int().min(1).max(50),
  maxRunMinutes: z.number().int().min(5).max(24 * 60),
});

export async function updateSettings(admin: Admin, raw: unknown): Promise<ActionResult<null>> {
  const parsed = settingsInput
    .refine((v) => v.minPurchasePaise <= v.maxPurchasePaise, { message: "The smallest top-up can't be more than the largest", path: ["minPurchasePaise"] })
    .safeParse(raw);
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
  range: CreditRange | null;
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
  const items = await db.select({ slug: catalogItems.slug, title: catalogItems.title, creditRanges: catalogItems.creditRanges }).from(catalogItems);
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
    range: bySlug.get(r.slug)?.creditRanges[String(r.duration_sec)] ?? null,
  }));
  const totals = rows.reduce(
    (t, r) => ({ costPaise: t.costPaise + r.costPaise, failedCostPaise: t.failedCostPaise + r.failedCostPaise, netCredits: t.netCredits + r.netCredits, jobs: t.jobs + r.jobs }),
    { costPaise: 0, failedCostPaise: 0, netCredits: 0, jobs: 0 },
  );
  // What a credit earns after GST, for revenue and margin.
  const netPaisePerCredit = (s.sellPaisePerCredit * 10_000) / (10_000 + s.gstRateBps);
  return { rows, totals, sellPaisePerCredit: s.sellPaisePerCredit, netPaisePerCredit, costPaisePerSecond: s.costPaisePerSecond, days };
}

import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { creditLedger, payments } from "@/db/schema";

// A user's credit history for their billing page: every ledger row with the balance after it, newest first.

export type FeedFilter = "all" | "purchases" | "montages";
const KINDS: Record<Exclude<FeedFilter, "all">, string[]> = { purchases: ["purchase", "grant"], montages: ["charge", "refund"] };

export type FeedRow = {
  id: string;
  kind: string;
  delta: number;
  balanceAfter: number;
  at: string;
  jobId: string | null;
  styleTitle: string | null;
  durationSec: number | null;
  runMs: number | null;
  amountPaise: number | null;
  method: string | null;
  invoiceId: string | null;
  invoiceNumber: string | null;
};

export async function creditFeed(userId: string, filter: FeedFilter, page: number, size = 20): Promise<{ rows: FeedRow[]; hasMore: boolean }> {
  const kinds = filter === "all" ? null : KINDS[filter];
  // The running balance is computed over every row first, then filtered, so it stays right on every page and filter.
  const result = await db.execute<{
    id: string;
    kind: string;
    delta: number;
    balance_after: number;
    created_at: Date;
    job_id: string | null;
    style_title: string | null;
    duration_sec: number | null;
    run_ms: number | null;
    amount_paise: number | null;
    method: string | null;
    invoice_id: string | null;
    invoice_number: string | null;
  }>(sql`
    select t.*, j.duration_sec, j.run_ms, c.title as style_title, p.amount_paise, p.method, i.id as invoice_id, i.number as invoice_number
    from (
      select l.id, l.kind::text as kind, l.delta, l.created_at, l.job_id, l.payment_id,
        (sum(l.delta) over (order by l.created_at, l.id))::int as balance_after
      from credit_ledger l where l.user_id = ${userId}
    ) t
    left join jobs j on j.id = t.job_id
    left join catalog_items c on c.id = j.catalog_item_id
    left join payments p on p.id = t.payment_id
    left join invoices i on i.payment_id = t.payment_id
    ${kinds ? sql`where t.kind in (${sql.join(kinds.map((k) => sql`${k}`), sql`, `)})` : sql``}
    order by t.created_at desc, t.id desc
    limit ${size + 1} offset ${page * size}`);
  const rows = result.slice(0, size).map((r) => ({
    id: r.id,
    kind: r.kind,
    delta: r.delta,
    balanceAfter: r.balance_after,
    at: new Date(r.created_at).toISOString(),
    jobId: r.job_id,
    styleTitle: r.style_title,
    durationSec: r.duration_sec,
    runMs: r.run_ms,
    amountPaise: r.amount_paise,
    method: r.method,
    invoiceId: r.invoice_id,
    invoiceNumber: r.invoice_number,
  }));
  return { rows, hasMore: result.length > size };
}

/** Totals for the billing summary: rupees paid, credits used by montages, montages made. */
export async function billingTotals(userId: string) {
  const [[paid], [used]] = await Promise.all([
    db
      .select({ paise: sql<number>`coalesce(sum(${payments.amountPaise}), 0)::int` })
      .from(payments)
      .where(and(eq(payments.userId, userId), eq(payments.status, "paid"))),
    db
      .select({
        credits: sql<number>`coalesce(-sum(${creditLedger.delta}) filter (where ${creditLedger.kind} in ('charge', 'refund')), 0)::int`,
        montages: sql<number>`count(*) filter (where ${creditLedger.kind} = 'charge')::int`,
      })
      .from(creditLedger)
      .where(eq(creditLedger.userId, userId)),
  ]);
  return { paidPaise: paid.paise, creditsUsed: used.credits, montages: used.montages };
}

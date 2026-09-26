import "server-only";
import { and, desc, eq, gte, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { adminAuditLog, catalogItems, creditLedger, jobEvents, jobs, userBalances, users } from "@/db/schema";
import { enginex } from "@/server/enginex/client";
import type { RunStep } from "@/server/enginex/types";

// Read side of the admin. Admin pages may see raw Engine X data (CLAUDE.md §4.8).

const PAGE = 50;
const IST_TODAY = sql`(date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata')`;

export async function overviewStats() {
  const window = async (since: SQL) => {
    const [r] = await db
      .select({
        total: sql<number>`count(*)::int`,
        succeeded: sql<number>`count(*) filter (where ${jobs.status} = 'succeeded')::int`,
        failed: sql<number>`count(*) filter (where ${jobs.status} in ('failed', 'canceled'))::int`,
        running: sql<number>`count(*) filter (where ${jobs.status} in ('queued', 'starting', 'running'))::int`,
        avgRunMs: sql<number | null>`avg(${jobs.runMs}) filter (where ${jobs.status} = 'succeeded')::int`,
        costPaise: sql<number>`coalesce(sum(${jobs.computeCostPaise}), 0)::int`,
      })
      .from(jobs)
      .where(gte(jobs.createdAt, since));
    const [c] = await db
      .select({ used: sql<number>`coalesce(-sum(${creditLedger.delta}) filter (where ${creditLedger.kind} in ('charge', 'refund')), 0)::int` })
      .from(creditLedger)
      .where(gte(creditLedger.createdAt, since));
    return { ...r, creditsUsed: c.used };
  };
  const [today, week] = await Promise.all([window(IST_TODAY), window(sql`now() - interval '7 days'`)]);
  const recentFailures = await db
    .select({ id: jobs.id, createdAt: jobs.createdAt, catalogSlug: jobs.catalogSlug, errorRaw: jobs.errorRaw })
    .from(jobs)
    .where(inArray(jobs.status, ["failed", "canceled"]))
    .orderBy(desc(jobs.createdAt))
    .limit(5);
  return { today, week, recentFailures };
}

export async function listUsers(q: string, kind: "real" | "all" | "anonymous", page = 0) {
  const filters: SQL[] = [];
  if (kind === "real") filters.push(eq(users.isAnonymous, false));
  if (kind === "anonymous") filters.push(eq(users.isAnonymous, true));
  const term = q.trim();
  if (term) {
    const like = `%${term.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
    filters.push(or(ilike(users.email, like), ilike(users.name, like), eq(sql`${users.id}::text`, term))!);
  }
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      isAnonymous: users.isAnonymous,
      role: users.role,
      suspendedAt: users.suspendedAt,
      createdAt: users.createdAt,
      balance: sql<number>`coalesce(${userBalances.balance}, 0)::int`,
      jobCount: sql<number>`(select count(*) from ${jobs} where ${jobs.userId} = ${users.id})::int`,
    })
    .from(users)
    .leftJoin(userBalances, eq(userBalances.userId, users.id))
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(users.createdAt))
    .limit(PAGE + 1)
    .offset(page * PAGE);
  return { rows: rows.slice(0, PAGE), hasMore: rows.length > PAGE };
}

export async function userDetail(userId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return null;
  const [user] = await db
    .select({ user: users, balance: sql<number>`coalesce(${userBalances.balance}, 0)::int` })
    .from(users)
    .leftJoin(userBalances, eq(userBalances.userId, users.id))
    .where(eq(users.id, userId));
  if (!user) return null;
  const [ledger, userJobs] = await Promise.all([
    db.select().from(creditLedger).where(eq(creditLedger.userId, userId)).orderBy(desc(creditLedger.createdAt)).limit(PAGE),
    db
      .select({ id: jobs.id, status: jobs.status, catalogSlug: jobs.catalogSlug, durationSec: jobs.durationSec, chargedCredits: jobs.chargedCredits, createdAt: jobs.createdAt })
      .from(jobs)
      .where(eq(jobs.userId, userId))
      .orderBy(desc(jobs.createdAt))
      .limit(PAGE),
  ]);
  return { ...user.user, balance: user.balance, ledger, jobs: userJobs };
}

export async function recentAdjustments() {
  return db
    .select({ entry: creditLedger, email: users.email, isAnonymous: users.isAnonymous })
    .from(creditLedger)
    .innerJoin(users, eq(users.id, creditLedger.userId))
    .where(inArray(creditLedger.kind, ["admin_add", "admin_remove", "refund", "grant"]))
    .orderBy(desc(creditLedger.createdAt))
    .limit(PAGE);
}

export type JobStatus = (typeof jobs.$inferSelect)["status"];
export const JOB_STATUSES: JobStatus[] = ["queued", "starting", "running", "succeeded", "failed", "canceled"];

export async function listAllJobs(status: JobStatus | null, catalogSlug: string | null, page = 0) {
  const filters: SQL[] = [];
  if (status) filters.push(eq(jobs.status, status));
  if (catalogSlug) filters.push(eq(jobs.catalogSlug, catalogSlug));
  const rows = await db
    .select({
      id: jobs.id,
      status: jobs.status,
      catalogSlug: jobs.catalogSlug,
      durationSec: jobs.durationSec,
      chargedCredits: jobs.chargedCredits,
      runMs: jobs.runMs,
      computeCostPaise: jobs.computeCostPaise,
      createdAt: jobs.createdAt,
      userId: jobs.userId,
      email: users.email,
      isAnonymous: users.isAnonymous,
    })
    .from(jobs)
    .innerJoin(users, eq(users.id, jobs.userId))
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(jobs.createdAt))
    .limit(PAGE + 1)
    .offset(page * PAGE);
  const slugs = await db.select({ slug: catalogItems.slug, title: catalogItems.title }).from(catalogItems);
  return { rows: rows.slice(0, PAGE), hasMore: rows.length > PAGE, slugs };
}

export async function jobDetail(jobId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) return null;
  const [row] = await db
    .select({ job: jobs, email: users.email, isAnonymous: users.isAnonymous })
    .from(jobs)
    .innerJoin(users, eq(users.id, jobs.userId))
    .where(eq(jobs.id, jobId));
  if (!row) return null;
  const [events, ledger] = await Promise.all([
    db.select().from(jobEvents).where(eq(jobEvents.jobId, jobId)).orderBy(jobEvents.createdAt),
    db.select().from(creditLedger).where(eq(creditLedger.jobId, jobId)).orderBy(creditLedger.createdAt),
  ]);
  // Live step list from Engine X (admin-only). Failure here must not break the page.
  let steps: RunStep[] | null = null;
  let stepsError: string | null = null;
  if (row.job.runId) {
    try {
      steps = (await enginex().getRun(row.job.runId)).steps;
    } catch (e) {
      stepsError = e instanceof Error ? e.message : String(e);
    }
  }
  return { ...row, events, ledger, steps, stepsError };
}

export async function auditLog(page = 0) {
  const rows = await db
    .select({ entry: adminAuditLog, adminEmail: users.email })
    .from(adminAuditLog)
    .innerJoin(users, eq(users.id, adminAuditLog.adminId))
    .orderBy(desc(adminAuditLog.createdAt))
    .limit(PAGE + 1)
    .offset(page * PAGE);
  return { rows: rows.slice(0, PAGE), hasMore: rows.length > PAGE };
}

/** A user id from an email or an id typed by an admin. */
export async function resolveUserId(q: string): Promise<string | null> {
  const term = q.trim();
  const byId = /^[0-9a-f-]{36}$/i.test(term);
  const [u] = await db
    .select({ id: users.id })
    .from(users)
    .where(byId ? eq(users.id, term) : eq(sql`lower(${users.email})`, term.toLowerCase()));
  return u?.id ?? null;
}

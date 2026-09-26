import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { creditLedger, jobs, userBalances } from "@/db/schema";

// The only code that changes balances (CLAUDE.md §5). Every change runs in one transaction:
// lock the balance row, check idempotency, insert the ledger row, update the cached balance.

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Kind = (typeof creditLedger.$inferInsert)["kind"];

export class InsufficientCreditsError extends Error {
  constructor(
    public needed: number,
    public balance: number,
  ) {
    super(`Needs ${needed} credits, balance is ${balance}`);
    this.name = "InsufficientCreditsError";
  }
}

type Entry = {
  userId: string;
  delta: number;
  kind: Kind;
  jobId?: string;
  adminId?: string;
  reason?: string;
  /** Allow the balance to go below zero (only the settle charge does this). */
  allowNegative?: boolean;
};

async function lockBalance(tx: Tx, userId: string): Promise<number> {
  await tx.insert(userBalances).values({ userId, balance: 0 }).onConflictDoNothing();
  const [row] = await tx.select({ balance: userBalances.balance }).from(userBalances).where(eq(userBalances.userId, userId)).for("update");
  return row.balance;
}

/** Applies one ledger entry. Returns false when a job-scoped entry of this kind already exists. */
async function apply(tx: Tx, e: Entry): Promise<boolean> {
  if (!Number.isInteger(e.delta)) throw new Error("Credit deltas must be integers");
  const balance = await lockBalance(tx, e.userId);
  if (e.jobId) {
    const [dup] = await tx
      .select({ id: creditLedger.id })
      .from(creditLedger)
      .where(and(eq(creditLedger.jobId, e.jobId), eq(creditLedger.kind, e.kind)));
    if (dup) return false;
  }
  if (e.delta < 0 && !e.allowNegative && balance + e.delta < 0) throw new InsufficientCreditsError(-e.delta, balance);
  await tx.insert(creditLedger).values({
    userId: e.userId,
    delta: e.delta,
    kind: e.kind,
    jobId: e.jobId,
    adminId: e.adminId,
    reason: e.reason,
  });
  await tx
    .update(userBalances)
    .set({ balance: sql`${userBalances.balance} + ${e.delta}` })
    .where(eq(userBalances.userId, e.userId));
  return true;
}

export async function getBalance(userId: string): Promise<number> {
  const [row] = await db.select({ balance: userBalances.balance }).from(userBalances).where(eq(userBalances.userId, userId));
  return row?.balance ?? 0;
}

export async function grant(userId: string, amount: number, reason: string) {
  if (amount <= 0) return;
  await db.transaction((tx) => apply(tx, { userId, delta: amount, kind: "grant", reason }));
}

/** Reserve inside the caller's transaction, so the job row and the reservation commit together. */
export async function reserve(tx: Tx, userId: string, jobId: string, amount: number) {
  await apply(tx, { userId, delta: -amount, kind: "reserve", jobId, reason: "Reserved for job" });
}

type JobCredits = { userId: string; reservedCredits: number };

async function jobCredits(tx: Tx, jobId: string): Promise<JobCredits> {
  const [job] = await tx.select({ userId: jobs.userId, reservedCredits: jobs.reservedCredits }).from(jobs).where(eq(jobs.id, jobId));
  if (!job) throw new Error(`Job ${jobId} not found`);
  return job;
}

export const creditsForMs = (runMs: number, msPerCredit: number) => Math.ceil(runMs / msPerCredit);

/**
 * On success: release the reservation, then charge actual usage. The charge may take the
 * balance below zero once; reserve() then blocks new jobs until it is topped up.
 * Idempotent: a second call changes nothing and returns the original charge.
 */
export async function settle(jobId: string, runMs: number, msPerCredit: number, tx?: Tx): Promise<number> {
  const run = async (t: Tx) => {
    const job = await jobCredits(t, jobId);
    const charge = creditsForMs(runMs, msPerCredit);
    await apply(t, { userId: job.userId, delta: job.reservedCredits, kind: "release", jobId, reason: "Reservation released" });
    await apply(t, { userId: job.userId, delta: -charge, kind: "charge", jobId, reason: "Processing time", allowNegative: true });
    const [row] = await t.select({ delta: creditLedger.delta }).from(creditLedger).where(and(eq(creditLedger.jobId, jobId), eq(creditLedger.kind, "charge")));
    return -row.delta;
  };
  return tx ? run(tx) : db.transaction(run);
}

/** On failure, cancel or timeout: give the reservation back, charge nothing. Idempotent. */
export async function release(jobId: string, reason = "Job did not finish", tx?: Tx) {
  const run = async (t: Tx) => {
    const job = await jobCredits(t, jobId);
    await apply(t, { userId: job.userId, delta: job.reservedCredits, kind: "release", jobId, reason });
  };
  return tx ? run(tx) : db.transaction(run);
}

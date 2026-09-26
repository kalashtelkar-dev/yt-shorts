import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { creditLedger, jobs, userBalances } from "@/db/schema";

// The only code that changes balances (CLAUDE.md §5). Every change runs in one transaction:
// lock the balance row, check idempotency, insert the ledger row, update the cached balance.
// Jobs have a fixed price: charged when the job is created, refunded in full if it fails.

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

type Entry = { userId: string; delta: number; kind: Kind; jobId?: string; adminId?: string; reason?: string };

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
  if (e.delta < 0 && balance + e.delta < 0) throw new InsufficientCreditsError(-e.delta, balance);
  await tx.insert(creditLedger).values({ userId: e.userId, delta: e.delta, kind: e.kind, jobId: e.jobId, adminId: e.adminId, reason: e.reason });
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

/**
 * Starter credits for an account that has never had any. The balance row lock makes the
 * "no ledger rows yet" check race-free, so it can only ever happen once per user.
 */
export async function grantStarterOnce(userId: string, amount: number): Promise<boolean> {
  if (amount <= 0) return false;
  return db.transaction(async (tx) => {
    await lockBalance(tx, userId);
    const [any] = await tx.select({ id: creditLedger.id }).from(creditLedger).where(eq(creditLedger.userId, userId)).limit(1);
    return any ? false : apply(tx, { userId, delta: amount, kind: "grant", reason: "Starter credits" });
  });
}

export async function hasCreditHistory(userId: string): Promise<boolean> {
  const [any] = await db.select({ id: creditLedger.id }).from(creditLedger).where(eq(creditLedger.userId, userId)).limit(1);
  return !!any;
}

/**
 * Moves the whole balance of `fromUserId` to `toUserId` inside the caller's transaction. Returns the amount.
 * The pair of rows is written even for 0 when the source ever had credits, so the destination counts as
 * having credit history and can't claim starter credits a second time.
 */
export async function transferBalance(tx: Tx, fromUserId: string, toUserId: string, reason: string): Promise<number> {
  // Lock both rows in a fixed order so two merges can't deadlock.
  for (const id of [fromUserId, toUserId].sort()) await lockBalance(tx, id);
  const amount = await lockBalance(tx, fromUserId);
  const [history] = await tx.select({ id: creditLedger.id }).from(creditLedger).where(eq(creditLedger.userId, fromUserId)).limit(1);
  if (!history) return 0;
  await apply(tx, { userId: fromUserId, delta: -amount, kind: "transfer", reason });
  await apply(tx, { userId: toUserId, delta: amount, kind: "transfer", reason });
  return amount;
}

/** Charge the job's price inside the caller's transaction, so the job row and the charge commit together. */
export async function chargeForJob(tx: Tx, userId: string, jobId: string, amount: number) {
  await apply(tx, { userId, delta: -amount, kind: "charge", jobId, reason: "Montage" });
}

/**
 * Return the job's full price: automatically on failure/cancel/timeout, or by an admin.
 * Idempotent: returns false if the job was already refunded (or cost nothing).
 */
export async function refundJob(jobId: string, reason = "Job did not finish", tx?: Tx, adminId?: string): Promise<boolean> {
  const run = async (t: Tx) => {
    // Locked, so a guest → account merge (which moves jobs) can't send this refund to the old owner.
    const [job] = await t.select({ userId: jobs.userId, chargedCredits: jobs.chargedCredits }).from(jobs).where(eq(jobs.id, jobId)).for("update");
    if (!job) throw new Error(`Job ${jobId} not found`);
    if (job.chargedCredits <= 0) return false;
    return apply(t, { userId: job.userId, delta: job.chargedCredits, kind: "refund", jobId, adminId, reason });
  };
  return tx ? run(tx) : db.transaction(run);
}

/** Admin adjustment with a required reason. Removing more than the balance is refused. */
export async function adjustCredits(tx: Tx, adminId: string, userId: string, delta: number, reason: string) {
  if (!Number.isInteger(delta) || delta === 0) throw new Error("Adjustment must be a non-zero whole number");
  await apply(tx, { userId, delta, kind: delta > 0 ? "admin_add" : "admin_remove", adminId, reason });
}

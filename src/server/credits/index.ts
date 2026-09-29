import "server-only";
import { db, type Tx } from "@/db/client";
import type { LedgerKind } from "@/generated/prisma/client";

// The only code that changes balances (CLAUDE.md §5). Every change runs in one transaction:
// lock the balance row, check idempotency, insert the ledger row, update the cached balance.
// Jobs pay for the editing time they use, after they succeed: to start, the balance minus what the user's
// other unfinished jobs hold must cover the top of the job's range. Failed jobs cost nothing.

export type { Tx };

export class InsufficientCreditsError extends Error {
  constructor(
    public needed: number,
    public balance: number,
  ) {
    super(`Needs ${needed} credits, balance is ${balance}`);
    this.name = "InsufficientCreditsError";
  }
}

type Entry = { userId: string; delta: number; kind: LedgerKind; jobId?: string; paymentId?: string; adminId?: string; reason?: string };

async function lockBalance(tx: Tx, userId: string): Promise<number> {
  await tx.$executeRaw`insert into user_balances (user_id) values (${userId}) on conflict do nothing`;
  const [row] = await tx.$queryRaw<{ balance: number }[]>`select balance from user_balances where user_id = ${userId} for update`;
  return row.balance;
}

/** Applies one ledger entry. Returns false when a job-scoped entry of this kind already exists. */
async function apply(tx: Tx, e: Entry): Promise<boolean> {
  if (!Number.isInteger(e.delta)) throw new Error("Credit deltas must be integers");
  const balance = await lockBalance(tx, e.userId);
  if (e.jobId && (await tx.creditLedger.findFirst({ where: { jobId: e.jobId, kind: e.kind }, select: { id: true } }))) return false;
  if (e.paymentId && (await tx.creditLedger.findFirst({ where: { paymentId: e.paymentId }, select: { id: true } }))) return false;
  if (e.delta < 0 && balance + e.delta < 0) throw new InsufficientCreditsError(-e.delta, balance);
  await tx.creditLedger.create({ data: { userId: e.userId, delta: e.delta, kind: e.kind, jobId: e.jobId, paymentId: e.paymentId, adminId: e.adminId, reason: e.reason } });
  await tx.userBalance.update({ where: { userId: e.userId }, data: { balance: { increment: e.delta } } });
  return true;
}

export async function getBalance(userId: string): Promise<number> {
  const row = await db.userBalance.findUnique({ where: { userId }, select: { balance: true } });
  return row?.balance ?? 0;
}

export async function grant(userId: string, amount: number, reason: string) {
  if (amount <= 0) return;
  await db.$transaction((tx) => apply(tx, { userId, delta: amount, kind: "grant", reason }));
}

/**
 * Starter credits for an account that has never had any. The balance row lock makes the
 * "no ledger rows yet" check race-free, so it can only ever happen once per user.
 */
export async function grantStarterOnce(userId: string, amount: number): Promise<boolean> {
  if (amount <= 0) return false;
  return db.$transaction(async (tx) => {
    await lockBalance(tx, userId);
    const any = await tx.creditLedger.findFirst({ where: { userId }, select: { id: true } });
    return any ? false : apply(tx, { userId, delta: amount, kind: "grant", reason: "Starter credits" });
  });
}

export async function hasCreditHistory(userId: string): Promise<boolean> {
  return !!(await db.creditLedger.findFirst({ where: { userId }, select: { id: true } }));
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
  if (!(await tx.creditLedger.findFirst({ where: { userId: fromUserId }, select: { id: true } }))) return 0;
  await apply(tx, { userId: fromUserId, delta: -amount, kind: "transfer", reason });
  await apply(tx, { userId: toUserId, delta: amount, kind: "transfer", reason });
  return amount;
}

const ACTIVE = ["queued", "starting", "running"] as const;

/** Credits the user's unfinished jobs hold: each holds the top of its range until it's settled. */
async function heldCredits(tx: Tx, userId: string): Promise<number> {
  const { _sum } = await tx.job.aggregate({ _sum: { maxCredits: true }, where: { userId, status: { in: [...ACTIVE] } } });
  return _sum.maxCredits ?? 0;
}

/** Balance minus what running jobs hold: what a new job may count on. */
export async function availableCredits(userId: string): Promise<number> {
  const [balance, held] = await Promise.all([getBalance(userId), heldCredits(db, userId)]);
  return Math.max(0, balance - held);
}

/**
 * The start gate, inside the transaction that inserts the job: the balance row stays locked until it commits,
 * so two starts can't both count the same credits. Throws when balance − held < need.
 */
export async function checkStartGate(tx: Tx, userId: string, need: number) {
  const balance = await lockBalance(tx, userId);
  const available = balance - (await heldCredits(tx, userId));
  if (available < need) throw new InsufficientCreditsError(need, Math.max(0, available));
}

/**
 * Charges a finished job for the editing time it used, inside the caller's transaction. Capped at the balance, so
 * it never goes negative (the start gate makes that rare). One charge per job; returns the credits charged.
 */
export async function chargeForUsage(tx: Tx, userId: string, jobId: string, credits: number): Promise<number> {
  if (!Number.isInteger(credits) || credits <= 0) return 0;
  const amount = Math.min(credits, await lockBalance(tx, userId));
  if (amount <= 0) return 0;
  return (await apply(tx, { userId, delta: -amount, kind: "charge", jobId, reason: "Montage" })) ? amount : 0;
}

/** Credits bought with a payment, inside the payment's transaction. Once per payment; returns whether it was added. */
export async function addPurchase(tx: Tx, userId: string, paymentId: string, credits: number): Promise<boolean> {
  if (!Number.isInteger(credits) || credits <= 0) throw new Error("Purchased credits must be a positive whole number");
  return apply(tx, { userId, delta: credits, kind: "purchase", paymentId, reason: "Bought credits" });
}

/**
 * Return the job's full price: automatically on failure/cancel/timeout, or by an admin.
 * Idempotent: returns false if the job was already refunded (or cost nothing).
 */
export async function refundJob(jobId: string, reason = "Job did not finish", tx?: Tx, adminId?: string): Promise<boolean> {
  const run = async (t: Tx) => {
    // Locked, so a guest → account merge (which moves jobs) can't send this refund to the old owner.
    const [job] = await t.$queryRaw<{ userId: string; chargedCredits: number }[]>`
      select user_id as "userId", charged_credits as "chargedCredits" from jobs where id = ${jobId}::uuid for update`;
    if (!job) throw new Error(`Job ${jobId} not found`);
    if (job.chargedCredits <= 0) return false;
    return apply(t, { userId: job.userId, delta: job.chargedCredits, kind: "refund", jobId, adminId, reason });
  };
  return tx ? run(tx) : db.$transaction(run);
}

/** Admin adjustment with a required reason. Removing more than the balance is refused. */
export async function adjustCredits(tx: Tx, adminId: string, userId: string, delta: number, reason: string) {
  if (!Number.isInteger(delta) || delta === 0) throw new Error("Adjustment must be a non-zero whole number");
  await apply(tx, { userId, delta, kind: delta > 0 ? "admin_add" : "admin_remove", adminId, reason });
}

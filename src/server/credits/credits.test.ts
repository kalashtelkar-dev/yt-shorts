import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { addPurchase, availableCredits, chargeForUsage, checkStartGate, getBalance, grant, InsufficientCreditsError, refundJob } from ".";

let userId: string;
let catalogItemId: string;

/** Starts a job the way createJob does: gate, then insert holding `max`. */
async function startJob(max: number) {
  return db.$transaction(async (tx) => {
    await checkStartGate(tx, userId, max);
    const job = await tx.job.create({
      data: { userId, catalogItemId, catalogSlug: "t", templateId: "tpl_t", input: {}, source: "url", durationSec: 30, maxCredits: max },
      select: { id: true },
    });
    return job.id;
  });
}

async function succeed(jobId: string, credits: number) {
  return db.$transaction(async (tx) => {
    await tx.job.update({ where: { id: jobId }, data: { status: "succeeded" } });
    const charged = await chargeForUsage(tx, userId, jobId, credits);
    await tx.job.update({ where: { id: jobId }, data: { chargedCredits: charged } });
    return charged;
  });
}

const ledgerSum = async () => {
  const { _sum } = await db.creditLedger.aggregate({ _sum: { delta: true }, where: { userId } });
  return _sum.delta ?? 0;
};

beforeEach(async () => {
  userId = crypto.randomUUID();
  await db.user.create({ data: { id: userId, name: "t", email: `${userId}@test.local`, isAnonymous: true } });
  const item = await db.catalogItem.create({ data: { slug: `t-${userId}`, title: "t", templateId: "tpl_t" }, select: { id: true } });
  catalogItemId = item.id;
  await grant(userId, 100, "test");
});

describe("credits", () => {
  it("charges nothing when a job starts; it holds the top of its range", async () => {
    await startJob(60);
    expect(await getBalance(userId)).toBe(100);
    expect(await availableCredits(userId)).toBe(40);
  });

  it("charges the time used after success, once", async () => {
    const jobId = await startJob(60);
    expect(await succeed(jobId, 42)).toBe(42);
    expect(await succeed(jobId, 42)).toBe(0); // second settle does nothing
    expect(await getBalance(userId)).toBe(58);
    expect(await ledgerSum()).toBe(58);
    expect(await availableCredits(userId)).toBe(58); // the hold is gone once the job finished
  });

  it("never takes the balance below zero", async () => {
    const jobId = await startJob(100);
    expect(await succeed(jobId, 250)).toBe(100);
    expect(await getBalance(userId)).toBe(0);
  });

  it("a failed job costs nothing", async () => {
    const jobId = await startJob(60);
    await db.job.update({ where: { id: jobId }, data: { status: "failed" } });
    expect(await refundJob(jobId)).toBe(false);
    expect(await getBalance(userId)).toBe(100);
  });

  it("refuses a start when the free credits can't cover the top of the range, and creates nothing", async () => {
    await expect(startJob(101)).rejects.toBeInstanceOf(InsufficientCreditsError);
    expect(await db.job.count({ where: { userId } })).toBe(0);
  });

  it("counts running jobs' holds: two parallel starts can't spend the same credits", async () => {
    const results = await Promise.allSettled([startJob(60), startJob(60)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await availableCredits(userId)).toBe(40);
  });

  it("adds purchased credits once per payment", async () => {
    const p = await db.payment.create({ data: { userId, provider: "mock", providerOrderId: `o_${userId}`, amountPaise: 10_000, credits: 500 }, select: { id: true } });
    await db.$transaction((tx) => addPurchase(tx, userId, p.id, 500));
    expect(await db.$transaction((tx) => addPurchase(tx, userId, p.id, 500))).toBe(false);
    expect(await getBalance(userId)).toBe(600);
  });

  it("the database refuses edits to the ledger", async () => {
    const err = await db.creditLedger.updateMany({ where: { userId }, data: { delta: 1 } }).catch((e: Error) => e);
    expect(String(err)).toMatch(/append-only/);
  });
});

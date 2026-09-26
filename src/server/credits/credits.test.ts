import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { catalogItems, creditLedger, jobs, users } from "@/db/schema";
import { InsufficientCreditsError, chargeForJob, getBalance, grant, refundJob } from ".";

let userId: string;
let catalogItemId: string;

async function newJob(price: number) {
  return db.transaction(async (tx) => {
    const [job] = await tx
      .insert(jobs)
      .values({ userId, catalogItemId, catalogSlug: "t", templateId: "tpl_t", input: {}, source: "url", durationSec: 30, chargedCredits: price })
      .returning({ id: jobs.id });
    await chargeForJob(tx, userId, job.id, price);
    return job.id;
  });
}

const ledgerSum = async () => {
  const [r] = await db.select({ s: sql<number>`coalesce(sum(${creditLedger.delta}), 0)::int` }).from(creditLedger).where(eq(creditLedger.userId, userId));
  return r.s;
};

beforeEach(async () => {
  userId = crypto.randomUUID();
  await db.insert(users).values({ id: userId, name: "t", email: `${userId}@test.local`, isAnonymous: true });
  const [item] = await db.insert(catalogItems).values({ slug: `t-${userId}`, title: "t", templateId: "tpl_t" }).returning({ id: catalogItems.id });
  catalogItemId = item.id;
  await grant(userId, 100, "test");
});

describe("credits", () => {
  it("charges the fixed price when the job is created", async () => {
    await newJob(60);
    expect(await getBalance(userId)).toBe(40);
    expect(await ledgerSum()).toBe(40);
  });

  it("refunds the full price on failure, once", async () => {
    const jobId = await newJob(60);
    await refundJob(jobId);
    await refundJob(jobId);
    expect(await getBalance(userId)).toBe(100);
    expect(await ledgerSum()).toBe(100);
  });

  it("refuses a job the balance can't cover, and creates nothing", async () => {
    await expect(newJob(101)).rejects.toBeInstanceOf(InsufficientCreditsError);
    expect(await getBalance(userId)).toBe(100);
    expect(await db.select().from(jobs).where(eq(jobs.userId, userId))).toHaveLength(0);
  });

  it("serialises concurrent jobs: only one of two fits", async () => {
    const results = await Promise.allSettled([newJob(60), newJob(60)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await getBalance(userId)).toBe(40);
    expect(await ledgerSum()).toBe(40);
  });

  it("the database refuses edits to the ledger", async () => {
    const err = await db.update(creditLedger).set({ delta: 1 }).where(eq(creditLedger.userId, userId)).catch((e: Error) => e);
    expect(String((err as Error).cause)).toMatch(/append-only/);
  });
});

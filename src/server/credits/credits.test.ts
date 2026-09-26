import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { catalogItems, creditLedger, jobs, users } from "@/db/schema";
import { InsufficientCreditsError, getBalance, grant, release, reserve, settle } from ".";

const MS_PER_CREDIT = 1000;
let userId: string;
let catalogItemId: string;

async function newJob(reserved: number) {
  return db.transaction(async (tx) => {
    const [job] = await tx
      .insert(jobs)
      .values({ userId, catalogItemId, catalogSlug: "t", templateId: "tpl_t", input: {}, source: "url", durationSec: 30, reservedCredits: reserved })
      .returning({ id: jobs.id });
    await reserve(tx, userId, job.id, reserved);
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
  const [item] = await db
    .insert(catalogItems)
    .values({ slug: `t-${userId}`, title: "t", templateId: "tpl_t" })
    .returning({ id: catalogItems.id });
  catalogItemId = item.id;
  await grant(userId, 100, "test");
});

describe("credits", () => {
  it("runs the full lifecycle: reserve → settle by actual time", async () => {
    const jobId = await newJob(60);
    expect(await getBalance(userId)).toBe(40);
    const charged = await settle(jobId, 12_300, MS_PER_CREDIT); // rounds up to 13
    expect(charged).toBe(13);
    expect(await getBalance(userId)).toBe(87);
    expect(await ledgerSum()).toBe(87);
  });

  it("settling twice charges once", async () => {
    const jobId = await newJob(60);
    await settle(jobId, 10_000, MS_PER_CREDIT);
    expect(await settle(jobId, 99_000, MS_PER_CREDIT)).toBe(10);
    expect(await getBalance(userId)).toBe(90);
    expect(await ledgerSum()).toBe(90);
  });

  it("releases the full reservation on failure, once", async () => {
    const jobId = await newJob(60);
    await release(jobId);
    await release(jobId);
    expect(await getBalance(userId)).toBe(100);
    expect(await ledgerSum()).toBe(100);
  });

  it("refuses a reservation larger than the balance", async () => {
    await expect(newJob(101)).rejects.toBeInstanceOf(InsufficientCreditsError);
    expect(await getBalance(userId)).toBe(100);
  });

  it("serialises concurrent reservations: only one of two fits", async () => {
    const results = await Promise.allSettled([newJob(60), newJob(60)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await getBalance(userId)).toBe(40);
    expect(await ledgerSum()).toBe(40);
  });

  it("lets an overrun charge go negative once, then blocks new jobs", async () => {
    const jobId = await newJob(50);
    await settle(jobId, 180_000, MS_PER_CREDIT); // charges 180 against 100
    expect(await getBalance(userId)).toBe(-80);
    await expect(newJob(1)).rejects.toBeInstanceOf(InsufficientCreditsError);
    expect(await ledgerSum()).toBe(-80);
  });

  it("the database refuses edits to the ledger", async () => {
    const err = await db.update(creditLedger).set({ delta: 1 }).where(eq(creditLedger.userId, userId)).catch((e: Error) => e);
    expect(String((err as Error).cause)).toMatch(/append-only/);
  });
});

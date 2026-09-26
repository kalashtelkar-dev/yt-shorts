import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { catalogItems, creditLedger, jobEvents, jobs, users } from "@/db/schema";
import { chargeForJob, getBalance, grant } from "@/server/credits";
import { getSettings } from "@/server/settings";
import { pollJob, startJob, sweep } from "./lifecycle";

const T0 = Date.UTC(2026, 8, 26, 10, 0, 0);
const stageMap = [
  { match: "download", label: "Downloading your video" },
  { match: "read_feed", label: "Reading the kill feed" },
  { match: "make_montage", label: "Rendering your montage" },
];
let userId: string;
let catalogItemId: string;

async function newJob(playerName: string, price = 120) {
  return db.transaction(async (tx) => {
    const [job] = await tx
      .insert(jobs)
      .values({ userId, catalogItemId, catalogSlug: "kill-montage", templateId: "tpl_t", input: { youtubeUrl: "https://youtu.be/x", playerName }, source: "url", durationSec: 60, chargedCredits: price })
      .returning();
    await chargeForJob(tx, userId, job.id, price);
    return job;
  });
}

const load = async (id: string) => (await db.select().from(jobs).where(eq(jobs.id, id)))[0];
const at = (ms: number) => vi.setSystemTime(T0 + ms);

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  at(0);
  userId = crypto.randomUUID();
  await db.insert(users).values({ id: userId, name: "t", email: `${userId}@test.local`, isAnonymous: true });
  const [item] = await db.insert(catalogItems).values({ slug: `t-${userId}`, title: "t", templateId: "tpl_t", stageMap }).returning({ id: catalogItems.id });
  catalogItemId = item.id;
  await grant(userId, 600, "test");
});
afterEach(() => vi.useRealTimers());

describe("job lifecycle (mock Engine X)", () => {
  it("starts once, tracks stages, and keeps the upfront charge on success", async () => {
    const job = await newJob("Aqua");
    await Promise.all([startJob(job.id, T0), startJob(job.id, T0)]); // double start → one run
    let row = await load(job.id);
    expect(row.status).toBe("running");
    expect(row.runId).toMatch(/^mock-/);

    const settings = await getSettings();
    at(9_000); // mock: reading the kill feed
    await pollJob(row, settings, stageMap, "montage", T0 + 9_000);
    row = await load(job.id);
    expect(row.currentStage).toBe("Reading the kill feed");
    expect(row.stepsDone).toBeGreaterThan(0);

    at(60_000);
    await Promise.all([pollJob(row, settings, stageMap, "montage", T0 + 60_000), pollJob(row, settings, stageMap, "montage", T0 + 60_000)]);
    row = await load(job.id);
    expect(row.status).toBe("succeeded");
    expect(row.outputKey).toMatch(/montage\.mp4$/);
    expect(row.outputMeta).toMatchObject({ totalKills: 7 });
    expect(row.chargedCredits).toBe(120);
    expect(row.computeCostPaise).toBe(19 * settings.costPaisePerSecond); // mock runMs 19 000
    expect(await getBalance(userId)).toBe(600 - 120);
  });

  it("refunds and stores a friendly error when a step fails", async () => {
    const job = await newJob("fail");
    await startJob(job.id, T0);
    at(60_000);
    await pollJob(await load(job.id), await getSettings(), stageMap, "montage", T0 + 60_000);
    const row = await load(job.id);
    expect(row.status).toBe("failed");
    expect(row.errorPublic).toMatch(/kill feed/);
    expect(row.errorRaw).toMatch(/137/);
    expect(row.computeCostPaise).toBeGreaterThan(0);
    expect(await getBalance(userId)).toBe(600);
    const events = await db.select().from(jobEvents).where(eq(jobEvents.jobId, job.id));
    expect(events.some((e) => e.level === "error" && !/137/.test(e.message))).toBe(true);
  });

  it("times out and refunds", async () => {
    const job = await newJob("timeout");
    await startJob(job.id, T0);
    const settings = await getSettings();
    const late = settings.maxRunMinutes * 60_000 + 1000;
    at(late);
    await pollJob(await load(job.id), settings, stageMap, "montage", T0 + late);
    const row = await load(job.id);
    expect(row.status).toBe("failed");
    expect(row.errorPublic).toMatch(/too long/);
    expect(await getBalance(userId)).toBe(600);
    const ledger = await db.select().from(creditLedger).where(eq(creditLedger.jobId, job.id));
    expect(ledger.map((l) => l.kind).sort()).toEqual(["charge", "refund"]);
  });

  it("sweep starts queued jobs (resume after a restart)", async () => {
    const job = await newJob("Aqua");
    await sweep(T0);
    expect((await load(job.id)).status).toBe("running");
  });
});

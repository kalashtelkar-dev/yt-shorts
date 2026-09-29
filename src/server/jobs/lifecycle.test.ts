import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db/client";
import { getBalance, grant } from "@/server/credits";
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

/** A job as createJob leaves it: nothing charged, the top of its range held. */
async function newJob(playerName: string, maxCredits = 120) {
  return db.job.create({
    data: { userId, catalogItemId, catalogSlug: "kill-montage", templateId: "tpl_t", input: { youtubeUrl: "https://youtu.be/x", playerName }, source: "url", durationSec: 60, maxCredits },
  });
}

const load = (id: string) => db.job.findUniqueOrThrow({ where: { id } });
const at = (ms: number) => vi.setSystemTime(T0 + ms);

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  at(0);
  userId = crypto.randomUUID();
  await db.user.create({ data: { id: userId, name: "t", email: `${userId}@test.local`, isAnonymous: true } });
  const item = await db.catalogItem.create({ data: { slug: `t-${userId}`, title: "t", templateId: "tpl_t", stageMap }, select: { id: true } });
  catalogItemId = item.id;
  await grant(userId, 600, "test");
});
afterEach(() => vi.useRealTimers());

describe("job lifecycle (mock Engine X)", () => {
  it("starts once, tracks stages, and charges the editing time on success", async () => {
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
    expect(row.chargedCredits).toBe(19); // mock runMs 19 000 → 19 credits, 1 a second
    expect(row.computeCostPaise).toBe(19 * settings.costPaisePerSecond);
    expect(await getBalance(userId)).toBe(600 - 19);
  });

  it("retries a transient failure once, then fails with a friendly error and charges nothing", async () => {
    const job = await newJob("fail");
    await startJob(job.id, T0);
    at(60_000);
    const settings = await getSettings();
    await pollJob(await load(job.id), settings, stageMap, "montage", T0 + 60_000); // OCR out of memory → retry
    let row = await load(job.id);
    expect(row).toMatchObject({ status: "running", retries: 1 });
    await pollJob(row, settings, stageMap, "montage", T0 + 65_000); // still failing → give up
    row = await load(job.id);
    expect(row.status).toBe("failed");
    expect(row.errorPublic).toMatch(/kill feed/);
    expect(row.errorRaw).toMatch(/137/);
    expect(row.computeCostPaise).toBeGreaterThan(0);
    expect(await getBalance(userId)).toBe(600);
    const events = await db.jobEvent.findMany({ where: { jobId: job.id } });
    expect(events.some((e) => e.level === "error" && !/137/.test(e.message))).toBe(true);
  });

  it("times out and charges nothing", async () => {
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
    const ledger = await db.creditLedger.findMany({ where: { jobId: job.id } });
    expect(ledger).toHaveLength(0);
  });

  it("sweep starts queued jobs (resume after a restart)", async () => {
    const job = await newJob("Aqua");
    await sweep(T0);
    expect((await load(job.id)).status).toBe("running");
  });
});

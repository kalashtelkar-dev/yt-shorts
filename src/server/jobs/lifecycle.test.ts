import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db/client";
import { getBalance, grant } from "@/server/credits";
import { getSettings } from "@/server/settings";
import { enginex } from "@/server/enginex/client";
import { saveFilesFor } from "./files";
import { cancelJob, lastStepEnd, pollJob, startJob, sweep } from "./lifecycle";
import { getPublicJob } from "./public";

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
  // Saving the finished files downloads them: serve fake bytes instead of the mock sample links.
  vi.stubGlobal("fetch", async () => new Response("fake-bytes", { headers: { "content-type": "video/mp4" } }));
  vi.useFakeTimers({ toFake: ["Date"] });
  at(0);
  userId = crypto.randomUUID();
  await db.user.create({ data: { id: userId, name: "t", email: `${userId}@test.local`, isAnonymous: true } });
  const item = await db.catalogItem.create({ data: { slug: `t-${userId}`, title: "t", templateId: "tpl_t", stageMap }, select: { id: true } });
  catalogItemId = item.id;
  await grant(userId, 600, "test");
  // Other tests' unfinished jobs share this DB: give the site plenty of slots (the queue test sets its own limit).
  await db.settings.upsert({ where: { id: 1 }, update: { maxConcurrentJobsTotal: 500 }, create: { id: 1, maxConcurrentJobsTotal: 500 } });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

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
    // Done straight away (the video plays from Engine X); our long-term copy is the worker's background task.
    expect(row.outputMeta).not.toHaveProperty("stored");
    await saveFilesFor(job.id);
    expect((await load(job.id)).outputMeta).toMatchObject({ stored: { video: `montages/${job.id}/video.mp4` } });
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

  it("never charges more than the top of the range the user was shown", async () => {
    const job = await newJob("Aqua", 12); // shown "up to 12"; the mock run takes 19 s
    await startJob(job.id, T0);
    const settings = await getSettings();
    at(9_000);
    await pollJob(await load(job.id), settings, stageMap, "montage", T0 + 9_000);
    at(60_000);
    await pollJob(await load(job.id), settings, stageMap, "montage", T0 + 60_000);
    const row = await load(job.id);
    expect(row).toMatchObject({ status: "succeeded", chargedCredits: 12 });
    expect(row.computeCostPaise).toBe(19 * settings.costPaisePerSecond); // our own cost still records the real time
    expect(await getBalance(userId)).toBe(600 - 12);
  });

  it("runs at most the site's limit at once; the rest wait in line, oldest first", async () => {
    await db.job.updateMany({ where: { status: { in: ["queued", "starting", "running"] } }, data: { status: "canceled" } }); // other tests' leftovers
    await db.settings.update({ where: { id: 1 }, data: { maxConcurrentJobsTotal: 2 } });
    const a = await newJob("A");
    at(1_000);
    const b = await newJob("B");
    at(2_000);
    const c = await newJob("C");
    at(3_000);
    const d = await newJob("D");
    // Started all at once (four workers): exactly two get a slot, the oldest two.
    await Promise.all([d, c, b, a].map((j) => startJob(j.id, T0 + 3_000)));
    expect(await Promise.all([a, b, c, d].map(async (j) => (await load(j.id)).status))).toEqual(["running", "running", "queued", "queued"]);
    // Their pages say where they are in line.
    expect(await getPublicJob(c.id, userId)).toMatchObject({ status: "queued", stage: "Waiting in line", stageDetail: "You're next" });
    expect(await getPublicJob(d.id, userId)).toMatchObject({ stage: "Waiting in line", stageDetail: "1 ahead of you" });
    // One finishes: the next sweep starts the oldest waiting job, never a newer one first.
    await cancelJob(a.id, "done", T0 + 4_000);
    await startJob(d.id, T0 + 4_000);
    expect((await load(d.id)).status).toBe("queued");
    await sweep(T0 + 5_000);
    expect(await Promise.all([c, d].map(async (j) => (await load(j.id)).status))).toEqual(["running", "queued"]);
    // Waiting cost nothing: C's run clock starts when it got its slot, not when it was made.
    expect((await load(c.id)).startedAt?.getTime()).toBe(T0 + 5_000);
    await db.job.updateMany({ where: { id: { in: [b.id, c.id, d.id] } }, data: { status: "canceled" } });
  });

  it("sweep starts queued jobs (resume after a restart)", async () => {
    const job = await newJob("Aqua");
    await sweep(T0);
    expect((await load(job.id)).status).toBe("running");
  });

  it("an admin cancel stops the Engine X run and costs nothing", async () => {
    const cancelRun = vi.spyOn(enginex(), "cancelRun");
    const job = await newJob("Aqua");
    await startJob(job.id, T0);
    const { runId } = await load(job.id);
    at(9_000);
    expect(await cancelJob(job.id, "canceled by admin a@b.c", T0 + 9_000)).toBe(true);
    expect(cancelRun).toHaveBeenCalledWith(runId);
    const row = await load(job.id);
    expect(row).toMatchObject({ status: "canceled", chargedCredits: 0, errorRaw: "canceled by admin a@b.c" });
    expect(row.errorPublic).toMatch(/didn't cost you/);
    expect(await getBalance(userId)).toBe(600);
    expect(await cancelJob(job.id, "again")).toBe(false); // already finished
    await sweep(T0 + 60_000); // the finished run is never picked up again
    expect((await load(job.id)).status).toBe("canceled");
    cancelRun.mockRestore();
  });
});

describe("lastStepEnd", () => {
  const run = (finished: (string | null)[]) =>
    ({ runId: "r", status: "succeeded", output: null, error: null, runMs: null, steps: finished.map((f) => ({ step: "s", engine: null, status: "succeeded", error: null, items: null, job: null, finishedAt: f })) }) as const;
  it("bills up to Engine X's last step, not when our poll noticed", () => {
    expect(lastStepEnd(run(["2026-10-01T10:00:05Z", "2026-10-01T10:00:09Z", null]), Date.parse("2026-10-01T10:00:20Z"))).toBe(Date.parse("2026-10-01T10:00:09Z"));
  });
  it("falls back to now without step times, and never goes past now (clock skew)", () => {
    expect(lastStepEnd(run([null]), 1000)).toBe(1000);
    expect(lastStepEnd(run(["2026-10-01T10:00:30Z"]), Date.parse("2026-10-01T10:00:20Z"))).toBe(Date.parse("2026-10-01T10:00:20Z"));
  });
});

import { eq, inArray } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { catalogItems, jobs, mediaIndex, users } from "@/db/schema";
import { chargeForJob, getBalance, grant } from "@/server/credits";
import { startJob, sweep } from "./lifecycle";
import { REUSE_MS, styleInput } from "./staged";

// The mock (ENGINEX_MODE=mock) knows these as gameplay-index / song-index / the two styles.
const INDEX = { gameplay: "tpl_yYsSXHkQXJBP", gameplayUpload: "tpl_K6Lo3rwFya4A", song: "tpl_sfY_wbow51wN" };
const T0 = Date.UTC(2026, 8, 28, 10, 0, 0);
const stageMap = [
  { match: "download", label: "Downloading your video" },
  { match: "read_feed", label: "Reading the kill feed" },
  { match: "music", label: "Getting your song" },
  { match: "plan", label: "Planning your edit" },
  { match: "make_montage", label: "Rendering your montage" },
];
let userId: string;
let catalogItemId: string;
let tag: string;

async function newJob(opts: { playerName?: string; musicUrl?: string; style?: string } = {}) {
  return db.transaction(async (tx) => {
    const [job] = await tx
      .insert(jobs)
      .values({
        userId,
        catalogItemId,
        catalogSlug: "kill-montage",
        templateId: opts.style ?? "tpl_dUktOJyZOv-K",
        indexTemplates: INDEX,
        input: { youtubeUrl: `https://youtu.be/${tag}`, playerName: opts.playerName ?? "Aqua", musicUrl: opts.musicUrl ?? `https://youtu.be/song-${tag}`, maxDurationSec: "30", variation: "slow first" },
        source: "url",
        durationSec: 30,
        chargedCredits: 300,
      })
      .returning();
    await chargeForJob(tx, userId, job.id, 300);
    return job;
  });
}
const load = async (id: string) => (await db.select().from(jobs).where(eq(jobs.id, id)))[0];
const at = (ms: number) => vi.setSystemTime(T0 + ms);
const tick = async (ms: number) => {
  at(ms);
  await sweep(T0 + ms);
};

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  at(0);
  tag = crypto.randomUUID();
  userId = crypto.randomUUID();
  await db.insert(users).values({ id: userId, name: "t", email: `${userId}@test.local`, isAnonymous: true });
  const [item] = await db
    .insert(catalogItems)
    .values({ slug: `s-${tag}`, title: "t", templateId: "tpl_dUktOJyZOv-K", indexTemplates: INDEX, stageMap })
    .returning({ id: catalogItems.id });
  catalogItemId = item.id;
  await grant(userId, 2000, "test");
});
afterEach(() => vi.useRealTimers());

describe("staged styles (mock Engine X)", () => {
  it("indexes the gameplay and the song in parallel, then renders; a second job shares the indexes", async () => {
    const job = await newJob();
    await startJob(job.id, T0);
    let row = await load(job.id);
    expect(row).toMatchObject({ status: "running", phase: "index", runId: null });
    const indexes = await db.select().from(mediaIndex).where(inArray(mediaIndex.id, [row.gameplayIndexId!, row.songIndexId!]));
    expect(indexes.map((r) => r.kind).sort()).toEqual(["gameplay", "song"]);
    expect(indexes.every((r) => r.runId?.startsWith("mock-"))).toBe(true);

    const twin = await newJob();
    await startJob(twin.id, T0);
    const twinRow = await load(twin.id);
    expect([twinRow.gameplayIndexId, twinRow.songIndexId]).toEqual([row.gameplayIndexId, row.songIndexId]); // no second runs

    await tick(8_000); // gameplay-index is reading the kill feed
    row = await load(job.id);
    expect(row.currentStage).toBe("Reading the kill feed");
    expect(row.stepsDone).toBeGreaterThan(0);
    const before = row.stepsDone;

    await tick(20_000); // both indexes finished: the render run starts
    row = await load(job.id);
    expect(row.phase).toBe("render");
    expect(row.runId).toMatch(/^mock-\d+-ok-style-/);
    expect(row.stepsDone).toBeGreaterThanOrEqual(before); // the bar never goes back

    await tick(30_000);
    row = await load(job.id);
    expect(row).toMatchObject({ status: "succeeded", outputKey: expect.stringContaining("montage.mp4") });
    expect(row.outputMeta).toMatchObject({ totalKills: 5, title: "Mock match" });
    expect(await getBalance(userId)).toBe(2000 - 600); // both jobs charged, nothing refunded
  });

  it("reuses a finished index for an hour, then indexes again", async () => {
    const first = await newJob();
    await startJob(first.id, T0);
    for (const ms of [20_000, 30_000]) await tick(ms);
    const done = await load(first.id);
    expect(done.status).toBe("succeeded");

    at(60_000);
    const again = await newJob();
    await startJob(again.id, T0 + 60_000);
    const reused = await load(again.id);
    expect(reused.gameplayIndexId).toBe(done.gameplayIndexId);
    await tick(61_000);
    expect((await load(again.id)).phase).toBe("render"); // straight to the render, no index wait

    const later = T0 + 30_000 + REUSE_MS + 1_000;
    vi.setSystemTime(later);
    const stale = await newJob();
    await startJob(stale.id, later);
    const [g] = await db.select().from(mediaIndex).where(eq(mediaIndex.id, (await load(stale.id)).gameplayIndexId!));
    expect(g).toMatchObject({ status: "running" }); // expired outputs: indexed again (same row, new run)
  });

  it("fails and refunds when the gameplay can't be read, with the kill-feed message", async () => {
    const job = await newJob({ playerName: "fail" });
    await startJob(job.id, T0);
    for (const ms of [10_000, 12_000]) await tick(ms);
    const row = await load(job.id);
    expect(row.status).toBe("failed");
    expect(row.errorPublic).toMatch(/couldn't read the kill feed/);
    expect(await getBalance(userId)).toBe(2000);
  });

  it("fails and refunds when the song can't be fetched, with the song message", async () => {
    const job = await newJob({ musicUrl: `https://youtu.be/fail-${tag}` });
    await startJob(job.id, T0);
    for (const ms of [3_000, 6_000, 8_000]) await tick(ms);
    const row = await load(job.id);
    expect(row.status).toBe("failed");
    expect(row.errorPublic).toMatch(/couldn't get that song/);
    expect(await getBalance(userId)).toBe(2000);
  });

  it("sends a style only the inputs it declares", () => {
    const g = { video: "v.mp4", durationSec: 1800, kills: { kills: [{ t: 51 }], totalKills: 1 }, flex: { flex: [] } };
    const s = { audio: "a.m4a", durationSec: 22, loudness: "0,-30", words: [{ word: "so", start: 1, end: 1.3, score: 0.9 }] };
    const job = { input: { variation: "slow last", lyricLook: "7" }, durationSec: 60 };
    const kill = styleInput(job, g, s, ["video", "kills", "flex", "gameDurationSec", "audio", "songDurationSec", "loudness", "maxDurationSec", "variation"]);
    expect(kill).not.toHaveProperty("words");
    expect(kill).not.toHaveProperty("lyricLook");
    expect(kill).toMatchObject({ maxDurationSec: "60", variation: "slow last", gameDurationSec: "1800", kills: JSON.stringify(g.kills) });
    expect(styleInput(job, g, s, null)).toMatchObject({ words: JSON.stringify(s.words), lyricLook: "7" });
  });
});

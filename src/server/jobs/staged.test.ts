import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db/client";
import { getBalance, grant } from "@/server/credits";
import { enginex } from "@/server/enginex/client";
import { cancelJob, startJob, sweep } from "./lifecycle";
import { saveFilesFor } from "./files";
import { getPublicJob, signedVideo } from "./public";
import { ensureIndex, indexInputs, introMoments, shuffleKills, styleInput } from "./staged";

// The mock (ENGINEX_MODE=mock) knows these as gameplay-index / song-index / the two styles.
const INDEX = { gameplay: "tpl_HHdgqEu5oz46", gameplayUpload: "tpl_MR-vL8OuXjf7", song: "tpl_2e8cr5IiomI_" };
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
  return db.job.create({
    data: {
      userId,
      catalogItemId,
      catalogSlug: "kill-montage",
      templateId: opts.style ?? "tpl_P0krMNymIjdb",
      indexTemplates: INDEX,
      input: { youtubeUrl: `https://youtu.be/${tag}`, playerName: opts.playerName ?? "Aqua", musicUrl: opts.musicUrl ?? `https://youtu.be/song-${tag}`, maxDurationSec: "30", variation: "slow first" },
      source: "url",
      durationSec: 30,
      maxCredits: 300,
    },
  });
}
const load = (id: string) => db.job.findUniqueOrThrow({ where: { id } });
const at = (ms: number) => vi.setSystemTime(T0 + ms);
const tick = async (ms: number) => {
  at(ms);
  await sweep(T0 + ms);
};

beforeEach(async () => {
  // Other tests' unfinished jobs share this DB: give the site plenty of slots (the queue test sets its own limit).
  await db.settings.upsert({ where: { id: 1 }, update: { maxConcurrentJobsTotal: 500 }, create: { id: 1, maxConcurrentJobsTotal: 500 } });
  // Saving the finished files downloads them: serve fake bytes instead of the mock sample links.
  vi.stubGlobal("fetch", async () => new Response("fake-bytes", { headers: { "content-type": "video/mp4" } }));
  vi.useFakeTimers({ toFake: ["Date"] });
  at(0);
  tag = crypto.randomUUID();
  userId = crypto.randomUUID();
  await db.user.create({ data: { id: userId, name: "t", email: `${userId}@test.local`, isAnonymous: true } });
  const item = await db.catalogItem.create({ data: { slug: `s-${tag}`, title: "t", templateId: "tpl_P0krMNymIjdb", indexTemplates: INDEX, stageMap }, select: { id: true } });
  catalogItemId = item.id;
  await grant(userId, 2000, "test");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("staged styles (mock Engine X)", () => {
  it("indexes the gameplay and the song in parallel, then renders; a second job for the same video runs its own", async () => {
    const job = await newJob();
    await startJob(job.id, T0);
    let row = await load(job.id);
    expect(row).toMatchObject({ status: "running", phase: "index", runId: null });
    const indexes = await db.mediaIndex.findMany({ where: { id: { in: [row.gameplayIndexId!, row.songIndexId!] } } });
    expect(indexes.map((r) => r.kind).sort()).toEqual(["gameplay", "song"]);
    expect(indexes.every((r) => r.runId?.startsWith("mock-"))).toBe(true);

    const twin = await newJob();
    await startJob(twin.id, T0);
    const twinRow = await load(twin.id);
    expect(twinRow.gameplayIndexId).not.toBe(row.gameplayIndexId); // nothing shared between jobs: its own download and kills
    expect(twinRow.songIndexId).not.toBe(row.songIndexId); // and its own song
    const twinIdx = await db.mediaIndex.findMany({ where: { id: { in: [twinRow.gameplayIndexId!, twinRow.songIndexId!] } } });
    expect(twinIdx.every((r) => r.runId?.startsWith("mock-") && !indexes.some((o) => o.runId === r.runId))).toBe(true); // new runs

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
    expect(row.outputMeta).toMatchObject({ totalKills: 5, title: "Mock match", thumbnailKey: expect.stringContaining("thumbnail.jpg") });
    // Until the background copy lands everything comes from Engine X.
    expect(await signedVideo(job.id, userId)).toMatchObject({ url: expect.stringContaining(".mp4"), poster: expect.stringContaining("data:image/svg") });
    await saveFilesFor(job.id);
    // Just finished: still Engine X for the video (our copy as the fallback); the cover is ours at once.
    expect(await signedVideo(job.id, userId)).toEqual({ url: expect.stringContaining(".mp4"), poster: `/api/jobs/${job.id}/files/thumbnail`, fallback: `/api/jobs/${job.id}/files/video` });
    // Each job pays for its whole run, indexes included: from T0 to the render's last step at T0 + 26 s (the poll that
    // noticed came at T0 + 30 s; that wait is free) → 26 credits.
    expect(row.chargedCredits).toBe(26);
    expect(await getBalance(userId)).toBe(2000 - 2 * 26); // both jobs
  });

  it("never reuses another job's finished index, and a restarted job keeps its own run", async () => {
    const first = await newJob();
    await startJob(first.id, T0);
    for (const ms of [20_000, 30_000]) await tick(ms);
    const done = await load(first.id);
    expect(done.status).toBe("succeeded");

    at(60_000); // a minute later, the same video and song
    const again = await newJob();
    await startJob(again.id, T0 + 60_000);
    const fresh = await load(again.id);
    expect(fresh.gameplayIndexId).not.toBe(done.gameplayIndexId);
    const g = await db.mediaIndex.findUniqueOrThrow({ where: { id: fresh.gameplayIndexId! } });
    expect(g).toMatchObject({ status: "running" }); // indexing from scratch
    await tick(61_000);
    expect((await load(again.id)).phase).toBe("index"); // it waits for its own index, no shortcut

    // the worker restarts and starts the same job again: it finds its own run instead of starting a second one
    const { gameplay } = indexInputs(await load(again.id));
    const same = await ensureIndex("gameplay", gameplay.templateId, gameplay.input, gameplay.parts, T0 + 62_000);
    expect(same).toMatchObject({ id: g.id, runId: g.runId });
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

  it("stops before the render, with the no-kills message and a refund, when the match has no kills by the player", async () => {
    const job = await newJob({ playerName: "nokills" });
    await startJob(job.id, T0);
    for (const ms of [20_000, 22_000]) await tick(ms);
    const row = await load(job.id);
    expect(row).toMatchObject({ status: "failed", runId: null }); // no render run was started
    expect(row.errorPublic).toMatch(/didn't find any kills by "nokills"/);
    expect(await getBalance(userId)).toBe(2000);
  });

  it("fails and refunds when the song can't be fetched, with the song message", async () => {
    const retryRun = vi.spyOn(enginex(), "retryRun");
    const job = await newJob({ musicUrl: `https://youtu.be/fail-${tag}` });
    await startJob(job.id, T0);
    for (const ms of [3_000, 6_000, 8_000, 9_000]) await tick(ms);
    const row = await load(job.id);
    expect(row.status).toBe("failed");
    expect(row.errorPublic).toMatch(/couldn't get that song/);
    // The mock's failure looks like a blip (exit 137), so the index retried its failed steps once before giving up.
    expect(retryRun).toHaveBeenCalledTimes(1);
    expect(await db.mediaIndex.findUnique({ where: { id: row.songIndexId! }, select: { retries: true, status: true } })).toEqual({ retries: 1, status: "failed" });
    retryRun.mockRestore();
    expect(await getBalance(userId)).toBe(2000);
  });

  it("merges kills less than 8 s apart into one entry, then shuffles the entries per seed", () => {
    const kills = { kills: [{ t: 10 }, { t: 13.5 }, { t: 17 }, { t: 40 }, { t: 90 }, { t: 130 }, { t: 131 }, { t: 200 }, { t: 260 }, { t: 260 }], totalKills: 10 };
    const orders = new Set<string>();
    for (let seed = 1; seed <= 30; seed++) {
      const out = shuffleKills(kills, String(seed)) as { kills: { t: number; more?: string }[]; totalKills: number };
      expect(out.totalKills).toBe(10);
      expect([...out.kills].sort((a, b) => a.t - b.t)).toEqual([
        { t: 10, more: "+3.5 s, +7 s" }, // a chain: each within 8 s of the one before
        { t: 40 },
        { t: 90 },
        { t: 130, more: "+1 s" },
        { t: 200 },
        { t: 260 }, // the same kill twice: once
      ]);
      expect(shuffleKills(kills, String(seed))).toEqual(out); // one job, one order
      orders.add(out.kills.map((k) => k.t).join());
    }
    expect(orders.size).toBeGreaterThan(20); // different jobs, different orders
    expect(shuffleKills({ kills: [67, 176, 177], totalKills: 3 }, undefined)).toEqual({ kills: [{ t: 67 }, { t: 176, more: "+1 s" }], totalKills: 3 }); // bare numbers
  });

  it("takes intro moments from just before kills that have no other kill in the 12 s before them", () => {
    const kills = { kills: [{ t: 5 }, { t: 89 }, { t: 92 }, { t: 238 }, { t: 400 }] };
    const intro = introMoments(kills, "7").flex;
    expect(intro.map((m) => m.start).sort((a, b) => a - b)).toEqual([80, 229, 391]); // 5 is too early, 92 follows 89
    expect(introMoments(kills, "7")).toEqual({ flex: intro }); // one job, one order
    expect(introMoments({ kills: [] }, "7")).toEqual({ flex: [] });
    expect(introMoments(undefined, "7")).toEqual({ flex: [] });
  });

  it("an uploaded song goes to the song-upload pipeline as its audio", () => {
    const templates = { ...INDEX, songUpload: "tpl_su" };
    const job = { id: "j1", source: "url", indexTemplates: templates, input: { youtubeUrl: "https://youtu.be/x", playerName: "Aqua", songUpload: "input/song.mp3" } } as never;
    expect(indexInputs(job).song).toEqual({ templateId: "tpl_su", input: { audio: "input/song.mp3" }, parts: ["j1", "input/song.mp3"] });
    const link = { id: "j2", source: "url", indexTemplates: templates, input: { youtubeUrl: "https://youtu.be/x", playerName: "Aqua", musicUrl: "https://youtu.be/s" } } as never;
    expect(indexInputs(link).song).toMatchObject({ templateId: INDEX.song, input: { musicUrl: "https://youtu.be/s" } });
  });

  it("sends a style only the inputs it declares", () => {
    const g = { video: "v.mp4", durationSec: 1800, kills: { kills: [{ t: 51 }], totalKills: 1 }, flex: { flex: [] } };
    const s = { audio: "a.m4a", durationSec: 22, loudness: "0,-30", words: [{ word: "so", start: 1, end: 1.3, score: 0.9 }] };
    const job = { input: { variation: "slow last", lyricLook: "7" }, durationSec: 60 };
    const kill = styleInput(job, g, s, ["video", "kills", "flex", "gameDurationSec", "audio", "songDurationSec", "loudness", "maxDurationSec", "variation"]);
    expect(kill).not.toHaveProperty("words");
    expect(kill).not.toHaveProperty("lyricLook");
    expect(kill).toMatchObject({ maxDurationSec: "60", variation: "slow last", gameDurationSec: "1800", kills: JSON.stringify(g.kills) });
    expect(styleInput(job, g, s, null)).toMatchObject({ lyricLook: "7", lines: expect.stringContaining('{"s":1,"e":1.5,"t":"so","r":0,"n":2,"p":') });
    // Too little loudness to read: safe defaults, and the planner is told there's no drop.
    expect(styleInput(job, g, s, null)).toMatchObject({ beatSec: "0.5", beats: "", dropAtSec: "none" });
    // A real song's loudness: its beat (105 BPM) and the beat times up to the montage's length (the song's 22 s here).
    const real = { ...s, loudness: readFileSync(new URL("./fixtures/loudness-rolling-in-the-deep-60s.csv", import.meta.url), "utf8") };
    const measured = styleInput(job, g, real, ["beatSec", "beats", "dropAtSec"]);
    expect(Math.abs(Number(measured.beatSec) - 0.571)).toBeLessThanOrEqual(0.005);
    expect(Math.max(...measured.beats.split(", ").map(Number))).toBeLessThanOrEqual(22);
    const seg = { ...s, segments: [{ start: 1, end: 2, words: [{ word: "so", start: 1, end: 1.3 }, { word: "cool", start: 1.4, end: 2 }] }] };
    expect(JSON.parse(styleInput(job, g, seg, ["lines"]).lines)).toMatchObject([{ s: 1, e: 1.4, t: "so" }, { s: 1.4, e: 2.2, t: "so cool" }, { t: "" }]); // + the no-text item
  });

  it("shows the video download's own progress while it downloads, then clears it", async () => {
    const job = await newJob();
    await startJob(job.id, T0);
    await tick(1_500); // the mock's download step runs 0-3 s
    // Half way through the step: the picture file is 0.5 / 0.65 of the way in (the mock: picture, sound, join, save).
    expect((await getPublicJob(job.id, userId))?.download).toEqual({ pct: 76, bytes: 553_846_154, totalBytes: 720_000_000, etaSec: 1, phase: "downloading" });
    await tick(2_400); // both files in, joining them
    expect((await getPublicJob(job.id, userId))?.download).toEqual({ pct: 100, bytes: 750_000_000, totalBytes: 750_000_000, etaSec: 0, phase: "joining" });
    await tick(9_500); // downloaded: reading the kill feed
    expect((await getPublicJob(job.id, userId))?.download).toBeNull();
  });

  it("canceling in the index phase stops both index runs", async () => {
    const cancelRun = vi.spyOn(enginex(), "cancelRun");
    const job = await newJob();
    await startJob(job.id, T0);
    const row = await load(job.id);
    const indexes = await db.mediaIndex.findMany({ where: { id: { in: [row.gameplayIndexId!, row.songIndexId!] } } });
    expect(await cancelJob(job.id, "canceled by admin")).toBe(true);
    expect(cancelRun.mock.calls.map(([id]) => id).sort()).toEqual(indexes.map((i) => i.runId).sort());
    expect(await db.mediaIndex.count({ where: { id: { in: indexes.map((i) => i.id) }, status: "failed" } })).toBe(2);
    expect(await load(job.id)).toMatchObject({ status: "canceled", chargedCredits: 0 });
    cancelRun.mockRestore();
  });
});

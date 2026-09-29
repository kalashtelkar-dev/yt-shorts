import { eq, inArray } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { catalogItems, jobs, mediaIndex, users } from "@/db/schema";
import { getBalance, grant } from "@/server/credits";
import { startJob, sweep } from "./lifecycle";
import { signedVideo } from "./public";
import { ensureIndex, indexInputs, introMoments, shuffleKills, styleInput } from "./staged";

// The mock (ENGINEX_MODE=mock) knows these as gameplay-index / song-index / the two styles.
const INDEX = { gameplay: "tpl_Yn4z8LVxNvFw", gameplayUpload: "tpl_MR-vL8OuXjf7", song: "tpl_8nvlocGpQ3nT" };
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
  {
    const [job] = await db
      .insert(jobs)
      .values({
        userId,
        catalogItemId,
        catalogSlug: "kill-montage",
        templateId: opts.style ?? "tpl_P0krMNymIjdb",
        indexTemplates: INDEX,
        input: { youtubeUrl: `https://youtu.be/${tag}`, playerName: opts.playerName ?? "Aqua", musicUrl: opts.musicUrl ?? `https://youtu.be/song-${tag}`, maxDurationSec: "30", variation: "slow first" },
        source: "url",
        durationSec: 30,
        maxCredits: 300,
      })
      .returning();
    return job;
  }
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
    .values({ slug: `s-${tag}`, title: "t", templateId: "tpl_P0krMNymIjdb", indexTemplates: INDEX, stageMap })
    .returning({ id: catalogItems.id });
  catalogItemId = item.id;
  await grant(userId, 2000, "test");
});
afterEach(() => vi.useRealTimers());

describe("staged styles (mock Engine X)", () => {
  it("indexes the gameplay and the song in parallel, then renders; a second job for the same video runs its own", async () => {
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
    expect(twinRow.gameplayIndexId).not.toBe(row.gameplayIndexId); // nothing shared between jobs: its own download and kills
    expect(twinRow.songIndexId).not.toBe(row.songIndexId); // and its own song
    const twinIdx = await db.select().from(mediaIndex).where(inArray(mediaIndex.id, [twinRow.gameplayIndexId!, twinRow.songIndexId!]));
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
    // the result page gets fresh links to the video and its cover still
    expect(await signedVideo(job.id, userId)).toMatchObject({ url: expect.stringContaining(".mp4"), poster: expect.stringContaining("data:image/svg") });
    // Each job pays for its whole run, indexes included: started at T0, finished at T0 + 30 s → 30 credits.
    expect(row.chargedCredits).toBe(30);
    expect(await getBalance(userId)).toBe(2000 - 60);
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
    const [g] = await db.select().from(mediaIndex).where(eq(mediaIndex.id, fresh.gameplayIndexId!));
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
    const job = await newJob({ musicUrl: `https://youtu.be/fail-${tag}` });
    await startJob(job.id, T0);
    for (const ms of [3_000, 6_000, 8_000]) await tick(ms);
    const row = await load(job.id);
    expect(row.status).toBe("failed");
    expect(row.errorPublic).toMatch(/couldn't get that song/);
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

  it("sends a style only the inputs it declares", () => {
    const g = { video: "v.mp4", durationSec: 1800, kills: { kills: [{ t: 51 }], totalKills: 1 }, flex: { flex: [] } };
    const s = { audio: "a.m4a", durationSec: 22, loudness: "0,-30", words: [{ word: "so", start: 1, end: 1.3, score: 0.9 }] };
    const job = { input: { variation: "slow last", lyricLook: "7" }, durationSec: 60 };
    const kill = styleInput(job, g, s, ["video", "kills", "flex", "gameDurationSec", "audio", "songDurationSec", "loudness", "maxDurationSec", "variation"]);
    expect(kill).not.toHaveProperty("words");
    expect(kill).not.toHaveProperty("lyricLook");
    expect(kill).toMatchObject({ maxDurationSec: "60", variation: "slow last", gameDurationSec: "1800", kills: JSON.stringify(g.kills) });
    expect(styleInput(job, g, s, null)).toMatchObject({ lyricLook: "7", lines: expect.stringContaining('{"s":1,"e":1.5,"t":"so","r":0,"n":2,"p":') });
    const seg = { ...s, segments: [{ start: 1, end: 2, words: [{ word: "so", start: 1, end: 1.3 }, { word: "cool", start: 1.4, end: 2 }] }] };
    expect(JSON.parse(styleInput(job, g, seg, ["lines"]).lines)).toMatchObject([{ s: 1, e: 1.4, t: "so" }, { s: 1.4, e: 2.2, t: "so cool" }, { t: "" }]); // + the no-text item
  });
});

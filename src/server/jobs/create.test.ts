import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import type { SessionUser } from "@/server/auth";
import { availableCredits, getBalance, grant } from "@/server/credits";
import { redis } from "@/server/redis";
import { cleanFileName, issueUpload } from "@/server/uploads";
import { createJob, randomLyricLook, randomVariation } from "./create";

let user: SessionUser;
let slug: string;
const url = "https://www.youtube.com/watch?v=2LnFuREmbpk";

beforeEach(async () => {
  const id = crypto.randomUUID();
  await db.user.create({ data: { id, name: "t", email: `${id}@test.local`, isAnonymous: true } });
  user = { id, suspendedAt: null } as SessionUser;
  slug = `km-${id}`;
  await db.catalogItem.create({
    data: {
      slug,
      title: "Kill Montage",
      templateId: "tpl_t",
      uploadTemplateId: "tpl_upload",
      durations: [30, 60, 90],
      creditRanges: { "30": { min: 40, max: 100 }, "60": { min: 80, max: 200 } }, // 90 has no range
      fields: [{ name: "playerName", label: "Your in-game name", type: "text", required: true, max: 32 }],
      inputMap: { youtubeUrl: "$source.url", video: "$source.key", videoTitle: "$source.name", playerName: "$fields.playerName" },
    },
  });
  await grant(id, 250, "test");
});

describe("createJob", () => {
  it("charges nothing up front, holds the top of the range, snapshots the template and stores the mapped input", async () => {
    const r = await createJob(user, { catalogSlug: slug, url, durationSec: 60, fields: { playerName: "  Aqua " } });
    expect(r.ok).toBe(true);
    const job = await db.job.findFirst({ where: { userId: user.id } });
    expect(job).toMatchObject({ status: "queued", templateId: "tpl_t", chargedCredits: 0, maxCredits: 200, input: { youtubeUrl: url, playerName: "Aqua" } });
    expect(await getBalance(user.id)).toBe(250);
    expect(await availableCredits(user.id)).toBe(50);
  });

  it.each([
    [{ url: "https://vimeo.com/1" }, "url"],
    [{ url: "http://youtube.com/watch?v=x" }, "url"],
    [{ fields: {} }, "playerName"],
    [{ fields: { playerName: "x".repeat(33) } }, "playerName"],
    [{ durationSec: 45 }, "durationSec"],
  ])("rejects bad input %j and charges nothing", async (patch, field) => {
    const r = await createJob(user, { catalogSlug: slug, url, durationSec: 60, fields: { playerName: "Aqua" }, ...patch });
    expect(r).toMatchObject({ ok: false, error: { field } });
    expect(await getBalance(user.id)).toBe(250);
  });

  it("requires a file for upload jobs", async () => {
    expect(await createJob(user, { catalogSlug: slug, source: "upload", durationSec: 30, fields: { playerName: "Aqua" } })).toMatchObject({ ok: false, error: { field: "upload" } });
  });

  it("rejects unknown keys", async () => {
    const r = await createJob(user, { catalogSlug: slug, url, durationSec: 60, fields: {}, templateId: "tpl_evil" } as never);
    expect(r.ok).toBe(false);
  });

  it("refuses a length without a credits range", async () => {
    const r = await createJob(user, { catalogSlug: slug, url, durationSec: 90, fields: { playerName: "Aqua" } });
    expect(r).toMatchObject({ ok: false, error: { code: "unavailable" } });
  });

  it("needs the top of the range free, counting what running jobs hold", async () => {
    await db.settings.update({ where: { id: 1 }, data: { maxConcurrentJobsPerUser: 2 } }); // two at once, so credits are the limit
    await createJob(user, { catalogSlug: slug, url, durationSec: 60, fields: { playerName: "Aqua" } }); // holds 200 of 250
    const r = await createJob(user, { catalogSlug: slug, url, durationSec: 60, fields: { playerName: "Aqua" } });
    expect(r).toMatchObject({ ok: false, error: { code: "insufficient", message: expect.stringContaining("you need 200 credits free") } });
    expect(r).toMatchObject({ error: { message: expect.stringContaining("You have 50") } });
  });

  it("blocks suspended users", async () => {
    const r = await createJob({ ...user, suspendedAt: new Date() } as SessionUser, { catalogSlug: slug, url, durationSec: 30, fields: { playerName: "Aqua" } });
    expect(r).toMatchObject({ ok: false, error: { code: "suspended" } });
  });

  it("lets a user run one montage at a time and an admin three, even when the starts land together", async () => {
    await db.settings.update({ where: { id: 1 }, data: { maxConcurrentJobsPerUser: 1, maxConcurrentJobsPerAdmin: 3 } });
    await grant(user.id, 10_000, "test");
    const start = () => createJob(user, { catalogSlug: slug, url, durationSec: 30, fields: { playerName: "Aqua" } });

    const first = await Promise.all([start(), start()]);
    expect(first.filter((r) => r.ok)).toHaveLength(1);
    expect(first.find((r) => !r.ok)).toMatchObject({ error: { code: "busy", message: expect.stringContaining("a montage being made") } });

    await db.user.update({ where: { id: user.id }, data: { isAnonymous: false, role: "admin" } });
    const more = await Promise.all([start(), start(), start()]);
    expect(more.filter((r) => r.ok)).toHaveLength(2); // three at once, one was already running
    expect(await db.job.count({ where: { userId: user.id } })).toBe(3);
  });
});

describe("per-run variety", () => {
  it("places slow motion only (no speed-ups) and picks one of the ten lyric looks", () => {
    for (let i = 0; i < 50; i++) {
      expect(randomVariation()).toMatch(/^Put the slow-motion clip [\w -]+\.$/);
      expect(randomLyricLook()).toMatch(/^\d$/);
    }
  });
});

describe("uploads", () => {
  it("checks type and size before issuing an upload URL", async () => {
    expect(await issueUpload(user, { name: "clip.exe", size: 10, type: "application/x-msdownload" })).toMatchObject({ ok: false, error: { code: "type" } });
    expect(await issueUpload(user, { name: "clip.mp4", size: 10, type: "image/png" })).toMatchObject({ ok: false, error: { code: "type" } });
    expect(await issueUpload(user, { name: "huge.mp4", size: 50 * 1024 ** 3, type: "video/mp4" })).toMatchObject({ ok: false, error: { code: "too_big" } });
    const ok = await issueUpload(user, { name: "my match.MKV", size: 1024, type: "" });
    expect(ok.ok).toBe(true);
  });

  it("takes songs as audio files, and never lets one kind pass as the other", async () => {
    expect(await issueUpload(user, { name: "track.mp3", size: 1024, type: "audio/mpeg" }, "audio")).toMatchObject({ ok: true });
    expect(await issueUpload(user, { name: "track.m4a", size: 1024, type: "" }, "audio")).toMatchObject({ ok: true });
    expect(await issueUpload(user, { name: "clip.mp4", size: 1024, type: "video/mp4" }, "audio")).toMatchObject({ ok: false, error: { code: "type" } });
    expect(await issueUpload(user, { name: "track.mp3", size: 1024, type: "audio/mpeg" })).toMatchObject({ ok: false, error: { code: "type" } }); // video by default
    expect(await issueUpload(user, { name: "constructor", size: 1024, type: "" }, "audio")).toMatchObject({ ok: false, error: { code: "type" } });
  });

  it("a song file instead of the song link, only where the style takes one and only the user's own file", async () => {
    const songField = { name: "songUrl", label: "Song (YouTube link)", type: "url", required: true };
    const staged = { gameplay: "tpl_g", gameplayUpload: null, song: "tpl_s" };
    await db.catalogItem.update({ where: { slug }, data: { fields: [{ name: "playerName", label: "Your in-game name", type: "text", required: true, max: 32 }, songField], inputMap: { youtubeUrl: "$source.url", playerName: "$fields.playerName", musicUrl: "$fields.songUrl" }, indexTemplates: staged } });
    const issued = await issueUpload(user, { name: "my song.mp3", size: 1024, type: "audio/mpeg" }, "audio");
    const key = issued.ok ? issued.data.key : "";
    const start = (songUpload: { key: string; name: string }) => createJob(user, { catalogSlug: slug, url, durationSec: 30, fields: { playerName: "Aqua" }, songUpload });
    expect(await start({ key, name: "my song.mp3" })).toMatchObject({ ok: false, error: { code: "unavailable", field: "songUrl" } }); // no song-upload pipeline yet
    await db.catalogItem.update({ where: { slug }, data: { indexTemplates: { ...staged, songUpload: "tpl_su" } } });
    expect(await start({ key: "input/someone-else.mp3", name: "x.mp3" })).toMatchObject({ ok: false, error: { field: "songUrl" } });
    expect(await start({ key, name: "my song.mp3" })).toMatchObject({ ok: true }); // no song link needed
    const job = await db.job.findFirstOrThrow({ where: { userId: user.id } });
    expect(job.input).toMatchObject({ songUpload: key, songName: "my song", youtubeUrl: url });
    expect(job.input).not.toHaveProperty("musicUrl");
  });

  it("cleans file names", () => {
    expect(cleanFileName("../../etc/pass wd.mp4")).toBe("pass wd.mp4");
    expect(cleanFileName("C:\\Videos\\ranked<1>.mov")).toBe("ranked_1_.mov");
  });

  it("starts an upload job on the upload template, only with the user's own key", async () => {
    const issued = await issueUpload(user, { name: "ranked game.mp4", size: 1024, type: "video/mp4" });
    const key = issued.ok ? issued.data.key : "";
    const r = await createJob(user, { catalogSlug: slug, source: "upload", upload: { key, name: "ranked game.mp4" }, durationSec: 30, fields: { playerName: "Aqua" } });
    expect(r.ok).toBe(true);
    const job = await db.job.findFirst({ where: { userId: user.id } });
    expect(job).toMatchObject({ source: "upload", uploadKey: key, sourceUrl: null, templateId: "tpl_upload", input: { video: key, videoTitle: "ranked game", playerName: "Aqua" } });

    await redis.del(`upload:${key}`);
    const stranger = await createJob(user, { catalogSlug: slug, source: "upload", upload: { key: "input/someone-else.mp4", name: "x.mp4" }, durationSec: 30, fields: { playerName: "Aqua" } });
    expect(stranger).toMatchObject({ ok: false, error: { field: "upload" } });
  });
});

import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { catalogItems, jobs, users } from "@/db/schema";
import type { SessionUser } from "@/server/auth";
import { getBalance, grant } from "@/server/credits";
import { redis } from "@/server/redis";
import { cleanFileName, issueUpload } from "@/server/uploads";
import { createJob, randomLyricLook, randomVariation } from "./create";

let user: SessionUser;
let slug: string;
const url = "https://www.youtube.com/watch?v=2LnFuREmbpk";

beforeEach(async () => {
  const id = crypto.randomUUID();
  await db.insert(users).values({ id, name: "t", email: `${id}@test.local`, isAnonymous: true });
  user = { id, suspendedAt: null } as SessionUser;
  slug = `km-${id}`;
  await db.insert(catalogItems).values({
    slug,
    title: "Kill Montage",
    templateId: "tpl_t",
    uploadTemplateId: "tpl_upload",
    durations: [30, 60, 90],
    prices: { "30": 100, "60": 200 }, // 90 has no price
    fields: [{ name: "playerName", label: "Your in-game name", type: "text", required: true, max: 32 }],
    inputMap: { youtubeUrl: "$source.url", video: "$source.key", videoTitle: "$source.name", playerName: "$fields.playerName" },
  });
  await grant(id, 250, "test");
});

describe("createJob", () => {
  it("charges the price, snapshots the template and stores the mapped input", async () => {
    const r = await createJob(user, { catalogSlug: slug, url, durationSec: 60, fields: { playerName: "  Aqua " } });
    expect(r.ok).toBe(true);
    const [job] = await db.select().from(jobs).where(eq(jobs.userId, user.id));
    expect(job).toMatchObject({ status: "queued", templateId: "tpl_t", chargedCredits: 200, input: { youtubeUrl: url, playerName: "Aqua" } });
    expect(await getBalance(user.id)).toBe(50);
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

  it("refuses a length without a price", async () => {
    const r = await createJob(user, { catalogSlug: slug, url, durationSec: 90, fields: { playerName: "Aqua" } });
    expect(r).toMatchObject({ ok: false, error: { code: "unavailable" } });
  });

  it("says how many credits are missing", async () => {
    await createJob(user, { catalogSlug: slug, url, durationSec: 60, fields: { playerName: "Aqua" } });
    const r = await createJob(user, { catalogSlug: slug, url, durationSec: 60, fields: { playerName: "Aqua" } });
    expect(r).toMatchObject({ ok: false, error: { code: "insufficient", message: "This montage costs 200 credits and you have 50." } });
  });

  it("blocks suspended users", async () => {
    const r = await createJob({ ...user, suspendedAt: new Date() } as SessionUser, { catalogSlug: slug, url, durationSec: 30, fields: { playerName: "Aqua" } });
    expect(r).toMatchObject({ ok: false, error: { code: "suspended" } });
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

  it("cleans file names", () => {
    expect(cleanFileName("../../etc/pass wd.mp4")).toBe("pass wd.mp4");
    expect(cleanFileName("C:\\Videos\\ranked<1>.mov")).toBe("ranked_1_.mov");
  });

  it("starts an upload job on the upload template, only with the user's own key", async () => {
    const issued = await issueUpload(user, { name: "ranked game.mp4", size: 1024, type: "video/mp4" });
    const key = issued.ok ? issued.data.key : "";
    const r = await createJob(user, { catalogSlug: slug, source: "upload", upload: { key, name: "ranked game.mp4" }, durationSec: 30, fields: { playerName: "Aqua" } });
    expect(r.ok).toBe(true);
    const [job] = await db.select().from(jobs).where(eq(jobs.userId, user.id));
    expect(job).toMatchObject({ source: "upload", uploadKey: key, sourceUrl: null, templateId: "tpl_upload", input: { video: key, videoTitle: "ranked game", playerName: "Aqua" } });

    await redis.del(`upload:${key}`);
    const stranger = await createJob(user, { catalogSlug: slug, source: "upload", upload: { key: "input/someone-else.mp4", name: "x.mp4" }, durationSec: 30, fields: { playerName: "Aqua" } });
    expect(stranger).toMatchObject({ ok: false, error: { field: "upload" } });
  });
});

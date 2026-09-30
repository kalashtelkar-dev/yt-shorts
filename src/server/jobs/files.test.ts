import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db/client";
import { ENGINEX_SERVE_MS, fileResponse, mediaLinks, parseRange, saveJobFiles, saveMissingFiles } from "./files";

const bytes = Uint8Array.from({ length: 3_000_000 }, (_, i) => i % 251); // spans several 1 MB read steps
let jobId: string;

beforeEach(async () => {
  vi.stubGlobal("fetch", async () => new Response(bytes, { headers: { "content-type": "video/mp4" } }));
  const userId = crypto.randomUUID();
  await db.user.create({ data: { id: userId, name: "t", email: `${userId}@test.local`, isAnonymous: true } });
  const item = await db.catalogItem.create({ data: { slug: `f-${userId}`, title: "t", templateId: "tpl_t" }, select: { id: true } });
  const job = await db.job.create({
    data: {
      userId, catalogItemId: item.id, catalogSlug: "kill-montage", templateId: "tpl_t", input: {}, source: "url", durationSec: 30,
      status: "succeeded", finishedAt: new Date(), outputKey: "mock/r/montage.mp4", outputMeta: { thumbnailKey: "mock/r/thumbnail.jpg" },
    },
  });
  jobId = job.id;
});
afterEach(() => vi.unstubAllGlobals());

describe("job files", () => {
  it("parses single byte ranges", () => {
    expect(parseRange(null, 100)).toBeNull();
    expect(parseRange("bytes=0-", 100)).toEqual({ start: 0, end: 99 });
    expect(parseRange("bytes=10-19", 100)).toEqual({ start: 10, end: 19 });
    expect(parseRange("bytes=90-500", 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange("bytes=100-", 100)).toBe("invalid");
    expect(parseRange("bytes=0-1,5-6", 100)).toBeNull(); // multi-range: send it all
  });

  it("plays from Engine X for the first hour (our copy as the fallback), then from Postgres; serves our copy with ranges", async () => {
    const finishedAt = new Date();
    const job = { id: jobId, outputKey: "mock/r/montage.mp4", outputMeta: { thumbnailKey: "mock/r/thumbnail.jpg" }, finishedAt };
    const links = async (afterMs: number) => (await mediaLinks([job], finishedAt.getTime() + afterMs)).get(jobId);
    expect(await links(0)).toMatchObject({ video: expect.stringMatching(/^https:/), videoFallback: null }); // nothing saved yet

    await saveMissingFiles({ since: new Date(0), limit: 1000 });
    await saveJobFiles(job); // again: a no-op
    expect(await db.jobFile.count({ where: { jobId } })).toBe(2);
    const ours = { video: `/api/jobs/${jobId}/files/video`, poster: `/api/jobs/${jobId}/files/thumbnail` };
    expect(await links(59 * 60_000)).toEqual({ video: expect.stringMatching(/^https:/), poster: ours.poster, videoFallback: ours.video });
    expect(await links(ENGINEX_SERVE_MS)).toEqual({ ...ours, videoFallback: null });

    const whole = (await fileResponse(jobId, "video", null))!;
    expect(whole.status).toBe(200);
    expect(new Uint8Array(await whole.arrayBuffer())).toEqual(bytes);

    const part = (await fileResponse(jobId, "video", "bytes=1048570-2097160"))!;
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe(`bytes 1048570-2097160/${bytes.length}`);
    expect(new Uint8Array(await part.arrayBuffer())).toEqual(bytes.slice(1048570, 2097161));

    expect((await fileResponse(jobId, "video", `bytes=${bytes.length}-`))!.status).toBe(416);
  });
});

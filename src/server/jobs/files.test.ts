import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { ENGINEX_SERVE_MS, mediaLinks, saveMissingFiles, storedFileResponse, storeJobFiles } from "./files";

let jobId: string;

beforeEach(async () => {
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

describe("job files", () => {
  it("plays from Engine X for the first hour (our stored copy as the fallback), then from the bucket", async () => {
    const finishedAt = new Date();
    const load = async () => ({ ...(await db.job.findUniqueOrThrow({ where: { id: jobId }, select: { id: true, outputKey: true, outputMeta: true } })), finishedAt });
    const links = async (afterMs: number) => (await mediaLinks([await load()], finishedAt.getTime() + afterMs)).get(jobId);
    expect(await links(0)).toMatchObject({ video: expect.stringMatching(/^https:/), videoFallback: null }); // nothing stored yet

    await saveMissingFiles({ since: new Date(0), limit: 1000 });
    const stored = { video: `montages/${jobId}/video.mp4`, thumbnail: `montages/${jobId}/thumbnail.jpg` };
    expect((await load()).outputMeta).toEqual({ thumbnailKey: "mock/r/thumbnail.jpg", stored });
    await storeJobFiles(await load()); // again: a no-op
    const ours = { video: `/api/jobs/${jobId}/files/video`, poster: `/api/jobs/${jobId}/files/thumbnail` };
    expect(await links(59 * 60_000)).toEqual({ video: expect.stringMatching(/^https:/), poster: ours.poster, videoFallback: ours.video });
    expect(await links(ENGINEX_SERVE_MS)).toEqual({ ...ours, videoFallback: null });

    const res = await storedFileResponse(stored.video);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toMatch(/^https:/);
  });
});

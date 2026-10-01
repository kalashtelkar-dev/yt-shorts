import "server-only";
import { env } from "@/config/env";
import { db } from "@/db/client";
import { enginex } from "@/server/enginex/client";

// While a montage is being made everything lives in Engine X storage, which is cleared within hours. Once it succeeds,
// the worker runs the store-file pipeline (pipelines/build.py) for the video and the cover still, which copies each into
// our bucket (ENGINEX_STORE_*) for the long term and records its key in outputMeta.stored. Videos play from Engine X for
// the first hour, then from the bucket through /api/jobs/:id/files/:kind (a share link redirect); see mediaLinks.

export const FILE_KINDS = ["thumbnail", "video"] as const;
export type FileKind = (typeof FILE_KINDS)[number];
export const isFileKind = (k: string): k is FileKind => (FILE_KINDS as readonly string[]).includes(k);

export const DEFAULT_TYPE: Record<FileKind, string> = { video: "video/mp4", thumbnail: "image/jpeg" };
const EXT: Record<FileKind, string> = { video: "mp4", thumbnail: "jpg" };
const STORE_POLL_MS = 1000;
const STORE_TIMEOUT_MS = 10 * 60_000;

type OutputJob = { id: string; outputKey: string | null; outputMeta: unknown };

/** The Engine X object keys of a finished job's files. */
function outputKeys(job: OutputJob): Partial<Record<FileKind, string>> {
  const thumb = (job.outputMeta as { thumbnailKey?: unknown } | null)?.thumbnailKey;
  return { ...(typeof thumb === "string" ? { thumbnail: thumb } : {}), ...(job.outputKey ? { video: job.outputKey } : {}) };
}

/** Keys in our bucket of the files already stored. */
export const storedKeys = (job: { outputMeta: unknown }): Partial<Record<FileKind, string>> =>
  (job.outputMeta as { stored?: Partial<Record<FileKind, string>> } | null)?.stored ?? {};

export const fileUrl = (jobId: string, kind: FileKind) => `/api/jobs/${jobId}/files/${kind}`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Copies one Engine X file into our bucket with the store-file pipeline, then records its key on the job. */
export async function storeFile(jobId: string, kind: FileKind, enginexKey: string, contentType = DEFAULT_TYPE[kind]): Promise<void> {
  if (!env.ENGINEX_STORE_PIPELINE) throw new Error("ENGINEX_STORE_PIPELINE is not set");
  const key = `montages/${jobId}/${kind}.${EXT[kind]}`;
  // A repeated store run only rewrites the same object, so each attempt starts its own run.
  const { runId } = await enginex().runPipeline(env.ENGINEX_STORE_PIPELINE, { file: enginexKey, key, contentType }, crypto.randomUUID());
  for (const deadline = Date.now() + STORE_TIMEOUT_MS; ; await sleep(STORE_POLL_MS)) {
    const run = await enginex().getRun(runId);
    if (run.status === "succeeded") break;
    if (run.status === "failed" || run.status === "canceled") throw new Error(`store run ${run.status}`); // details: admin run view
    if (Date.now() > deadline) {
      await enginex().cancelRun(runId).catch(() => {});
      throw new Error("store run timed out");
    }
  }
  // One statement, so storing the video and the cover at once can't drop either key.
  await db.$executeRaw`
    UPDATE jobs SET output_meta = coalesce(output_meta, '{}'::jsonb)
      || jsonb_build_object('stored', coalesce(output_meta->'stored', '{}'::jsonb) || jsonb_build_object(${kind}::text, ${key}::text))
    WHERE id = ${jobId}::uuid`;
}

/** Stores the job's files that aren't stored yet. Throws if one can't be, so the queue retries. */
export async function storeJobFiles(job: OutputJob): Promise<void> {
  const keys = outputKeys(job);
  const stored = storedKeys(job);
  const errors: string[] = [];
  for (const kind of FILE_KINDS) {
    // Each file on its own: a cover Engine X already cleared mustn't cost us the video.
    if (keys[kind] && !stored[kind]) await storeFile(job.id, kind, keys[kind]).catch((e: unknown) => errors.push(`${kind}: ${e instanceof Error ? e.message : String(e)}`));
  }
  if (errors.length) throw new Error(`couldn't store ${errors.join(", ")}`);
}

/** The worker's "save-files" task for one job; throws so the queue retries it. */
export async function saveFilesFor(jobId: string): Promise<void> {
  if (!env.ENGINEX_STORE_PIPELINE) return;
  const job = await db.job.findUnique({ where: { id: jobId }, select: { id: true, status: true, outputKey: true, outputMeta: true } });
  if (job?.status === "succeeded") await storeJobFiles(job);
}

/** Stores files for finished jobs whose video isn't stored yet (a store run failed at finish). */
export async function saveMissingFiles({ since, limit }: { since: Date; limit: number }) {
  if (!env.ENGINEX_STORE_PIPELINE) return { tried: 0, failed: [] };
  // Raw: "no stored.video key in the JSON" isn't a filter Prisma can say plainly.
  const ids = await db.$queryRaw<{ id: string }[]>`
    SELECT id FROM jobs WHERE status = 'succeeded' AND output_key IS NOT NULL AND finished_at >= ${since}
      AND output_meta->'stored'->>'video' IS NULL
    ORDER BY finished_at DESC LIMIT ${limit}`;
  const jobs = await db.job.findMany({ where: { id: { in: ids.map((r) => r.id) } }, select: { id: true, outputKey: true, outputMeta: true } });
  const failed: { id: string; error: string }[] = [];
  for (const job of jobs) {
    await storeJobFiles(job).catch((e: unknown) => failed.push({ id: job.id, error: e instanceof Error ? e.message : String(e) }));
  }
  return { tried: jobs.length, failed };
}

export type MediaLinks = { video: string | null; poster: string | null; videoFallback: string | null };

/** How long a finished video keeps playing from Engine X before links switch to our copy (the user's call, 2026-09-30). Engine X keeps outputs for some hours. */
export const ENGINEX_SERVE_MS = 60 * 60_000;

/**
 * Links to each job's video and cover (one signing call). For the first hour after the job finished the video plays from
 * Engine X, with our stored copy as `videoFallback` (the player switches to it if Engine X fails); after that, from our
 * copy. Covers come from our copy as soon as it's stored. Nothing stored yet: Engine X links.
 */
export async function mediaLinks(jobs: (OutputJob & { finishedAt: Date | null })[], now = Date.now()): Promise<Map<string, MediaLinks>> {
  const stored = new Map(jobs.map((j) => [j.id, storedKeys(j)]));
  const has = (id: string, kind: FileKind) => !!stored.get(id)?.[kind];
  const fresh = (j: { finishedAt: Date | null }) => !j.finishedAt || now - j.finishedAt.getTime() < ENGINEX_SERVE_MS;
  const keys = new Map(jobs.map((j) => [j.id, outputKeys(j)]));
  const toSign = jobs.flatMap((j) => {
    const k = keys.get(j.id)!;
    return [fresh(j) || !has(j.id, "video") ? k.video : undefined, has(j.id, "thumbnail") ? undefined : k.thumbnail].filter((x): x is string => !!x);
  });
  const signed: Record<string, string> = toSign.length ? await enginex().signOutput(toSign, 3600).catch(() => ({})) : {};
  return new Map(
    jobs.map((j): [string, MediaLinks] => {
      const k = keys.get(j.id)!;
      const poster = has(j.id, "thumbnail") ? fileUrl(j.id, "thumbnail") : k.thumbnail ? (signed[k.thumbnail] ?? null) : null;
      const remote = k.video ? (signed[k.video] ?? null) : null;
      if (!has(j.id, "video")) return [j.id, { video: remote, poster, videoFallback: null }];
      const ours = fileUrl(j.id, "video");
      return [j.id, fresh(j) && remote ? { video: remote, poster, videoFallback: ours } : { video: ours, poster, videoFallback: null }];
    }),
  );
}

/** A single `bytes=` range within `size`: null means "send it all", "invalid" means 416. */
export function parseRange(header: string | null, size: number): { start: number; end: number } | null | "invalid" {
  const m = header?.match(/^bytes=(\d*)-(\d*)$/);
  if (!m || (!m[1] && !m[2])) return null; // absent, multi-range or malformed: the whole file
  const [start, end] = m[1] ? [Number(m[1]), m[2] ? Math.min(Number(m[2]), size - 1) : size - 1] : [Math.max(0, size - Number(m[2])), size - 1];
  return start > end || start >= size ? "invalid" : { start, end };
}

/** A redirect to a fresh share link for a stored file (never stored itself; the browser may reuse it for 10 minutes). */
export async function storedFileResponse(key: string): Promise<Response> {
  const url = await enginex().shareStored(key, 3600);
  return new Response(null, { status: 302, headers: { Location: url, "Cache-Control": "private, max-age=600" } });
}

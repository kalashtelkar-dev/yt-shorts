import "server-only";
import { db } from "@/db/client";
import { enginex } from "@/server/enginex/client";

// While a montage is being made everything lives in Engine X storage. Once it succeeds, the worker copies the video and
// cover still into Postgres (job_files) in the background, for the long term: Engine X clears its storage after a while.
// Videos play from Engine X for the first hour, then from Postgres (/api/jobs/:id/files/:kind); see mediaLinks.

export const FILE_KINDS = ["thumbnail", "video"] as const;
export type FileKind = (typeof FILE_KINDS)[number];
export const isFileKind = (k: string): k is FileKind => (FILE_KINDS as readonly string[]).includes(k);

const DEFAULT_TYPE: Record<FileKind, string> = { video: "video/mp4", thumbnail: "image/jpeg" };
const CHUNK = 1 << 20; // bytes read from the DB per step while streaming
const DOWNLOAD_TIMEOUT_MS = 5 * 60_000;

type OutputJob = { id: string; outputKey: string | null; outputMeta: unknown };

/** The Engine X object keys of a finished job's files. */
function outputKeys(job: OutputJob): Partial<Record<FileKind, string>> {
  const thumb = (job.outputMeta as { thumbnailKey?: unknown } | null)?.thumbnailKey;
  return { ...(typeof thumb === "string" ? { thumbnail: thumb } : {}), ...(job.outputKey ? { video: job.outputKey } : {}) };
}

export const fileUrl = (jobId: string, kind: FileKind) => `/api/jobs/${jobId}/files/${kind}`;

/** Copies the job's files from Engine X into Postgres, skipping ones already saved. Throws if one can't be fetched. */
export async function saveJobFiles(job: OutputJob): Promise<void> {
  const keys = outputKeys(job);
  const saved = new Set((await db.jobFile.findMany({ where: { jobId: job.id }, select: { kind: true } })).map((f) => f.kind));
  const todo = FILE_KINDS.filter((k) => keys[k] && !saved.has(k));
  if (!todo.length) return;
  const urls = await enginex().signOutput(todo.map((k) => keys[k]!), 900);
  const errors: string[] = [];
  for (const kind of todo) {
    // Each file on its own: a cover Engine X already cleared mustn't cost us the video.
    try {
      const url = urls[keys[kind]!];
      if (!url) throw new Error("no link");
      const res = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) }); // never log the signed URL
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = new Uint8Array(await res.arrayBuffer());
      const contentType = res.headers.get("content-type")?.split(";")[0]?.trim() || DEFAULT_TYPE[kind];
      // Another worker may have saved it meanwhile: the first copy wins.
      await db.jobFile.createMany({ data: [{ jobId: job.id, kind, contentType, size: data.byteLength, data }], skipDuplicates: true });
    } catch (e) {
      errors.push(`${kind}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (errors.length) throw new Error(`couldn't save ${errors.join(", ")}`);
}

/** The worker's "save-files" task for one job; throws so the queue retries it. */
export async function saveFilesFor(jobId: string): Promise<void> {
  const job = await db.job.findUnique({ where: { id: jobId }, select: { id: true, status: true, outputKey: true, outputMeta: true } });
  if (job?.status === "succeeded") await saveJobFiles(job);
}

/** Saves files for finished jobs that don't have theirs yet (a download failed at finish, or the job predates job_files). */
export async function saveMissingFiles({ since, limit }: { since: Date; limit: number }) {
  const jobs = await db.job.findMany({
    where: { status: "succeeded", outputKey: { not: null }, finishedAt: { gte: since }, files: { none: { kind: "video" } } },
    select: { id: true, outputKey: true, outputMeta: true },
    orderBy: { finishedAt: "desc" },
    take: limit,
  });
  const failed: { id: string; error: string }[] = [];
  for (const job of jobs) {
    await saveJobFiles(job).catch((e: unknown) => failed.push({ id: job.id, error: e instanceof Error ? e.message : String(e) }));
  }
  return { tried: jobs.length, failed };
}

export type MediaLinks = { video: string | null; poster: string | null; videoFallback: string | null };

/** How long a finished video keeps playing from Engine X before links switch to our copy (the user's call, 2026-09-30). Engine X keeps outputs for some hours. */
export const ENGINEX_SERVE_MS = 60 * 60_000;

/**
 * Links to each job's video and cover (one signing call). For the first hour after the job finished the video plays from
 * Engine X, with our Postgres copy as `videoFallback` (the player switches to it if Engine X fails); after that, from
 * Postgres. Covers are small, so they come from Postgres as soon as they're saved. Nothing saved yet: Engine X links.
 */
export async function mediaLinks(jobs: (OutputJob & { finishedAt: Date | null })[], now = Date.now()): Promise<Map<string, MediaLinks>> {
  const saved = new Set(
    (await db.jobFile.findMany({ where: { jobId: { in: jobs.map((j) => j.id) } }, select: { jobId: true, kind: true } })).map((f) => `${f.jobId}/${f.kind}`),
  );
  const has = (id: string, kind: FileKind) => saved.has(`${id}/${kind}`);
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

/** The saved file as an HTTP response, honouring Range so videos can seek. Null when it isn't saved. */
export async function fileResponse(jobId: string, kind: FileKind, rangeHeader: string | null): Promise<Response | null> {
  const file = await db.jobFile.findUnique({ where: { jobId_kind: { jobId, kind } }, select: { size: true, contentType: true } });
  if (!file) return null;
  const range = parseRange(rangeHeader, file.size);
  if (range === "invalid") return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${file.size}` } });
  const { start, end } = range ?? { start: 0, end: file.size - 1 };
  let pos = start;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (pos > end) return controller.close();
      const len = Math.min(CHUNK, end - pos + 1);
      const [row] = await db.$queryRaw<{ chunk: Uint8Array }[]>`
        SELECT substring(data FROM ${pos + 1}::int FOR ${len}::int) AS chunk FROM job_files WHERE job_id = ${jobId}::uuid AND kind = ${kind}`;
      if (!row) return controller.error(new Error("file removed while streaming"));
      controller.enqueue(new Uint8Array(row.chunk));
      pos += len;
    },
  });
  return new Response(body, {
    status: range ? 206 : 200,
    headers: {
      "Content-Type": file.contentType,
      "Content-Length": String(end - start + 1),
      "Accept-Ranges": "bytes",
      // The files never change once saved.
      "Cache-Control": "private, max-age=31536000, immutable",
      ...(range ? { "Content-Range": `bytes ${start}-${end}/${file.size}` } : {}),
    },
  });
}

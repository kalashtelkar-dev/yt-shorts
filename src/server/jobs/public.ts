import "server-only";
import { db, type JobRow } from "@/db/client";
import type { JobStatus } from "@/generated/prisma/client";
import { enginex } from "@/server/enginex/client";
import type { LibraryItem, PublicJob, PublicStatus } from "@/lib/jobs";

// What users may see about a job (CLAUDE.md §4.8): friendly stages and errors only.
// Never run ids, template ids, step names or raw errors.

const toPublicStatus = (s: JobStatus): PublicStatus =>
  s === "queued" ? "queued" : s === "starting" || s === "running" ? "running" : s === "succeeded" ? "succeeded" : "failed";

/** The job if `userId` owns it, else null (so other people's job ids look like missing pages). */
export async function getPublicJob(jobId: string, userId: string): Promise<PublicJob | null> {
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) return null;
  const found = await db.job.findFirst({ where: { id: jobId, userId }, include: { catalogItem: { select: { title: true, stageMap: true } } } });
  if (!found) return null;
  const { catalogItem: row, ...job } = found;
  const events = (
    await db.jobEvent.findMany({ where: { jobId }, select: { createdAt: true, message: true, level: true }, orderBy: { createdAt: "asc" }, take: 100 })
  ).map(({ createdAt, ...e }) => ({ at: createdAt, ...e }));
  const meta = (job.outputMeta ?? {}) as { totalKills?: number; title?: string | null };
  const status = toPublicStatus(job.status);
  return {
    id: job.id,
    title: row.title,
    status,
    stage: job.currentStage,
    stageDetail: status === "running" ? job.stageDetail : null,
    stages: [...new Set(row.stageMap.filter((s) => !s.only || s.only === job.source).map((s) => s.label))],
    progress: status === "succeeded" ? 1 : job.stepsTotal ? job.stepsDone / job.stepsTotal : 0,
    events: events.map((e) => ({ ...e, at: e.at.toISOString() })),
    createdAt: job.createdAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt: job.finishedAt?.toISOString() ?? null,
    durationSec: job.durationSec,
    credits: job.chargedCredits,
    kills: typeof meta.totalKills === "number" ? meta.totalKills : null,
    videoTitle: meta.title ?? null,
    error: status === "failed" ? (job.errorPublic ?? "Something went wrong. Your credits were returned.") : null,
  };
}

export async function listJobs(userId: string, limit = 50): Promise<LibraryItem[]> {
  const rows = (
    await db.job.findMany({ where: { userId }, include: { catalogItem: { select: { title: true } } }, orderBy: { createdAt: "desc" }, take: limit })
  ).map(({ catalogItem, ...job }) => ({ job, title: catalogItem.title }));
  const metaOf = (job: JobRow) => (job.outputMeta ?? {}) as { totalKills?: number; title?: string | null; thumbnailKey?: unknown };
  const thumbOf = (job: JobRow) => {
    const k = metaOf(job).thumbnailKey;
    return job.status === "succeeded" && typeof k === "string" ? k : null;
  };
  // One signing call for every cover on the page; the library still renders if it fails.
  const keys = rows.map((r) => thumbOf(r.job)).filter((k): k is string => !!k);
  const posters: Record<string, string> = keys.length ? await enginex().signOutput(keys, 3600).catch(() => ({})) : {};
  return rows.map(({ job, title }) => {
    const meta = metaOf(job);
    const status = toPublicStatus(job.status);
    const thumb = thumbOf(job);
    return {
      id: job.id,
      title,
      status,
      createdAt: job.createdAt.toISOString(),
      durationSec: job.durationSec,
      kills: typeof meta.totalKills === "number" ? meta.totalKills : null,
      videoTitle: meta.title ?? null,
      progress: status === "succeeded" ? 1 : job.stepsTotal ? job.stepsDone / job.stepsTotal : 0,
      poster: thumb ? (posters[thumb] ?? null) : null,
      error: status === "failed" ? (job.errorPublic ?? "Something went wrong. Your credits were returned.") : null,
    };
  });
}

/** Fresh signed links to the finished video and its cover still, every time (never stored). */
export async function signedVideo(jobId: string, userId: string): Promise<{ url: string; poster: string | null } | null> {
  const job = await db.job.findFirst({ where: { id: jobId, userId, status: "succeeded" }, select: { outputKey: true, outputMeta: true } });
  if (!job?.outputKey) return null;
  const thumbnailKey = (job.outputMeta as { thumbnailKey?: unknown } | null)?.thumbnailKey;
  const keys = typeof thumbnailKey === "string" ? [job.outputKey, thumbnailKey] : [job.outputKey];
  const urls = await enginex().signOutput(keys, 3600);
  const url = urls[job.outputKey];
  return url ? { url, poster: typeof thumbnailKey === "string" ? (urls[thumbnailKey] ?? null) : null } : null;
}

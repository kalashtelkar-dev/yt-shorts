import "server-only";
import { db, type JobRow } from "@/db/client";
import type { JobStatus } from "@/generated/prisma/client";
import { mediaLinks } from "@/server/jobs/files";
import { lengthNote } from "@/server/jobs/plan";
import type { LibraryItem, PublicJob, PublicStatus } from "@/lib/jobs";
import { youtubeId } from "@/lib/youtube";

// What users may see about a job (CLAUDE.md §4.8): friendly stages and errors only.
// Never run ids, template ids, step names or raw errors.

const toPublicStatus = (s: JobStatus): PublicStatus =>
  s === "queued" ? "queued" : s === "starting" || s === "running" ? "running" : s === "succeeded" ? "succeeded" : "failed";

/** What a job is made from, as its owner gave it (shown to them and to admins); titles once the readers have finished. */
export async function jobSources(job: JobRow): Promise<PublicJob["sources"]> {
  const indexes = await db.mediaIndex.findMany({
    where: { id: { in: [job.gameplayIndexId, job.songIndexId].filter((x): x is string => !!x) } },
    select: { kind: true, output: true },
  });
  const titleOf = (kind: "gameplay" | "song") => {
    const t = (indexes.find((i) => i.kind === kind)?.output as { title?: unknown } | null)?.title;
    return typeof t === "string" && t.trim() ? t.trim() : null;
  };
  const { musicUrl, songUpload, songName } = job.input as Record<string, unknown>;
  const videoTitle = (job.outputMeta as { title?: unknown } | null)?.title;
  return {
    gameplay: {
      youtubeId: job.source === "url" ? youtubeId(job.sourceUrl) : null,
      title: titleOf("gameplay") ?? (typeof videoTitle === "string" ? videoTitle : null),
    },
    song:
      typeof songUpload === "string"
        ? { youtubeId: null, title: typeof songName === "string" && songName ? songName : null } // an uploaded file: its name
        : typeof musicUrl === "string"
          ? { youtubeId: youtubeId(musicUrl), title: titleOf("song") }
          : null,
  };
}

/** The job if `userId` owns it, else null (so other people's job ids look like missing pages). */
export async function getPublicJob(jobId: string, userId: string): Promise<PublicJob | null> {
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) return null;
  const found = await db.job.findFirst({ where: { id: jobId, userId }, include: { catalogItem: { select: { title: true, stageMap: true } } } });
  if (!found) return null;
  const { catalogItem: row, ...job } = found;
  const events = (
    await db.jobEvent.findMany({ where: { jobId }, select: { createdAt: true, message: true, level: true }, orderBy: { createdAt: "asc" }, take: 100 })
  ).map(({ createdAt, ...e }) => ({ at: createdAt, ...e }));
  const meta = (job.outputMeta ?? {}) as { totalKills?: number; title?: string | null; lengthSec?: number | null; songSec?: number | null };
  // Waiting for one of the site's slots (settings.maxConcurrentJobsTotal): its place in line, oldest first.
  const ahead = job.status === "queued" ? await db.job.count({ where: { status: "queued", createdAt: { lt: job.createdAt } } }) : null;
  const status = toPublicStatus(job.status);
  return {
    id: job.id,
    title: row.title,
    status,
    stage: ahead !== null ? "Waiting in line" : job.currentStage,
    stageDetail: ahead !== null ? (ahead ? `${ahead} ahead of you` : "You're next") : status === "running" ? job.stageDetail : null,
    stages: [...new Set(row.stageMap.filter((s) => !s.only || s.only === job.source).map((s) => s.label))],
    progress: status === "succeeded" ? 1 : job.stepsTotal ? job.stepsDone / job.stepsTotal : 0,
    download: status === "running" ? job.download : null,
    events: events.map((e) => ({ ...e, at: e.at.toISOString() })),
    createdAt: job.createdAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt: job.finishedAt?.toISOString() ?? null,
    durationSec: job.durationSec,
    lengthSec: meta.lengthSec ?? null,
    lengthNote:
      status === "succeeded" ? lengthNote({ pickedSec: job.durationSec, lengthSec: meta.lengthSec, songSec: meta.songSec, kills: meta.totalKills }) : null,
    credits: job.chargedCredits,
    kills: typeof meta.totalKills === "number" ? meta.totalKills : null,
    videoTitle: meta.title ?? null,
    error: status === "failed" ? (job.errorPublic ?? "Something went wrong. Your credits were returned.") : null,
    sources: await jobSources(job),
  };
}

export async function listJobs(userId: string, limit = 50): Promise<LibraryItem[]> {
  const rows = (
    await db.job.findMany({ where: { userId }, include: { catalogItem: { select: { title: true } } }, orderBy: { createdAt: "desc" }, take: limit })
  ).map(({ catalogItem, ...job }) => ({ job, title: catalogItem.title }));
  const metaOf = (job: JobRow) => (job.outputMeta ?? {}) as { totalKills?: number; title?: string | null; lengthSec?: number | null; songSec?: number | null };
  // Covers for finished jobs; the library still renders if links fail.
  const links = await mediaLinks(rows.filter((r) => r.job.status === "succeeded").map((r) => r.job)).catch(() => new Map());
  return rows.map(({ job, title }) => {
    const meta = metaOf(job);
    const status = toPublicStatus(job.status);
    return {
      id: job.id,
      title,
      status,
      createdAt: job.createdAt.toISOString(),
      durationSec: (status === "succeeded" && meta.lengthSec) || job.durationSec,
      kills: typeof meta.totalKills === "number" ? meta.totalKills : null,
      videoTitle: meta.title ?? null,
      progress: status === "succeeded" ? 1 : job.stepsTotal ? job.stepsDone / job.stepsTotal : 0,
      poster: links.get(job.id)?.poster ?? null,
      error: status === "failed" ? (job.errorPublic ?? "Something went wrong. Your credits were returned.") : null,
    };
  });
}

/** Links to the finished video and its cover still (see mediaLinks: Engine X for the first hour, then our copy). Never stored. */
export async function signedVideo(jobId: string, userId: string): Promise<{ url: string; poster: string | null; fallback: string | null } | null> {
  const job = await db.job.findFirst({
    where: { id: jobId, userId, status: "succeeded" },
    select: { id: true, outputKey: true, outputMeta: true, finishedAt: true },
  });
  if (!job?.outputKey) return null;
  const links = (await mediaLinks([job])).get(job.id);
  return links?.video ? { url: links.video, poster: links.poster, fallback: links.videoFallback } : null;
}

import "server-only";
import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { catalogItems, jobEvents, jobs } from "@/db/schema";
import { enginex } from "@/server/enginex/client";
import type { LibraryItem, PublicJob, PublicStatus } from "@/lib/jobs";

// What users may see about a job (CLAUDE.md §4.8): friendly stages and errors only.
// Never run ids, template ids, step names or raw errors.

const toPublicStatus = (s: (typeof jobs.$inferSelect)["status"]): PublicStatus =>
  s === "queued" ? "queued" : s === "starting" || s === "running" ? "running" : s === "succeeded" ? "succeeded" : "failed";

/** The job if `userId` owns it, else null (so other people's job ids look like missing pages). */
export async function getPublicJob(jobId: string, userId: string): Promise<PublicJob | null> {
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) return null;
  const [row] = await db
    .select({ job: jobs, title: catalogItems.title, stageMap: catalogItems.stageMap })
    .from(jobs)
    .innerJoin(catalogItems, eq(catalogItems.id, jobs.catalogItemId))
    .where(and(eq(jobs.id, jobId), eq(jobs.userId, userId)));
  if (!row) return null;
  const { job } = row;
  const events = await db
    .select({ at: jobEvents.createdAt, message: jobEvents.message, level: jobEvents.level })
    .from(jobEvents)
    .where(eq(jobEvents.jobId, jobId))
    .orderBy(asc(jobEvents.createdAt))
    .limit(100);
  const meta = (job.outputMeta ?? {}) as { totalKills?: number; title?: string | null };
  const status = toPublicStatus(job.status);
  return {
    id: job.id,
    title: row.title,
    status,
    stage: job.currentStage,
    stageDetail: status === "running" ? job.stageDetail : null,
    stages: [...new Set(row.stageMap.map((s) => s.label))],
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
  const rows = await db
    .select({ job: jobs, title: catalogItems.title })
    .from(jobs)
    .innerJoin(catalogItems, eq(catalogItems.id, jobs.catalogItemId))
    .where(eq(jobs.userId, userId))
    .orderBy(desc(jobs.createdAt))
    .limit(limit);
  return rows.map(({ job, title }) => {
    const meta = (job.outputMeta ?? {}) as { totalKills?: number; title?: string | null };
    return {
      id: job.id,
      title,
      status: toPublicStatus(job.status),
      createdAt: job.createdAt.toISOString(),
      durationSec: job.durationSec,
      kills: typeof meta.totalKills === "number" ? meta.totalKills : null,
      videoTitle: meta.title ?? null,
    };
  });
}

/** A fresh signed link to the finished video, every time (never stored). */
export async function signedVideoUrl(jobId: string, userId: string): Promise<string | null> {
  const [job] = await db
    .select({ outputKey: jobs.outputKey })
    .from(jobs)
    .where(and(eq(jobs.id, jobId), eq(jobs.userId, userId), eq(jobs.status, "succeeded")));
  if (!job?.outputKey) return null;
  const urls = await enginex().signOutput([job.outputKey], 3600);
  return urls[job.outputKey] ?? null;
}

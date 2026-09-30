import "server-only";
import { db } from "@/db/client";
import type { DownloadPhase, DownloadProgress } from "@/db/types";
import { Prisma } from "@/generated/prisma/client";
import { enginex } from "@/server/enginex/client";
import type { JobEvent, RunStep } from "@/server/enginex/types";
import { notify } from "./lifecycle";

// The video download's own progress. Engine X reports it only in the download step's engine-job trail
// (`downloading` events with a fraction, bytes and eta; the job's `progress` field jumps 0 → 100 at the end).

/**
 * The download's progress so far, or null if it hasn't reported any. YouTube serves picture and sound as separate files,
 * so Engine X reports each from 0 to 1 in turn: they're added up as one download. Then it joins them ("Merger") and moves
 * the result into storage ("MoveFiles"), which took 35 s to 3+ min on real jobs (2026-09-30) with no progress of its own.
 */
export function downloadFromEvents(events: JobEvent[]): DownloadProgress | null {
  let done = 0; // bytes of the files already finished
  let cur: { bytes: number; total: number; fraction: number; eta: unknown } | null = null;
  let later = false; // a second file has started
  let phase: DownloadPhase = "downloading";
  for (const e of events) {
    const d = e.data;
    if (e.kind === "postprocessing") phase = d?.step === "Merger" ? "joining" : "saving";
    const fraction = Number(d?.fraction);
    if (!d || d.fraction == null || !Number.isFinite(fraction)) continue;
    const total = Math.max(0, Math.round(Number(d.totalBytes) || 0));
    if (cur && total !== cur.total) {
      done += cur.total;
      later = true;
    }
    cur = { bytes: Math.max(0, Math.round(Number(d.bytes) || 0)), total, fraction: Math.min(1, Math.max(0, fraction)), eta: d.eta };
  }
  if (!cur) return null;
  const bytes = done + cur.bytes;
  const totalBytes = done + cur.total;
  let pct = Math.floor((totalBytes ? Math.min(1, bytes / totalBytes) : cur.fraction) * 100);
  // A later file grows the total as it starts, which would pull the bar back from 100: hold at 99 until it's in.
  if (later && cur.fraction < 1) pct = 99;
  const etaSec = cur.eta == null || !Number.isFinite(Number(cur.eta)) ? null : Math.max(0, Math.round(Number(cur.eta)));
  return { pct, bytes, totalBytes, etaSec, phase };
}

/** Progress of a run's video download while that step runs, else null. Callers pass only runs whose download is the video. */
export async function downloadProgress(steps: RunStep[]): Promise<DownloadProgress | null> {
  const step = steps.find((s) => s.engine === "media-fetch" && s.status === "running" && s.job);
  if (!step) return null;
  return downloadFromEvents(await enginex().getJobEvents(step.job!).catch(() => []));
}

// Last percent written per source (a job or an index row), so a poll writes only when it changes (after a restart, once).
// ponytail: one small entry per job for the worker's lifetime; prune finished ones if a worker ever runs for months.
const lastPct = new Map<string, string | null>();

/** Stores the download progress on the running jobs `where` matches (and tells their progress pages), when it changed. */
export async function syncDownload(source: string, where: Prisma.JobWhereInput, download: DownloadProgress | null) {
  const pct = download ? `${download.pct}|${download.phase ?? ""}` : null; // a new phase at 100% counts as a change
  if (lastPct.has(source) && lastPct.get(source) === pct) return;
  const jobs = await db.job.findMany({ where: { ...where, status: "running" }, select: { id: true } });
  if (jobs.length) await db.job.updateMany({ where: { id: { in: jobs.map((j) => j.id) } }, data: { download: download ?? Prisma.DbNull } });
  lastPct.set(source, pct);
  for (const j of jobs) await notify(j.id);
}

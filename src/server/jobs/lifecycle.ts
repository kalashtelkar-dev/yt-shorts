import "server-only";
import { db, type JobRow } from "@/db/client";
import { progressOf, stageDetail, stageFor } from "@/server/catalog";
import { chargeForUsage, refundJob } from "@/server/credits";
import { creditsForRun } from "@/lib/billing";
import { enginex } from "@/server/enginex/client";
import { EngineXError, type Run } from "@/server/enginex/types";
import { enqueueSaveFiles } from "@/server/queue";
import { redis } from "@/server/redis";
import { getSettings, type Settings } from "@/server/settings";
import { CANCELED_MESSAGE, isTransientFailure, noKillsMessage, publicErrorFor, TIMEOUT_MESSAGE } from "./errors";
import { downloadProgress, syncDownload } from "./download";
import { advanceStaged, pollIndexes, startStaged } from "./staged";

// Everything that moves a job through its life. Runs in the worker only (CLAUDE.md §7).
// Every transition is a conditional UPDATE, so overlapping sweeps or two workers can't double-act.

type Job = JobRow;

const STALE_START_MS = 2 * 60_000;
const MAX_RETRIES = 1;
const FAST_POLL_FOR_MS = 5 * 60_000;
const SLOW_POLL_MS = 10_000;

export async function event(jobId: string, message: string, level: "info" | "warn" | "error" = "info") {
  await db.jobEvent.create({ data: { jobId, level, message } });
}

/** Tells SSE listeners (web) that the job changed; they re-read the public view. */
export async function notify(jobId: string) {
  await redis.publish(`job:${jobId}`, "update").catch(() => {});
}

const costPaise = (runMs: number, s: Settings) => Math.ceil(runMs / 1000) * s.costPaisePerSecond;

/** Queued jobs, and "starting" jobs whose start never got a run id (a crash or a network error) after STALE_START_MS. */
const startable = (now: number) => ({
  OR: [{ status: "queued" as const }, { status: "starting" as const, runId: null, startedAt: { lt: new Date(now - STALE_START_MS) } }],
});

// Held while a job takes one of the site's slots, so two workers can't both take the last one (any constant works).
const SLOT_LOCK = 710_001;

/**
 * Moves a job to "starting" if the site has room: fewer than settings.maxConcurrentJobsTotal jobs starting or running,
 * and it's among the oldest queued jobs that fit (first come, first served). A stale "starting" job already holds a slot.
 */
async function claimSlot(jobId: string, now: number): Promise<boolean> {
  const max = (await getSettings()).maxConcurrentJobsTotal;
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`select pg_advisory_xact_lock(${SLOT_LOCK})`;
    const restart = await tx.job.updateMany({ where: { id: jobId, ...startable(now), status: "starting" }, data: { startedAt: new Date(now) } });
    if (restart.count) return true;
    const free = max - (await tx.job.count({ where: { status: { in: ["starting", "running"] } } }));
    if (free <= 0) return false;
    const next = await tx.job.findMany({ where: { status: "queued" }, orderBy: { createdAt: "asc" }, take: free, select: { id: true } });
    if (!next.some((j) => j.id === jobId)) return false;
    const { count } = await tx.job.updateMany({ where: { id: jobId, status: "queued" }, data: { status: "starting", startedAt: new Date(now) } });
    return count > 0;
  });
}

/**
 * Starts the Engine X run for a queued job. The job id is the Idempotency-Key, so re-sending after a
 * network failure or a crash returns the same run instead of starting a second one.
 */
export async function startJob(jobId: string, now = Date.now()) {
  if (!(await claimSlot(jobId, now))) return; // the site is full: it stays queued, and the sweep tries again in 5 s

  const job = await db.job.findUniqueOrThrow({ where: { id: jobId } });

  if (job.indexTemplates) {
    // Staged style: index the gameplay and the song first (staged.ts); the render run starts when both are done.
    try {
      await startStaged(job, now);
    } catch (e) {
      console.error("[startStaged]", e instanceof Error ? e.message : e);
      await finishFailed(job, { errorRaw: `start: ${e instanceof Error ? e.message : String(e)}`, errorPublic: publicErrorFor(null), runMs: 0 });
    }
    // Canceled while the index runs were starting: stop them too.
    if ((await db.job.findUnique({ where: { id: job.id }, select: { status: true } }))?.status === "canceled") await stopRuns(await load(job.id));
    return;
  }

  try {
    const { runId } = await enginex().runPipeline(job.templateId, job.input as Record<string, unknown>, job.id);
    const { count } = await db.job.updateMany({ where: { id: job.id, status: "starting" }, data: { runId, status: "running" } });
    // Canceled while the run was starting: nothing will poll it, so stop it now.
    if (!count) return void (await enginex().cancelRun(runId).catch(logCancelError));
    await event(job.id, "Started editing");
  } catch (e) {
    const err = e instanceof EngineXError ? e : new EngineXError("unknown", String(e), false);
    // Network/5xx: the run may exist. Stay "starting"; the sweep re-sends with the same key after STALE_START_MS.
    if (err.retryable) {
      await event(job.id, "Waiting for an editing server", "warn");
      return;
    }
    await finishFailed(job, { errorRaw: `start: ${err.code}: ${err.message}`, errorPublic: publicErrorFor(null, err.code), runMs: 0 });
  }
}

/** One poll of a running job: progress, stage, timeout and the terminal outcome. Credits are charged when it succeeds. */
export async function pollJob(job: Job, settings: Settings, stageMap: { match: string; label: string }[], outputField: string, now = Date.now()) {
  let run: Run;
  try {
    run = await enginex().getRun(job.runId!);
  } catch (e) {
    if (e instanceof EngineXError && e.status === 404) {
      await finishFailed(job, { errorRaw: `poll: run ${job.runId} not found`, errorPublic: publicErrorFor(null), runMs: elapsed(job, now) }, settings);
    }
    return; // transient: next sweep tries again
  }

  if (run.status === "succeeded") return finishSucceeded(job, run, outputField, settings, now);
  if (run.status === "failed" || run.status === "canceled") {
    const failed = run.steps.find((s) => s.status === "failed");
    // One automatic retry of the failed steps for infrastructure blips (same run, so no double charge).
    if (run.status === "failed" && job.retries < MAX_RETRIES && isTransientFailure(failed?.engine ?? null, failed?.error ?? run.error)) {
      try {
        await enginex().retryRun(job.runId!);
        await db.job.updateMany({ where: { id: job.id, status: "running" }, data: { retries: job.retries + 1 } });
        await event(job.id, "A step failed on our side, so we're running it again", "warn");
        await notify(job.id);
        return;
      } catch {
        // Retry refused: fall through and finish as failed.
      }
    }
    return finishFailed(
      job,
      {
        errorRaw: [run.error, failed && `${failed.step} (${failed.engine}): ${failed.error}`].filter(Boolean).join(" | ") || run.status,
        errorPublic: publicErrorFor(failed?.engine ?? null),
        runMs: run.runMs ?? elapsed(job, now),
        status: run.status === "canceled" ? "canceled" : "failed",
      },
      settings,
    );
  }

  if (elapsed(job, now) > settings.maxRunMinutes * 60_000) {
    await enginex()
      .cancelRun(job.runId!)
      .catch(() => {});
    return finishFailed(job, { errorRaw: `timeout after ${settings.maxRunMinutes} min`, errorPublic: TIMEOUT_MESSAGE, runMs: elapsed(job, now) }, settings);
  }

  await syncDownload(job.id, { id: job.id }, await downloadProgress(run.steps)); // single-run styles download the video themselves

  // Staged jobs: the index phase's steps count too, so the bar keeps moving forward.
  const p = progressOf(run.steps);
  const done = p.done + job.indexSteps;
  const total = p.total + job.indexSteps;
  const stage = stageFor(run.steps, stageMap, job.currentStage);
  const detail = stageDetail(run.steps, stageMap, stage);
  if (done === job.stepsDone && total === job.stepsTotal && stage === job.currentStage && detail === job.stageDetail) return;
  await db.job.updateMany({ where: { id: job.id, status: "running" }, data: { stepsDone: done, stepsTotal: total, currentStage: stage, stageDetail: detail } });
  if (stage && stage !== job.currentStage) await event(job.id, stage);
  await notify(job.id);
}

const elapsed = (job: Job, now: number) => (job.startedAt ? now - job.startedAt.getTime() : 0);

async function finishSucceeded(job: Job, run: Run, outputField: string, settings: Settings, now: number) {
  const output = run.output ?? {};
  // Style pipelines report the kills inside their plan.
  const plan = (output.plan && typeof output.plan === "object" ? output.plan : {}) as Record<string, unknown>;
  const clipList = Array.isArray(output.clips) ? output.clips : Array.isArray(plan.clips) ? plan.clips : null;
  const killCount = Number(output.totalKills ?? plan.totalKills);
  const outputKey = typeof output[outputField] === "string" ? (output[outputField] as string) : null;
  const thumbnailKey = typeof output.thumbnail === "string" ? output.thumbnail : null; // the cover still (style pipelines)
  // Staged jobs also ran their gameplay and song indexes, so they pay for the whole job, not just the render run.
  const runMs = job.indexTemplates ? elapsed(job, now) : (run.runMs ?? elapsed(job, now));
  if (!outputKey) {
    // The pipeline skips rendering when it finds no kills: tell the user that, not "something went wrong".
    const noKills = killCount === 0 || (clipList !== null && clipList.length === 0);
    const name = String((job.input as Record<string, unknown>).playerName ?? "your name");
    return finishFailed(
      job,
      { errorRaw: noKills ? "no kills found" : `succeeded without output field "${outputField}"`, errorPublic: noKills ? noKillsMessage(name) : publicErrorFor(null), runMs },
      settings,
    );
  }
  const totalKills = killCount || 0;
  const clips = clipList ? clipList.length : null;
  let title = typeof output.title === "string" ? output.title : null;
  if (!title && job.gameplayIndexId) {
    const g = await db.mediaIndex.findUnique({ where: { id: job.gameplayIndexId }, select: { output: true } });
    title = typeof g?.output?.title === "string" ? g.output.title : null;
  }

  const finished = await db.$transaction(async (tx) => {
    const { count } = await tx.job.updateMany({
      where: { id: job.id, status: "running" },
      data: {
        status: "succeeded",
        outputKey,
        outputMeta: { totalKills, title, clips, thumbnailKey },
        runMs,
        computeCostPaise: costPaise(runMs, settings),
        stepsDone: job.stepsTotal || job.stepsDone,
        currentStage: "Done",
        stageDetail: null,
        finishedAt: new Date(now),
      },
    });
    if (!count) return false;
    // The owner now (our update holds the row lock): a guest who signed up mid-run moved the job.
    const claimed = await tx.job.findUniqueOrThrow({ where: { id: job.id }, select: { userId: true } });
    // Pay for the editing time used, never more than the top of the range the user was shown (maxCredits, the user's
    // call on 2026-09-30). Jobs from before usage pricing were charged at start (maxCredits 0): skip.
    if (job.maxCredits > 0) {
      const charged = await chargeForUsage(tx, claimed.userId, job.id, Math.min(creditsForRun(runMs), job.maxCredits));
      await tx.job.update({ where: { id: job.id }, data: { chargedCredits: charged } });
    }
    await tx.jobEvent.create({ data: { jobId: job.id, message: totalKills ? `Done. Found ${totalKills} kill${totalKills === 1 ? "" : "s"}` : "Done" } });
    return true;
  });
  if (finished) {
    await notify(job.id);
    // The result plays from Engine X right away; our long-term copy goes into Postgres in the background (Engine X clears its storage).
    await enqueueSaveFiles(job.id).catch((e: unknown) => console.error(`[files] enqueue ${job.id}: ${e instanceof Error ? e.message : String(e)}`));
  }
}

const load = (id: string) => db.job.findUniqueOrThrow({ where: { id } });
const logCancelError = (e: unknown) => console.error(`[cancelRun] ${e instanceof Error ? e.message : String(e)}`);

/** Cancels every Engine X run a job has (its run, and a staged job's running index runs) so compute stops. */
async function stopRuns(job: Job, now = Date.now()) {
  // Index rows are per job (their cache key includes the job id), so no other job is using these runs.
  const indexes = await db.mediaIndex.findMany({
    where: { id: { in: [job.gameplayIndexId, job.songIndexId].filter((x): x is string => !!x) }, status: "running" },
    select: { id: true, runId: true },
  });
  const runIds = [job.runId, ...indexes.map((i) => i.runId)].filter((x): x is string => !!x);
  await Promise.all(runIds.map((id) => enginex().cancelRun(id).catch(logCancelError)));
  if (indexes.length) {
    await db.mediaIndex.updateMany({ where: { id: { in: indexes.map((i) => i.id) }, status: "running" }, data: { status: "failed", error: "canceled", finishedAt: new Date(now) } });
  }
}

/** Stops an unfinished job: its Engine X runs are canceled and it ends as "canceled", costing the user nothing. False if it had already finished. */
export async function cancelJob(jobId: string, errorRaw: string, now = Date.now()): Promise<boolean> {
  const job = await db.job.findUnique({ where: { id: jobId } });
  if (!job || !["queued", "starting", "running"].includes(job.status)) return false;
  const canceled = await finishFailed(job, { status: "canceled", errorRaw, errorPublic: CANCELED_MESSAGE, runMs: elapsed(job, now) });
  // After the status change, so a run that startJob saves meanwhile is caught by its own check or by this re-read.
  if (canceled) await stopRuns(await load(jobId), now);
  return canceled;
}

export async function finishFailed(
  job: Job,
  f: { errorRaw: string; errorPublic: string; runMs: number; status?: "failed" | "canceled" },
  settings?: Settings,
): Promise<boolean> {
  const s = settings ?? (await getSettings());
  const finished = await db.$transaction(async (tx) => {
    const { count } = await tx.job.updateMany({
      where: { id: job.id, status: { in: ["queued", "starting", "running"] } },
      data: {
        status: f.status ?? "failed",
        errorRaw: f.errorRaw,
        errorPublic: f.errorPublic,
        runMs: f.runMs,
        computeCostPaise: costPaise(f.runMs, s), // tracked for the cost report even though the user isn't charged
        finishedAt: new Date(),
      },
    });
    if (!count) return false;
    // Only jobs from before usage pricing were charged up front; new jobs charged nothing, so this is a no-op for them.
    await refundJob(job.id, f.status === "canceled" ? "Job canceled" : "Job did not finish", tx);
    await tx.jobEvent.create({ data: { jobId: job.id, level: "error", message: f.errorPublic } });
    return true;
  });
  if (finished) await notify(job.id);
  return finished;
}

const lastPolled = new Map<string, number>();

/** Runs every 5 s in the worker: starts queued jobs, polls running ones. Also how the worker resumes after a restart. */
export async function sweep(now = Date.now()) {
  const settings = await getSettings();
  await pollIndexes(settings, now); // staged styles: each gameplay/song index is polled once, however many jobs share it

  const toStart = await db.job.findMany({ where: startable(now), orderBy: { createdAt: "asc" }, select: { id: true } });
  for (const { id } of toStart) await startJob(id, now);

  const running = (
    await db.job.findMany({ where: { status: "running" }, include: { catalogItem: { select: { stageMap: true, outputKey: true } } } })
  ).map(({ catalogItem, ...job }) => ({ job, stageMap: catalogItem.stageMap, outputKey: catalogItem.outputKey }));

  const due = running.filter(({ job }) => {
    const slow = elapsed(job, now) > FAST_POLL_FOR_MS;
    return !slow || now - (lastPolled.get(job.id) ?? 0) >= SLOW_POLL_MS;
  });
  // ponytail: polls in batches of 10 from one sweep; shard across workers if hundreds run at once.
  for (let i = 0; i < due.length; i += 10) {
    await Promise.all(
      due.slice(i, i + 10).map(async ({ job, stageMap, outputKey }) => {
        lastPolled.set(job.id, now);
        if (job.phase === "index") await advanceStaged(job, settings, stageMap, now);
        else await pollJob(job, settings, stageMap, outputKey, now);
      }),
    );
  }
  for (const id of lastPolled.keys()) if (!running.some((r) => r.job.id === id)) lastPolled.delete(id);
}

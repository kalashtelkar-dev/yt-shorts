import "server-only";
import { and, eq, inArray, isNull, lt, or } from "drizzle-orm";
import { db } from "@/db";
import { catalogItems, jobEvents, jobs } from "@/db/schema";
import { progressOf, stageDetail, stageFor } from "@/server/catalog";
import { refundJob } from "@/server/credits";
import { enginex } from "@/server/enginex/client";
import { EngineXError, type Run } from "@/server/enginex/types";
import { redis } from "@/server/redis";
import { getSettings, type Settings } from "@/server/settings";
import { isTransientFailure, noKillsMessage, publicErrorFor, TIMEOUT_MESSAGE } from "./errors";

// Everything that moves a job through its life. Runs in the worker only (CLAUDE.md §7).
// Every transition is a conditional UPDATE, so overlapping sweeps or two workers can't double-act.

type Job = typeof jobs.$inferSelect;

const STALE_START_MS = 2 * 60_000;
const MAX_RETRIES = 1;
const FAST_POLL_FOR_MS = 5 * 60_000;
const SLOW_POLL_MS = 10_000;

async function event(jobId: string, message: string, level: "info" | "warn" | "error" = "info") {
  await db.insert(jobEvents).values({ jobId, level, message });
}

/** Tells SSE listeners (web) that the job changed; they re-read the public view. */
async function notify(jobId: string) {
  await redis.publish(`job:${jobId}`, "update").catch(() => {});
}

const costPaise = (runMs: number, s: Settings) => Math.ceil(runMs / 1000) * s.costPaisePerSecond;

/**
 * Starts the Engine X run for a queued job. The job id is the Idempotency-Key, so re-sending after a
 * network failure or a crash returns the same run instead of starting a second one.
 */
export async function startJob(jobId: string, now = Date.now()) {
  const [job] = await db
    .update(jobs)
    .set({ status: "starting", startedAt: new Date(now) })
    .where(
      and(
        eq(jobs.id, jobId),
        or(eq(jobs.status, "queued"), and(eq(jobs.status, "starting"), isNull(jobs.runId), lt(jobs.startedAt, new Date(now - STALE_START_MS)))),
      ),
    )
    .returning();
  if (!job) return;

  try {
    const { runId } = await enginex().runPipeline(job.templateId, job.input as Record<string, unknown>, job.id);
    await db.update(jobs).set({ runId, status: "running" }).where(and(eq(jobs.id, job.id), eq(jobs.status, "starting")));
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

/** One poll of a running job: progress, stage, timeout and the terminal outcome. Credits were charged at creation. */
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
        await db.update(jobs).set({ retries: job.retries + 1 }).where(and(eq(jobs.id, job.id), eq(jobs.status, "running")));
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

  const { done, total } = progressOf(run.steps);
  const stage = stageFor(run.steps, stageMap, job.currentStage);
  const detail = stageDetail(run.steps, stageMap, stage);
  if (done === job.stepsDone && total === job.stepsTotal && stage === job.currentStage && detail === job.stageDetail) return;
  await db
    .update(jobs)
    .set({ stepsDone: done, stepsTotal: total, currentStage: stage, stageDetail: detail })
    .where(and(eq(jobs.id, job.id), eq(jobs.status, "running")));
  if (stage && stage !== job.currentStage) await event(job.id, stage);
  await notify(job.id);
}

const elapsed = (job: Job, now: number) => (job.startedAt ? now - job.startedAt.getTime() : 0);

async function finishSucceeded(job: Job, run: Run, outputField: string, settings: Settings, now: number) {
  const output = run.output ?? {};
  const outputKey = typeof output[outputField] === "string" ? (output[outputField] as string) : null;
  const runMs = run.runMs ?? elapsed(job, now);
  if (!outputKey) {
    // The pipeline skips rendering when it finds no kills: tell the user that, not "something went wrong".
    const noKills = Number(output.totalKills) === 0 || (Array.isArray(output.clips) && output.clips.length === 0);
    const name = String((job.input as Record<string, unknown>).playerName ?? "your name");
    return finishFailed(
      job,
      { errorRaw: noKills ? "no kills found" : `succeeded without output field "${outputField}"`, errorPublic: noKills ? noKillsMessage(name) : publicErrorFor(null), runMs },
      settings,
    );
  }
  const totalKills = Number(output.totalKills) || 0;
  const clips = Array.isArray(output.clips) ? output.clips.length : null;

  const finished = await db.transaction(async (tx) => {
    const [claimed] = await tx
      .update(jobs)
      .set({
        status: "succeeded",
        outputKey,
        outputMeta: { totalKills, title: typeof output.title === "string" ? output.title : null, clips },
        runMs,
        computeCostPaise: costPaise(runMs, settings),
        stepsDone: job.stepsTotal || job.stepsDone,
        currentStage: "Done",
        stageDetail: null,
        finishedAt: new Date(now),
      })
      .where(and(eq(jobs.id, job.id), eq(jobs.status, "running")))
      .returning({ id: jobs.id });
    if (!claimed) return false;
    await tx.insert(jobEvents).values({ jobId: job.id, message: totalKills ? `Done. Found ${totalKills} kill${totalKills === 1 ? "" : "s"}` : "Done" });
    return true;
  });
  if (finished) await notify(job.id);
}

async function finishFailed(
  job: Job,
  f: { errorRaw: string; errorPublic: string; runMs: number; status?: "failed" | "canceled" },
  settings?: Settings,
) {
  const s = settings ?? (await getSettings());
  const finished = await db.transaction(async (tx) => {
    const [claimed] = await tx
      .update(jobs)
      .set({
        status: f.status ?? "failed",
        errorRaw: f.errorRaw,
        errorPublic: f.errorPublic,
        runMs: f.runMs,
        computeCostPaise: costPaise(f.runMs, s), // tracked for the cost report even though the user isn't charged
        finishedAt: new Date(),
      })
      .where(and(eq(jobs.id, job.id), inArray(jobs.status, ["queued", "starting", "running"])))
      .returning({ id: jobs.id });
    if (!claimed) return false;
    await refundJob(job.id, f.status === "canceled" ? "Job canceled" : "Job did not finish", tx);
    await tx.insert(jobEvents).values({ jobId: job.id, level: "error", message: f.errorPublic });
    return true;
  });
  if (finished) await notify(job.id);
}

const lastPolled = new Map<string, number>();

/** Runs every 5 s in the worker: starts queued jobs, polls running ones. Also how the worker resumes after a restart. */
export async function sweep(now = Date.now()) {
  const settings = await getSettings();

  const toStart = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(or(eq(jobs.status, "queued"), and(eq(jobs.status, "starting"), isNull(jobs.runId), lt(jobs.startedAt, new Date(now - STALE_START_MS)))));
  for (const { id } of toStart) await startJob(id, now);

  const running = await db
    .select({ job: jobs, stageMap: catalogItems.stageMap, outputKey: catalogItems.outputKey })
    .from(jobs)
    .innerJoin(catalogItems, eq(catalogItems.id, jobs.catalogItemId))
    .where(eq(jobs.status, "running"));

  const due = running.filter(({ job }) => {
    const slow = elapsed(job, now) > FAST_POLL_FOR_MS;
    return !slow || now - (lastPolled.get(job.id) ?? 0) >= SLOW_POLL_MS;
  });
  // ponytail: polls in batches of 10 from one sweep; shard across workers if hundreds run at once.
  for (let i = 0; i < due.length; i += 10) {
    await Promise.all(
      due.slice(i, i + 10).map(async ({ job, stageMap, outputKey }) => {
        lastPolled.set(job.id, now);
        await pollJob(job, settings, stageMap, outputKey, now);
      }),
    );
  }
  for (const id of lastPolled.keys()) if (!running.some((r) => r.job.id === id)) lastPolled.delete(id);
}

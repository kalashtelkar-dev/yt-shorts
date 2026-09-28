import "server-only";
import { createHash } from "node:crypto";
import { and, eq, inArray, lt, or } from "drizzle-orm";
import { db } from "@/db";
import { jobs, mediaIndex, type StageMapEntry } from "@/db/schema";
import { progressOf, stageDetail, stageFor } from "@/server/catalog";
import { enginex } from "@/server/enginex/client";
import { EngineXError } from "@/server/enginex/types";
import type { Settings } from "@/server/settings";
import { publicErrorFor, TIMEOUT_MESSAGE } from "./errors";
import { event, finishFailed, notify } from "./lifecycle";

// Staged styles (docs/edit-styles/README.md): the gameplay and the song are indexed by their own pipelines,
// in parallel, and the results are shared through media_index; then the style pipeline plans and renders.
// The render phase is an ordinary run (job.runId), so polling, retry, timeout and refunds are unchanged.

type Job = typeof jobs.$inferSelect;
type IndexRow = typeof mediaIndex.$inferSelect;
type Kind = IndexRow["kind"];

// ponytail: Engine X outputs expire after a few hours, so a finished index is reused for an hour. Store
// the outputs ourselves if re-renders later than that should skip the index.
export const REUSE_MS = 60 * 60_000;
const STALE_RUN_MS = 60 * 60_000; // a "running" index older than this is started again
const RESEND_MS = 2 * 60_000; // an index whose run couldn't be started is re-sent after this
const RENDER_STEPS_ESTIMATE = 60; // keeps the progress bar honest before the render run reports its steps

export const cacheKey = (kind: Kind, templateId: string, parts: string[]) =>
  createHash("sha256").update(JSON.stringify([kind, templateId, ...parts])).digest("hex");

/** What each index pipeline needs, from the job's mapped input (youtubeUrl or video, playerName, musicUrl). */
export function indexInputs(job: Pick<Job, "input" | "source" | "indexTemplates">) {
  const i = job.input as Record<string, string>;
  const t = job.indexTemplates!;
  const upload = job.source === "upload";
  const gameplay: Record<string, string> = upload ? { video: i.video, playerName: i.playerName } : { youtubeUrl: i.youtubeUrl, playerName: i.playerName };
  return {
    gameplay: {
      templateId: upload ? t.gameplayUpload! : t.gameplay,
      input: gameplay,
      parts: [upload ? i.video : i.youtubeUrl, (i.playerName ?? "").toLowerCase()],
    },
    song: { templateId: t.song, input: { musicUrl: i.musicUrl }, parts: [i.musicUrl] },
  };
}

async function startIndexRun(row: IndexRow) {
  try {
    const { runId } = await enginex().runPipeline(row.templateId, row.input, `idx-${row.id}`);
    await db.update(mediaIndex).set({ runId }).where(and(eq(mediaIndex.id, row.id), eq(mediaIndex.status, "running")));
  } catch (e) {
    const err = e instanceof EngineXError ? e : new EngineXError("unknown", String(e), false);
    if (err.retryable) return; // no runId yet: pollIndexes re-sends with the same key
    await db
      .update(mediaIndex)
      .set({ status: "failed", error: `start: ${err.code}: ${err.message}`, finishedAt: new Date() })
      .where(eq(mediaIndex.id, row.id));
  }
}

/**
 * The index row for this pipeline and input: a fresh finished one, one already running, or a new run.
 * Claiming is one INSERT … ON CONFLICT, so two jobs for the same video start only one run.
 */
export async function ensureIndex(kind: Kind, templateId: string, input: Record<string, string>, parts: string[], now = Date.now()): Promise<IndexRow> {
  const key = cacheKey(kind, templateId, parts);
  const at = new Date(now);
  const [claimed] = await db
    .insert(mediaIndex)
    .values({ kind, cacheKey: key, templateId, input, startedAt: at })
    .onConflictDoUpdate({
      target: mediaIndex.cacheKey,
      set: { status: "running", runId: null, output: null, error: null, steps: [], stepsDone: 0, stepsTotal: 0, input, startedAt: at, finishedAt: null, runMs: null },
      setWhere: or(
        eq(mediaIndex.status, "failed"),
        and(eq(mediaIndex.status, "succeeded"), lt(mediaIndex.finishedAt, new Date(now - REUSE_MS))),
        and(eq(mediaIndex.status, "running"), lt(mediaIndex.startedAt, new Date(now - STALE_RUN_MS))),
      ),
    })
    .returning();
  if (claimed) {
    await startIndexRun(claimed);
    const [row] = await db.select().from(mediaIndex).where(eq(mediaIndex.id, claimed.id));
    return row;
  }
  const [row] = await db.select().from(mediaIndex).where(eq(mediaIndex.cacheKey, key));
  return row;
}

/** Called by startJob once the job is claimed: both indexes start (or are reused) in parallel. */
export async function startStaged(job: Job, now = Date.now()) {
  const { gameplay, song } = indexInputs(job);
  const [g, s] = await Promise.all([
    ensureIndex("gameplay", gameplay.templateId, gameplay.input, gameplay.parts, now),
    ensureIndex("song", song.templateId, song.input, song.parts, now),
  ]);
  await db
    .update(jobs)
    .set({ status: "running", phase: "index", gameplayIndexId: g.id, songIndexId: s.id })
    .where(and(eq(jobs.id, job.id), eq(jobs.status, "starting")));
  await event(job.id, "Started editing");
  await notify(job.id);
}

/** Runs every sweep: polls each running index once, however many jobs wait on it. */
export async function pollIndexes(settings: Settings, now = Date.now()) {
  const rows = await db.select().from(mediaIndex).where(eq(mediaIndex.status, "running"));
  await Promise.all(
    rows.map(async (row) => {
      if (!row.runId) {
        if (now - row.startedAt.getTime() >= RESEND_MS) await startIndexRun(row);
        return;
      }
      let run;
      try {
        run = await enginex().getRun(row.runId);
      } catch (e) {
        if (e instanceof EngineXError && e.status === 404) {
          await db.update(mediaIndex).set({ status: "failed", error: `run ${row.runId} not found`, finishedAt: new Date(now) }).where(eq(mediaIndex.id, row.id));
        }
        return;
      }
      const { done, total } = progressOf(run.steps);
      if (run.status === "succeeded") {
        await db
          .update(mediaIndex)
          .set({ status: "succeeded", output: run.output ?? {}, steps: run.steps, stepsDone: total, stepsTotal: total, runMs: run.runMs, finishedAt: new Date(now) })
          .where(and(eq(mediaIndex.id, row.id), eq(mediaIndex.status, "running")));
      } else if (run.status === "failed" || run.status === "canceled") {
        const failed = run.steps.find((s) => s.status === "failed");
        await db
          .update(mediaIndex)
          .set({
            status: "failed",
            steps: run.steps,
            error: [run.error, failed && `${failed.step} (${failed.engine}): ${failed.error}`].filter(Boolean).join(" | ") || run.status,
            output: { failedEngine: failed?.engine ?? null },
            finishedAt: new Date(now),
          })
          .where(and(eq(mediaIndex.id, row.id), eq(mediaIndex.status, "running")));
      } else if (now - row.startedAt.getTime() > settings.maxRunMinutes * 60_000) {
        await enginex().cancelRun(row.runId).catch(() => {});
        await db.update(mediaIndex).set({ status: "failed", error: `timeout after ${settings.maxRunMinutes} min`, finishedAt: new Date(now) }).where(eq(mediaIndex.id, row.id));
      } else if (done !== row.stepsDone || total !== row.stepsTotal) {
        await db.update(mediaIndex).set({ steps: run.steps, stepsDone: done, stepsTotal: total }).where(eq(mediaIndex.id, row.id));
      }
    }),
  );
}

/** Everything the app can send a style pipeline (styleInput); a style may declare fewer. */
export const STYLE_INPUTS = ["video", "kills", "flex", "gameDurationSec", "audio", "songDurationSec", "loudness", "words", "maxDurationSec", "variation", "lyricLook"];

/** The style pipeline's inputs, from the two indexes. Only inputs the pipeline declares are sent. */
export function styleInput(job: Pick<Job, "input" | "durationSec">, g: Record<string, unknown>, s: Record<string, unknown>, declared: string[] | null) {
  const i = job.input as Record<string, string>;
  const all: Record<string, string> = {
    video: String(g.video ?? ""),
    kills: JSON.stringify(g.kills ?? { kills: [], totalKills: 0 }),
    flex: JSON.stringify(g.flex ?? { flex: [] }),
    gameDurationSec: String(g.durationSec ?? ""),
    audio: String(s.audio ?? ""),
    songDurationSec: String(s.durationSec ?? ""),
    loudness: String(s.loudness ?? ""),
    words: JSON.stringify(s.words ?? []),
    maxDurationSec: String(job.durationSec),
    variation: i.variation ?? "",
    lyricLook: i.lyricLook ?? "0",
  };
  return declared ? Object.fromEntries(Object.entries(all).filter(([k]) => declared.includes(k))) : all;
}

const declaredCache = new Map<string, { at: number; names: string[] }>();
async function declaredInputs(templateId: string, now: number): Promise<string[] | null> {
  const hit = declaredCache.get(templateId);
  if (hit && now - hit.at < 10 * 60_000) return hit.names;
  try {
    const names = (await enginex().getPipeline(templateId)).inputs.map((x) => x.name);
    declaredCache.set(templateId, { at: now, names });
    return names;
  } catch {
    return hit?.names ?? null; // unknown: send everything
  }
}

const SONG_ERROR = "We couldn't get that song. Check the link is public and plays without signing in, then try again. Your credits were returned.";

/** One sweep for a job in the index phase: progress while indexing, failure, or starting the render. */
export async function advanceStaged(job: Job, settings: Settings, stageMap: StageMapEntry[], now = Date.now()) {
  const ids = [job.gameplayIndexId, job.songIndexId].filter((x): x is string => !!x);
  const rows = await db.select().from(mediaIndex).where(inArray(mediaIndex.id, ids));
  const g = rows.find((r) => r.id === job.gameplayIndexId);
  const s = rows.find((r) => r.id === job.songIndexId);
  const elapsedMs = job.startedAt ? now - job.startedAt.getTime() : 0;
  if (!g || !s) return finishFailed(job, { errorRaw: "index rows missing", errorPublic: publicErrorFor(null), runMs: elapsedMs }, settings);

  for (const [row, songPart] of [[g, false], [s, true]] as const) {
    if (row.status !== "failed") continue;
    const engine = (row.output?.failedEngine as string | null) ?? null;
    return finishFailed(job, { errorRaw: `${row.kind} index: ${row.error}`, errorPublic: songPart ? SONG_ERROR : publicErrorFor(engine), runMs: elapsedMs }, settings);
  }
  if (elapsedMs > settings.maxRunMinutes * 60_000) {
    return finishFailed(job, { errorRaw: `timeout after ${settings.maxRunMinutes} min in the index phase`, errorPublic: TIMEOUT_MESSAGE, runMs: elapsedMs }, settings);
  }

  if (g.status === "succeeded" && s.status === "succeeded") {
    const input = styleInput(job, g.output ?? {}, s.output ?? {}, await declaredInputs(job.templateId, now));
    try {
      const { runId } = await enginex().runPipeline(job.templateId, input, job.id);
      await db
        .update(jobs)
        .set({ runId, phase: "render", indexSteps: g.stepsTotal + s.stepsTotal, stepsDone: g.stepsTotal + s.stepsTotal, stepsTotal: g.stepsTotal + s.stepsTotal + RENDER_STEPS_ESTIMATE })
        .where(and(eq(jobs.id, job.id), eq(jobs.status, "running"), eq(jobs.phase, "index")));
      await event(job.id, "Cutting your montage");
      await notify(job.id);
    } catch (e) {
      const err = e instanceof EngineXError ? e : new EngineXError("unknown", String(e), false);
      if (err.retryable) return; // same job id as the key: the next sweep re-sends safely
      await finishFailed(job, { errorRaw: `render start: ${err.code}: ${err.message}`, errorPublic: publicErrorFor(null, err.code), runMs: elapsedMs }, settings);
    }
    return;
  }

  const steps = [...g.steps, ...s.steps];
  const done = g.stepsDone + s.stepsDone;
  const total = g.stepsTotal + s.stepsTotal + RENDER_STEPS_ESTIMATE;
  const stage = stageFor(steps, stageMap, job.currentStage);
  const detail = stageDetail(steps, stageMap, stage);
  if (done === job.stepsDone && total === job.stepsTotal && stage === job.currentStage && detail === job.stageDetail) return;
  await db
    .update(jobs)
    .set({ stepsDone: done, stepsTotal: total, currentStage: stage, stageDetail: detail })
    .where(and(eq(jobs.id, job.id), eq(jobs.status, "running"), eq(jobs.phase, "index")));
  if (stage && stage !== job.currentStage) await event(job.id, stage);
  await notify(job.id);
}

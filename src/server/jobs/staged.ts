import "server-only";
import { createHash } from "node:crypto";
import { db, type JobRow, type MediaIndexRow } from "@/db/client";
import type { StageMapEntry } from "@/db/types";
import { Prisma } from "@/generated/prisma/client";
import { progressOf, stageDetail, stageFor } from "@/server/catalog";
import { enginex } from "@/server/enginex/client";
import { EngineXError } from "@/server/enginex/types";
import type { Settings } from "@/server/settings";
import { isTransientFailure, noKillsMessage, publicErrorFor, TIMEOUT_MESSAGE } from "./errors";
import { seeded } from "@/lib/seeded";
import { downloadProgress, syncDownload } from "./download";
import { event, finishFailed, notify } from "./lifecycle";
import { songBeats } from "./beats";
import { planMontage, planStyle, type KillEntry } from "./plan";
import { lyricEvents, lyricItems } from "./lyrics";

// Staged styles (docs/edit-styles/README.md): the gameplay and the song are indexed by their own pipelines,
// in parallel, and the results are shared through media_index; then the style pipeline plans and renders.
// The render phase is an ordinary run (job.runId), so polling, retry, timeout and refunds are unchanged.

type Job = JobRow;
type IndexRow = MediaIndexRow;
type Kind = IndexRow["kind"];

// Nothing is shared between jobs (the user's call, 2026-09-29): every job downloads, finds kills and indexes the song
// itself, even for the same video and song. The index key includes the job id, so a job only ever finds its own run
// (a worker restart resumes it instead of starting a second one). REUSE_MS only matters for that same job.
export const REUSE_MS = 60 * 60_000;
const STALE_RUN_MS = 60 * 60_000; // a "running" index older than this is started again
const RESEND_MS = 2 * 60_000; // an index whose run couldn't be started is re-sent after this
const MAX_INDEX_RETRIES = 1;
const RENDER_STEPS_ESTIMATE = 60; // keeps the progress bar honest before the render run reports its steps

export const cacheKey = (kind: Kind, templateId: string, parts: string[]) =>
  createHash("sha256")
    .update(JSON.stringify([kind, templateId, ...parts]))
    .digest("hex");

/** What each index pipeline needs, from the job's mapped input (youtubeUrl or video, playerName, musicUrl). */
export function indexInputs(job: Pick<Job, "id" | "input" | "source" | "indexTemplates">) {
  const i = job.input as Record<string, string>;
  const t = job.indexTemplates!;
  const upload = job.source === "upload";
  const gameplay: Record<string, string> = upload ? { video: i.video, playerName: i.playerName } : { youtubeUrl: i.youtubeUrl, playerName: i.playerName };
  return {
    gameplay: {
      templateId: upload ? t.gameplayUpload! : t.gameplay,
      input: gameplay,
      parts: [job.id, upload ? i.video : i.youtubeUrl, (i.playerName ?? "").toLowerCase()],
    },
    // an uploaded song file (createJob's songUpload) goes to the song-upload pipeline as its "audio"
    song: (i.songUpload && t.songUpload
      ? { templateId: t.songUpload, input: { audio: i.songUpload }, parts: [job.id, i.songUpload] }
      : { templateId: t.song, input: { musicUrl: i.musicUrl }, parts: [job.id, i.musicUrl] }) as {
      templateId: string;
      input: Record<string, string>;
      parts: string[];
    },
  };
}

async function startIndexRun(row: IndexRow) {
  try {
    const { runId } = await enginex().runPipeline(row.templateId, row.input, `idx-${row.id}`);
    await db.mediaIndex.updateMany({ where: { id: row.id, status: "running" }, data: { runId } });
  } catch (e) {
    const err = e instanceof EngineXError ? e : new EngineXError("unknown", String(e), false);
    if (err.retryable) return; // no runId yet: pollIndexes re-sends with the same key
    await db.mediaIndex.updateMany({ where: { id: row.id }, data: { status: "failed", error: `start: ${err.code}: ${err.message}`, finishedAt: new Date() } });
  }
}

/**
 * This job's index row for a pipeline: its run if already started (a restart), or a new run.
 * Claiming is one INSERT … ON CONFLICT on a key that includes the job id, so a job never starts two runs.
 */
export async function ensureIndex(kind: Kind, templateId: string, input: Record<string, string>, parts: string[], now = Date.now()): Promise<IndexRow> {
  const key = cacheKey(kind, templateId, parts);
  const at = new Date(now);
  // Raw: Prisma's upsert can't make the update conditional (ON CONFLICT … DO UPDATE … WHERE).
  const [claimed] = await db.$queryRaw<{ id: string }[]>`
    insert into media_index (kind, cache_key, template_id, input, started_at)
    values (${kind}::media_index_kind, ${key}, ${templateId}, ${JSON.stringify(input)}::jsonb, ${at})
    on conflict (cache_key) do update set
      status = 'running', run_id = null, output = null, error = null, steps = '[]'::jsonb, steps_done = 0, steps_total = 0, retries = 0,
      input = excluded.input, started_at = excluded.started_at, finished_at = null, run_ms = null
    where media_index.status = 'failed'
      or (media_index.status = 'succeeded' and media_index.finished_at < ${new Date(now - REUSE_MS)})
      or (media_index.status = 'running' and media_index.started_at < ${new Date(now - STALE_RUN_MS)})
    returning id`;
  if (claimed) {
    await startIndexRun(await db.mediaIndex.findUniqueOrThrow({ where: { id: claimed.id } }));
    return db.mediaIndex.findUniqueOrThrow({ where: { id: claimed.id } });
  }
  return db.mediaIndex.findUniqueOrThrow({ where: { cacheKey: key } });
}

/** Called by startJob once the job is claimed: both indexes start (or are reused) in parallel. */
export async function startStaged(job: Job, now = Date.now()) {
  const { gameplay, song } = indexInputs(job);
  const [g, s] = await Promise.all([
    ensureIndex("gameplay", gameplay.templateId, gameplay.input, gameplay.parts, now),
    ensureIndex("song", song.templateId, song.input, song.parts, now),
  ]);
  await db.job.updateMany({ where: { id: job.id, status: "starting" }, data: { status: "running", phase: "index", gameplayIndexId: g.id, songIndexId: s.id } });
  await event(job.id, "Started editing");
  await notify(job.id);
}

/** Runs every sweep: polls each running index once, however many jobs wait on it. */
export async function pollIndexes(settings: Settings, now = Date.now()) {
  const rows = await db.mediaIndex.findMany({ where: { status: "running" } });
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
          await db.mediaIndex.updateMany({ where: { id: row.id }, data: { status: "failed", error: `run ${row.runId} not found`, finishedAt: new Date(now) } });
        }
        return;
      }
      const { done, total } = progressOf(run.steps);
      // The gameplay video's download progress, shown as its own bar on the job's page.
      if (row.kind === "gameplay") await syncDownload(row.id, { gameplayIndexId: row.id }, run.status === "running" ? await downloadProgress(run.steps) : null);
      if (run.status === "succeeded") {
        await db.mediaIndex.updateMany({
          where: { id: row.id, status: "running" },
          data: {
            status: "succeeded",
            output: (run.output ?? {}) as Prisma.InputJsonValue,
            steps: run.steps as Prisma.InputJsonValue,
            stepsDone: total,
            stepsTotal: total,
            runMs: run.runMs,
            finishedAt: new Date(now),
          },
        });
      } else if (run.status === "failed" || run.status === "canceled") {
        const failed = run.steps.find((s) => s.status === "failed");
        // Like render runs: one automatic retry of the failed steps after a blip (e.g. YouTube refusing a download once).
        if (run.status === "failed" && row.retries < MAX_INDEX_RETRIES && isTransientFailure(failed?.engine ?? null, failed?.error ?? run.error)) {
          const { count } = await db.mediaIndex.updateMany({
            where: { id: row.id, status: "running", retries: row.retries },
            data: { retries: row.retries + 1 },
          });
          if (count)
            await enginex()
              .retryRun(row.runId)
              .catch((e: unknown) => console.error(`[index retry] ${e instanceof Error ? e.message : String(e)}`));
          return;
        }
        await db.mediaIndex.updateMany({
          where: { id: row.id, status: "running" },
          data: {
            status: "failed",
            steps: run.steps as Prisma.InputJsonValue,
            error: [run.error, failed && `${failed.step} (${failed.engine}): ${failed.error}`].filter(Boolean).join(" | ") || run.status,
            output: { failedEngine: failed?.engine ?? null },
            finishedAt: new Date(now),
          },
        });
      } else if (now - row.startedAt.getTime() > settings.maxRunMinutes * 60_000) {
        await enginex()
          .cancelRun(row.runId)
          .catch(() => {});
        await db.mediaIndex.updateMany({
          where: { id: row.id },
          data: { status: "failed", error: `timeout after ${settings.maxRunMinutes} min`, finishedAt: new Date(now) },
        });
      } else if (done !== row.stepsDone || total !== row.stepsTotal) {
        await db.mediaIndex.updateMany({ where: { id: row.id }, data: { steps: run.steps as Prisma.InputJsonValue, stepsDone: done, stepsTotal: total } });
      }
    }),
  );
}

/** Everything the app can send a style pipeline (styleInput); a style may declare fewer. */
export const STYLE_INPUTS = [
  "video",
  "kills",
  "flex",
  "gameDurationSec",
  "audio",
  "songDurationSec",
  "loudness",
  "words",
  "maxDurationSec",
  "variation",
  "lyricLook",
  "lines",
  "subs",
  "beatSec",
  "beats",
  "dropAtSec",
  "plan",
];

// Kills closer than this share one entry, so two clips never show the same moment. A clip reaches at most hold (4 s at
// 90 s) + 2 s past its kill and the next starts 2.5 s before its own (pipelines/build.py), so 8 s apart can't overlap.
const MERGE_SEC = 8;
/**
 * This job's kill list: close kills merged into one entry ({t: first, more: "+3 s, +7 s"}, a multi-kill the planner can
 * extend its clip over), then the entries shuffled with the job's seed, so the same match gives a different montage every
 * run while one job always gets the same order. Accepts {t} objects or bare numbers (the kill finder writes either).
 * No seed (older jobs): merged, in time order.
 */
export function shuffleKills(kills: unknown, seed: string | undefined): unknown {
  const list = (kills as { kills?: unknown })?.kills;
  if (!Array.isArray(list)) return kills;
  const times = list.map((k) => Number(typeof k === "object" && k ? (k as { t?: unknown }).t : k)).filter(Number.isFinite);
  const groups: number[][] = [];
  for (const t of [...new Set(times)].sort((a, b) => a - b)) {
    const last = groups.at(-1);
    if (last && t - last.at(-1)! < MERGE_SEC) last.push(t);
    else groups.push([t]);
  }
  if (seed) {
    const next = seeded(seed);
    for (let n = groups.length - 1; n > 0; n--) {
      const j = Math.floor(next() * (n + 1));
      [groups[n], groups[j]] = [groups[j], groups[n]];
    }
  }
  const entry = ([t, ...rest]: number[]) => (rest.length ? { t, more: rest.map((r) => `+${Math.round((r - t) * 10) / 10} s`).join(", ") } : { t });
  return { ...(kills as object), kills: groups.map(entry) };
}

const INTRO_LEAD = 9; // the intro starts this many seconds before a kill: the player alive and moving in a live round
const INTRO_CLEAR = 12; // ...a kill with no other kill in the 12 s before it, so the intro shows none
/**
 * Intro moments, taken from the kill times instead of the image model: the approach to a kill (K-9 s onward). A real
 * job's image model twice offered the agent-select screen as "knife out" (2026-09-29); before a kill the player is
 * always in a live round. Up to 5, in a seeded random order.
 */
export function introMoments(kills: unknown, seed: string | undefined): { flex: { start: number; what: string }[] } {
  const list = (kills as { kills?: unknown })?.kills;
  const times = (Array.isArray(list) ? list : [])
    .map((k) => Number(typeof k === "object" && k ? (k as { t?: unknown }).t : k))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  const starts = times.filter((t, i) => t - INTRO_LEAD >= 1 && (i === 0 || t - times[i - 1] >= INTRO_CLEAR)).map((t) => t - INTRO_LEAD);
  const next = seeded(seed ?? "1");
  for (let n = starts.length - 1; n > 0; n--) {
    const j = Math.floor(next() * (n + 1));
    [starts[n], starts[j]] = [starts[j], starts[n]];
  }
  return { flex: starts.slice(0, 5).map((start) => ({ start, what: "moving through the map, just before a fight" })) };
}

// Always one line that draws nothing: an empty list would make Engine X skip the text steps and leave the render without
// its text layer (pipelines/build.py draws only lines with text). Its late line start (a) keeps it through Ultra's
// "only after the intro" filter.
const NO_TEXT = { s: 0, e: 0, t: "", r: 0, n: 0, p: 0, a: 9999 };

/** The style pipeline's inputs, from the two indexes. Only inputs the pipeline declares are sent. */
export function styleInput(
  job: Pick<Job, "input" | "durationSec"> & { catalogSlug?: string },
  g: Record<string, unknown>,
  s: Record<string, unknown>,
  declared: string[] | null,
) {
  const i = job.input as Record<string, string>;
  // Measured here so the planner is handed them (beats.ts): the beat, the beat times inside the montage, the drop.
  const cap = Math.min(job.durationSec, Number(s.durationSec) || job.durationSec);
  const song = songBeats(String(s.loudness ?? ""), cap);
  const kills = shuffleKills(g.kills ?? { kills: [], totalKills: 0 }, i.killSeed) as { kills?: KillEntry[] };
  const flex = introMoments(g.kills, i.killSeed);
  // The clip list, planned here from what was measured (plan.ts); the style pipeline checks it and renders it.
  const plan = planMontage({
    style: planStyle(job.catalogSlug),
    kills: Array.isArray(kills.kills) ? kills.kills : [],
    flexStarts: flex.flex.map((f) => f.start),
    // the gameplay reader's rows with the player as the victim (older results have none: no deaths to avoid)
    deaths: ((g.deaths as { deaths?: { t?: unknown }[] } | undefined)?.deaths ?? []).map((d) => Number(d?.t)).filter(Number.isFinite),
    beats: song?.beats ?? [],
    beatSec: song?.beatSec ?? 0.5,
    dropAtSec: song?.dropAtSec ?? null,
    lengthSec: job.durationSec,
    capSec: cap,
    variation: i.variation ?? "",
  });
  // aligned segments from song-index; an older cached result has only words, read as one segment
  const lyrics = lyricItems(s.segments ?? (Array.isArray(s.words) ? [{ words: s.words }] : []), i.killSeed ?? "1", s.voice);
  // Smart Edit's intro runs without lyrics: only lines that start once the kills do
  const intro = plan.clips[0]?.role === "flex" ? plan.clips[0].len : 0;
  const all: Record<string, string> = {
    video: String(g.video ?? ""),
    kills: JSON.stringify(kills),
    flex: JSON.stringify(flex),
    gameDurationSec: String(g.durationSec ?? ""),
    audio: String(s.audio ?? ""),
    songDurationSec: String(s.durationSec ?? ""),
    loudness: String(s.loudness ?? ""),
    words: JSON.stringify(s.words ?? []),
    maxDurationSec: String(job.durationSec),
    variation: i.variation ?? "",
    lyricLook: i.lyricLook ?? "0",
    lines: JSON.stringify([...lyrics, NO_TEXT]), // pipelines from before the subtitle file (2026-10-01)
    subs: lyricEvents(lyrics, planStyle(job.catalogSlug) === "ultra" ? intro : 0, cap, i.lyricLook ?? "0"),
    beatSec: song ? String(song.beatSec) : "0.5",
    beats: song ? song.beats.join(", ") : "",
    dropAtSec: song?.dropAtSec != null ? String(song.dropAtSec) : "none",
    plan: JSON.stringify(plan),
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
  const rows = await db.mediaIndex.findMany({ where: { id: { in: ids } } });
  const g = rows.find((r) => r.id === job.gameplayIndexId);
  const s = rows.find((r) => r.id === job.songIndexId);
  const elapsedMs = job.startedAt ? now - job.startedAt.getTime() : 0;
  if (!g || !s) return finishFailed(job, { errorRaw: "index rows missing", errorPublic: publicErrorFor(null), runMs: elapsedMs }, settings);

  for (const [row, songPart] of [
    [g, false],
    [s, true],
  ] as const) {
    if (row.status !== "failed") continue;
    const engine = (row.output?.failedEngine as string | null) ?? null;
    return finishFailed(
      job,
      { errorRaw: `${row.kind} index: ${row.error}`, errorPublic: songPart ? SONG_ERROR : publicErrorFor(engine), runMs: elapsedMs },
      settings,
    );
  }
  if (elapsedMs > settings.maxRunMinutes * 60_000) {
    return finishFailed(
      job,
      { errorRaw: `timeout after ${settings.maxRunMinutes} min in the index phase`, errorPublic: TIMEOUT_MESSAGE, runMs: elapsedMs },
      settings,
    );
  }

  if (g.status === "succeeded" && s.status === "succeeded") {
    // No kills by this player: say so now, with what to check, instead of a render that has nothing to cut.
    const found = (g.output?.kills as { kills?: unknown } | undefined)?.kills;
    if (!Array.isArray(found) || found.length === 0) {
      const name = String((job.input as Record<string, unknown>).playerName ?? "your name");
      return finishFailed(job, { errorRaw: "no kills found (gameplay index)", errorPublic: noKillsMessage(name), runMs: elapsedMs }, settings);
    }
    const input = styleInput(job, g.output ?? {}, s.output ?? {}, await declaredInputs(job.templateId, now));
    try {
      const { runId } = await enginex().runPipeline(job.templateId, input, job.id);
      await db.job.updateMany({
        where: { id: job.id, status: "running", phase: "index" },
        data: {
          runId,
          phase: "render",
          indexSteps: g.stepsTotal + s.stepsTotal,
          stepsDone: g.stepsTotal + s.stepsTotal,
          stepsTotal: g.stepsTotal + s.stepsTotal + RENDER_STEPS_ESTIMATE,
        },
      });
      await event(job.id, "Cutting your montage");
      await notify(job.id);
    } catch (e) {
      const err = e instanceof EngineXError ? e : new EngineXError("unknown", String(e), false);
      if (err.retryable) return; // same job id as the key: the next sweep re-sends safely
      await finishFailed(
        job,
        { errorRaw: `render start: ${err.code}: ${err.message}`, errorPublic: publicErrorFor(null, err.code), runMs: elapsedMs },
        settings,
      );
    }
    return;
  }

  const steps = [...g.steps, ...s.steps];
  const done = g.stepsDone + s.stepsDone;
  const total = g.stepsTotal + s.stepsTotal + RENDER_STEPS_ESTIMATE;
  const stage = stageFor(steps, stageMap, job.currentStage);
  const detail = stageDetail(steps, stageMap, stage);
  if (done === job.stepsDone && total === job.stepsTotal && stage === job.currentStage && detail === job.stageDetail) return;
  await db.job.updateMany({
    where: { id: job.id, status: "running", phase: "index" },
    data: { stepsDone: done, stepsTotal: total, currentStage: stage, stageDetail: detail },
  });
  if (stage && stage !== job.currentStage) await event(job.id, stage);
  await notify(job.id);
}

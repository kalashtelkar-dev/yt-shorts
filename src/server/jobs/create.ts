import "server-only";
import { randomInt } from "node:crypto";
import { z } from "zod";
import { db, type Tx } from "@/db/client";
import type { CatalogField } from "@/db/types";
import { Prisma } from "@/generated/prisma/client";
import { MapInputError, mapInput } from "@/server/catalog";
import { isAdmin } from "@/server/admin/guard";
import { checkStartGate, InsufficientCreditsError } from "@/server/credits";
import { enqueueStart } from "@/server/queue";
import { limitResetsIn, underLimit } from "@/server/redis";
import { getSettings } from "@/server/settings";
import { cleanFileName, ownsUpload } from "@/server/uploads";
import type { SessionUser } from "@/server/auth";
import type { ActionResult } from "@/lib/jobs";
import { youtubeLinkProblem } from "@/lib/youtube";

// Starting a job (PLAN.md §5.1). Returns within the request: validate, check credits, insert, enqueue.
// Nothing is charged here: the job holds the top of its range, and pays for the time it used when it succeeds.

const JOB_STARTS_PER_HOUR = 10;

export const youtubeUrl = z
  .string()
  .trim()
  .max(500)
  .superRefine((v, ctx) => {
    const problem = youtubeLinkProblem(v);
    if (problem) ctx.addIssue({ code: "custom", message: problem });
  });

export const createJobInput = z.strictObject({
  catalogSlug: z.string().min(1).max(64),
  source: z.enum(["url", "upload"]).default("url"),
  url: z.string().max(500).optional(),
  upload: z.strictObject({ key: z.string().min(1).max(300), name: z.string().max(300) }).optional(),
  /** The song as an uploaded audio file instead of the song link field (the user, 2026-09-30). */
  songUpload: z.strictObject({ key: z.string().min(1).max(300), name: z.string().max(300) }).optional(),
  durationSec: z.coerce.number().int(),
  fields: z.record(z.string().max(64), z.unknown()).default({}),
});
export type CreateJobInput = z.input<typeof createJobInput>;

// Staged styles shuffle where the slow-motion and speed-up clips go on every run (docs/edit-styles/kill-montage.md).
const SLOW_AT = ["first", "second", "third", "in the middle", "second to last", "last", "on the drop"];
export const randomVariation = () => `Put the slow-motion clip ${SLOW_AT[randomInt(SLOW_AT.length)]}.`;
/** One of the lyrics' ten looks (font, colours), for styles that show the song's words; the pipeline maps the digit (pipelines/build.py LOOKS). */
export const randomLyricLook = () => String(randomInt(10));
/** Seeds this job's kill order (shuffleKills in staged.ts). */
export const randomKillSeed = () => String(randomInt(1, 2 ** 31));

const fail = (code: string, message: string, field?: string): ActionResult<never> => ({ ok: false, error: { code, message, field } });
/** The catalog field a song file replaces (src/db/catalog-seed.ts FIELDS). */
const SONG_FIELD = "songUrl";

/** Validates one catalog-defined field. Returns the clean value or an error message. */
function checkField(f: CatalogField, raw: unknown): { value?: unknown; error?: string } {
  if (f.type === "range") return { value: raw }; // a song time range (an older lyric style); no current style uses it
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) return f.required ? { error: `Enter ${f.label.toLowerCase()}` } : {};
  if (f.max && value.length > f.max) return { error: `${f.label} can be at most ${f.max} characters` };
  if (f.type === "url") {
    const u = youtubeUrl.safeParse(value);
    if (!u.success) return { error: u.error.issues[0].message };
  }
  return { value };
}

class BusyError extends Error {}

const activeJobs = (tx: Tx, userId: string) => tx.job.count({ where: { userId, status: { in: ["queued", "starting", "running"] } } });

const busy = (max: number) =>
  fail(
    "busy",
    max === 1
      ? "You already have a montage being made. Wait for it to finish, then start the next one."
      : `You already have ${max} montages being made. Wait for one to finish, then start the next one.`,
  );

export async function createJob(user: SessionUser, raw: unknown): Promise<ActionResult<{ jobId: string }>> {
  const parsed = createJobInput.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return fail("invalid", issue.message, String(issue.path[0] ?? ""));
  }
  const input = parsed.data;
  let sourceUrl: string | null = null;
  if (input.source === "url") {
    const u = youtubeUrl.safeParse(input.url ?? "");
    if (!u.success) return fail("invalid", u.error.issues[0].message, "url");
    sourceUrl = u.data;
  } else if (!input.upload) {
    return fail("invalid", "Choose a video file to upload.", "upload");
  }

  // Read from the DB: the session cookie cache can be up to 5 minutes old.
  const fresh = await db.user.findUnique({ where: { id: user.id }, select: { suspendedAt: true, role: true, isAnonymous: true } });
  if (fresh?.suspendedAt ?? user.suspendedAt) return fail("suspended", "Your account is paused, so you can't make new montages. Contact support if this looks wrong.");

  const item = await db.catalogItem.findFirst({ where: { slug: input.catalogSlug, enabled: true } });
  if (!item) return fail("unavailable", "That style isn't available right now. Pick another one.");
  if (!item.durations.includes(input.durationSec)) return fail("invalid", "Pick one of the lengths shown.", "durationSec");
  if (input.source === "upload") {
    if (!(item.uploadTemplateId || item.indexTemplates?.gameplayUpload)) return fail("unavailable", "This style doesn't take uploads yet. Paste a YouTube link instead.", "upload");
    if (!(await ownsUpload(user.id, input.upload!.key))) return fail("invalid", "That upload has expired. Choose the file again.", "upload");
  }
  if (input.songUpload) {
    if (!item.indexTemplates?.songUpload) return fail("unavailable", "This style doesn't take song files yet. Paste a YouTube link instead.", SONG_FIELD);
    if (!(await ownsUpload(user.id, input.songUpload.key))) return fail("invalid", "That song upload has expired. Choose the file again.", SONG_FIELD);
  }
  // Staged styles always render with the style pipeline; the source only changes which gameplay index runs.
  const templateId = input.source === "upload" && !item.indexTemplates ? item.uploadTemplateId! : item.templateId;
  const uploadName = input.upload ? cleanFileName(input.upload.name).replace(/\.[^.]+$/, "") : undefined;
  const range = item.creditRanges[String(input.durationSec)];
  if (!range || !Number.isInteger(range.max) || range.max <= 0) return fail("unavailable", "This length isn't available right now. Pick another one.");

  const fields: Record<string, unknown> = {};
  for (const f of item.fields) {
    if (input.songUpload && f.name === SONG_FIELD) continue; // the file stands in for the song link
    const { value, error } = checkField(f, input.fields[f.name]);
    if (error) return fail("invalid", error, f.name);
    if (value !== undefined) fields[f.name] = value;
  }

  let pipelineInput: Record<string, string>;
  try {
    pipelineInput = mapInput(item.inputMap, { sourceUrl: sourceUrl ?? "", uploadKey: input.upload?.key, uploadName, durationSec: input.durationSec, fields });
  } catch (e) {
    if (e instanceof MapInputError) return fail("config", "This style is misconfigured. We've been told; try again later.");
    throw e;
  }

  if (input.songUpload) {
    // read by staged.ts indexInputs (the song-upload pipeline's "audio") and shown as the song's name
    pipelineInput.songUpload = input.songUpload.key;
    pipelineInput.songName = cleanFileName(input.songUpload.name).replace(/\.[^.]+$/, "");
  }
  if (item.indexTemplates) {
    pipelineInput.variation = randomVariation();
    pipelineInput.lyricLook = randomLyricLook();
    pipelineInput.killSeed = randomKillSeed();
  }

  const settings = await getSettings();
  const admin = !!fresh && isAdmin(fresh);
  // Admins may run more at once (both limits are set in the admin Billing settings).
  const maxActive = admin ? settings.maxConcurrentJobsPerAdmin : settings.maxConcurrentJobsPerUser;
  // A quick check before spending an hourly start; the one that counts runs under the balance lock below.
  if ((await activeJobs(db, user.id)) >= maxActive) return busy(maxActive);
  // Admins skip the hourly cap (they test a lot); the at-once limit above still applies.
  if (!admin && !(await underLimit(`jobs:${user.id}`, JOB_STARTS_PER_HOUR, 3600))) {
    const minutes = Math.max(1, Math.ceil((await limitResetsIn(`jobs:${user.id}`)) / 60));
    return fail("rate_limited", `You've started a lot of montages this hour. Try again in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`);
  }

  let jobId: string;
  try {
    jobId = await db.$transaction(async (tx) => {
      await checkStartGate(tx, user.id, range.max);
      // Under the balance row lock, so two quick starts can't both slip past the limit.
      if ((await activeJobs(tx, user.id)) >= maxActive) throw new BusyError();
      const job = await tx.job.create({
        data: {
          userId: user.id,
          catalogItemId: item.id,
          catalogSlug: item.slug,
          templateId, // snapshot: later catalog edits don't touch this job
          indexTemplates: item.indexTemplates ?? Prisma.DbNull,
          input: pipelineInput,
          source: input.source,
          sourceUrl,
          uploadKey: input.upload?.key ?? null,
          durationSec: input.durationSec,
          maxCredits: range.max,
        },
        select: { id: true },
      });
      await tx.jobEvent.create({ data: { jobId: job.id, message: "Queued" } });
      return job.id;
    });
  } catch (e) {
    if (e instanceof BusyError) return busy(maxActive);
    if (e instanceof InsufficientCreditsError) {
      return fail(
        "insufficient",
        `To start this one you need ${range.max} credits free, enough for the longest it usually takes. You have ${e.balance}. Add credits or pick a shorter length.`,
      );
    }
    throw e;
  }

  await enqueueStart(jobId).catch(() => {}); // the worker's sweep starts it anyway
  return { ok: true, data: { jobId } };
}

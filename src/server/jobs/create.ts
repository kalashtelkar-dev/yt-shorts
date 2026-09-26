import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { catalogItems, jobEvents, jobs, users, type CatalogField } from "@/db/schema";
import { MapInputError, mapInput } from "@/server/catalog";
import { chargeForJob, InsufficientCreditsError } from "@/server/credits";
import { enqueueStart } from "@/server/queue";
import { underLimit } from "@/server/redis";
import { getSettings } from "@/server/settings";
import type { SessionUser } from "@/server/auth";
import type { ActionResult } from "@/lib/jobs";

// Starting a job (PLAN.md §5.1). Returns within the request: validate, charge, insert, enqueue.

const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be", "music.youtube.com"]);
const JOB_STARTS_PER_HOUR = 10;

export const youtubeUrl = z
  .string()
  .trim()
  .max(500)
  .refine((v) => {
    try {
      const u = new URL(v);
      return u.protocol === "https:" && YOUTUBE_HOSTS.has(u.hostname.toLowerCase());
    } catch {
      return false;
    }
  }, "Paste a YouTube link that starts with https://");

export const createJobInput = z.strictObject({
  catalogSlug: z.string().min(1).max(64),
  url: youtubeUrl,
  durationSec: z.coerce.number().int(),
  fields: z.record(z.string().max(64), z.unknown()).default({}),
});
export type CreateJobInput = z.input<typeof createJobInput>;

const fail = (code: string, message: string, field?: string): ActionResult<never> => ({ ok: false, error: { code, message, field } });

/** Validates one catalog-defined field. Returns the clean value or an error message. */
function checkField(f: CatalogField, raw: unknown): { value?: unknown; error?: string } {
  if (f.type === "range") return { value: raw }; // lyrical only; validated when that style is switched on
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) return f.required ? { error: `Enter ${f.label.toLowerCase()}` } : {};
  if (f.max && value.length > f.max) return { error: `${f.label} can be at most ${f.max} characters` };
  if (f.type === "url" && !youtubeUrl.safeParse(value).success) return { error: "Paste a YouTube link that starts with https://" };
  return { value };
}

export async function createJob(user: SessionUser, raw: unknown): Promise<ActionResult<{ jobId: string }>> {
  const parsed = createJobInput.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return fail("invalid", issue.message, String(issue.path[0] ?? ""));
  }
  const input = parsed.data;

  // Read from the DB: the session cookie cache can be up to 5 minutes old.
  const [fresh] = await db.select({ suspendedAt: users.suspendedAt }).from(users).where(eq(users.id, user.id));
  if (fresh?.suspendedAt ?? user.suspendedAt) return fail("suspended", "Your account is paused, so you can't make new montages. Contact support if this looks wrong.");

  const [item] = await db.select().from(catalogItems).where(and(eq(catalogItems.slug, input.catalogSlug), eq(catalogItems.enabled, true)));
  if (!item) return fail("unavailable", "That style isn't available right now. Pick another one.");
  if (!item.durations.includes(input.durationSec)) return fail("invalid", "Pick one of the lengths shown.", "durationSec");
  const price = item.prices[String(input.durationSec)];
  if (!Number.isInteger(price) || price <= 0) return fail("unavailable", "This length isn't available right now. Pick another one.");

  const fields: Record<string, unknown> = {};
  for (const f of item.fields) {
    const { value, error } = checkField(f, input.fields[f.name]);
    if (error) return fail("invalid", error, f.name);
    if (value !== undefined) fields[f.name] = value;
  }

  let pipelineInput: Record<string, string>;
  try {
    pipelineInput = mapInput(item.inputMap, { sourceUrl: input.url, durationSec: input.durationSec, fields });
  } catch (e) {
    if (e instanceof MapInputError) return fail("config", "This style is misconfigured. We've been told; try again later.");
    throw e;
  }

  const settings = await getSettings();
  const [{ active }] = await db
    .select({ active: sql<number>`count(*)::int` })
    .from(jobs)
    .where(and(eq(jobs.userId, user.id), inArray(jobs.status, ["queued", "starting", "running"])));
  if (active >= settings.maxConcurrentJobsPerUser) {
    return fail("busy", `You already have ${active} montage${active === 1 ? "" : "s"} in progress. Wait for one to finish, then try again.`);
  }
  if (!(await underLimit(`jobs:${user.id}`, JOB_STARTS_PER_HOUR, 3600))) {
    return fail("rate_limited", "You've started a lot of montages this hour. Try again later.");
  }

  let jobId: string;
  try {
    jobId = await db.transaction(async (tx) => {
      const [job] = await tx
        .insert(jobs)
        .values({
          userId: user.id,
          catalogItemId: item.id,
          catalogSlug: item.slug,
          templateId: item.templateId, // snapshot: later catalog edits don't touch this job
          input: pipelineInput,
          source: "url",
          sourceUrl: input.url,
          durationSec: input.durationSec,
          chargedCredits: price,
        })
        .returning({ id: jobs.id });
      await chargeForJob(tx, user.id, job.id, price);
      await tx.insert(jobEvents).values({ jobId: job.id, message: "Queued" });
      return job.id;
    });
  } catch (e) {
    if (e instanceof InsufficientCreditsError) {
      return fail("insufficient", `This montage costs ${price} credits and you have ${e.balance}.`);
    }
    throw e;
  }

  await enqueueStart(jobId).catch(() => {}); // the worker's sweep starts it anyway
  return { ok: true, data: { jobId } };
}

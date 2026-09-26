"use server";

import { redirect } from "next/navigation";
import type { ActionResult } from "@/lib/jobs";
import { createJob, type CreateJobInput } from "@/server/jobs/create";
import { signedVideoUrl } from "@/server/jobs/public";
import { ensureUser, getViewer, RateLimitedError } from "@/server/session";

const serverError = { ok: false as const, error: { code: "server", message: "Something went wrong on our side. Try again in a moment." } };

export type CreateState = { error: { code: string; message: string; field?: string } | null };

/**
 * Form action for the Create page. Works before hydration too (the browser posts straight here).
 * On success it redirects to the job page; otherwise it returns the error to show.
 */
export async function createJobAction(_prev: CreateState, form: FormData): Promise<CreateState> {
  const fields: Record<string, string> = {};
  for (const [k, v] of form) if (k.startsWith("field:") && typeof v === "string") fields[k.slice(6)] = v;
  const input: CreateJobInput = {
    catalogSlug: String(form.get("style") ?? ""),
    url: String(form.get("url") ?? ""),
    durationSec: Number(form.get("duration")),
    fields,
  };

  let jobId: string;
  try {
    const user = await ensureUser();
    const result = await createJob(user, input);
    if (!result.ok) return { error: result.error };
    jobId = result.data.jobId;
  } catch (e) {
    if (e instanceof RateLimitedError) return { error: { code: "rate_limited", message: e.message } };
    console.error("[createJob]", e instanceof Error ? e.message : e);
    return { error: serverError.error };
  }
  redirect(`/jobs/${jobId}`); // outside try: redirect() works by throwing
}

/** A fresh signed link each time it's asked for (CLAUDE.md §4.7). */
export async function videoUrlAction(jobId: string): Promise<ActionResult<{ url: string }>> {
  try {
    const viewer = await getViewer();
    const url = viewer && (await signedVideoUrl(jobId, viewer.id));
    return url ? { ok: true, data: { url } } : { ok: false, error: { code: "not_found", message: "This video isn't available any more." } };
  } catch (e) {
    console.error("[videoUrl]", e instanceof Error ? e.message : e);
    return serverError;
  }
}

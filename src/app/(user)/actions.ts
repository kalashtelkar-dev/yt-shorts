"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { env } from "@/config/env";
import type { ActionResult } from "@/lib/jobs";
import { createJob, type CreateJobInput } from "@/server/jobs/create";
import { signedVideo } from "@/server/jobs/public";
import { confirmPurchase, saveBillingProfile, startPurchase, type CheckoutStart } from "@/server/payments";
import { issueUpload } from "@/server/uploads";
import { ensureUser, getViewer, RateLimitedError, SignInRequiredError } from "@/server/session";

const serverError = { ok: false as const, error: { code: "server", message: "Something went wrong on our side. Try again in a moment." } };

export type CreateState = { error: { code: string; message: string; field?: string } | null };

/**
 * Form action for the Create page. Works before hydration too (the browser posts straight here).
 * On success it redirects to the job page; otherwise it returns the error to show.
 */
export async function createJobAction(_prev: CreateState, form: FormData): Promise<CreateState> {
  const fields: Record<string, string> = {};
  for (const [k, v] of form) if (k.startsWith("field:") && typeof v === "string") fields[k.slice(6)] = v;
  const source = form.get("source") === "upload" ? "upload" : "url";
  const input: CreateJobInput = {
    catalogSlug: String(form.get("style") ?? ""),
    source,
    url: source === "url" ? String(form.get("url") ?? "") : undefined,
    upload: source === "upload" && form.get("uploadKey") ? { key: String(form.get("uploadKey")), name: String(form.get("uploadName") ?? "") } : undefined,
    songUpload: form.get("songSource") === "upload" && form.get("songUploadKey") ? { key: String(form.get("songUploadKey")), name: String(form.get("songUploadName") ?? "") } : undefined,
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
    if (e instanceof SignInRequiredError) return { error: { code: "sign_in", message: e.message } };
    console.error("[createJob]", e instanceof Error ? e.message : e);
    return { error: serverError.error };
  }
  redirect(`/jobs/${jobId}`); // outside try: redirect() works by throwing
}

/** Presigned upload URL for a file the browser will PUT straight to storage. */
export async function startUploadAction(file: { name: string; size: number; type: string }, kind: unknown = "video"): Promise<ActionResult<{ url: string; key: string }>> {
  try {
    const user = await ensureUser();
    if (user.suspendedAt) return { ok: false, error: { code: "suspended", message: "Your account is paused, so you can't upload files." } };
    return await issueUpload(user, file, kind === "audio" ? "audio" : "video");
  } catch (e) {
    if (e instanceof RateLimitedError || e instanceof SignInRequiredError) return { ok: false, error: { code: e instanceof RateLimitedError ? "rate_limited" : "sign_in", message: e.message } };
    console.error("[startUpload]", e instanceof Error ? e.message : e);
    return serverError;
  }
}

/** Links to the saved video and cover (or, until saved, fresh signed links: CLAUDE.md §4.7). */
export async function videoUrlAction(jobId: string): Promise<ActionResult<{ url: string; poster: string | null; fallback: string | null }>> {
  try {
    const viewer = await getViewer();
    const video = viewer && (await signedVideo(jobId, viewer.id));
    return video ? { ok: true, data: video } : { ok: false, error: { code: "not_found", message: "This video isn't available any more." } };
  } catch (e) {
    console.error("[videoUrl]", e instanceof Error ? e.message : e);
    return serverError;
  }
}

// ── Buying credits ──

/** Payments need a signed-in account (never a guest), so credits and invoices have an owner who can sign back in. */
async function payingUser() {
  const viewer = await getViewer();
  return viewer && !viewer.isAnonymous ? viewer : null;
}
const signInFirst = { ok: false as const, error: { code: "sign_in", message: "Sign in to buy credits." } };

export async function saveBillingProfileAction(input: { stateCode: string; legalName?: string; gstin?: string }): Promise<ActionResult<null>> {
  try {
    const user = await payingUser();
    if (!user) return signInFirst;
    return await saveBillingProfile(user.id, input);
  } catch (e) {
    console.error("[saveBillingProfile]", e instanceof Error ? e.message : e);
    return serverError;
  }
}

export async function startPurchaseAction(amountRupees: number): Promise<ActionResult<CheckoutStart>> {
  try {
    if (!env.PAYMENTS_ENABLED) return { ok: false, error: { code: "unavailable", message: "Buying credits isn't open yet." } };
    const user = await payingUser();
    if (!user) return signInFirst;
    return await startPurchase(user, amountRupees);
  } catch (e) {
    console.error("[startPurchase]", e instanceof Error ? e.message : e);
    return serverError;
  }
}

export async function confirmPurchaseAction(input: { orderId: string; paymentId?: string; signature?: string }): Promise<ActionResult<{ credits: number; invoiceId: string }>> {
  try {
    if (!env.PAYMENTS_ENABLED) return { ok: false, error: { code: "unavailable", message: "Buying credits isn't open yet." } };
    const user = await payingUser();
    if (!user) return signInFirst;
    const r = await confirmPurchase(user.id, input);
    if (r.ok) revalidatePath("/", "layout"); // the header balance
    return r;
  } catch (e) {
    console.error("[confirmPurchase]", e instanceof Error ? e.message : e);
    return serverError;
  }
}

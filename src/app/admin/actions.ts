"use server";

import { APIError } from "better-auth/api";
import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { db } from "@/db/client";
import { redirect } from "next/navigation";
import { z } from "zod";
import { env } from "@/config/env";
import { adjustUserCredits, refundJobByAdmin, retryJob, setRole, setSuspended } from "@/server/admin/mutations";
import { currentAdmin, isAdmin } from "@/server/admin/guard";
import { resolveUserId } from "@/server/admin/queries";
import { deleteCatalogItem, saveCatalogItem, validateItem, type CatalogInput, type ValidationReport } from "@/server/admin/catalog";
import { updateSettings } from "@/server/admin/billing";
import { auth } from "@/server/auth";
import { clientIp } from "@/server/ip";
import { failuresUnder, recordFailure, underLimit } from "@/server/redis";

// Every admin action checks currentAdmin() itself (CLAUDE.md §6); the layout check is not enough.

export type FormState = { ok: boolean; message: string } | null;

const denied: FormState = { ok: false, message: "Your admin session has ended. Sign in again." };
const uuid = z.uuid();

export async function signInAction(_prev: FormState, form: FormData): Promise<FormState> {
  const parsed = z.object({ email: z.email().max(254), password: z.string().min(1).max(200) }).safeParse({ email: form.get("email"), password: form.get("password") });
  if (!parsed.success) return { ok: false, message: "Enter your email and password." };
  const email = parsed.data.email.toLowerCase();
  const h = await headers();
  const ip = clientIp(h, env.TRUSTED_PROXY_HOPS);
  // Only failures count per email, so nobody can lock an admin out by typing their address.
  const failKey = `admin-login-fail:${email}`;
  if (!(await underLimit(`admin-login:ip:${ip}`, 20, 900)) || !(await failuresUnder(failKey, 5))) {
    return { ok: false, message: "Too many attempts. Wait 15 minutes, then try again." };
  }
  const wrong: FormState = { ok: false, message: "That email and password don't match an admin account." };
  let userId: string;
  try {
    // Sets the session cookie on this response (nextCookies plugin).
    ({ user: { id: userId } } = await auth.api.signInEmail({ body: { email, password: parsed.data.password }, headers: h }));
  } catch (e) {
    if (e instanceof APIError) {
      await recordFailure(failKey, 900);
      console.warn("[admin sign-in] refused:", e.status, (e.body as { code?: string } | undefined)?.code ?? e.message);
      return wrong;
    }
    throw e;
  }
  // The request still carries the old cookie, so check the signed-in user directly.
  const row = await db.user.findUnique({ where: { id: userId }, select: { role: true, isAnonymous: true, suspendedAt: true } });
  if (!isAdmin(row)) {
    await recordFailure(failKey, 900);
    console.warn("[admin sign-in] not an admin account:", userId);
    const cookieHeader = (await cookies()).toString();
    await auth.api.signOut({ headers: new Headers({ cookie: cookieHeader }) }).catch(() => {});
    return wrong;
  }
  redirect("/admin/health");
}

export async function signOutAction() {
  await auth.api.signOut({ headers: await headers() }).catch(() => {});
  redirect("/admin/sign-in");
}

export async function adjustCreditsAction(_prev: FormState, form: FormData): Promise<FormState> {
  const admin = await currentAdmin();
  if (!admin) return denied;
  const parsed = z
    .object({ user: z.string().trim().min(1).max(254), delta: z.coerce.number().int(), reason: z.string().max(500) })
    .safeParse({ user: form.get("user"), delta: form.get("delta"), reason: form.get("reason") });
  if (!parsed.success) return { ok: false, message: "Enter the user, a whole number of credits and a reason." };
  const userId = await resolveUserId(parsed.data.user);
  if (!userId) return { ok: false, message: "No user with that email or ID." };
  const r = await adjustUserCredits(admin, userId, parsed.data.delta, parsed.data.reason);
  if (!r.ok) return { ok: false, message: r.error.message };
  revalidatePath("/admin", "layout");
  return { ok: true, message: `Done. New balance: ${r.data.balance.toLocaleString("en-IN")} credits.` };
}

export async function suspendAction(_prev: FormState, form: FormData): Promise<FormState> {
  const admin = await currentAdmin();
  if (!admin) return denied;
  const userId = uuid.safeParse(form.get("userId"));
  if (!userId.success) return { ok: false, message: "Unknown user." };
  const suspend = form.get("suspend") === "true";
  const r = await setSuspended(admin, userId.data, suspend);
  if (!r.ok) return { ok: false, message: r.error.message };
  revalidatePath("/admin", "layout");
  return { ok: true, message: suspend ? "Suspended. They can't start new montages." : "Unsuspended." };
}

export async function roleAction(_prev: FormState, form: FormData): Promise<FormState> {
  const admin = await currentAdmin();
  if (!admin) return denied;
  const parsed = z.object({ userId: uuid, role: z.enum(["user", "admin"]) }).safeParse({ userId: form.get("userId"), role: form.get("role") });
  if (!parsed.success) return { ok: false, message: "Pick a role." };
  const r = await setRole(admin, parsed.data.userId, parsed.data.role);
  if (!r.ok) return { ok: false, message: r.error.message };
  revalidatePath("/admin", "layout");
  return { ok: true, message: `Role set to ${parsed.data.role}.` };
}

export async function refundAction(_prev: FormState, form: FormData): Promise<FormState> {
  const admin = await currentAdmin();
  if (!admin) return denied;
  const parsed = z.object({ jobId: uuid, reason: z.string().max(500) }).safeParse({ jobId: form.get("jobId"), reason: form.get("reason") });
  if (!parsed.success) return { ok: false, message: "Add a reason for the refund." };
  const r = await refundJobByAdmin(admin, parsed.data.jobId, parsed.data.reason);
  if (!r.ok) return { ok: false, message: r.error.message };
  revalidatePath("/admin", "layout");
  return { ok: true, message: "Refunded." };
}

export async function retryAction(_prev: FormState, form: FormData): Promise<FormState> {
  const admin = await currentAdmin();
  if (!admin) return denied;
  const jobId = uuid.safeParse(form.get("jobId"));
  if (!jobId.success) return { ok: false, message: "Unknown job." };
  const r = await retryJob(admin, jobId.data);
  if (!r.ok) return { ok: false, message: r.error.message };
  redirect(`/admin/jobs/${r.data.jobId}`);
}

// ── Catalog ──

export type ValidateState = { report: ValidationReport | null; message: string | null } | null;

function jsonField(form: FormData, name: string, label: string): { value?: unknown; error?: string } {
  const text = String(form.get(name) ?? "").trim();
  if (!text) return { value: name === "inputMap" ? {} : name === "indexTemplates" ? null : [] };
  try {
    return { value: JSON.parse(text) };
  } catch (e) {
    return { error: `${label} isn't valid JSON: ${(e as Error).message}` };
  }
}

/** Form → the shape catalogInput expects. Validation itself happens in the schema. */
function catalogFromForm(form: FormData): { input?: Record<string, unknown>; error?: string } {
  const durations = String(form.get("durations") ?? "")
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number);
  const creditRanges: Record<string, { min: number; max: number }> = {};
  for (const d of durations) {
    const min = String(form.get(`min:${d}`) ?? "").trim();
    const max = String(form.get(`max:${d}`) ?? "").trim();
    if (min && max) creditRanges[String(d)] = { min: Number(min), max: Number(max) };
  }
  const json = {
    fields: jsonField(form, "fields", "Fields"),
    inputMap: jsonField(form, "inputMap", "Input map"),
    stageMap: jsonField(form, "stageMap", "Stage map"),
    indexTemplates: jsonField(form, "indexTemplates", "Index pipelines"),
  };
  const bad = Object.values(json).find((j) => j.error);
  if (bad) return { error: bad.error };
  return {
    input: {
      slug: String(form.get("slug") ?? "").trim(),
      title: String(form.get("title") ?? ""),
      description: String(form.get("description") ?? ""),
      templateId: String(form.get("templateId") ?? ""),
      uploadTemplateId: String(form.get("uploadTemplateId") ?? "").trim() || null,
      indexTemplates: json.indexTemplates.value ?? null,
      enabled: form.get("enabled") === "on",
      beta: form.get("beta") === "on",
      sortOrder: Number(form.get("sortOrder") || 0),
      durations,
      creditRanges,
      fields: json.fields.value,
      inputMap: json.inputMap.value,
      stageMap: json.stageMap.value,
      outputKey: String(form.get("outputKey") ?? "").trim(),
    },
  };
}

export async function validateTemplateAction(_prev: ValidateState, form: FormData): Promise<ValidateState> {
  if (!(await currentAdmin())) return { report: null, message: denied!.message };
  const templateId = String(form.get("templateId") ?? "").trim();
  if (!templateId) return { report: null, message: "Enter a template ID first." };
  const map = jsonField(form, "inputMap", "Input map");
  if (map.error) return { report: null, message: map.error };
  const inputMap = (map.value ?? {}) as Record<string, unknown>;
  const outputKey = String(form.get("outputKey") ?? "montage").trim();
  const index = jsonField(form, "indexTemplates", "Index pipelines");
  if (index.error) return { report: null, message: index.error };
  // Same checks as Save.
  const report = await validateItem({
    templateId,
    uploadTemplateId: String(form.get("uploadTemplateId") ?? "").trim() || null,
    indexTemplates: (index.value ?? null) as CatalogInput["indexTemplates"],
    inputMap: inputMap as CatalogInput["inputMap"],
    outputKey,
  });
  return { report, message: null };
}

export async function saveCatalogAction(_prev: FormState, form: FormData): Promise<FormState> {
  const admin = await currentAdmin();
  if (!admin) return denied;
  const id = form.get("id") ? uuid.safeParse(form.get("id")) : null;
  if (id && !id.success) return { ok: false, message: "Unknown catalog item." };
  const { input, error } = catalogFromForm(form);
  if (error) return { ok: false, message: error };
  const r = await saveCatalogItem(admin, id?.data ?? null, input);
  if (!r.ok) return { ok: false, message: r.error.message };
  revalidatePath("/admin", "layout");
  revalidatePath("/"); // the Create page lists enabled items
  if (!id) redirect(`/admin/catalog/${r.data.id}`);
  const warnings = r.data.report?.warnings ?? [];
  return { ok: true, message: warnings.length ? `Saved, with warnings: ${warnings.join(" ")}` : "Saved. New jobs use this right away." };
}

export async function deleteCatalogAction(_prev: FormState, form: FormData): Promise<FormState> {
  const admin = await currentAdmin();
  if (!admin) return denied;
  const id = uuid.safeParse(form.get("id"));
  if (!id.success) return { ok: false, message: "Unknown catalog item." };
  const r = await deleteCatalogItem(admin, id.data);
  if (!r.ok) return { ok: false, message: r.error.message };
  revalidatePath("/");
  redirect("/admin/catalog");
}

// ── Billing ──

const rupeesToPaise = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").trim();
  return s === "" ? null : Math.round(Number(s) * 100);
};

export async function saveSettingsAction(_prev: FormState, form: FormData): Promise<FormState> {
  const admin = await currentAdmin();
  if (!admin) return denied;
  const r = await updateSettings(admin, {
    costPaisePerSecond: rupeesToPaise(form.get("costRupeesPerSecond")) ?? 0,
    sellPaisePerCredit: rupeesToPaise(form.get("sellRupeesPerCredit")) ?? 0,
    minPurchasePaise: rupeesToPaise(form.get("minPurchaseRupees")) ?? 0,
    maxPurchasePaise: rupeesToPaise(form.get("maxPurchaseRupees")) ?? 0,
    gstRateBps: Math.round(Number(form.get("gstPercent")) * 100),
    seller: Object.fromEntries(
      ["legalName", "address", "stateCode", "gstin", "pan", "email", "phone", "website", "sac", "signatory"].map((k) => [k, String(form.get(`seller.${k}`) ?? "")]),
    ),
    starterCredits: Number(form.get("starterCredits")),
    maxUploadMb: Number(form.get("maxUploadMb")),
    maxConcurrentJobsPerUser: Number(form.get("maxConcurrentJobsPerUser")),
    maxRunMinutes: Number(form.get("maxRunMinutes")),
  });
  if (!r.ok) return { ok: false, message: r.error.message };
  revalidatePath("/admin", "layout");
  return { ok: true, message: "Saved." };
}

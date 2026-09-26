"use server";

import { APIError } from "better-auth/api";
import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { redirect } from "next/navigation";
import { z } from "zod";
import { env } from "@/config/env";
import { adjustUserCredits, refundJobByAdmin, retryJob, setRole, setSuspended } from "@/server/admin/mutations";
import { currentAdmin, isAdmin } from "@/server/admin/guard";
import { resolveUserId } from "@/server/admin/queries";
import { auth } from "@/server/auth";
import { clientIp } from "@/server/ip";
import { underLimit } from "@/server/redis";

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
  if (!(await underLimit(`admin-login:ip:${ip}`, 20, 900)) || !(await underLimit(`admin-login:email:${email}`, 5, 900))) {
    return { ok: false, message: "Too many attempts. Wait 15 minutes, then try again." };
  }
  const wrong: FormState = { ok: false, message: "That email and password don't match an admin account." };
  let userId: string;
  try {
    // Sets the session cookie on this response (nextCookies plugin).
    ({ user: { id: userId } } = await auth.api.signInEmail({ body: { email, password: parsed.data.password }, headers: h }));
  } catch (e) {
    if (e instanceof APIError) {
      console.warn("[admin sign-in] refused:", e.status, (e.body as { code?: string } | undefined)?.code ?? e.message);
      return wrong;
    }
    throw e;
  }
  // The request still carries the old cookie, so check the signed-in user directly.
  const [row] = await db.select({ role: users.role, isAnonymous: users.isAnonymous, suspendedAt: users.suspendedAt }).from(users).where(eq(users.id, userId));
  if (!isAdmin(row)) {
    console.warn("[admin sign-in] not an admin account:", userId);
    const cookieHeader = (await cookies()).toString();
    await auth.api.signOut({ headers: new Headers({ cookie: cookieHeader }) }).catch(() => {});
    return wrong;
  }
  redirect("/admin");
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

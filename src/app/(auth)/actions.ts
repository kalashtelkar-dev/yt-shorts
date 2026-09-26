"use server";

import { APIError } from "better-auth/api";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { env } from "@/config/env";
import { auth } from "@/server/auth";
import { clientIp } from "@/server/ip";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { applyHeldPassword, clearPendingEmail, codeErrorMessage, holdPassword, markCodeSent, pendingEmail, pendingSignupNonce, sendCode, setPendingEmail } from "@/server/otp";
import { failuresUnder, recordFailure, underLimit } from "@/server/redis";
import { getViewer, welcomeCredits } from "@/server/session";

// Full-auth flows (AUTH_MODE=full). Each parses its input with zod, applies Redis rate limits, then
// calls Better Auth on the server; the nextCookies plugin sets the session cookie on the response.

// `email` comes back on errors so the form (reset by React after every action) can keep it.
export type AuthState = { ok: boolean; message: string; field?: string; email?: string } | null;

const closed: AuthState = { ok: false, message: "Accounts aren't open yet." };
const email = z.email().max(254).transform((e) => e.toLowerCase());
const password = z.string().min(8, "Use at least 8 characters.").max(128, "Use at most 128 characters.");
const otp = z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code from the email.");

const errorCode = (e: APIError) => (e.body as { code?: string } | undefined)?.code;

async function ip() {
  return clientIp(await headers(), env.TRUSTED_PROXY_HOPS);
}

export async function signUpAction(_prev: AuthState, form: FormData): Promise<AuthState> {
  if (env.AUTH_MODE !== "full") return closed;
  const parsed = z.object({ email, password }).safeParse({ email: form.get("email"), password: form.get("password") });
  const typed = String(form.get("email") ?? "").slice(0, 254);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, message: issue.path[0] === "password" ? issue.message : "Enter a valid email address.", field: String(issue.path[0]), email: typed };
  }
  const addr = await ip();
  if (!(await underLimit(`signup:ip:${addr}`, 10, 3600))) return { ok: false, message: "Too many sign-ups from this network. Try again in an hour.", email: typed };
  const [existing] = await db.select({ emailVerified: users.emailVerified }).from(users).where(eq(users.email, parsed.data.email));
  try {
    // For an email that already has an account Better Auth answers the same way and doesn't store the
    // password, so this page never reveals who has an account.
    await auth.api.signUpEmail({ body: { email: parsed.data.email, password: parsed.data.password, name: parsed.data.email.split("@")[0] }, headers: await headers() });
  } catch (e) {
    if (e instanceof APIError) return { ok: false, message: errorCode(e) === "PASSWORD_TOO_LONG" ? "Use at most 128 characters." : "We couldn't create that account. Check the details and try again.", email: typed };
    throw e;
  }
  if (!existing) await markCodeSent(parsed.data.email, "email-verification"); // Better Auth sent the first code
  else if (!existing.emailVerified) await sendCode(parsed.data.email, "email-verification", addr); // unfinished sign-up: fresh code
  // Whoever enters the code sets the password (see holdPassword), including over an unfinished sign-up.
  await setPendingEmail(parsed.data.email, await holdPassword(parsed.data.email, parsed.data.password));
  redirect("/verify");
}

export async function signInAction(_prev: AuthState, form: FormData): Promise<AuthState> {
  if (env.AUTH_MODE !== "full") return closed;
  const parsed = z.object({ email, password: z.string().min(1).max(128) }).safeParse({ email: form.get("email"), password: form.get("password") });
  const typed = String(form.get("email") ?? "").slice(0, 254);
  if (!parsed.success) return { ok: false, message: "Enter your email and password.", email: typed };
  const addr = await ip();
  const failKey = `signin-fail:${parsed.data.email}`;
  if (!(await underLimit(`signin:ip:${addr}`, 30, 900)) || !(await failuresUnder(failKey, 10))) {
    return { ok: false, message: "Too many attempts. Wait 15 minutes, then try again.", email: typed };
  }
  try {
    const { user } = await auth.api.signInEmail({ body: parsed.data, headers: await headers() });
    await welcomeCredits(user, addr); // no-op unless this account has never had credits
  } catch (e) {
    if (!(e instanceof APIError)) throw e;
    if (errorCode(e) !== "EMAIL_NOT_VERIFIED") await recordFailure(failKey, 900);
    if (errorCode(e) === "EMAIL_NOT_VERIFIED") {
      // The password was right; finish the sign-up with a fresh code.
      const sent = await sendCode(parsed.data.email, "email-verification", addr);
      if (!sent.ok && sent.error.code === "rate_limited") return { ok: false, message: sent.error.message, email: typed };
      await setPendingEmail(parsed.data.email);
      redirect("/verify");
    }
    return { ok: false, message: "That email and password don't match an account.", email: typed };
  }
  redirect("/");
}

export async function verifyAction(_prev: AuthState, form: FormData): Promise<AuthState> {
  if (env.AUTH_MODE !== "full") return closed;
  const to = await pendingEmail();
  if (!to) return { ok: false, message: "This code page has expired. Sign in or sign up again." };
  const parsed = otp.safeParse(form.get("otp"));
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message, field: "otp" };
  if (!(await underLimit(`verify:ip:${await ip()}`, 30, 900))) return { ok: false, message: "Too many attempts. Wait 15 minutes, then try again." };
  try {
    // Signs the new account in; a guest session in the same browser is merged into it (auth.ts).
    const { user } = await auth.api.verifyEmailOTP({ body: { email: to, otp: parsed.data }, headers: await headers() });
    const nonce = await pendingSignupNonce();
    if (nonce) await applyHeldPassword(nonce, to, user.id);
    await welcomeCredits(user, await ip()); // after the guest merge, which already ran in verifyEmailOTP
  } catch (e) {
    if (e instanceof APIError) return { ok: false, message: codeErrorMessage(errorCode(e)), field: "otp" };
    throw e;
  }
  await clearPendingEmail();
  redirect("/");
}

/** "Send a new code" on the verify and reset pages. */
export async function resendAction(_prev: AuthState, form: FormData): Promise<AuthState> {
  if (env.AUTH_MODE !== "full") return closed;
  const to = await pendingEmail();
  if (!to) return { ok: false, message: "This page has expired. Start again." };
  const purpose = form.get("purpose") === "forget-password" ? "forget-password" : "email-verification";
  const r = await sendCode(to, purpose, await ip());
  return r.ok ? { ok: true, message: "We sent a new code. It works for 10 minutes." } : { ok: false, message: r.error.message };
}

export async function forgotAction(_prev: AuthState, form: FormData): Promise<AuthState> {
  if (env.AUTH_MODE !== "full") return closed;
  const parsed = email.safeParse(form.get("email"));
  const typed = String(form.get("email") ?? "").slice(0, 254);
  if (!parsed.success) return { ok: false, message: "Enter a valid email address.", field: "email", email: typed };
  const r = await sendCode(parsed.data, "forget-password", await ip());
  if (!r.ok && r.error.code === "rate_limited") return { ok: false, message: r.error.message, email: typed };
  await setPendingEmail(parsed.data);
  redirect("/forgot-password?step=code");
}

export async function resetAction(_prev: AuthState, form: FormData): Promise<AuthState> {
  if (env.AUTH_MODE !== "full") return closed;
  const to = await pendingEmail();
  if (!to) return { ok: false, message: "This page has expired. Start again." };
  const parsed = z.object({ otp, password }).safeParse({ otp: form.get("otp"), password: form.get("password") });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message, field: String(parsed.error.issues[0].path[0]) };
  if (!(await underLimit(`reset:ip:${await ip()}`, 30, 900))) return { ok: false, message: "Too many attempts. Wait 15 minutes, then try again." };
  try {
    // Also signs out every other session of this account (revokeSessionsOnPasswordReset).
    await auth.api.resetPasswordEmailOTP({ body: { email: to, otp: parsed.data.otp, password: parsed.data.password } });
  } catch (e) {
    if (e instanceof APIError) return { ok: false, message: codeErrorMessage(errorCode(e)), field: "otp" };
    throw e;
  }
  await clearPendingEmail();
  redirect("/sign-in?reset=1");
}

/** Account page: needs the current password; signs out every other session of the account. */
export async function changePasswordAction(_prev: AuthState, form: FormData): Promise<AuthState> {
  if (env.AUTH_MODE !== "full") return closed;
  const viewer = await getViewer();
  if (!viewer || viewer.isAnonymous) return { ok: false, message: "Your session has ended. Sign in again." };
  const parsed = z
    .object({ currentPassword: z.string().min(1, "Enter your current password.").max(128), password })
    .safeParse({ currentPassword: form.get("currentPassword"), password: form.get("password") });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message, field: String(parsed.error.issues[0].path[0]) };
  if (parsed.data.currentPassword === parsed.data.password) return { ok: false, message: "Choose a password that's different from your current one.", field: "password" };
  if (!(await underLimit(`password-change:${viewer.id}`, 10, 900))) return { ok: false, message: "Too many attempts. Wait 15 minutes, then try again." };
  try {
    await auth.api.changePassword({ body: { currentPassword: parsed.data.currentPassword, newPassword: parsed.data.password, revokeOtherSessions: true }, headers: await headers() });
  } catch (e) {
    if (!(e instanceof APIError)) throw e;
    if (errorCode(e) === "INVALID_PASSWORD") return { ok: false, message: "Your current password isn't right.", field: "currentPassword" };
    return { ok: false, message: "We couldn't change your password. Try again." };
  }
  return { ok: true, message: "Password changed. Your other devices will be signed out within 5 minutes." };
}

/** Ends every session of this account, including this one. */
export async function signOutEverywhereAction() {
  await auth.api.revokeSessions({ headers: await headers() }).catch(() => {});
  await auth.api.signOut({ headers: await headers() }).catch(() => {}); // clears this browser's cookie
  redirect("/sign-in");
}

export async function signOutAction() {
  await auth.api.signOut({ headers: await headers() }).catch(() => {});
  redirect("/");
}

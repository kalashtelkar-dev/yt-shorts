import "server-only";
import { cookies } from "next/headers";
import { z } from "zod";
import { env } from "@/config/env";
import { db } from "@/db/client";
import type { ActionResult } from "@/lib/jobs";
import { auth } from "./auth";
import { redis, underLimit } from "./redis";

// Email codes (CLAUDE.md §6): 6 digits, 10-minute expiry, 5 attempts, hashed, single use (set in
// auth.ts). This adds what Better Auth doesn't: a 60 s resend cooldown and per-email / per-IP caps.

export type CodePurpose = "email-verification" | "forget-password";

export const RESEND_COOLDOWN_SEC = 60;
const PER_EMAIL_PER_HOUR = 6;
const PER_EMAIL_PER_DAY = 12; // with 5 tries per code: at most 60 guesses a day at a 1-in-a-million code
const PER_IP_PER_HOUR = 20;

export async function sendCode(email: string, purpose: CodePurpose, ip: string): Promise<ActionResult<null>> {
  email = email.toLowerCase();
  // Cooldown first, so impatient clicks don't use up the hourly allowance.
  if (!(await redis.set(`otp-cooldown:${purpose}:${email}`, "1", "EX", RESEND_COOLDOWN_SEC, "NX"))) {
    return { ok: false, error: { code: "cooldown", message: "We just sent a code. Wait a minute before asking for another." } };
  }
  if (
    !(await underLimit(`otp:ip:${ip}`, PER_IP_PER_HOUR, 3600)) ||
    !(await underLimit(`otp:email:${email}`, PER_EMAIL_PER_HOUR, 3600)) ||
    !(await underLimit(`otp:email-day:${email}`, PER_EMAIL_PER_DAY, 86_400))
  ) {
    return { ok: false, error: { code: "rate_limited", message: "Too many codes requested. Try again in an hour." } };
  }
  if (purpose === "forget-password") {
    // Better Auth sends nothing (and says nothing) when there's no account with this email.
    await auth.api.requestPasswordResetEmailOTP({ body: { email } });
  } else {
    // Only unverified accounts get sign-up codes; a verified one signs in with its password.
    const user = await db.user.findUnique({ where: { email }, select: { emailVerified: true } });
    if (user && !user.emailVerified) await auth.api.sendVerificationOTP({ body: { email, type: "email-verification" } });
  }
  return { ok: true, data: null };
}

/** Starts the cooldown for a code Better Auth sent on its own (the first sign-up code). */
export async function markCodeSent(email: string, purpose: CodePurpose) {
  await redis.set(`otp-cooldown:${purpose}:${email.toLowerCase()}`, "1", "EX", RESEND_COOLDOWN_SEC);
}

// The sign-up password waits here until the code proves the mailbox. Otherwise someone could sign up
// with a victim's email first, and when the victim later verified, the account would keep the
// attacker's password (account pre-registration). Only the browser that signed up holds the nonce.
const HOLD_SEC = 30 * 60;

export async function holdPassword(email: string, password: string): Promise<string> {
  const hash = await (await auth.$context).password.hash(password);
  const nonce = crypto.randomUUID();
  await redis.set(`signup-password:${nonce}`, JSON.stringify({ email: email.toLowerCase(), hash }), "EX", HOLD_SEC);
  return nonce;
}

/** After a successful code check: the held password becomes the account's password. */
export async function applyHeldPassword(nonce: string, email: string, userId: string): Promise<boolean> {
  const raw = await redis.getdel(`signup-password:${nonce}`);
  if (!raw) return false;
  const held = JSON.parse(raw) as { email: string; hash: string };
  if (held.email !== email.toLowerCase()) return false;
  await (await auth.$context).internalAdapter.updatePassword(userId, held.hash);
  return true;
}

// Which address the /verify and password-reset steps are for, so it never goes in the URL.
const PENDING_EMAIL = "auth_email";

const PENDING_SIGNUP = "auth_signup";
const cookieOpts = () => ({ httpOnly: true, sameSite: "lax" as const, secure: env.NODE_ENV === "production", maxAge: HOLD_SEC, path: "/" });

/** `signupNonce` (from holdPassword) is set by sign-up only; other flows clear it. */
export async function setPendingEmail(email: string, signupNonce?: string) {
  const jar = await cookies();
  jar.set(PENDING_EMAIL, email, cookieOpts());
  if (signupNonce) jar.set(PENDING_SIGNUP, signupNonce, cookieOpts());
  else jar.delete(PENDING_SIGNUP);
}

export async function pendingSignupNonce(): Promise<string | null> {
  return (await cookies()).get(PENDING_SIGNUP)?.value ?? null;
}

export async function pendingEmail(): Promise<string | null> {
  const v = (await cookies()).get(PENDING_EMAIL)?.value;
  return v && z.email().safeParse(v).success ? v : null;
}

export async function clearPendingEmail() {
  const jar = await cookies();
  jar.delete(PENDING_EMAIL);
  jar.delete(PENDING_SIGNUP);
}

/** Friendly text for Better Auth's code errors. */
export function codeErrorMessage(code: string | undefined): string {
  if (code === "OTP_EXPIRED") return "That code has expired. Send a new one.";
  if (code === "TOO_MANY_ATTEMPTS") return "Too many wrong tries. Send a new code.";
  return "That code isn't right. Check the email and try again.";
}

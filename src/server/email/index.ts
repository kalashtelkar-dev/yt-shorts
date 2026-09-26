import "server-only";
import { render } from "@react-email/components";
import nodemailer, { type Transporter } from "nodemailer";
import { env } from "@/config/env";
import type { OtpPurpose } from "./otp-email";

// Outgoing email over SMTP (CLAUDE.md §2). Never log addresses with codes, or SMTP credentials.

let transport: Transporter | null = null;

export const mailConfigured = () => !!env.SMTP_HOST;

export function mailer(): Transporter {
  return (transport ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    connectionTimeout: 10_000,
  }));
}

export async function sendOtpEmail(to: string, otp: string, purpose: OtpPurpose) {
  // Loaded on send only, so the worker (which just runs the SMTP health check) never compiles JSX.
  const { OtpEmail, otpSubject } = await import("./otp-email");
  const html = await render(OtpEmail({ otp, purpose }));
  const text = await render(OtpEmail({ otp, purpose }), { plainText: true });
  if (!mailConfigured()) {
    // Local development without SMTP: print the code so the flow can still be tested.
    if (env.NODE_ENV === "development") console.info(`[email] SMTP not configured; ${purpose} code: ${otp}`);
    else console.error("[email] SMTP not configured; code not sent");
    return;
  }
  await mailer().sendMail({ from: env.SMTP_FROM, to, subject: otpSubject(purpose), html, text });
}

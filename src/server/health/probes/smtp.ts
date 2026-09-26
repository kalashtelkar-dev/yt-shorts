import "server-only";
import { mailConfigured, mailer } from "@/server/email";
import type { Probe } from "../types";

// Connects and logs in to the SMTP server without sending anything. Not critical: montages
// keep working when email is down, only sign-up and password-reset codes stop.
export const smtpProbe: Probe = {
  id: "smtp",
  name: "Email (SMTP)",
  tier: "email",
  critical: false,
  degradedMs: 2000,
  async run() {
    if (!mailConfigured()) return { status: "not_configured", message: "Set SMTP_HOST to send sign-up codes" };
    await mailer().verify();
    return { status: "up" };
  },
};

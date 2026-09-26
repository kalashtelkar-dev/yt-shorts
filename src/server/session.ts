import "server-only";
import { headers } from "next/headers";
import { auth, type SessionUser } from "./auth";
import { grant } from "./credits";
import { underLimit } from "./redis";
import { getSettings } from "./settings";

const ANON_PER_IP_PER_HOUR = 10;
const STARTER_GRANTS_PER_IP_PER_DAY = 3;

export function clientIp(h: Headers): string {
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}

/** The signed-in (or anonymous) user, or null for a first-time visitor. Read-only: safe in Server Components. */
export async function getViewer(): Promise<SessionUser | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.user ?? null;
}

export class RateLimitedError extends Error {}

/**
 * Returns the current user, creating an anonymous one (plus starter credits) on first use.
 * Only call from Server Actions or Route Handlers: it sets the session cookie.
 * Users are created lazily, when a visitor first acts, so bots browsing the page create nothing.
 */
export async function ensureUser(): Promise<SessionUser> {
  const h = await headers();
  const existing = await auth.api.getSession({ headers: h });
  if (existing) return existing.user;

  const ip = clientIp(h);
  if (!(await underLimit(`anon:${ip}`, ANON_PER_IP_PER_HOUR, 3600))) {
    throw new RateLimitedError("Too many new sessions from this network. Try again in an hour.");
  }
  const { user } = await auth.api.signInAnonymous({ headers: h });

  const day = new Date().toISOString().slice(0, 10);
  if (await underLimit(`starter:${ip}:${day}`, STARTER_GRANTS_PER_IP_PER_DAY, 86_400)) {
    const { starterCredits } = await getSettings();
    await grant(user.id, starterCredits, "Starter credits");
  }
  return user as SessionUser;
}

import "server-only";
import { headers } from "next/headers";
import { auth, type SessionUser } from "./auth";
import { env } from "@/config/env";
import { inboxKey } from "@/lib/email";
import { getBalance, grant, grantStarterOnce, hasCreditHistory } from "./credits";
import { clientIp } from "./ip";
import { redis, underLimit } from "./redis";
import { getSettings } from "./settings";

const ANON_PER_IP_PER_HOUR = 10;
const STARTER_GRANTS_PER_IP_PER_DAY = 3;

/** The signed-in (or anonymous) user, or null for a first-time visitor. Read-only: safe in Server Components. */
export async function getViewer(): Promise<SessionUser | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.user ?? null;
}

/** The balance to show. First-time visitors and brand-new accounts see the starter credits their first action grants. */
export async function viewerBalance(viewer: SessionUser | null): Promise<number> {
  if (viewer && (viewer.isAnonymous || (await hasCreditHistory(viewer.id)))) return getBalance(viewer.id);
  return (await getSettings()).starterCredits;
}

export class RateLimitedError extends Error {}
/** AUTH_MODE=full and the visitor has no account (or only a guest session from before the switch). */
export class SignInRequiredError extends Error {
  constructor() {
    super("Create a free account or sign in to make a montage.");
  }
}

const starterCap = (ip: string) => underLimit(`starter:${ip}:${new Date().toISOString().slice(0, 10)}`, STARTER_GRANTS_PER_IP_PER_DAY, 86_400);

/**
 * Returns the current user, creating an anonymous one (plus starter credits) on first use.
 * Only call from Server Actions or Route Handlers: it sets the session cookie.
 * Users are created lazily, when a visitor first acts, so bots browsing the page create nothing.
 */
export async function ensureUser(): Promise<SessionUser> {
  const h = await headers();
  const existing = await auth.api.getSession({ headers: h });
  const ip = clientIp(h, env.TRUSTED_PROXY_HOPS);

  if (existing && !existing.user.isAnonymous) {
    // Accounts that have never had credits (direct sign-ups) get the starter credits once per inbox.
    // ponytail: the inbox marker lives in Redis; move it to a DB column if Redis stops being durable.
    if (
      !(await hasCreditHistory(existing.user.id)) &&
      (await starterCap(ip)) &&
      (await redis.set(`starter-inbox:${inboxKey(existing.user.email)}`, existing.user.id, "NX"))
    ) {
      await grantStarterOnce(existing.user.id, (await getSettings()).starterCredits);
    }
    return existing.user;
  }
  if (env.AUTH_MODE === "full") throw new SignInRequiredError();
  if (existing) return existing.user;

  if (!(await underLimit(`anon:${ip}`, ANON_PER_IP_PER_HOUR, 3600))) {
    throw new RateLimitedError("Too many new sessions from this network. Try again in an hour.");
  }
  const { user } = await auth.api.signInAnonymous({ headers: h });

  if (await starterCap(ip)) {
    const { starterCredits } = await getSettings();
    await grant(user.id, starterCredits, "Starter credits");
  }
  return user as SessionUser;
}

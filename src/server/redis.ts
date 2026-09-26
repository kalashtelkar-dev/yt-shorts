import "server-only";
import Redis from "ioredis";
import { env } from "@/config/env";

const g = globalThis as unknown as { redis?: Redis };

// One connection per process (survives dev hot reloads).
export const redis = (g.redis ??= new Redis(env.REDIS_URL, { maxRetriesPerRequest: 2, lazyConnect: false }));

/** Fixed-window limiter. Returns true while the caller is under `limit` hits per `windowSec`. */
export async function underLimit(key: string, limit: number, windowSec: number): Promise<boolean> {
  const k = `rl:${key}`;
  const [[, count]] = (await redis.multi().incr(k).expire(k, windowSec, "NX").exec()) as [[unknown, number]];
  return count <= limit;
}

/**
 * Failure counters: check with `failuresUnder` before an attempt, `recordFailure` only when it fails,
 * so someone typing a victim's email can't lock them out while they keep signing in successfully.
 */
export async function failuresUnder(key: string, limit: number): Promise<boolean> {
  return Number((await redis.get(`rl:${key}`)) ?? 0) < limit;
}

export async function recordFailure(key: string, windowSec: number): Promise<void> {
  await underLimit(key, Number.MAX_SAFE_INTEGER, windowSec);
}

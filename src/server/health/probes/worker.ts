import "server-only";
import { redis } from "@/server/redis";
import type { Probe } from "../types";

export const HEARTBEAT_KEY = "worker:heartbeat";

/** Milliseconds since the worker's last heartbeat, or null if it has none. */
export async function heartbeatAge(): Promise<number | null> {
  const beat = Number(await redis.get(HEARTBEAT_KEY));
  return beat ? Date.now() - beat : null;
}

export const workerProbe: Probe = {
  id: "worker",
  name: "Worker",
  tier: "app",
  critical: true,
  async run() {
    const age = await heartbeatAge();
    return age !== null && age < 60_000 ? { status: "up", message: `heartbeat ${Math.round(age / 1000)} s ago` } : { status: "down", message: "No heartbeat in the last 60 s" };
  },
};

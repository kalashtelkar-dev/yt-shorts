import "server-only";
import { redis } from "@/server/redis";
import type { Probe } from "../types";

export const HEARTBEAT_KEY = "worker:heartbeat";

export const workerProbe: Probe = {
  id: "worker",
  name: "Worker",
  tier: "app",
  critical: true,
  async run() {
    const beat = Number(await redis.get(HEARTBEAT_KEY));
    const age = Date.now() - beat;
    return beat && age < 60_000 ? { status: "up", message: `heartbeat ${Math.round(age / 1000)} s ago` } : { status: "down", message: "No heartbeat in the last 60 s" };
  },
};

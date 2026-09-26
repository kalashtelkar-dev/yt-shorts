import "server-only";
import { redis } from "@/server/redis";
import type { Probe } from "../types";

export const redisProbe: Probe = {
  id: "redis",
  name: "Redis",
  tier: "data",
  critical: true,
  degradedMs: 250,
  async run() {
    const pong = await redis.ping();
    return pong === "PONG" ? { status: "up" } : { status: "down", message: `Unexpected reply: ${pong}` };
  },
};

import "server-only";
import { Queue } from "bullmq";
import { bullConnection, QUEUE } from "@/server/queue";
import type { Probe } from "../types";

const g = globalThis as unknown as { healthQueue?: Queue };
const WAITING_DEGRADED = 20;

export const queueProbe: Probe = {
  id: "queue",
  name: "Job queue",
  tier: "queue",
  critical: false,
  async run() {
    const q = (g.healthQueue ??= new Queue(QUEUE, { connection: bullConnection() }));
    const c = await q.getJobCounts("waiting", "active", "failed");
    const message = `${c.waiting} waiting · ${c.active} active · ${c.failed} failed`;
    return { status: c.waiting > WAITING_DEGRADED ? "degraded" : "up", message };
  },
};

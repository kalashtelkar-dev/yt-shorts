import "server-only";
import { env } from "@/config/env";
import type { Probe } from "../types";

export const webProbe: Probe = {
  id: "web",
  name: "Web app",
  tier: "app",
  critical: true,
  degradedMs: 1500,
  async run() {
    const res = await fetch(new URL("/api/health", env.APP_URL), { cache: "no-store", signal: AbortSignal.timeout(5000) });
    return res.ok ? { status: "up" } : { status: "down", message: `HTTP ${res.status}` };
  },
};

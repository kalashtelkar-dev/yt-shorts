import "server-only";
import { env } from "@/config/env";
import type { Probe } from "../types";

// MinIO's standard liveness endpoint; needs no credentials and touches no objects.
export const storageProbe: Probe = {
  id: "storage",
  name: "Object storage",
  tier: "storage",
  critical: true,
  degradedMs: 1000,
  async run() {
    if (!env.ENGINEX_STORAGE_URL) return { status: "not_configured", message: "Set ENGINEX_STORAGE_URL to check it" };
    const res = await fetch(new URL("/minio/health/live", env.ENGINEX_STORAGE_URL), { cache: "no-store", signal: AbortSignal.timeout(5000) });
    return res.ok ? { status: "up" } : { status: "down", message: `HTTP ${res.status}` };
  },
};

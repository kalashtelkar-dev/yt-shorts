import "server-only";
import type { ProbeStatus } from "@/lib/uptime";
import type { FleetStatus } from "@/server/enginex/types";

import type { HealthTier } from "@/lib/health";

export type Tier = HealthTier;

export type ProbeResult = { status: ProbeStatus; latencyMs?: number | null; message?: string | null };

/** Shared per sweep, so one fleetStatus call serves the gateway and every engine probe. */
export type SweepContext = { fleet: () => Promise<FleetStatus> };

export type Probe = {
  id: string;
  name: string;
  tier: Tier;
  /** Critical probes count towards fleet uptime. */
  critical: boolean;
  /** Slower than this (ms) = degraded. */
  degradedMs?: number;
  /** Answered from data another probe fetched (e.g. the shared fleet call), so its latency means nothing. */
  derived?: boolean;
  run(ctx: SweepContext): Promise<ProbeResult>;
};

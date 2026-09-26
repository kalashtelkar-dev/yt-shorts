// Health view types shared by server and client. No server imports here.
import type { BucketStatus, ProbeStatus, Range } from "./uptime";

export type HealthTier = "app" | "data" | "queue" | "engine" | "storage" | "workers";

export type ProbeView = {
  id: string;
  name: string;
  tier: HealthTier;
  critical: boolean;
  status: ProbeStatus | "unknown";
  latencyMs: number | null;
  message: string | null;
  checkedAt: string | null;
  buckets: BucketStatus[];
  uptime: number | null;
  downBuckets: number;
  recent: { at: string; status: ProbeStatus; latencyMs: number | null; message: string | null }[];
};

export type HealthView = {
  range: Range;
  probes: ProbeView[];
  fleet: { uptime: number | null; buckets: BucketStatus[]; criticalCount: number };
  lastSweepAt: string | null;
  workerAlive: boolean;
  generatedAt: string;
};


// Health view types shared by server and client. No server imports here.
import type { BucketStatus, Counts, ProbeStatus, Range } from "./uptime";

export type HealthTier = "app" | "data" | "queue" | "email" | "engine" | "storage" | "workers";

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
  /** Check counts behind each bucket, for hover details. */
  counts: Counts[];
  uptime: number | null;
  downBuckets: number;
  recent: { at: string; status: ProbeStatus; latencyMs: number | null; message: string | null }[];
};

export type HealthView = {
  range: Range;
  probes: ProbeView[];
  fleet: { uptime: number | null; buckets: BucketStatus[]; criticalCount: number; /** Critical services not fully up, per bucket. */ troubled: string[][] };
  incidents: { ongoing: IncidentView[]; recent: IncidentView[] };
  lastSweepAt: string | null;
  workerAlive: boolean;
  generatedAt: string;
};


export type IncidentView = {
  id: string;
  probeId: string;
  name: string;
  severity: "down" | "degraded";
  startedAt: string;
  resolvedAt: string | null;
  message: string | null;
};

import "server-only";

export type RunStatus = "queued" | "running" | "succeeded" | "failed" | "canceled";

export type RunStep = {
  step: string;
  engine: string | null;
  status: string;
  error: string | null;
  /** Fan-out steps report their items instead of one step per item. */
  items: { total: number; done: number; failed: number } | null;
};

export type Run = {
  runId: string;
  status: RunStatus;
  steps: RunStep[];
  output: Record<string, unknown> | null;
  error: string | null;
  runMs: number | null;
};

export type Pipeline = {
  id: string;
  name: string;
  etag: string | null;
  /** Head version (may be an unpublished draft). */
  version: number | null;
  /** Published version that /v1/run executes; null = never published. */
  publishedVersion: number | null;
  compiles: boolean;
  /** Request fields the pipeline declares (its `kind: "input"` nodes). */
  inputs: { name: string; type: string; required: boolean }[];
  /** Fields of the output node, e.g. montage, clips, totalKills, title. */
  outputs: string[];
  issues: unknown[];
  raw: unknown;
};

export type UploadTarget = { url: string; key: string };

/** `available` maps each engine with live workers to its tiers. */
export type FleetStatus = { known: string[]; available: Record<string, string[]>; raw: unknown };

export class EngineXError extends Error {
  constructor(
    public code: string,
    message: string,
    public retryable: boolean,
    public status?: number,
  ) {
    super(message);
    this.name = "EngineXError";
  }
}

export interface EngineXClient {
  /** `idempotencyKey` should be the job id so a repeated start returns the same run. */
  runPipeline(templateId: string, input: Record<string, unknown>, idempotencyKey: string): Promise<{ runId: string }>;
  getRun(runId: string): Promise<Run>;
  cancelRun(runId: string): Promise<void>;
  signOutput(keys: string[], expiresSec: number): Promise<Record<string, string>>;
  createUploadUrl(filename: string, expirySec?: number): Promise<UploadTarget>;
  getPipeline(templateId: string): Promise<Pipeline>;
  fleetStatus(): Promise<FleetStatus>;
}

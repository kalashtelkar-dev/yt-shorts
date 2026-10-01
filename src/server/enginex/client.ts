import "server-only";
import { env } from "@/config/env";
import { mockClient } from "./mock";
import { EngineXError, type EngineXClient, type Pipeline, type Run, type RunStatus, type RunStep } from "./types";

// The only place that talks to Engine X (CLAUDE.md §4). REST, documented at <base>/v1/openapi.json.
// The OpenAPI spec does not type success bodies, so the normalisers below read them leniently.
// Pipeline and engines shapes are confirmed (smoke, 2026-09-26). Run, sign and upload bodies are still
// read leniently: ponytail: tighten them from the first real run.

const TIMEOUT_MS = 30_000;
const MAX_RETRIES = 3;

type Json = Record<string, unknown>;
type RequestOptions = { body?: unknown; retry?: boolean; headers?: Record<string, string> };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function createClient(
  baseUrl: string,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
  backoffMs = (attempt: number) => 500 * 2 ** attempt + Math.random() * 250,
): EngineXClient {
  async function request<T = Json>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
    const retry = opts.retry ?? true;
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await fetchImpl(new URL(path, baseUrl), {
          method,
          headers: {
            Authorization: `Bearer ${apiKey}`,
            Accept: "application/json",
            ...(opts.body === undefined ? {} : { "Content-Type": "application/json" }),
            ...opts.headers,
          },
          body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
          signal: AbortSignal.timeout(TIMEOUT_MS),
          cache: "no-store",
        });
        const text = await res.text();
        const data = text ? safeJson(text) : {};
        if (res.ok) return data as T;
        const err = (data as { error?: { code?: string; message?: string } }).error;
        throw new EngineXError(err?.code ?? `http_${res.status}`, err?.message ?? res.statusText, res.status >= 500, res.status);
      } catch (e) {
        const error = toEngineXError(e);
        if (!retry || !error.retryable || attempt >= MAX_RETRIES) throw error;
        await sleep(backoffMs(attempt));
      }
    }
  }

  return {
    async runPipeline(templateId, input, idempotencyKey) {
      // Never retried automatically (CLAUDE.md §4.5). The Idempotency-Key makes a manual retry safe.
      const data = await request("POST", `/v1/run/${encodeURIComponent(templateId)}`, {
        body: input,
        retry: false,
        headers: { "Idempotency-Key": idempotencyKey },
      });
      const runId = str(data.runId) ?? str(data.id) ?? str((data.run as Json | undefined)?.id);
      if (!runId) throw new EngineXError("bad_response", "Run accepted but no run id in the response", false);
      return { runId };
    },

    async getRun(runId) {
      return normaliseRun(runId, await request("GET", `/v1/runs/${encodeURIComponent(runId)}`));
    },

    async getJobEvents(jobId) {
      const data = await request("GET", `/v1/jobs/${encodeURIComponent(jobId)}/events`);
      const events = Array.isArray(data.events) ? (data.events as Json[]) : [];
      return events.map((e) => ({ at: str(e.at) ?? "", kind: str(e.kind) ?? "", data: e.data && typeof e.data === "object" ? (e.data as Json) : null }));
    },

    async cancelRun(runId) {
      await request("DELETE", `/v1/runs/${encodeURIComponent(runId)}`);
    },

    async retryRun(runId) {
      await request("POST", `/v1/runs/${encodeURIComponent(runId)}/retry`, { retry: false });
    },

    async signOutput(keys, expiresSec) {
      const data = await request("POST", "/v1/outputs/sign", { body: { keys, expiresSec: Math.min(expiresSec, 3600) } });
      return normaliseSigned(keys, data);
    },

    async createUploadUrl(filename, expirySec = 3600) {
      const data = await request("POST", "/v1/uploads", { body: { filename, expirySec }, retry: false });
      const url = str(data.url) ?? str(data.uploadUrl);
      const key = str(data.key) ?? str(data.objectKey);
      if (!url || !key) throw new EngineXError("bad_response", "Upload URL response missing url or key", false);
      return { url, key };
    },

    async shareStored(key, expirySec) {
      if (!env.ENGINEX_STORE_CONNECTION || !env.ENGINEX_STORE_BUCKET) throw new EngineXError("not_configured", "ENGINEX_STORE_* is not set", false);
      // An Object Storage engine job; ?wait= returns it finished (about 0.3 s, measured 2026-10-01).
      const data = await request("POST", "/v1/storage/object-share?wait=10", {
        body: { connection: { use: env.ENGINEX_STORE_CONNECTION }, bucket: env.ENGINEX_STORE_BUCKET, key, expirySec: Math.min(expirySec, 3600) },
      });
      const url = str((data.result as Json | undefined)?.url);
      if (!url) throw new EngineXError("bad_response", `Share link not ready (job ${str(data.status) ?? "unknown"})`, true);
      return url;
    },

    async getPipeline(templateId) {
      return normalisePipeline(templateId, await request("GET", `/v1/pipelines/${encodeURIComponent(templateId)}`));
    },

    async fleetStatus() {
      const data = await request("GET", "/v1/engines");
      const known = Array.isArray(data.known) ? (data.known as string[]) : [];
      const available = (data.available as Record<string, string[]> | undefined) ?? {};
      return { known, available, raw: data };
    },
  };
}

// ── normalisers (exported for tests) ──

const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

function safeJson(text: string): Json {
  try {
    return JSON.parse(text) as Json;
  } catch {
    return {};
  }
}

function toEngineXError(e: unknown): EngineXError {
  if (e instanceof EngineXError) return e;
  if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) {
    return new EngineXError("timeout", "Engine X did not answer in time", true);
  }
  // Network failures (fetch TypeError). Never include request details: they carry the key.
  return new EngineXError("network", e instanceof Error ? e.message : "Network error", true);
}

const STATUS: Record<string, RunStatus> = {
  queued: "queued",
  pending: "queued",
  waiting: "queued",
  running: "running",
  active: "running",
  succeeded: "succeeded",
  success: "succeeded",
  completed: "succeeded",
  done: "succeeded",
  failed: "failed",
  error: "failed",
  canceled: "canceled",
  cancelled: "canceled",
};

export function normaliseRun(runId: string, data: Json): Run {
  const run = (data.run as Json | undefined) ?? data;
  const steps = Array.isArray(run.steps) ? (run.steps as Json[]) : [];
  const status = STATUS[String(run.status ?? "").toLowerCase()] ?? "running";
  return {
    runId: str(run.id) ?? runId,
    status,
    steps: steps.map(normaliseStep),
    output: (run.output as Json | null | undefined) ?? null,
    error: errorText(run.error),
    runMs: num(run.runMs) ?? num(run.durationMs) ?? null,
  };
}

function normaliseStep(s: Json): RunStep {
  const items = s.items as Json | undefined;
  return {
    step: str(s.step) ?? str(s.name) ?? str(s.id) ?? "step",
    engine: str(s.engine) ?? null,
    status: String(s.status ?? "queued").toLowerCase(),
    error: errorText(s.error),
    job: str(s.job) ?? null,
    startedAt: str(s.startedAt) ?? null,
    finishedAt: str(s.finishedAt) ?? null,
    items: items
      ? { total: num(items.total) ?? 0, done: num(items.done) ?? 0, failed: Array.isArray(items.failed) ? items.failed.length : (num(items.failed) ?? 0) }
      : null,
  };
}

function errorText(e: unknown): string | null {
  if (!e) return null;
  if (typeof e === "string") return e;
  const o = e as Json;
  return str(o.message) ?? JSON.stringify(e);
}

export function normaliseSigned(keys: string[], data: Json): Record<string, string> {
  const out: Record<string, string> = {};
  const body = (data.urls ?? data.signed ?? data) as unknown;
  if (Array.isArray(body)) {
    for (const [i, item] of body.entries()) {
      if (typeof item === "string") out[keys[i]] = item;
      else if (item && typeof item === "object") {
        const o = item as Json;
        const url = str(o.url);
        if (url) out[str(o.key) ?? keys[i]] = url;
      }
    }
  } else if (body && typeof body === "object") {
    for (const k of keys) {
      const v = (body as Json)[k];
      const url = str(v) ?? str((v as Json | undefined)?.url);
      if (url) out[k] = url;
    }
  }
  return out;
}

export function normalisePipeline(id: string, data: Json): Pipeline {
  const issues = Array.isArray(data.issues) ? (data.issues as unknown[]) : [];
  const graph = (data.graph as Json | undefined) ?? {};
  const nodes = Array.isArray(graph.nodes) ? (graph.nodes as Json[]) : [];
  const inputs = nodes
    .filter((n) => n.kind === "input" && str(n.name))
    .map((n) => ({ name: n.name as string, type: str(n.type) ?? "text", required: n.required === true }));
  const outNode = nodes.find((n) => n.kind === "output");
  const outputs = Array.isArray(outNode?.fields) ? (outNode.fields as unknown[]).filter((f): f is string => typeof f === "string") : [];
  return {
    id: str(data.id) ?? id,
    name: str(data.name) ?? id,
    etag: str(data.etag) ?? null,
    version: num(data.version) ?? null,
    publishedVersion: num(data.currentVersion) ?? null,
    compiles: typeof data.compiles === "boolean" ? data.compiles : issues.length === 0,
    inputs,
    outputs,
    issues,
    raw: data,
  };
}

let instance: EngineXClient | undefined;

export function enginex(): EngineXClient {
  if (!instance) {
    instance =
      env.ENGINEX_MODE === "mock"
        ? mockClient
        : createClient(env.ENGINEX_BASE_URL!, env.ENGINEX_API_KEY!); // presence checked in env.ts
  }
  return instance;
}

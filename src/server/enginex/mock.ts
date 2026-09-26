import "server-only";
import { EngineXError, type EngineXClient, type Run, type RunStep } from "./types";

// ENGINEX_MODE=mock. Stateless so web and worker processes agree: the run id encodes the
// start time and scenario, and progress is derived from elapsed time.
// Scenario from the input's playerName: contains "fail" → fails at OCR, "timeout" → never finishes.

const STEPS: { step: string; engine: string; ms: number; items?: number }[] = [
  { step: "download", engine: "ytdlp", ms: 3000 },
  { step: "frames", engine: "ffmpeg", ms: 2000 },
  { step: "read_feed", engine: "ocr", ms: 6000, items: 12 },
  { step: "find_kills", engine: "vllm", ms: 2000 },
  { step: "plan_edit", engine: "vllm", ms: 2000 },
  { step: "render", engine: "ffmpeg", ms: 4000 },
];
const TOTAL_MS = STEPS.reduce((a, s) => a + s.ms, 0);

type Scenario = "ok" | "fail" | "timeout";

export function mockRunAt(runId: string, now: number): Run {
  const m = /^mock-(\d+)-(ok|fail|timeout)-/.exec(runId);
  if (!m) throw new EngineXError("not_found", "Run not found", false, 404);
  const started = Number(m[1]);
  const scenario = m[2] as Scenario;
  const elapsed = Math.max(0, now - started);

  let t = 0;
  const steps: RunStep[] = [];
  let failed = false;
  for (const s of STEPS) {
    const into = elapsed - t;
    const stuck = scenario === "timeout" && s.step === "read_feed";
    const fails = scenario === "fail" && s.step === "read_feed" && into >= s.ms / 2;
    let status = into <= 0 || failed ? "queued" : into >= s.ms && !stuck ? "succeeded" : "running";
    if (fails) {
      status = "failed";
      failed = true;
    }
    const done = s.items ? Math.min(s.items, Math.floor((Math.max(0, into) / s.ms) * s.items)) : 0;
    steps.push({
      step: s.step,
      engine: s.engine,
      status,
      error: fails ? "ocr: worker exited with code 137 (out of memory)" : null,
      items: s.items ? { total: s.items, done: stuck ? Math.min(done, s.items - 1) : done, failed: 0 } : null,
    });
    t += s.ms;
  }

  if (failed) {
    return { runId, status: "failed", steps, output: null, error: "step read_feed failed: ocr worker exited with code 137", runMs: elapsed };
  }
  if (scenario === "ok" && elapsed >= TOTAL_MS) {
    return {
      runId,
      status: "succeeded",
      steps,
      output: { montage: `mock/${runId}/montage.mp4`, clips: [], totalKills: 7, title: "Mock montage" },
      error: null,
      runMs: TOTAL_MS,
    };
  }
  return { runId, status: elapsed === 0 ? "queued" : "running", steps, output: null, error: null, runMs: null };
}

export const mockClient: EngineXClient = {
  async runPipeline(_templateId, input, idempotencyKey) {
    const name = String(input.playerName ?? "").toLowerCase();
    const scenario: Scenario = name.includes("timeout") ? "timeout" : name.includes("fail") ? "fail" : "ok";
    return { runId: `mock-${Date.now()}-${scenario}-${idempotencyKey}` };
  },
  async getRun(runId) {
    return mockRunAt(runId, Date.now());
  },
  async cancelRun() {},
  async signOutput(keys) {
    // A public sample clip so the result page has something to play in dev.
    return Object.fromEntries(keys.map((k) => [k, "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4"]));
  },
  async createUploadUrl(filename) {
    return { url: "http://localhost:3000/__mock_upload", key: `mock/uploads/${Date.now()}-${filename}` };
  },
  async getPipeline(templateId) {
    return {
      id: templateId,
      etag: "mock",
      published: true,
      compiles: true,
      inputs: ["youtubeUrl", "playerName", "durationSec", "songUrl", "songStart", "songEnd", "lyricsLrc"],
      issues: [],
      raw: {},
    };
  },
  async fleetStatus() {
    const engines = Object.fromEntries(STEPS.map((s) => [s.engine, { tiers: ["cpu"] }]));
    return { engines, raw: engines };
  },
};

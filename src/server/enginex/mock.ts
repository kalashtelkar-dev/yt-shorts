import "server-only";
import { env } from "@/config/env";
import { EngineXError, type EngineXClient, type Run, type RunStep } from "./types";

// ENGINEX_MODE=mock. Stateless so web and worker processes agree: the run id encodes the
// start time and scenario, and progress is derived from elapsed time.
// Scenario from the input's playerName: contains "fail" → fails at OCR, "timeout" → never finishes.

// Step names and outputs mirror the real pipelines. The run id also says which pipeline kind ran:
// "single" (the one-run Kill Montage), or the staged ones: "gameplay" (gameplay-index), "song" (song-index), "style".
type MockKind = "single" | "gameplay" | "song" | "style";
type MockStep = { step: string; engine: string; ms: number; items?: number };
const STEPS: Record<MockKind, MockStep[]> = {
  single: [
    { step: "download", engine: "ytdlp", ms: 3000 },
    { step: "kill_feed", engine: "ffmpeg", ms: 2000 },
    { step: "feed_frames", engine: "ffmpeg", ms: 1000 },
    { step: "read_feed", engine: "ocr", ms: 6000, items: 12 },
    { step: "find_kills", engine: "vllm", ms: 3000 },
    { step: "make_montage", engine: "ffmpeg", ms: 4000 },
  ],
  gameplay: [
    { step: "download", engine: "media-fetch", ms: 3000 },
    { step: "kill_feed", engine: "video", ms: 2000 },
    { step: "feed_frames", engine: "video", ms: 1000 },
    { step: "read_feed", engine: "ocr", ms: 6000, items: 12 },
    { step: "find_kills", engine: "llm", ms: 2000 },
    { step: "flex_pick", engine: "llm", ms: 2000 },
  ],
  song: [
    { step: "music", engine: "media-fetch", ms: 2000 },
    { step: "vocals", engine: "transcribe", ms: 2000 },
    { step: "lyrics", engine: "transcribe", ms: 2000 },
  ],
  style: [
    { step: "plan", engine: "llm", ms: 2000 },
    { step: "make_montage", engine: "video", ms: 4000 },
  ],
};
const ALL_STEPS = Object.values(STEPS).flat();

function outputFor(kind: MockKind, runId: string): Record<string, unknown> {
  if (kind === "gameplay") {
    return { video: `mock/${runId}/video.mp4`, durationSec: 1800, title: "Mock match",
      kills: { kills: [{ t: 51 }, { t: 157 }, { t: 249 }, { t: 293 }, { t: 591 }], totalKills: 5 }, flex: { flex: [{ start: 20, what: "knife out" }] } };
  }
  if (kind === "song") {
    return { audio: `mock/${runId}/song.m4a`, durationSec: 22, title: "Mock song", loudness: "0.000000,-30.0\n0.250000,-20.0",
      segments: [{ start: 1.0, end: 1.9, text: "so cool", words: [{ word: "so", start: 1.0, end: 1.3, score: 0.9 }, { word: "cool", start: 1.4, end: 1.9, score: 0.9 }] }],
      voice: [{ start: 1.0, end: 1.9 }] };
  }
  if (kind === "style") {
    return { montage: `mock/${runId}/montage.mp4`, thumbnail: `mock/${runId}/thumbnail.jpg`, plan: { totalKills: 5, clips: [{ id: 1, start: 20, len: 3, speed: 1, role: "flex" }] } };
  }
  return { montage: `mock/${runId}/montage.mp4`, clips: [], totalKills: 7, title: "Mock montage" };
}

type Scenario = "ok" | "fail" | "timeout";

export function mockRunAt(runId: string, now: number): Run {
  const m = /^mock-(\d+)-(ok|fail|timeout)-(?:(single|gameplay|song|style)-)?/.exec(runId);
  if (!m) throw new EngineXError("not_found", "Run not found", false, 404);
  const started = Number(m[1]);
  const scenario = m[2] as Scenario;
  const kind = (m[3] ?? "single") as MockKind;
  const plan = STEPS[kind];
  const total = plan.reduce((a, s) => a + s.ms, 0);
  const failAt = plan.find((s) => s.step === "read_feed") ?? plan[plan.length - 1];
  const elapsed = Math.max(0, now - started);

  let t = 0;
  const steps: RunStep[] = [];
  let failed = false;
  for (const s of plan) {
    const into = elapsed - t;
    const stuck = scenario === "timeout" && s === failAt;
    const fails = scenario === "fail" && s === failAt && into >= s.ms / 2;
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
      error: fails ? `${s.engine}: worker exited with code 137 (out of memory)` : null,
      items: s.items ? { total: s.items, done: stuck ? Math.min(done, s.items - 1) : done, failed: 0 } : null,
    });
    t += s.ms;
  }

  if (failed) {
    return { runId, status: "failed", steps, output: null, error: `step ${failAt.step} failed: worker exited with code 137`, runMs: elapsed };
  }
  if (scenario === "ok" && elapsed >= total) {
    return { runId, status: "succeeded", steps, output: outputFor(kind, runId), error: null, runMs: total };
  }
  return { runId, status: elapsed === 0 ? "queued" : "running", steps, output: null, error: null, runMs: null };
}

// The staged pipelines (pipelines/README.md), so the mock answers getPipeline like Engine X would.
const STAGED: Record<string, "gameplay" | "gameplay-upload" | "song" | "style" | "style-lyrical"> = {
  tpl_yYsSXHkQXJBP: "gameplay", tpl_K6Lo3rwFya4A: "gameplay-upload", tpl_8nvlocGpQ3nT: "song",
  tpl_P0krMNymIjdb: "style", tpl_UbAzXGQjRxHH: "style-lyrical", tpl_vHJuWtlDPYYj: "style-lyrical",
};
const STYLE_INPUTS = ["video", "kills", "flex", "gameDurationSec", "audio", "songDurationSec", "loudness", "maxDurationSec", "variation"];
function mockInputs(templateId: string): string[] {
  switch (STAGED[templateId]) {
    case "gameplay": return ["youtubeUrl", "playerName"];
    case "gameplay-upload": return ["video", "playerName"];
    case "song": return ["musicUrl"];
    case "style": return STYLE_INPUTS;
    case "style-lyrical": return [...STYLE_INPUTS, "lines", "lyricLook"];
  }
  if (templateId === "tpl_fgi2j31DHK_M" || templateId.includes("lyric")) return ["youtubeUrl", "playerName", "songUrl", "songStart", "songEnd", "lyricsLrc"];
  if (templateId === "tpl_24XhRunrxRjQ" || templateId.includes("upload")) return ["video", "videoTitle", "playerName", "durationSec"];
  return ["youtubeUrl", "playerName", "durationSec"];
}

/** Which pipeline ran, from its template id (the staged ones are listed above); anything else is the one-run style. */
function kindOf(templateId: string): MockKind {
  const k = STAGED[templateId];
  return k === "gameplay" || k === "gameplay-upload" ? "gameplay" : k === "song" ? "song" : k ? "style" : "single";
}

export const mockClient: EngineXClient = {
  async runPipeline(templateId, input, idempotencyKey) {
    const hint = String(input.playerName ?? input.musicUrl ?? "").toLowerCase();
    const scenario: Scenario = hint.includes("timeout") ? "timeout" : hint.includes("fail") ? "fail" : "ok";
    return { runId: `mock-${Date.now()}-${scenario}-${kindOf(templateId)}-${idempotencyKey}` };
  },
  async getRun(runId) {
    return mockRunAt(runId, Date.now());
  },
  async cancelRun() {},
  async retryRun() {}, // the mock's failure is permanent, so a retried run fails again
  async signOutput(keys) {
    // A public sample clip so the result page has something to play in dev; a plain 9:16 image for a cover still.
    const still = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 9 16"><rect width="9" height="16" fill="#1f1f1f"/></svg>');
    return Object.fromEntries(keys.map((k) => [k, k.endsWith(".jpg") ? still : "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4"]));
  },
  async createUploadUrl(filename) {
    // Accepted and discarded by /api/mock-upload (mock mode only).
    return { url: new URL("/api/mock-upload", env.APP_URL).toString(), key: `mock/uploads/${Date.now()}-${filename.replace(/[^\w.-]/g, "_")}` };
  },
  async getPipeline(templateId) {
    // Test hooks: ids containing "missing" don't exist, "draft" were never published.
    if (templateId.includes("missing")) throw new EngineXError("not_found", "pipeline not found", false, 404);
    return {
      id: templateId,
      name: "mock-pipeline",
      etag: "mock",
      version: 1,
      publishedVersion: templateId.includes("draft") ? null : 1,
      compiles: true,
      // Mirrors the real pipelines: the Lyrical template also takes the song inputs.
      inputs: mockInputs(templateId).map((name) => ({ name, type: "text", required: name !== "lyricsLrc" && name !== "videoTitle" })),
      outputs: STAGED[templateId] === "gameplay" ? ["video", "durationSec", "kills", "flex", "title"]
        : STAGED[templateId] === "song" ? ["audio", "durationSec", "loudness", "words", "title"]
        : STAGED[templateId] ? ["montage", "plan"] : ["montage", "clips", "totalKills", "title"],
      issues: [],
      raw: { graph: { nodes: STEPS.single.map((st) => ({ id: st.step, kind: "engine", engine: st.engine })) } },
    };
  },
  async fleetStatus() {
    const available = Object.fromEntries(ALL_STEPS.map((s) => [s.engine, ["cpu"]]));
    return { known: Object.keys(available), available, raw: { available } };
  },
};

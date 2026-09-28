// Dev tool for editing Engine X pipelines (run by a person, never by the app).
// The app itself only reads pipelines (CLAUDE.md §4.9); edits go through this script so every change is deliberate.
//
//   pnpm enginex:pipeline get <templateId>             → .pipelines/<templateId>.json (graph + etag)
//   pnpm enginex:pipeline nodes                        → .pipelines/nodes.json (the node palette)
//   pnpm enginex:pipeline export <templateId>          → .pipelines/<templateId>.export.json (portable document)
//   pnpm enginex:pipeline import <file>                → creates a NEW unpublished pipeline from a document
//   pnpm enginex:pipeline validate <file>              → compile check, issues or plan
//   pnpm enginex:pipeline save <templateId> <file>     → replace the draft (needs the etag from `get`; 409 if it moved)
//   pnpm enginex:pipeline publish <templateId> [etag]  → make the draft the version /v1/run executes
//   pnpm enginex:pipeline runs [templateId]            → .pipelines/runs.json (recent runs, read-only)
//   pnpm enginex:pipeline run <runId>                  → .pipelines/run-<runId>.json (steps and outputs, read-only)
//   pnpm enginex:pipeline job <jobId>                  → .pipelines/job-<jobId>.json (one step's engine job, read-only)
//   pnpm enginex:pipeline start <templateId> '<json>'  → starts a run of a published pipeline (dev analysis only; uses compute)
//   pnpm enginex:pipeline fetch <storageKey> <file>    → downloads a run's output file (via a 10-minute signed link)
//   pnpm enginex:pipeline cancel <runId>               → cancels a run (stops its compute)
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const base = process.env.ENGINEX_BASE_URL;
// Saving and publishing need an Engine X admin key. Keep it separate from the app's run-only key:
// ENGINEX_ADMIN_KEY is read only by this script, never by the app.
const key = process.env.ENGINEX_ADMIN_KEY || process.env.ENGINEX_API_KEY;
if (!base || !key) {
  console.error("ENGINEX_BASE_URL and ENGINEX_ADMIN_KEY (or ENGINEX_API_KEY for read-only commands) must be set (.env)");
  process.exit(1);
}

async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(new URL(path, base), {
    method,
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {}
  return { status: res.status, data };
}

const [cmd, a, b] = process.argv.slice(2);
// Prints the first 6000 characters; the full response is always in .pipelines/last-response.json.
const show = (x: unknown) => {
  mkdirSync(".pipelines", { recursive: true });
  writeFileSync(".pipelines/last-response.json", JSON.stringify(x, null, 2));
  console.log(JSON.stringify(x, null, 2).slice(0, 6000));
};

if (cmd === "get" && a) {
  const r = await call("GET", `/v1/pipelines/${encodeURIComponent(a)}`);
  if (r.status !== 200) {
    show(r);
    process.exit(1);
  }
  mkdirSync(".pipelines", { recursive: true });
  writeFileSync(`.pipelines/${a}.json`, JSON.stringify(r.data, null, 2));
  const d = r.data as { name?: string; version?: number; currentVersion?: number; etag?: string; compiles?: boolean };
  console.log(`Saved .pipelines/${a}.json  "${d.name}" head v${d.version} published v${d.currentVersion} etag ${d.etag} compiles=${d.compiles}`);
} else if (cmd === "nodes") {
  const r = await call("GET", "/v1/pipelines/nodes");
  mkdirSync(".pipelines", { recursive: true });
  writeFileSync(".pipelines/nodes.json", JSON.stringify(r.data, null, 2));
  console.log(`Saved .pipelines/nodes.json (HTTP ${r.status})`);
} else if (cmd === "export" && a) {
  const r = await call("GET", `/v1/pipelines/${encodeURIComponent(a)}/export`);
  mkdirSync(".pipelines", { recursive: true });
  writeFileSync(`.pipelines/${a}.export.json`, typeof r.data === "string" ? r.data : JSON.stringify(r.data, null, 2));
  console.log(`HTTP ${r.status}, saved .pipelines/${a}.export.json`);
} else if (cmd === "import" && a) {
  // Creates a NEW pipeline (new id, unpublished v1) from an exported document; publish it in the dashboard.
  show(await call("POST", "/v1/pipelines/import", JSON.parse(readFileSync(a, "utf8"))));
} else if (cmd === "validate" && a) {
  const file = JSON.parse(readFileSync(a, "utf8")) as { graph: unknown };
  show(await call("POST", "/v1/pipelines/validate", { graph: file.graph }));
} else if (cmd === "save" && a && b) {
  const file = JSON.parse(readFileSync(b, "utf8")) as { graph: unknown; etag: string };
  show(await call("PUT", `/v1/pipelines/${encodeURIComponent(a)}`, { graph: file.graph, etag: file.etag }, { "If-Match": file.etag }));
} else if (cmd === "publish" && a) {
  show(await call("POST", `/v1/pipelines/${encodeURIComponent(a)}/publish`, b ? { etag: b } : {}, b ? { "If-Match": b } : {}));
} else if (cmd === "runs") {
  const r = await call("GET", `/v1/runs${a ? `?templateId=${encodeURIComponent(a)}` : ""}`);
  mkdirSync(".pipelines", { recursive: true });
  writeFileSync(".pipelines/runs.json", JSON.stringify(r.data, null, 2));
  console.log(`HTTP ${r.status}, saved .pipelines/runs.json`);
} else if (cmd === "run" && a) {
  const r = await call("GET", `/v1/runs/${encodeURIComponent(a)}`);
  mkdirSync(".pipelines", { recursive: true });
  writeFileSync(`.pipelines/run-${a}.json`, JSON.stringify(r.data, null, 2));
  console.log(`HTTP ${r.status}, saved .pipelines/run-${a}.json`);
} else if (cmd === "job" && a) {
  const r = await call("GET", `/v1/jobs/${encodeURIComponent(a)}`);
  mkdirSync(".pipelines", { recursive: true });
  writeFileSync(`.pipelines/job-${a}.json`, JSON.stringify(r.data, null, 2));
  console.log(`HTTP ${r.status}, saved .pipelines/job-${a}.json`);
} else if (cmd === "start" && a && b) {
  const r = await call("POST", `/v1/run/${encodeURIComponent(a)}`, JSON.parse(b));
  show(r);
} else if (cmd === "cancel" && a) {
  const r = await call("DELETE", `/v1/runs/${encodeURIComponent(a)}`);
  console.log(`HTTP ${r.status}, cancel ${a}`);
} else if (cmd === "fetch" && a && b) {
  // Never print the signed URL (CLAUDE.md §4.3); just save the file.
  const r = await call("POST", "/v1/outputs/sign", { keys: [a], expiresSec: 600 });
  const url = JSON.stringify(r.data).match(/"(https?:\/\/[^"]+)"/)?.[1]; // first link, whatever the response shape
  if (!url) { console.error(`HTTP ${r.status}: no signed URL in the response`); process.exit(1); }
  const res = await fetch(url, { signal: AbortSignal.timeout(300_000) });
  if (!res.ok) { console.error(`HTTP ${res.status}: the file isn't available (outputs expire)`); process.exit(1); }
  writeFileSync(b, Buffer.from(await res.arrayBuffer()));
  console.log(`HTTP ${res.status}, saved ${b}`);
} else {
  console.error("Usage: pnpm enginex:pipeline get|validate|save|publish …  (see the top of scripts/enginex-pipeline.mts)");
  process.exit(1);
}

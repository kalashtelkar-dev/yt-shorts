// pnpm enginex:smoke — checks Engine X connectivity and prints each catalog pipeline's inputs.
// Prints response shapes, never the key or signed URLs. Full pipeline JSON goes to .smoke/<slug>.json.
import { mkdirSync, writeFileSync } from "node:fs";
import { catalogSeed } from "@/db/catalog-seed";
import { enginex } from "@/server/enginex/client";

type Node = Record<string, unknown>;
const client = enginex();
let failed = false;
mkdirSync(".smoke", { recursive: true });

try {
  const t = Date.now();
  const fleet = await client.fleetStatus();
  const missing = fleet.known.filter((e) => !fleet.available[e]);
  console.log(`✓ fleetStatus ${Date.now() - t} ms — ${Object.keys(fleet.available).length}/${fleet.known.length} engines live`);
  if (missing.length) console.log(`  no workers: ${missing.join(", ")}`);
} catch (e) {
  failed = true;
  console.error("✗ fleetStatus", e);
}

// Every pipeline a job runs: the styles and the index pipelines they stage (deduped).
const templates = new Map<string, string>();
for (const item of catalogSeed) {
  templates.set(item.templateId, item.slug);
  for (const [k, id] of Object.entries(item.indexTemplates ?? {})) if (id) templates.set(id, `index:${k}`);
}

for (const [templateId, slug] of templates) {
  const item = { templateId, slug };
  try {
    const p = await client.getPipeline(item.templateId);
    if (process.env.ENGINEX_MODE !== "mock") writeFileSync(`.smoke/${item.slug}.json`, JSON.stringify(p.raw, null, 2)); // don't overwrite real dumps with mock data
    console.log(`\n✓ ${item.slug} (${item.templateId}) "${p.name}" head=v${p.version} published=v${p.publishedVersion ?? "none"} compiles=${p.compiles}`);
    if (p.version !== p.publishedVersion) console.log("  ⚠ head is an unpublished draft; runs use the published version");
    console.log(`  inputs: ${p.inputs.map((i) => `${i.name}${i.required ? "*" : ""}:${i.type}`).join(", ")}  outputs: ${p.outputs.join(", ")}`);
    const nodes = ((p.raw as { graph?: { nodes?: Node[] } }).graph?.nodes ?? []) as Node[];
    console.log(`  nodes (${nodes.length}):`);
    for (const n of nodes) {
      const scalars = Object.entries(n)
        .filter(([k, v]) => k !== "id" && k !== "position" && (typeof v !== "object" || v === null))
        .map(([k, v]) => `${k}=${String(v)}`);
      const data = n.data && typeof n.data === "object" ? n.data : n.params && typeof n.params === "object" ? n.params : {};
      const dataStr = JSON.stringify(data);
      console.log(`    ${String(n.id).padEnd(24)} ${scalars.join(" ")}  ${dataStr.length > 140 ? dataStr.slice(0, 140) + "…" : dataStr}`);
    }
  } catch (e) {
    failed = true;
    console.error(`✗ ${item.slug} (${item.templateId})`, e);
  }
}

process.exit(failed ? 1 : 0);

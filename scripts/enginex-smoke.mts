// pnpm enginex:smoke — checks Engine X connectivity and prints each catalog pipeline's inputs.
// Prints response shapes, never the key or signed URLs.
import { catalogSeed } from "@/db/catalog-seed";
import { enginex } from "@/server/enginex/client";

const client = enginex();
const clip = (v: unknown, n = 3000) => {
  const s = JSON.stringify(v, null, 2);
  return s.length > n ? `${s.slice(0, n)}\n… (${s.length} chars)` : s;
};

let failed = false;

try {
  const t = Date.now();
  const fleet = await client.fleetStatus();
  console.log(`✓ fleetStatus ${Date.now() - t} ms — engines: ${Object.keys(fleet.engines).join(", ")}`);
  console.log(clip(fleet.raw, 1500));
} catch (e) {
  failed = true;
  console.error("✗ fleetStatus", e);
}

for (const item of catalogSeed) {
  try {
    const p = await client.getPipeline(item.templateId);
    const mapped = Object.keys(item.inputMap ?? {});
    const unmapped = p.inputs.length ? mapped.filter((k) => !p.inputs.includes(k)) : [];
    console.log(`\n✓ ${item.slug} (${item.templateId}) published=${p.published} compiles=${p.compiles}`);
    console.log(`  inputs (parsed): ${p.inputs.join(", ") || "(none parsed — see raw below)"}`);
    if (unmapped.length) console.log(`  ⚠ inputMap targets not in pipeline: ${unmapped.join(", ")}`);
    console.log(`  raw top-level keys: ${Object.keys(p.raw as object).join(", ")}`);
    console.log(clip(p.raw));
  } catch (e) {
    failed = true;
    console.error(`✗ ${item.slug} (${item.templateId})`, e);
  }
}

process.exit(failed ? 1 : 0);

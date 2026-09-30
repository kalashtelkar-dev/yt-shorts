// pnpm catalog:sync — points existing catalog items at the pipeline ids in src/db/catalog-seed.ts (the ids in
// pipelines/README.md), and creates seed items that aren't in the catalog yet (a new style). Goes through the admin save,
// so each change is validated against Engine X, keeps a revision and writes the audit log. For existing items only the
// template ids and the stage labels (they name the pipelines' steps) change; prices, fields and the rest stay as admins
// set them.
import { db } from "@/db/client";
import { catalogSeed } from "@/db/catalog-seed";
import { catalogInput, saveCatalogItem } from "@/server/admin/catalog";

const admin = await db.user.findFirst({ where: { role: "admin", isAnonymous: false }, select: { id: true, email: true, name: true } });
if (!admin) {
  console.error("No admin account yet. Run pnpm admin:create first.");
  process.exit(1);
}
const keys = Object.keys(catalogInput.innerType?.().shape ?? catalogInput.shape);
for (const seed of catalogSeed) {
  const row = await db.catalogItem.findUnique({ where: { slug: seed.slug } });
  if (!row) {
    const input = Object.fromEntries(keys.filter((k) => k in seed).map((k) => [k, (seed as Record<string, unknown>)[k]]));
    const r = await saveCatalogItem(admin, null, input);
    console.log(r.ok ? `${seed.slug}: created (errors ${r.data.report?.errors.length ?? 0}, warnings ${r.data.report?.warnings.length ?? 0})` : `${seed.slug}: REFUSED, ${r.error.message}`);
    continue;
  }
  const ids = { templateId: seed.templateId, uploadTemplateId: seed.uploadTemplateId ?? null, indexTemplates: seed.indexTemplates ?? null, stageMap: seed.stageMap };
  const index = (t: typeof ids.indexTemplates) => (t ? [t.gameplay, t.gameplayUpload ?? null, t.song, t.songUpload ?? null].join() : ""); // jsonb reorders keys
  const stages = (m: unknown) => JSON.stringify((Array.isArray(m) ? m : []).map((e) => [e.match, e.label, e.itemSeconds ?? null, e.only ?? null]));
  if (ids.templateId === row.templateId && ids.uploadTemplateId === row.uploadTemplateId && index(ids.indexTemplates) === index(row.indexTemplates) && stages(ids.stageMap) === stages(row.stageMap)) {
    console.log(`${seed.slug}: up to date`);
    continue;
  }
  const input = Object.fromEntries(keys.map((k) => [k, (row as Record<string, unknown>)[k]]));
  const r = await saveCatalogItem(admin, row.id, { ...input, ...ids });
  console.log(r.ok ? `${seed.slug}: updated (errors ${r.data.report?.errors.length ?? 0}, warnings ${r.data.report?.warnings.length ?? 0})` : `${seed.slug}: REFUSED, ${r.error.message}`);
}
process.exit(0);

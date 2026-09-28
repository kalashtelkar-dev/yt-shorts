// pnpm catalog:sync — points existing catalog items at the pipeline ids in src/db/catalog-seed.ts (the ids in
// pipelines/README.md). Goes through the admin save, so each change is validated against Engine X, keeps a revision
// and writes the audit log. Only template ids change; prices, fields and the rest stay as admins set them.
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { catalogSeed } from "@/db/catalog-seed";
import { catalogItems, users } from "@/db/schema";
import { catalogInput, saveCatalogItem } from "@/server/admin/catalog";

const [admin] = await db
  .select({ id: users.id, email: users.email, name: users.name })
  .from(users)
  .where(and(eq(users.role, "admin"), eq(users.isAnonymous, false)))
  .limit(1);
if (!admin) {
  console.error("No admin account yet. Run pnpm admin:create first.");
  process.exit(1);
}
const keys = Object.keys(catalogInput.innerType?.().shape ?? catalogInput.shape);
for (const seed of catalogSeed) {
  const [row] = await db.select().from(catalogItems).where(eq(catalogItems.slug, seed.slug));
  if (!row) {
    console.log(`${seed.slug}: not in the catalog (pnpm db:seed adds it)`);
    continue;
  }
  const ids = { templateId: seed.templateId, uploadTemplateId: seed.uploadTemplateId ?? null, indexTemplates: seed.indexTemplates ?? null };
  const index = (t: typeof ids.indexTemplates) => (t ? [t.gameplay, t.gameplayUpload ?? null, t.song].join() : ""); // jsonb reorders keys
  if (ids.templateId === row.templateId && ids.uploadTemplateId === row.uploadTemplateId && index(ids.indexTemplates) === index(row.indexTemplates)) {
    console.log(`${seed.slug}: up to date`);
    continue;
  }
  const input = Object.fromEntries(keys.map((k) => [k, (row as Record<string, unknown>)[k]]));
  const r = await saveCatalogItem(admin, row.id, { ...input, ...ids });
  console.log(r.ok ? `${seed.slug}: updated (errors ${r.data.report?.errors.length ?? 0}, warnings ${r.data.report?.warnings.length ?? 0})` : `${seed.slug}: REFUSED, ${r.error.message}`);
}
process.exit(0);

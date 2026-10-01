// npm run db:seed — idempotent: inserts catalog items and the settings row if missing.
import type { Prisma } from "@/generated/prisma/client";
import { catalogSeed } from "./catalog-seed";
import { db } from "./client";

await db.settings.createMany({ data: [{ id: 1 }], skipDuplicates: true });
const inserted = await db.catalogItem.createManyAndReturn({ data: catalogSeed as Prisma.CatalogItemCreateManyInput[], skipDuplicates: true, select: { slug: true } });

console.log(`settings ready; catalog inserted: ${inserted.map((r) => r.slug).join(", ") || "none (already seeded)"}`);
process.exit(0);

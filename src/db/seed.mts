// pnpm db:seed — idempotent: inserts catalog items and the settings row if missing.
import { catalogSeed } from "./catalog-seed";
import { db } from "./index";
import { catalogItems, settings } from "./schema";

await db.insert(settings).values({ id: 1 }).onConflictDoNothing();
const inserted = await db.insert(catalogItems).values(catalogSeed).onConflictDoNothing({ target: catalogItems.slug }).returning({ slug: catalogItems.slug });

console.log(`settings ready; catalog inserted: ${inserted.map((r) => r.slug).join(", ") || "none (already seeded)"}`);
process.exit(0);

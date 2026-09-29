import { asc, eq } from "drizzle-orm";
import { CreateForm } from "@/components/create-form";
import { db } from "@/db";
import { catalogItems } from "@/db/schema";
import type { CatalogOption } from "@/lib/jobs";
import { env } from "@/config/env";
import { getViewer, viewerBalance } from "@/server/session";
import { getSettings } from "@/server/settings";

export default async function CreatePage() {
  const [viewer, rows] = await Promise.all([
    getViewer(),
    db
      .select({
        slug: catalogItems.slug,
        title: catalogItems.title,
        description: catalogItems.description,
        beta: catalogItems.beta,
        durations: catalogItems.durations,
        prices: catalogItems.prices,
        fields: catalogItems.fields,
        uploadTemplateId: catalogItems.uploadTemplateId,
        indexTemplates: catalogItems.indexTemplates,
      })
      .from(catalogItems)
      .where(eq(catalogItems.enabled, true))
      .orderBy(asc(catalogItems.sortOrder)),
  ]);
  const [settings, balance] = await Promise.all([getSettings(), viewerBalance(viewer)]);
  const needsAccount = env.AUTH_MODE === "full" && (!viewer || !!viewer.isAnonymous);
  // Only lengths that have a price can be picked.
  const items: CatalogOption[] = rows
    .map(({ uploadTemplateId, indexTemplates, ...r }) => ({ ...r, uploads: !!(uploadTemplateId || indexTemplates?.gameplayUpload), durations: r.durations.filter((d) => (r.prices[String(d)] ?? 0) > 0) }))
    .filter((r) => r.durations.length > 0);

  const intro = (
    <div className="flex flex-col gap-3">
      <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">Turn your match into a montage</h1>
      <p className="text-muted-foreground">Paste a gameplay link and your in-game name. We find your kills and cut them into a 9:16 edit you can post.</p>
    </div>
  );

  return items.length ? (
    <CreateForm items={items} balance={balance} intro={intro} maxUploadMb={settings.maxUploadMb} needsAccount={needsAccount} starterCredits={settings.starterCredits} />
  ) : (
    <div className="flex max-w-lg flex-col gap-8">
      {intro}
      <p className="rounded-xl border bg-panel p-4 text-muted-foreground">Montages are paused for maintenance. Check back in a few minutes.</p>
    </div>
  );
}

import "server-only";
import { CreateForm } from "@/components/create-form";
import { db } from "@/db/client";
import type { CatalogOption } from "@/lib/jobs";
import { env } from "@/config/env";
import { availableCredits } from "@/server/credits";
import { getViewer, viewerBalance } from "@/server/session";
import { getSettings } from "@/server/settings";

/** The Create page: the style picker and form. Rendered at /create, and at / for people who already use the app. */
export async function CreatePage() {
  const [viewer, rows] = await Promise.all([
    getViewer(),
    db.catalogItem.findMany({
      select: { slug: true, title: true, description: true, beta: true, durations: true, creditRanges: true, fields: true, uploadTemplateId: true, indexTemplates: true },
      where: { enabled: true },
      orderBy: { sortOrder: "asc" },
    }),
  ]);
  const [settings, balance, available] = await Promise.all([getSettings(), viewerBalance(viewer), viewer ? availableCredits(viewer.id) : Promise.resolve(0)]);
  const needsAccount = env.AUTH_MODE === "full" && (!viewer || !!viewer.isAnonymous);
  // Only lengths that have a price can be picked.
  const items: CatalogOption[] = rows
    .map(({ uploadTemplateId, indexTemplates, ...r }) => ({ ...r, uploads: !!(uploadTemplateId || indexTemplates?.gameplayUpload), durations: r.durations.filter((d) => (r.creditRanges[String(d)]?.max ?? 0) > 0) }))
    .filter((r) => r.durations.length > 0);

  const intro = (
    <div className="flex flex-col gap-3">
      <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">Turn your match into a montage</h1>
      <p className="text-muted-foreground">Paste a gameplay link and your in-game name. We find your kills and turn them into a short vertical video you can post.</p>
    </div>
  );

  return items.length ? (
    <CreateForm items={items} available={viewer ? available : balance} intro={intro} maxUploadMb={settings.maxUploadMb} needsAccount={needsAccount} starterCredits={settings.starterCredits} canBuy={env.PAYMENTS_ENABLED && env.AUTH_MODE === "full"} />
  ) : (
    <div className="flex max-w-lg flex-col gap-8">
      {intro}
      <p className="rounded-xl border bg-panel p-4 text-muted-foreground">Montages are paused for maintenance. Check back in a few minutes.</p>
    </div>
  );
}

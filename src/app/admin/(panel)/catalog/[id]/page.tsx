import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { deleteCatalogAction } from "@/app/admin/actions";
import { ActionForm } from "@/components/admin/action-form";
import { Empty, PAGE_SIZE, PageHeader, Pager, pageOf, pageParam, Panel } from "@/components/admin/bits";
import { CatalogForm } from "@/components/admin/catalog-form";
import { formatWhen } from "@/lib/format";
import { catalogItemWithRevisions } from "@/server/admin/catalog";
import { requireAdmin } from "@/server/admin/guard";

export const metadata: Metadata = { title: "Catalog item" };

const KEYS = ["title", "slug", "description", "templateId", "enabled", "beta", "sortOrder", "durations", "prices", "fields", "inputMap", "stageMap", "outputKey"] as const;

/** Which fields changed between two snapshots (newest first list). */
function changed(curr: Record<string, unknown>, prev: Record<string, unknown> | undefined) {
  if (!prev) return "created";
  const keys = KEYS.filter((k) => JSON.stringify(curr[k]) !== JSON.stringify(prev[k]));
  return keys.length ? keys.join(", ") : "no changes";
}

export default async function CatalogItemPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ page?: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const page = pageParam((await searchParams).page);
  const data = await catalogItemWithRevisions(id);
  if (!data) notFound();
  const { item, revisions } = data;
  const shown = pageOf(revisions, page);

  return (
    <>
      <PageHeader title={item.title} back={{ href: "/admin/catalog", label: "Back to catalog" }}>
        <p className="font-mono text-xs text-muted-foreground">{item.slug}</p>
      </PageHeader>
      <CatalogForm initial={{ ...item, id: item.id }} />

      <Panel title="History">
        {revisions.length === 0 ? (
          <Empty>No edits recorded yet. The first save starts the history.</Empty>
        ) : (
          <ol className="flex flex-col divide-y text-sm">
            {shown.rows.map((r, n) => {
              const i = page * PAGE_SIZE + n;
              const snap = r.snapshot as Record<string, unknown>;
              return (
                <li key={r.id} className="flex flex-col gap-1 py-2.5 sm:flex-row sm:items-baseline sm:gap-4">
                  <span className="shrink-0 font-mono text-xs text-muted-foreground tabular">{formatWhen(r.createdAt.toISOString())}</span>
                  <span className="shrink-0">{r.email ?? "unknown admin"}</span>
                  <span className="text-muted-foreground">
                    {changed(snap, revisions[i + 1]?.snapshot as Record<string, unknown> | undefined)} ·{" "}
                    <span className="font-mono text-xs">{String(snap.templateId)}</span>
                  </span>
                </li>
              );
            })}
          </ol>
        )}
        <Pager page={page} hasMore={shown.hasMore} params={{}} />
      </Panel>

      <Panel title="Delete">
        <ActionForm action={deleteCatalogAction} submitLabel="Delete this item" variant="destructive">
          <input type="hidden" name="id" value={item.id} />
          <p className="text-sm text-muted-foreground">Only possible if no job has used it. Otherwise switch it off.</p>
        </ActionForm>
      </Panel>
    </>
  );
}

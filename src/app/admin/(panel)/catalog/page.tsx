import type { Metadata } from "next";
import Link from "next/link";
import { Empty, PageHeader, Pager, pageOf, pageParam, Panel, Table } from "@/components/admin/bits";
import { buttonVariants } from "@/components/ui/button";
import { formatCredits } from "@/lib/format";
import { listCatalog, pipelinesInUse } from "@/server/admin/catalog";
import { requireAdmin } from "@/server/admin/guard";

export const metadata: Metadata = { title: "Catalog" };

export default async function CatalogPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  await requireAdmin();
  const page = pageParam((await searchParams).page);
  const items = await listCatalog();
  const shown = pageOf(items, page);
  const groups = pipelinesInUse(items);
  return (
    <>
      <PageHeader title="Catalog">
        <Link href="/admin/catalog/new" className={buttonVariants()}>
          New item
        </Link>
      </PageHeader>
      <Panel>
        {items.length === 0 ? (
          <Empty>No styles yet. Create one to let users make montages.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Style</th>
                <th>Template</th>
                <th>Prices</th>
                <th>Status</th>
                <th className="text-right">Order</th>
              </tr>
            </thead>
            <tbody>
              {shown.rows.map((i) => (
                <tr key={i.id}>
                  <td>
                    <Link href={`/admin/catalog/${i.id}`} className="font-medium hover:underline">
                      {i.title}
                    </Link>
                    <span className="block font-mono text-xs text-muted-foreground">{i.slug}</span>
                  </td>
                  <td className="font-mono text-xs">{i.templateId}</td>
                  <td className="font-mono text-xs tabular">
                    {i.durations.map((d) => `${d}s ${i.prices[String(d)] ? formatCredits(i.prices[String(d)]) : "—"}`).join(" · ")}
                  </td>
                  <td className="whitespace-nowrap">
                    {i.enabled ? <span className="text-success">Enabled</span> : <span className="text-muted-foreground">Off</span>}
                    {i.beta && <span className="ml-2 text-warning">Beta</span>}
                  </td>
                  <td className="text-right font-mono tabular">{i.sortOrder}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <Pager page={page} hasMore={shown.hasMore} params={{}} />
      </Panel>
      {groups.length > 0 && (
        <Panel title="Pipelines in use">
          <Table>
            <thead>
              <tr>
                <th>Stage</th>
                <th>Pipeline</th>
                <th>Used by</th>
              </tr>
            </thead>
            <tbody>
              {groups.flatMap(({ group, pipelines }) =>
                pipelines.map((p, n) => (
                  <tr key={`${group}:${p.templateId}`}>
                    {n === 0 && (
                      <td rowSpan={pipelines.length} className="whitespace-nowrap font-medium">
                        {group}
                      </td>
                    )}
                    <td className="font-mono text-xs">{p.templateId}</td>
                    <td className="text-muted-foreground">{p.usedBy.join(", ")}</td>
                  </tr>
                )),
              )}
            </tbody>
          </Table>
        </Panel>
      )}
    </>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { Empty, PageHeader, Panel, Table } from "@/components/admin/bits";
import { buttonVariants } from "@/components/ui/button";
import { formatCredits } from "@/lib/format";
import { listCatalog } from "@/server/admin/catalog";
import { requireAdmin } from "@/server/admin/guard";

export const metadata: Metadata = { title: "Catalog" };

export default async function CatalogPage() {
  await requireAdmin();
  const items = await listCatalog();
  return (
    <>
      <PageHeader title="Catalog">
        <Link href="/admin/catalog/new" className={buttonVariants({ variant: "secondary" })}>
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
              {items.map((i) => (
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
      </Panel>
    </>
  );
}

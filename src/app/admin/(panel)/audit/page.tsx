import type { Metadata } from "next";
import Link from "next/link";
import { Empty, PageHeader, Pager, Panel, Table } from "@/components/admin/bits";
import { formatWhen } from "@/lib/format";
import { requireAdmin } from "@/server/admin/guard";
import { auditLog } from "@/server/admin/queries";

export const metadata: Metadata = { title: "Audit log" };

function targetHref(target: string) {
  const [kind, id] = target.split(":");
  return kind === "user" ? `/admin/users/${id}` : kind === "job" ? `/admin/jobs/${id}` : null;
}

const compact = (v: unknown) => (v === null || v === undefined ? "—" : JSON.stringify(v));

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  await requireAdmin();
  const page = Math.max(0, Number((await searchParams).page) || 0);
  const { rows, hasMore } = await auditLog(page);
  return (
    <>
      <PageHeader title="Audit log" />
      <Panel>
        {rows.length === 0 ? (
          <Empty>No admin changes yet. Every credit adjustment, refund, retry, suspension and role change shows up here.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>When</th>
                <th>Admin</th>
                <th>Action</th>
                <th>Target</th>
                <th>Before → after</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ entry: a, adminEmail }) => {
                const href = targetHref(a.target);
                return (
                  <tr key={a.id}>
                    <td className="font-mono text-xs whitespace-nowrap text-muted-foreground tabular">{formatWhen(a.createdAt.toISOString())}</td>
                    <td>{adminEmail}</td>
                    <td className="font-mono text-xs">{a.action}</td>
                    <td className="font-mono text-xs">{href ? <Link href={href} className="hover:underline">{a.target.slice(0, 13)}</Link> : a.target}</td>
                    <td className="font-mono text-xs text-muted-foreground">
                      {compact(a.before)} → <span className="text-foreground">{compact(a.after)}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
        <Pager page={page} hasMore={hasMore} params={{}} />
      </Panel>
    </>
  );
}

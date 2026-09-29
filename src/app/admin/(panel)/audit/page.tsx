import type { Metadata } from "next";
import Link from "next/link";
import { Empty, PageHeader, Pager, Panel, Table } from "@/components/admin/bits";
import { changes } from "@/lib/diff";
import { formatWhen } from "@/lib/format";
import { requireAdmin } from "@/server/admin/guard";
import { auditLog } from "@/server/admin/queries";

export const metadata: Metadata = { title: "Audit log" };

function targetHref(target: string) {
  const [kind, id] = target.split(":");
  return kind === "user" ? `/admin/users/${id}` : kind === "job" ? `/admin/jobs/${id}` : kind === "catalog" ? `/admin/catalog/${id}` : null;
}

/** "catalog:6b210cdc-…" → "catalog 6b210cdc": the kind and the id's start (the full target is the link's title). */
const shortTarget = (t: string) => {
  const [kind, id] = t.split(":");
  return id ? `${kind} ${id.slice(0, 8)}` : t;
};

const pretty = (v: unknown) => (v === null || v === undefined ? "—" : JSON.stringify(v, null, 2));

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
                <th>What changed</th>
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
                    <td className="font-mono text-xs whitespace-nowrap">{href ? <Link href={href} className="hover:underline" title={a.target}>{shortTarget(a.target)}</Link> : a.target}</td>
                    <td className="min-w-[26rem]">
                      <Changes before={a.before} after={a.after} />
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

/** One short line per changed field; the full before/after records open on demand. */
function Changes({ before, after }: { before: unknown; after: unknown }) {
  const list = changes(before, after);
  return (
    <div className="flex flex-col gap-1.5">
      {list.length === 0 ? (
        <span className="text-xs text-muted-foreground">No field changed</span>
      ) : (
        <ul className="flex flex-col gap-1">
          {list.slice(0, 6).map((c) => (
            <li key={c.field} className="grid grid-cols-[minmax(0,12rem)_minmax(0,1fr)] gap-3 text-xs">
              <span className="truncate font-mono text-muted-foreground" title={c.field}>
                {c.field}
              </span>
              <span className="flex min-w-0 items-baseline gap-1.5 font-mono">
                <span className="truncate text-muted-foreground line-through decoration-muted-foreground/50" title={c.before}>
                  {c.before}
                </span>
                <span aria-label="became" className="shrink-0 text-muted-foreground">
                  →
                </span>
                <span className="truncate" title={c.after}>
                  {c.after}
                </span>
              </span>
            </li>
          ))}
          {list.length > 6 && <li className="text-xs text-muted-foreground">and {list.length - 6} more</li>}
        </ul>
      )}
      <details className="group">
        <summary className="w-fit cursor-pointer list-none rounded text-xs text-muted-foreground select-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none [&::-webkit-details-marker]:hidden">
          <span className="group-open:hidden">Show full record</span>
          <span className="hidden group-open:inline">Hide full record</span>
        </summary>
        <div className="mt-2 grid gap-2 xl:grid-cols-2">
          {(
            [
              ["Before", before],
              ["After", after],
            ] as const
          ).map(([label, v]) => (
            <div key={label} className="flex min-w-0 flex-col gap-1">
              <span className="text-xs text-muted-foreground">{label}</span>
              <pre className="max-h-64 overflow-auto rounded-lg bg-background p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-all">{pretty(v)}</pre>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}

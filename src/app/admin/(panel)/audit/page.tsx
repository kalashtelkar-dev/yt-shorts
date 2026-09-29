import type { Metadata } from "next";
import Link from "next/link";
import { X } from "lucide-react";
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
                    <td className="min-w-[16rem]">
                      <Changes id={a.id} before={a.before} after={a.after} title={`${a.action} · ${shortTarget(a.target)}`} meta={`${formatWhen(a.createdAt.toISOString())} by ${adminEmail}`} />
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

/** JSON values (lists, objects) laid out over lines; anything else as it is. */
function readable(v: string) {
  if (!/^[[{]/.test(v)) return v;
  try {
    return JSON.stringify(JSON.parse(v), null, 2);
  } catch {
    return v;
  }
}

/** The changed field names (wrapped) and a button that opens every change, in full, in a pop-up. */
function Changes({ id, before, after, title, meta }: { id: string; before: unknown; after: unknown; title: string; meta: string }) {
  const list = changes(before, after);
  const popId = `audit-${id}`;
  return (
    <div className="flex flex-col items-start gap-2">
      {list.length === 0 ? (
        <span className="text-xs text-muted-foreground">No field changed</span>
      ) : (
        <ul className="flex flex-wrap gap-1.5" aria-label="Changed fields">
          {list.slice(0, 5).map((c) => (
            <li key={c.field} className="rounded-md border bg-background px-1.5 py-0.5 font-mono text-[11px] break-all text-muted-foreground">
              {c.field}
            </li>
          ))}
          {list.length > 5 && <li className="px-1 py-0.5 text-[11px] text-muted-foreground">+{list.length - 5} more</li>}
        </ul>
      )}
      <button
        type="button"
        popoverTarget={popId}
        className="rounded text-xs text-foreground underline underline-offset-4 hover:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        View details
      </button>

      <div id={popId} popover="auto" className="m-auto max-h-[85dvh] w-[min(48rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl border bg-panel p-0 text-foreground shadow-2xl backdrop:bg-black/60">
        <div className="sticky top-0 flex items-start justify-between gap-4 border-b bg-panel px-5 py-4">
          <div className="flex min-w-0 flex-col gap-0.5">
            <h2 className="font-mono text-sm font-semibold break-all">{title}</h2>
            <span className="text-xs text-muted-foreground">{meta}</span>
          </div>
          <button
            type="button"
            popoverTarget={popId}
            popoverTargetAction="hide"
            aria-label="Close"
            className="-m-1 flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
        <div className="flex flex-col gap-5 p-5">
          {list.length > 0 && (
            <dl className="flex flex-col divide-y rounded-xl border">
              {list.map((c) => (
                <div key={c.field} className="flex flex-col gap-2 p-3">
                  <dt className="font-mono text-xs text-muted-foreground">{c.field}</dt>
                  <dd className="grid gap-2 sm:grid-cols-2">
                    <span className="flex flex-col gap-1">
                      <span className="text-[11px] text-muted-foreground">Before</span>
                      <span className="max-h-72 overflow-auto rounded-lg bg-background p-2 font-mono text-xs whitespace-pre-wrap break-all text-muted-foreground">{readable(c.before)}</span>
                    </span>
                    <span className="flex flex-col gap-1">
                      <span className="text-[11px] text-muted-foreground">After</span>
                      <span className="max-h-72 overflow-auto rounded-lg bg-background p-2 font-mono text-xs whitespace-pre-wrap break-all">{readable(c.after)}</span>
                    </span>
                  </dd>
                </div>
              ))}
            </dl>
          )}
          <details className="group">
            <summary className="w-fit cursor-pointer list-none rounded text-xs text-muted-foreground select-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none [&::-webkit-details-marker]:hidden">
              <span className="group-open:hidden">Show full records</span>
              <span className="hidden group-open:inline">Hide full records</span>
            </summary>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {(
                [
                  ["Before", before],
                  ["After", after],
                ] as const
              ).map(([label, v]) => (
                <div key={label} className="flex min-w-0 flex-col gap-1">
                  <span className="text-xs text-muted-foreground">{label}</span>
                  <pre className="max-h-80 overflow-auto rounded-lg bg-background p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-all">{pretty(v)}</pre>
                </div>
              ))}
            </div>
          </details>
        </div>
      </div>
    </div>
  );
}

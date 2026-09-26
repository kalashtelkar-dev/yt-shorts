import type { Metadata } from "next";
import Link from "next/link";
import { Empty, JobStatus, PageHeader, Pager, Panel, selectClass, Table, UserLabel } from "@/components/admin/bits";
import { Button } from "@/components/ui/button";
import { formatClock, formatCredits, formatRupees, formatWhen } from "@/lib/format";
import { requireAdmin } from "@/server/admin/guard";
import { JOB_STATUSES, listAllJobs, type JobStatus as Status } from "@/server/admin/queries";

export const metadata: Metadata = { title: "Jobs" };

type Search = { status?: string; style?: string; page?: string };

export default async function JobsPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireAdmin();
  const sp = await searchParams;
  const status = JOB_STATUSES.includes(sp.status as Status) ? (sp.status as Status) : null;
  const page = Math.max(0, Number(sp.page) || 0);
  const { rows, hasMore, slugs } = await listAllJobs(status, sp.style || null, page);

  return (
    <>
      <PageHeader title="Jobs" />
      <form className="flex flex-col gap-3 sm:flex-row">
        <select name="status" defaultValue={status ?? ""} aria-label="Status" className={`${selectClass} sm:w-44`}>
          <option value="">All statuses</option>
          {JOB_STATUSES.map((s) => (
            <option key={s} value={s} className="capitalize">
              {s}
            </option>
          ))}
        </select>
        <select name="style" defaultValue={sp.style ?? ""} aria-label="Style" className={`${selectClass} sm:w-56`}>
          <option value="">All styles</option>
          {slugs.map((s) => (
            <option key={s.slug} value={s.slug}>
              {s.title}
            </option>
          ))}
        </select>
        <Button type="submit" variant="secondary">
          Filter
        </Button>
      </form>
      <Panel>
        {rows.length === 0 ? (
          <Empty>No jobs match.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Created</th>
                <th>User</th>
                <th>Style</th>
                <th>Status</th>
                <th className="text-right">Credits</th>
                <th className="text-right">Run time</th>
                <th className="text-right">Cost</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((j) => (
                <tr key={j.id}>
                  <td className="font-mono text-xs whitespace-nowrap tabular">
                    <Link href={`/admin/jobs/${j.id}`} className="hover:underline">{formatWhen(j.createdAt.toISOString())}</Link>
                  </td>
                  <td><UserLabel id={j.userId} email={j.email} isAnonymous={j.isAnonymous} /></td>
                  <td className="whitespace-nowrap">{j.catalogSlug} · {j.durationSec} s</td>
                  <td><JobStatus status={j.status} /></td>
                  <td className="text-right font-mono tabular">{formatCredits(j.chargedCredits)}</td>
                  <td className="text-right font-mono tabular">{j.runMs ? formatClock(j.runMs) : "—"}</td>
                  <td className="text-right font-mono tabular">{j.computeCostPaise !== null ? formatRupees(j.computeCostPaise) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <Pager page={page} hasMore={hasMore} params={{ status: status ?? undefined, style: sp.style }} />
      </Panel>
    </>
  );
}

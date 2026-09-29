import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { refundAction, retryAction } from "@/app/admin/actions";
import { ActionForm } from "@/components/admin/action-form";
import { Empty, Field, JobStatus, PageHeader, Pager, pageOf, pageParam, Panel, Table, UserLabel } from "@/components/admin/bits";
import { Input } from "@/components/ui/input";
import { formatClock, formatCredits, formatRupees, formatTime, formatWhen } from "@/lib/format";
import { requireAdmin } from "@/server/admin/guard";
import { jobDetail } from "@/server/admin/queries";

export const metadata: Metadata = { title: "Job" };
export const dynamic = "force-dynamic";

export default async function AdminJobPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ep?: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const ep = pageParam((await searchParams).ep);
  const d = await jobDetail(id);
  if (!d) notFound();
  const { job } = d;
  const active = ["queued", "starting", "running"].includes(job.status);
  const refunded = d.ledger.some((l) => l.kind === "refund");
  const when = (x: Date | null) => (x ? formatWhen(x.toISOString()) : "—");

  const facts: [string, React.ReactNode][] = [
    ["Status", <JobStatus key="s" status={job.status} />],
    ["User", <UserLabel key="u" id={job.userId} email={d.email} isAnonymous={d.isAnonymous} />],
    ["Style", `${job.catalogSlug} · ${job.durationSec} s`],
    ["Template (snapshot)", <span key="t" className="font-mono text-xs">{job.templateId}</span>],
    ["Run ID", <span key="r" className="font-mono text-xs break-all">{job.runId ?? "—"}</span>],
    ["Source", <span key="src" className="break-all">{job.sourceUrl ?? job.uploadKey ?? "—"}</span>],
    ["Created / started / finished", `${when(job.createdAt)} · ${when(job.startedAt)} · ${when(job.finishedAt)}`],
    ["Run time", job.runMs ? formatClock(job.runMs) : "—"],
    ["Credits charged", `${formatCredits(job.chargedCredits)}${refunded ? " (refunded)" : ""}`],
    ["Compute cost", job.computeCostPaise !== null ? formatRupees(job.computeCostPaise) : "—"],
    ["Progress", job.stepsTotal ? `${job.stepsDone} / ${job.stepsTotal} · ${job.currentStage ?? ""}` : (job.currentStage ?? "—")],
  ];

  return (
    <>
      <PageHeader title="Job" back={{ href: `/admin/jobs?job=${id}`, label: "Back to jobs" }}>
        <p className="font-mono text-xs text-muted-foreground">{job.id}</p>
      </PageHeader>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Panel title="Details">
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_minmax(0,1fr)]">
            {facts.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="min-w-0">{v}</dd>
              </div>
            ))}
          </dl>
        </Panel>

        <Panel title="Actions">
          {active ? (
            <p className="text-sm text-muted-foreground">Refund and retry are available once the job finishes.</p>
          ) : (
            <div className="flex flex-col gap-6">
              <ActionForm action={refundAction} submitLabel={refunded ? "Already refunded" : job.chargedCredits === 0 ? "Nothing to refund" : "Refund credits"} disabled={refunded || job.chargedCredits === 0}>
                <input type="hidden" name="jobId" value={job.id} />
                <Field label="Reason">
                  <Input name="reason" required minLength={3} maxLength={500} disabled={refunded || job.chargedCredits === 0} placeholder="e.g. Kills were cut off" />
                </Field>
              </ActionForm>
              <ActionForm action={retryAction} submitLabel="Retry as a new job" variant="outline">
                <input type="hidden" name="jobId" value={job.id} />
                <p className="text-sm text-muted-foreground">Same input, current template, no charge to the user.</p>
              </ActionForm>
            </div>
          )}
        </Panel>
      </div>

      {(job.errorRaw || job.errorPublic) && (
        <Panel title="Error">
          <div className="flex flex-col gap-3 text-sm">
            {job.errorPublic && (
              <p>
                <span className="text-muted-foreground">User saw: </span>
                {job.errorPublic}
              </p>
            )}
            {job.errorRaw && <pre className="overflow-x-auto rounded-lg bg-background p-3 font-mono text-xs whitespace-pre-wrap text-danger">{job.errorRaw}</pre>}
          </div>
        </Panel>
      )}

      <Panel title="Engine X steps (live)">
        {d.stepsError ? (
          <p className="text-sm text-danger">Couldn&apos;t load steps from Engine X: {d.stepsError}</p>
        ) : !d.steps ? (
          <Empty>No run yet.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Step</th>
                <th>Engine</th>
                <th>Status</th>
                <th className="text-right">Items</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              {d.steps.map((s) => (
                <tr key={s.step}>
                  <td className="font-mono text-xs">{s.step}</td>
                  <td className="text-muted-foreground">{s.engine ?? "—"}</td>
                  <td className={s.status === "failed" ? "text-danger" : s.status === "running" ? "text-foreground" : "text-muted-foreground"}>{s.status}</td>
                  <td className="text-right font-mono text-xs tabular">{s.items ? `${s.items.done}/${s.items.total}${s.items.failed ? ` · ${s.items.failed} failed` : ""}` : ""}</td>
                  <td className="font-mono text-xs text-danger">{s.error}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel title="Input sent to Engine X">
          <pre className="overflow-x-auto rounded-lg bg-background p-3 font-mono text-xs">{JSON.stringify(job.input, null, 2)}</pre>
        </Panel>
        <Panel title="Output">
          <pre className="overflow-x-auto rounded-lg bg-background p-3 font-mono text-xs">{JSON.stringify({ outputKey: job.outputKey, ...(job.outputMeta as object | null) }, null, 2)}</pre>
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel title="Events (what the user saw)">
          <ol className="flex flex-col gap-1.5 font-mono text-xs">
            {pageOf(d.events, ep).rows.map((e) => (
              <li key={e.id} className={e.level === "error" ? "text-danger" : e.level === "warn" ? "text-warning" : "text-muted-foreground"}>
                <span className="tabular">{formatTime(e.createdAt.toISOString())}</span> <span className="font-sans">{e.message}</span>
              </li>
            ))}
          </ol>
          <Pager page={ep} hasMore={pageOf(d.events, ep).hasMore} params={{}} param="ep" />
        </Panel>
        <Panel title="Credits">
          {d.ledger.length === 0 ? (
            <Empty>No credit movements.</Empty>
          ) : (
            <ul className="flex flex-col gap-1.5 text-sm">
              {d.ledger.map((l) => (
                <li key={l.id} className="flex justify-between gap-4">
                  <span className="text-muted-foreground">
                    {l.kind} · {l.reason}
                  </span>
                  <span className="font-mono tabular">{l.delta > 0 ? `+${l.delta}` : l.delta}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}

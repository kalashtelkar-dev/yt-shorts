import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { refundAction, retryAction } from "@/app/admin/actions";
import { ActionForm } from "@/components/admin/action-form";
import { AutoRefresh } from "@/components/admin/auto-refresh";
import { Field, JobStatus, Pager, UserLabel } from "@/components/admin/bits";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/select-field";
import { VideoPlayer } from "@/components/video-player";
import { formatClock, formatCredits, formatRupees, formatWhen } from "@/lib/format";
import { cn } from "@/lib/utils";
import { requireAdmin } from "@/server/admin/guard";
import { JOB_STATUSES, jobDetail, listAllJobs, type JobStatus as Status } from "@/server/admin/queries";
import { signedVideo } from "@/server/jobs/public";

export const metadata: Metadata = { title: "Jobs" };
export const dynamic = "force-dynamic";

type Search = { status?: string; style?: string; page?: string; job?: string; q?: string };

const ACTIVE: Status[] = ["queued", "starting", "running"];
const DOT: Record<string, string> = {
  queued: "bg-muted-foreground/50",
  starting: "bg-danger",
  running: "bg-danger",
  succeeded: "bg-success",
  failed: "bg-muted-foreground",
  canceled: "bg-muted-foreground/50",
};

// A control room: the live queue on the left, the picked job on the right. On phones it's one or the other.
export default async function JobsPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireAdmin();
  const sp = await searchParams;
  const status = JOB_STATUSES.includes(sp.status as Status) ? (sp.status as Status) : null;
  const page = Math.max(0, Number(sp.page) || 0);
  const { rows, hasMore, slugs } = await listAllJobs(status, sp.style || null, page, sp.q ?? "");
  const titleOf = new Map(slugs.map((s) => [s.slug, s.title]));
  // A picked job (?job=) opens on every screen; otherwise desktop shows the newest and phones show the list.
  const picked = sp.job && /^[0-9a-f-]{36}$/i.test(sp.job) ? sp.job : null;
  const selected = picked ?? rows[0]?.id ?? null;
  const keep = { q: sp.q?.trim() || undefined, status: status ?? undefined, style: sp.style || undefined, page: page ? String(page) : undefined };
  const hrefFor = (job?: string) => `?${new URLSearchParams(Object.entries({ ...keep, job }).filter(([, v]) => v) as [string, string][])}`;
  const running = rows.filter((r) => r.status === "running" || r.status === "starting").length;
  const queued = rows.filter((r) => r.status === "queued").length;

  return (
    <>
      <AutoRefresh active={rows.some((r) => ACTIVE.includes(r.status))} />
      <div className="flex flex-wrap items-center justify-between gap-3 max-lg:flex-col max-lg:items-stretch">
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Live queue</h1>
          <span className="font-mono text-xs text-muted-foreground tabular">
            {running} running · {queued} queued
          </span>
        </div>
        {/* Phones: search on its own line, the two filters side by side, then the button. Wider: one row. */}
        <form role="search" className="grid w-full grid-cols-2 gap-2 lg:flex lg:w-auto lg:items-center">
          <Input name="q" type="search" defaultValue={sp.q ?? ""} placeholder="Job id, email, style, player or link" aria-label="Search jobs" className="col-span-2 lg:w-64" />
          <SelectField
            name="status"
            label="Status"
            defaultValue={status ?? ""}
            options={[{ value: "", label: "All statuses" }, ...JOB_STATUSES.map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) }))]}
            className="lg:w-36"
          />
          <SelectField name="style" label="Style" defaultValue={sp.style ?? ""} options={[{ value: "", label: "All styles" }, ...slugs.map((s) => ({ value: s.slug, label: s.title }))]} className="lg:w-44" />
          <Button type="submit" className="col-span-2 lg:col-auto">
            Search
          </Button>
        </form>
      </div>


      <div className="grid grid-cols-1 overflow-hidden rounded-xl border bg-panel lg:h-[calc(100dvh-12rem)] lg:min-h-[32rem] lg:grid-cols-[minmax(18rem,26rem)_minmax(0,1fr)]">
        <section aria-label="Jobs" className={cn("flex min-h-0 flex-col lg:border-r", picked && "max-lg:hidden")}>
          {rows.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">No jobs match{sp.q ? ` "${sp.q.trim()}"` : ""}. Try a shorter search or clear the filters.</p>
          ) : (
            <ul className="min-h-0 flex-1 overflow-y-auto">
              {rows.map((j) => {
                const active = ACTIVE.includes(j.status);
                const stage =
                  j.status === "queued"
                    ? "Waiting for a slot"
                    : active
                      ? (j.currentStage ?? "Starting")
                      : j.status === "succeeded"
                        ? `Done${j.runMs ? ` in ${formatClock(j.runMs)}` : ""}`
                        : (j.errorPublic ?? j.status);
                return (
                  <li key={j.id}>
                    <Link
                      href={hrefFor(j.id)}
                      aria-current={selected === j.id ? "true" : undefined}
                      className={cn(
                        "flex gap-3 border-b px-4 py-3 transition-colors hover:bg-panel-raised focus-visible:bg-panel-raised focus-visible:outline-none",
                        selected === j.id && "bg-panel-raised shadow-[inset_2px_0_0_var(--accent-red)]",
                      )}
                    >
                      <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", DOT[j.status])} aria-hidden />
                      <span className="flex min-w-0 flex-1 flex-col gap-1">
                        <span className="flex justify-between gap-3 text-sm font-medium">
                          <span className="truncate">
                            {titleOf.get(j.catalogSlug) ?? j.catalogSlug} <span className="font-normal text-muted-foreground">· {j.durationSec} s</span>
                          </span>
                          <span className="shrink-0 font-mono text-xs font-normal text-muted-foreground">{j.id.slice(0, 6)}</span>
                        </span>
                        <span className="truncate text-xs text-muted-foreground">
                          {j.isAnonymous ? `Guest ${j.userId.slice(0, 6)}` : j.email}, {stage}
                        </span>
                        {active && j.stepsTotal > 0 && (
                          <span className="h-0.5 overflow-hidden rounded-full bg-border" aria-hidden>
                            <span className="block h-full origin-left bg-danger" style={{ transform: `scaleX(${j.stepsDone / j.stepsTotal})` }} />
                          </span>
                        )}
                        <span className="sr-only">{j.status}</span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="px-4 pb-2">
            <Pager page={page} hasMore={hasMore} params={{ q: sp.q?.trim() || undefined, status: status ?? undefined, style: sp.style }} />
          </div>
        </section>

        <section aria-label="Job details" className={cn("min-h-0 overflow-y-auto", !picked && "max-lg:hidden")}>
          {selected ? (
            <JobPane id={selected} back={hrefFor()} />
          ) : (
            <p className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">Pick a job to see its steps, cost and actions.</p>
          )}
        </section>
      </div>
    </>
  );
}

async function JobPane({ id, back }: { id: string; back: string }) {
  const d = await jobDetail(id);
  if (!d) return <p className="p-6 text-sm text-muted-foreground">That job doesn&apos;t exist.</p>;
  const { job } = d;
  const active = ACTIVE.includes(job.status);
  const refunded = d.ledger.some((l) => l.kind === "refund");
  const meta = (job.outputMeta ?? {}) as { totalKills?: number };
  const video = job.status === "succeeded" ? await signedVideo(job.id, job.userId).catch(() => null) : null;
  const stats: [string, string][] = [
    ["Kills", typeof meta.totalKills === "number" ? String(meta.totalKills) : "—"],
    ["Credits", `${formatCredits(job.chargedCredits)}${refunded ? " (refunded)" : ""}`],
    ["Run time", job.runMs ? formatClock(job.runMs) : "—"],
    ["Compute", job.computeCostPaise !== null ? formatRupees(job.computeCostPaise) : "—"],
  ];

  return (
    <div className="flex flex-col gap-5 p-4 sm:p-6">
      <Link href={back} className="flex items-center gap-1.5 self-start rounded text-sm text-muted-foreground hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none lg:hidden">
        <ArrowLeft className="size-4" aria-hidden /> Back to queue
      </Link>

      <div className="flex flex-col gap-5 xl:flex-row xl:items-start">
        <div className="relative mx-auto aspect-[9/16] w-full max-w-60 shrink-0 xl:max-w-48 overflow-hidden rounded-xl border bg-background xl:mx-0">
          {video ? (
            <VideoPlayer src={video.url} poster={video.poster} label="Output video" />
          ) : (
            <span className="absolute inset-x-3 bottom-3 font-mono text-xs text-muted-foreground">{active ? "Not ready" : "No video"}</span>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 className="text-xl font-semibold tracking-tight">
              {job.catalogSlug} · {job.durationSec} s
            </h2>
            <JobStatus status={job.status} />
          </div>
          <p className="-mt-2 flex flex-wrap gap-x-3 text-sm text-muted-foreground">
            <UserLabel id={job.userId} email={d.email} isAnonymous={d.isAnonymous} />
            <span>{formatWhen(job.createdAt.toISOString())}</span>
            <span className="font-mono text-xs leading-5">{job.id}</span>
          </p>

          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-4">
            {stats.map(([k, v]) => (
              <div key={k} className="flex flex-col gap-1 bg-panel p-3">
                <dt className="text-xs text-muted-foreground">{k}</dt>
                <dd className="font-mono text-base tabular">{v}</dd>
              </div>
            ))}
          </dl>

          {job.errorRaw && <pre className="max-h-40 overflow-auto rounded-lg bg-background p-3 font-mono text-xs whitespace-pre-wrap text-danger">{job.errorRaw}</pre>}

          <div className="flex flex-col gap-2">
            <h3 className="text-xs text-muted-foreground">Engine X steps (admin only)</h3>
            {d.stepsError ? (
              <p className="text-sm text-danger">Couldn&apos;t load steps: {d.stepsError}</p>
            ) : !d.steps?.length ? (
              <p className="text-sm text-muted-foreground">No run yet.</p>
            ) : (
              <ol className="overflow-hidden rounded-lg border font-mono text-xs">
                {d.steps.map((s) => (
                  <li key={s.step} className="flex items-center gap-3 border-b px-3 py-2 last:border-b-0">
                    <span className={cn("size-2 shrink-0 rounded-full", stepDot(s.status))} aria-hidden />
                    <span className="min-w-0 flex-1 truncate" title={s.error ?? undefined}>
                      {s.step}
                    </span>
                    <span className={cn("shrink-0 tabular", s.status === "failed" ? "text-danger" : "text-muted-foreground")}>
                      {s.items ? `${s.items.done}/${s.items.total}${s.items.failed ? ` · ${s.items.failed} failed` : ""}` : s.status}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </div>

          {active ? (
            <p className="text-sm text-muted-foreground">Refund and retry are available once the job finishes.</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
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

          <Link href={`/admin/jobs/${job.id}`} className={buttonVariants({ variant: "outline", className: "self-start" })}>
            All details
          </Link>
        </div>
      </div>
    </div>
  );
}

function stepDot(status: string) {
  if (status === "failed") return "bg-danger";
  if (status === "running") return "bg-warning";
  if (["succeeded", "completed", "done", "skipped"].includes(status)) return "bg-success";
  return "bg-input";
}

import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { cancelAction, refundAction, retryAction } from "@/app/admin/actions";
import { ActionForm } from "@/components/admin/action-form";
import { AutoRefresh } from "@/components/admin/auto-refresh";
import { Field, JobStatus, Pager, UserLabel } from "@/components/admin/bits";
import { MadeFrom } from "@/components/job/made-from";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/select-field";
import { VideoPlayer } from "@/components/video-player";
import { formatClock, formatCredits, formatRupees, formatWhen } from "@/lib/format";
import { cn } from "@/lib/utils";
import { requireAdmin } from "@/server/admin/guard";
import { JOB_STATUSES, jobDetail, listAllJobs, queueCounts, runTimeStats, type JobStatus as Status } from "@/server/admin/queries";
import { heartbeatAge } from "@/server/health/probes/worker";
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
  const [{ rows, hasMore, slugs }, times, heartbeat, counts] = await Promise.all([
    listAllJobs(status, sp.style || null, page, sp.q ?? ""),
    runTimeStats(),
    heartbeatAge().catch(() => null),
    queueCounts(),
  ]);
  const titleOf = new Map(slugs.map((s) => [s.slug, s.title]));
  // A picked job (?job=) opens on every screen; otherwise desktop shows the newest and phones show the list.
  const picked = sp.job && /^[0-9a-f-]{36}$/i.test(sp.job) ? sp.job : null;
  const selected = picked ?? rows[0]?.id ?? null;
  const keep = { q: sp.q?.trim() || undefined, status: status ?? undefined, style: sp.style || undefined, page: page ? String(page) : undefined };
  const hrefFor = (job?: string) => `?${new URLSearchParams(Object.entries({ ...keep, job }).filter(([, v]) => v) as [string, string][])}`;

  return (
    <>
      <AutoRefresh active={counts.running + counts.queued > 0 || rows.some((r) => ACTIVE.includes(r.status))} />
      {(heartbeat === null || heartbeat > 60_000) && (
        <p role="alert" className="rounded-xl border border-danger/40 bg-panel px-4 py-3 text-sm">
          <span className="font-medium text-danger">The worker isn&apos;t running.</span>{" "}
          <span className="text-muted-foreground">
            Jobs won&apos;t start, update or finish until it&apos;s back. Start it with <code className="font-mono text-foreground">npm run dev:worker</code>.
          </span>
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 max-lg:flex-col max-lg:items-stretch">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <h1 className="text-2xl font-semibold tracking-tight">Live queue</h1>
          {/* Across the whole site, whatever the filters: what's using the slots and what's waiting for one. */}
          <dl className="grid grid-cols-2 gap-2 max-sm:w-full sm:flex" aria-live="polite">
            <QueueCount label="running" value={counts.running} tone={counts.running ? "live" : "idle"}>
              <span className="flex gap-1" title={`${counts.limit} slots`} aria-hidden>
                {Array.from({ length: Math.min(counts.limit, 12) }, (_, i) => (
                  <span key={i} className={cn("h-1 w-5 rounded-full", i < counts.running ? "bg-danger" : "bg-border")} />
                ))}
              </span>
            </QueueCount>
            <QueueCount label="waiting" value={counts.queued} tone={counts.queued ? "wait" : "idle"} />
          </dl>
          {heartbeat !== null && heartbeat <= 60_000 && (
            <p className="flex h-10 items-center gap-2 rounded-lg border px-3 text-sm text-muted-foreground max-sm:hidden">
              <span className="size-2 rounded-full bg-success" aria-hidden />
              Worker up · <span className="font-mono text-foreground tabular">{Math.round(heartbeat / 1000)} s</span> ago
            </p>
          )}
        </div>
        {/* Phones: search on its own line, the two filters side by side, then the button. Wider: one row. */}
        <form role="search" className="grid w-full grid-cols-2 gap-2 lg:flex lg:w-auto lg:items-center">
          <Input
            name="q"
            type="search"
            defaultValue={sp.q ?? ""}
            placeholder="Job id, email, style, player or link"
            aria-label="Search jobs"
            className="col-span-2 lg:w-64"
          />
          <SelectField
            name="status"
            label="Status"
            defaultValue={status ?? ""}
            options={[{ value: "", label: "All statuses" }, ...JOB_STATUSES.map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) }))]}
            className="lg:w-36"
          />
          <SelectField
            name="style"
            label="Style"
            defaultValue={sp.style ?? ""}
            options={[{ value: "", label: "All styles" }, ...slugs.map((s) => ({ value: s.slug, label: s.title }))]}
            className="lg:w-44"
          />
          <Button type="submit" className="col-span-2 lg:col-auto">
            Search
          </Button>
        </form>
      </div>

      {/* Both sides are as tall as their content: no scroll boxes inside the page. */}
      <div className="grid grid-cols-1 overflow-hidden rounded-xl border bg-panel lg:grid-cols-[minmax(18rem,26rem)_minmax(0,1fr)]">
        <section aria-label="Jobs" className={cn("flex min-h-0 flex-col lg:border-r", picked && "max-lg:hidden")}>
          {rows.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              No jobs match{sp.q ? ` "${sp.q.trim()}"` : ""}. Try a shorter search or clear the filters.
            </p>
          ) : (
            <div>
              {/* Running and waiting first (in the order they'll start), then what finished. */}
              {[
                { name: "Running", tone: "text-danger", jobs: rows.filter((j) => j.status === "running" || j.status === "starting") },
                { name: "Waiting in line", tone: "text-warning", jobs: rows.filter((j) => j.status === "queued").sort((a, b) => +a.createdAt - +b.createdAt) },
                { name: "Finished", tone: "text-muted-foreground", jobs: rows.filter((j) => !ACTIVE.includes(j.status)) },
              ]
                .filter((g) => g.jobs.length)
                .map((g) => (
                  <section key={g.name} aria-label={g.name}>
                    <h2 className={cn("px-4 pt-3.5 pb-1.5 text-xs font-medium", g.tone)}>
                      {g.name} · <span className="font-mono tabular">{g.jobs.length}</span>
                    </h2>
                    <ul>
                      {g.jobs.map((j) => (
                        <li key={j.id}>
                          <JobRow
                            job={j}
                            title={titleOf.get(j.catalogSlug) ?? j.catalogSlug}
                            href={hrefFor(j.id)}
                            selected={selected === j.id}
                            place={counts.line.indexOf(j.id) + 1}
                            now={counts.at}
                          />
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
            </div>
          )}
          <div className="px-4 pb-2">
            <Pager page={page} hasMore={hasMore} params={{ q: sp.q?.trim() || undefined, status: status ?? undefined, style: sp.style }} />
          </div>
        </section>

        <section aria-label="Job details" className={cn("min-w-0", !picked && "max-lg:hidden")}>
          {selected ? (
            <JobPane id={selected} back={hrefFor()} />
          ) : (
            <p className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">Pick a job to see its steps, cost and actions.</p>
          )}
        </section>
      </div>

      <RunTimes styles={slugs} times={times} />
    </>
  );
}

type Row = Awaited<ReturnType<typeof listAllJobs>>["rows"][number];

/** One job in the queue: running ones show their stage, time and progress; waiting ones their place in line. */
function JobRow({ job: j, title, href, selected, place, now }: { job: Row; title: string; href: string; selected: boolean; place: number; now: number }) {
  const running = j.status === "running" || j.status === "starting";
  const who = j.isAnonymous ? `Guest ${j.userId.slice(0, 6)}` : j.email;
  const line =
    j.status === "queued"
      ? `waiting ${formatClock(now - +j.createdAt)} · ${who}`
      : running
        ? `${j.currentStage ?? "Starting"} · ${formatClock(now - +(j.startedAt ?? j.createdAt))}`
        : j.status === "succeeded"
          ? `${who}, done${j.runMs ? ` in ${formatClock(j.runMs)}` : ""} · ${formatCredits(j.chargedCredits)} credits`
          : `${who}, ${j.errorPublic ?? j.status}`;
  return (
    <Link
      href={href}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "flex items-center gap-3 border-b px-4 py-3 transition-colors hover:bg-panel-raised focus-visible:bg-panel-raised focus-visible:outline-none",
        selected && "bg-panel-raised shadow-[inset_2px_0_0_var(--accent-red)]",
      )}
    >
      {j.status === "queued" ? (
        <span
          className="flex size-6.5 shrink-0 items-center justify-center rounded-full border border-warning/50 font-mono text-xs text-warning tabular"
          aria-label={place ? `number ${place} in line` : "waiting"}
        >
          {place || "–"}
        </span>
      ) : (
        <span className={cn("size-2 shrink-0 rounded-full", DOT[j.status])} aria-hidden />
      )}
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex justify-between gap-3 text-sm font-medium">
          <span className="truncate">
            {title} <span className="font-normal text-muted-foreground">· {j.durationSec} s</span>
          </span>
          <span className="shrink-0 font-mono text-xs font-normal text-muted-foreground">{j.id.slice(0, 6)}</span>
        </span>
        <span className="truncate text-xs text-muted-foreground">{line}</span>
        {running && j.stepsTotal > 0 && (
          <span className="relative h-0.5 overflow-hidden rounded-full bg-border" aria-hidden>
            <span
              className="block h-full origin-left bg-danger transition-transform duration-200 ease-out"
              style={{ transform: `scaleX(${j.stepsDone / j.stepsTotal})` }}
            />
            <span className="bar-glint" />
          </span>
        )}
        <span className="sr-only">{j.status}</span>
      </span>
    </Link>
  );
}

/** One of the live queue's two numbers, big enough to read at a glance; coloured only when it isn't zero. */
function QueueCount({
  label,
  detail,
  value,
  tone,
  children,
}: {
  label: string;
  detail?: string;
  value: number;
  tone: "live" | "wait" | "idle";
  children?: React.ReactNode;
}) {
  return (
    // One row, the same height as the worker chip and the search controls beside it.
    <div
      className={cn(
        "flex h-10 items-center gap-2.5 rounded-lg border bg-panel px-3",
        tone === "live" && "border-danger/50",
        tone === "wait" && "border-warning/50",
      )}
    >
      <dt className="text-sm">
        {label}
        {detail && <span className="font-mono text-muted-foreground tabular"> {detail}</span>}
      </dt>
      <dd
        className={cn(
          "order-first font-mono text-xl leading-none font-medium tabular",
          tone === "live" ? "text-danger" : tone === "wait" ? "text-warning" : "text-foreground",
        )}
      >
        {value}
      </dd>
      {children}
    </div>
  );
}

type Times = Awaited<ReturnType<typeof runTimeStats>>;

// How long each style takes at each length, so admins can set credit ranges from real runs.
function RunTimes({ styles, times }: { styles: { slug: string; title: string; durations: number[] }[]; times: Times }) {
  const lengths = [...new Set(styles.flatMap((s) => s.durations))].sort((a, b) => a - b);
  const at = new Map(times.map((t) => [`${t.catalogSlug}:${t.durationSec}`, t]));
  return (
    // Folded under the queue: a one-line summary (each style's average at its shortest length with runs), the table on open.
    <details className="group rounded-xl border bg-panel">
      <summary className="flex cursor-pointer list-none flex-wrap items-baseline gap-x-4 gap-y-1 rounded-xl px-4 py-3.5 text-sm text-muted-foreground select-none hover:text-foreground focus-visible:bg-panel-raised focus-visible:text-foreground focus-visible:outline-none [&::-webkit-details-marker]:hidden">
        <span className="font-medium text-foreground">Run times</span>
        {styles.map((st) => {
          const t = lengths.map((d) => at.get(`${st.slug}:${d}`)).find(Boolean);
          return (
            t && (
              <span key={st.slug}>
                {st.title} <span className="font-mono text-foreground tabular">{formatClock(t.avgMs)}</span> avg at {t.durationSec} s
              </span>
            )
          );
        })}
        <span className="ml-auto text-xs">Finished jobs only. 1 credit is 1 second.</span>
      </summary>
      <div className="overflow-x-auto border-t">
        <table className="w-full min-w-[40rem] text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th scope="col" className="px-4 py-2.5 font-normal">
                Style
              </th>
              {lengths.map((d) => (
                <th key={d} scope="col" className="px-4 py-2.5 font-normal">
                  {d} s
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {styles.map((s) => (
              <tr key={s.slug} className="border-b last:border-b-0">
                <th scope="row" className="px-4 py-3 text-left font-medium whitespace-nowrap">
                  {s.title}
                </th>
                {lengths.map((d) => {
                  const t = at.get(`${s.slug}:${d}`);
                  return (
                    <td key={d} className="px-4 py-3 align-top">
                      {t ? (
                        <div className="flex flex-col gap-0.5">
                          <span className="flex items-baseline gap-2">
                            <span className="font-mono text-base tabular">{formatClock(t.avgMs)}</span>
                            <span className="text-xs text-muted-foreground">avg, {formatCredits(t.avgCredits)} credits</span>
                          </span>
                          <span className="font-mono text-xs text-muted-foreground tabular">
                            {formatClock(t.minMs)} fastest, {formatClock(t.maxMs)} slowest
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {t.runs} {t.runs === 1 ? "run" : "runs"}
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">{s.durations.includes(d) ? "No runs yet" : "Not offered"}</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

async function JobPane({ id, back }: { id: string; back: string }) {
  const d = await jobDetail(id, { live: false });
  if (!d) return <p className="p-6 text-sm text-muted-foreground">That job doesn&apos;t exist.</p>;
  const { job } = d;
  const active = ACTIVE.includes(job.status);
  const refunded = d.ledger.some((l) => l.kind === "refund");
  const meta = (job.outputMeta ?? {}) as { totalKills?: number };
  const video = job.status === "succeeded" ? await signedVideo(job.id, job.userId).catch(() => null) : null;
  const stats: [string, string][] = [
    ["Kills", typeof meta.totalKills === "number" ? String(meta.totalKills) : "—"],
    ["Credits", `${formatCredits(job.chargedCredits)}${refunded ? " (refunded)" : job.maxCredits ? ` of up to ${formatCredits(job.maxCredits)}` : ""}`],
    ["Run time", job.runMs ? formatClock(job.runMs) : "—"],
    ["Compute", job.computeCostPaise !== null ? formatRupees(job.computeCostPaise) : "—"],
  ];

  return (
    <div className="flex flex-col gap-5 p-4 sm:p-6">
      <Link
        href={back}
        className="flex items-center gap-1.5 self-start rounded text-sm text-muted-foreground hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none lg:hidden"
      >
        <ArrowLeft className="size-4" aria-hidden /> Back to queue
      </Link>

      <div className="flex flex-col gap-5 xl:flex-row xl:items-start">
        <div className="relative mx-auto aspect-[9/16] w-full max-w-72 shrink-0 overflow-hidden rounded-xl border bg-background xl:mx-0 xl:max-w-64">
          {video ? (
            <VideoPlayer src={video.url} fallbackSrc={video.fallback} poster={video.poster} label="Output video" />
          ) : active ? (
            // The same motion as the user's progress card: a scan line sweeps the frame, a light runs along the bar.
            <>
              <div className="scan-sweep" aria-hidden />
              <span className="absolute inset-x-3 bottom-4 flex flex-col gap-1 font-mono text-xs text-muted-foreground">
                {job.download && (
                  <span>
                    Download {job.download.pct}%{job.download.totalBytes > 0 && ` of ${Math.round(job.download.totalBytes / 1_000_000)} MB`}
                  </span>
                )}
                <span>{job.stepsTotal ? `${Math.round((job.stepsDone / job.stepsTotal) * 100)}%` : "Starting"}</span>
              </span>
              <div className="absolute inset-x-0 bottom-0 h-1 overflow-hidden bg-border" aria-hidden>
                <div
                  className="h-full origin-left bg-danger transition-transform duration-200 ease-out"
                  style={{ transform: `scaleX(${job.stepsTotal ? job.stepsDone / job.stepsTotal : 0})` }}
                />
                <span className="bar-glint" />
              </div>
            </>
          ) : (
            <span className="absolute inset-x-3 bottom-3 font-mono text-xs text-muted-foreground">No video</span>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h2 className="text-xl font-semibold tracking-tight">
              {d.styleTitle} · {job.durationSec} s
            </h2>
            <JobStatus status={job.status} />
            <Link href={`/admin/jobs/${job.id}`} className={buttonVariants({ variant: "outline", size: "sm", className: "ml-auto" })}>
              All details
            </Link>
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

          <MadeFrom title={d.styleTitle} durationSec={job.durationSec} sources={d.sources} showEdit={false} />

          {active ? (
            <ActionForm action={cancelAction} submitLabel="Stop this job" variant="destructive">
              <input type="hidden" name="jobId" value={job.id} />
              <p className="text-sm text-muted-foreground">
                Cancels its run on Engine X. The user isn&apos;t charged. Refund and retry open once it has stopped.
              </p>
            </ActionForm>
          ) : (
            // The reason across the top, Refund and Retry side by side under it: the refund form's parts sit in this grid.
            <div className="grid grid-cols-[auto_auto_minmax(0,1fr)] items-start gap-3">
              <ActionForm
                action={refundAction}
                submitLabel={refunded ? "Already refunded" : job.chargedCredits === 0 ? "Nothing to refund" : "Refund credits"}
                disabled={refunded || job.chargedCredits === 0}
                className="contents"
              >
                <input type="hidden" name="jobId" value={job.id} />
                <div className="col-span-full">
                  <Field label="Reason">
                    <Input
                      name="reason"
                      required
                      minLength={3}
                      maxLength={500}
                      disabled={refunded || job.chargedCredits === 0}
                      placeholder="e.g. Kills were cut off"
                    />
                  </Field>
                </div>
              </ActionForm>
              <ActionForm action={retryAction} submitLabel="Retry as a new job" variant="outline">
                <input type="hidden" name="jobId" value={job.id} />
              </ActionForm>
            </div>
          )}
        </div>
      </div>

      {job.errorRaw && (
        <pre className="max-h-40 overflow-auto rounded-lg bg-background p-3 font-mono text-xs whitespace-pre-wrap text-danger">{job.errorRaw}</pre>
      )}
    </div>
  );
}

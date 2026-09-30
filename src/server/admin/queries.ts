import "server-only";
import { db } from "@/db/client";
import { Prisma, type JobStatus } from "@/generated/prisma/client";
import { enginex } from "@/server/enginex/client";
import type { RunStep } from "@/server/enginex/types";
import { mediaLinks, type MediaLinks } from "@/server/jobs/files";
import { jobSources } from "@/server/jobs/public";
import { getSettings } from "@/server/settings";

// Read side of the admin. Admin pages may see raw Engine X data (CLAUDE.md §4.8).

const PAGE = 20;
const SUB_PAGE = 20;
export async function listUsers(q: string, kind: "real" | "all" | "anonymous", page = 0) {
  const where: Prisma.UserWhereInput = {};
  if (kind === "real") where.isAnonymous = false;
  if (kind === "anonymous") where.isAnonymous = true;
  const term = q.trim();
  if (term) where.OR = [{ email: { contains: term, mode: "insensitive" } }, { name: { contains: term, mode: "insensitive" } }, { id: term }];
  const rows = await db.user.findMany({
    where,
    select: {
      id: true,
      email: true,
      name: true,
      isAnonymous: true,
      role: true,
      suspendedAt: true,
      createdAt: true,
      balance: { select: { balance: true } },
      _count: { select: { jobs: true } },
    },
    orderBy: { createdAt: "desc" },
    take: PAGE + 1,
    skip: page * PAGE,
  });
  const flat = rows.map(({ balance, _count, ...u }) => ({ ...u, balance: balance?.balance ?? 0, jobCount: _count.jobs }));
  return { rows: flat.slice(0, PAGE), hasMore: flat.length > PAGE };
}

export async function userDetail(userId: string, ledgerPage = 0, jobsPage = 0) {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return null;
  const user = await db.user.findUnique({ where: { id: userId }, include: { balance: { select: { balance: true } } } });
  if (!user) return null;
  const [ledger, userJobs] = await Promise.all([
    db.creditLedger.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: SUB_PAGE + 1, skip: ledgerPage * SUB_PAGE }),
    db.job.findMany({
      where: { userId },
      select: { id: true, status: true, catalogSlug: true, durationSec: true, chargedCredits: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: SUB_PAGE + 1,
      skip: jobsPage * SUB_PAGE,
    }),
  ]);
  const { balance, ...rest } = user;
  return {
    ...rest,
    balance: balance?.balance ?? 0,
    ledger: ledger.slice(0, SUB_PAGE),
    ledgerHasMore: ledger.length > SUB_PAGE,
    jobs: userJobs.slice(0, SUB_PAGE),
    jobsHasMore: userJobs.length > SUB_PAGE,
  };
}

export async function recentAdjustments(page = 0) {
  const rows = await db.creditLedger.findMany({
    where: { kind: { in: ["admin_add", "admin_remove", "refund", "grant"] } },
    include: { user: { select: { email: true, isAnonymous: true } } },
    orderBy: { createdAt: "desc" },
    take: PAGE + 1,
    skip: page * PAGE,
  });
  const flat = rows.map(({ user, ...entry }) => ({ entry, email: user.email, isAnonymous: user.isAnonymous }));
  return { rows: flat.slice(0, PAGE), hasMore: flat.length > PAGE };
}

const GALLERY_PAGE = 24;
// The Jobs page's list is as tall as its rows (no scroll box of its own), so a page stays short.
const JOBS_PAGE = 13;

/** Finished montages, newest first, with links to the video and its cover. */
export async function galleryItems(catalogSlug: string | null, page = 0) {
  const rows = await db.job.findMany({
    where: { status: "succeeded", outputKey: { not: null }, ...(catalogSlug ? { catalogSlug } : {}) },
    select: {
      id: true,
      catalogSlug: true,
      durationSec: true,
      chargedCredits: true,
      runMs: true,
      computeCostPaise: true,
      createdAt: true,
      finishedAt: true,
      outputKey: true,
      outputMeta: true,
      source: true,
      userId: true,
      user: { select: { email: true, isAnonymous: true } },
      catalogItem: { select: { title: true } },
    },
    orderBy: { finishedAt: "desc" },
    take: GALLERY_PAGE + 1,
    skip: page * GALLERY_PAGE,
  });
  const pageRows = rows.slice(0, GALLERY_PAGE);
  const meta = (r: (typeof rows)[number]) => (r.outputMeta ?? {}) as { totalKills?: number; title?: string | null };
  const links = await mediaLinks(pageRows).catch(() => new Map<string, MediaLinks>());
  const slugs = await db.catalogItem.findMany({ select: { slug: true, title: true } });
  return {
    items: pageRows.map((r) => ({
      id: r.id,
      title: r.catalogItem.title,
      durationSec: r.durationSec,
      credits: r.chargedCredits,
      runMs: r.runMs,
      computeCostPaise: r.computeCostPaise,
      createdAt: r.createdAt,
      finishedAt: r.finishedAt,
      source: r.source,
      userId: r.userId,
      email: r.user.email,
      isAnonymous: r.user.isAnonymous,
      kills: typeof meta(r).totalKills === "number" ? meta(r).totalKills! : null,
      videoTitle: meta(r).title ?? null,
      video: links.get(r.id)?.video ?? null,
      videoFallback: links.get(r.id)?.videoFallback ?? null,
      poster: links.get(r.id)?.poster ?? null,
    })),
    hasMore: rows.length > GALLERY_PAGE,
    slugs,
  };
}

export type { JobStatus };
export const JOB_STATUSES: JobStatus[] = ["queued", "starting", "running", "succeeded", "failed", "canceled"];

/**
 * Run time per style and length, from finished jobs: average, fastest, slowest, and the credits that time uses
 * (1 credit = 1 s, what usage pricing charges; older jobs were charged a fixed price, so chargedCredits would mislead).
 */
/** The live queue across the whole site (not the filtered page): jobs holding a slot, jobs waiting, and the slot limit. */
export async function queueCounts() {
  const [running, line, limit] = await Promise.all([
    db.job.count({ where: { status: { in: ["starting", "running"] } } }),
    // The waiting jobs in the order they'll start (their place in line is their index + 1).
    db.job.findMany({ where: { status: "queued" }, orderBy: { createdAt: "asc" }, select: { id: true }, take: 500 }),
    getSettings().then((s) => s.maxConcurrentJobsTotal),
  ]);
  return { running, queued: line.length, line: line.map((j) => j.id), limit, at: Date.now() };
}

export async function runTimeStats() {
  // Raw: avg of ceil() and rounding aren't expressible with groupBy.
  return db.$queryRaw<{ catalogSlug: string; durationSec: number; runs: number; avgMs: number; minMs: number; maxMs: number; avgCredits: number }[]>`
    select catalog_slug as "catalogSlug", duration_sec as "durationSec",
      count(*)::int as runs,
      round(avg(run_ms))::int as "avgMs",
      min(run_ms)::int as "minMs",
      max(run_ms)::int as "maxMs",
      round(avg(ceil(run_ms / 1000.0)))::int as "avgCredits"
    from jobs
    where status = 'succeeded' and run_ms is not null
    group by catalog_slug, duration_sec`;
}

type JobListRow = {
  id: string;
  status: JobStatus;
  catalogSlug: string;
  durationSec: number;
  chargedCredits: number;
  runMs: number | null;
  computeCostPaise: number | null;
  createdAt: Date;
  startedAt: Date | null;
  currentStage: string | null;
  stepsDone: number;
  stepsTotal: number;
  errorPublic: string | null;
  userId: string;
  email: string;
  isAnonymous: boolean;
};

export async function listAllJobs(status: JobStatus | null, catalogSlug: string | null, page = 0, q = "") {
  // Raw: the search matches a prefix of the uuid as text and fields inside the input JSON.
  const filters: Prisma.Sql[] = [];
  if (status) filters.push(Prisma.sql`j.status = ${status}::job_status`);
  if (catalogSlug) filters.push(Prisma.sql`j.catalog_slug = ${catalogSlug}`);
  const term = q.trim().slice(0, 200);
  if (term) {
    // Job id (the short id shown in the queue is its start), user email, style, player name, or the match / song link.
    const like = `%${term.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
    filters.push(Prisma.sql`(
      j.id::text ilike ${`${term.replace(/[%_\\]/g, "")}%`}
      or u.email ilike ${like}
      or j.catalog_slug ilike ${like}
      or j.input->>'playerName' ilike ${like}
      or j.source_url ilike ${like}
      or j.input->>'musicUrl' ilike ${like}
    )`);
  }
  const where = filters.length ? Prisma.sql`where ${Prisma.join(filters, " and ")}` : Prisma.empty;
  const rows = await db.$queryRaw<JobListRow[]>`
    select j.id, j.status, j.catalog_slug as "catalogSlug", j.duration_sec as "durationSec", j.charged_credits as "chargedCredits",
      j.run_ms as "runMs", j.compute_cost_paise as "computeCostPaise", j.created_at as "createdAt", j.started_at as "startedAt", j.current_stage as "currentStage",
      j.steps_done as "stepsDone", j.steps_total as "stepsTotal", j.error_public as "errorPublic", j.user_id as "userId",
      u.email, u.is_anonymous as "isAnonymous"
    from jobs j
    join users u on u.id = j.user_id
    ${where}
    order by j.created_at desc
    limit ${JOBS_PAGE + 1} offset ${page * JOBS_PAGE}`;
  const slugs = await db.catalogItem.findMany({ select: { slug: true, title: true, durations: true }, orderBy: { sortOrder: "asc" } });
  return { rows: rows.slice(0, JOBS_PAGE), hasMore: rows.length > JOBS_PAGE, slugs };
}

/** One job for the admin. `live: false` skips Engine X (steps and timeline), for views that don't show them: the Jobs pane. */
export async function jobDetail(jobId: string, { live = true } = {}) {
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) return null;
  const found = await db.job.findUnique({
    where: { id: jobId },
    include: { user: { select: { email: true, isAnonymous: true } }, catalogItem: { select: { title: true } } },
  });
  if (!found) return null;
  const { user, catalogItem, ...job } = found;
  const row = { job, email: user.email, isAnonymous: user.isAnonymous, styleTitle: catalogItem.title, sources: await jobSources(job) };
  const [events, ledger] = await Promise.all([
    db.jobEvent.findMany({ where: { jobId }, orderBy: { createdAt: "asc" } }),
    db.creditLedger.findMany({ where: { jobId }, orderBy: { createdAt: "asc" } }),
  ]);
  // Live step list from Engine X (admin-only). Failure here must not break the page.
  // A staged job's two index runs, for the timeline: fetched beside the render run, and left out if Engine X can't find them.
  const indexIds = live ? [row.job.gameplayIndexId, row.job.songIndexId].filter((x): x is string => !!x) : [];
  const [indexRuns, main] = await Promise.all([
    db.mediaIndex.findMany({ where: { id: { in: indexIds } }, select: { kind: true, runId: true }, orderBy: { kind: "asc" } }).then((rows) =>
      Promise.all(
        rows.map(async (i) => ({
          name: INDEX_LANE[i.kind],
          steps: i.runId
            ? await enginex()
                .getRun(i.runId)
                .then(
                  (r) => r.steps,
                  () => null,
                )
            : null,
        })),
      ),
    ),
    live && row.job.runId
      ? enginex()
          .getRun(row.job.runId)
          .then(
            (r) => ({ steps: r.steps, stepsError: null }),
            (e: unknown) => ({ steps: null, stepsError: e instanceof Error ? e.message : String(e) }),
          )
      : { steps: null, stepsError: null },
  ]);
  const timeline = [...indexRuns, { name: indexIds.length ? "Editor" : "Run", steps: main.steps }].filter((l): l is TimelineLane => !!l.steps?.length);
  return { ...row, events, ledger, ...main, timeline, timelineAt: Date.now() };
}

export type TimelineLane = { name: string; steps: RunStep[] };
const INDEX_LANE = { gameplay: "Gameplay reader", song: "Song reader" } as const;

export async function auditLog(page = 0) {
  const rows = await db.adminAuditLog.findMany({
    include: { admin: { select: { email: true } } },
    orderBy: { createdAt: "desc" },
    take: PAGE + 1,
    skip: page * PAGE,
  });
  const flat = rows.map(({ admin, ...entry }) => ({ entry, adminEmail: admin.email }));
  return { rows: flat.slice(0, PAGE), hasMore: flat.length > PAGE };
}

/** A user id from an email or an id typed by an admin. */
export async function resolveUserId(q: string): Promise<string | null> {
  const term = q.trim();
  if (/^[0-9a-f-]{36}$/i.test(term)) return (await db.user.findUnique({ where: { id: term }, select: { id: true } }))?.id ?? null;
  // Raw: an exact lower() match, so % and _ in what the admin typed are never wildcards.
  const [u] = await db.$queryRaw<{ id: string }[]>`select id from users where lower(email) = ${term.toLowerCase()}`;
  return u?.id ?? null;
}

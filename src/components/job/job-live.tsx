"use client";

import { Check, Download, Loader2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { videoUrlAction } from "@/app/(user)/actions";
import { Button, buttonVariants } from "@/components/ui/button";
import { VideoPlayer } from "@/components/video-player";
import { formatClock, formatCredits } from "@/lib/format";
import { isFinished, type PublicJob } from "@/lib/jobs";
import { cn } from "@/lib/utils";
import { Frame, StageFeed } from "./feed";
import { MadeFrom } from "./made-from";

type Video = { url: string; poster: string | null; fallback: string | null };

export function JobLive({ initial, initialVideo }: { initial: PublicJob; initialVideo: Video | null }) {
  const job = useLiveJob(initial);
  const [video, setVideo] = useState(initialVideo);
  const [videoError, setVideoError] = useState<string | null>(null);
  const now = useNow(!isFinished(job.status));
  const router = useRouter();
  const wasRunning = useRef(!isFinished(initial.status));

  // Finished while open: refresh server-rendered parts (the header balance shows the refund).
  useEffect(() => {
    if (wasRunning.current && isFinished(job.status)) {
      wasRunning.current = false;
      router.refresh();
    }
  }, [job.status, router]);

  // The job finished while this page was open: fetch signed links for the preview and its cover.
  useEffect(() => {
    if (job.status !== "succeeded" || video) return;
    videoUrlAction(job.id).then((r) => (r.ok ? setVideo(r.data) : setVideoError(r.error.message)));
  }, [job.status, job.id, video]);

  const started = Date.parse(job.startedAt ?? job.createdAt);
  const elapsed = (job.finishedAt ? Date.parse(job.finishedAt) : now) - started;
  const pct = Math.round(job.progress * 100);
  const done = job.status === "succeeded";
  const working = job.status === "queued" || job.status === "running";

  return (
    <div className="grid gap-6 md:grid-cols-[minmax(0,340px)_minmax(0,1fr)] md:items-start md:gap-10 lg:gap-14">
      <Frame className={cn("mx-auto md:mx-0 md:max-w-[340px]", done ? "max-w-[min(20rem,calc(58dvh*9/16))]" : "max-w-[min(340px,calc(56dvh*9/16))]")}>
        {done && video ? (
          <VideoPlayer src={video.url} fallbackSrc={video.fallback} poster={video.poster} label="Your montage" />
        ) : (
          <>
            {working && <div className="scan-sweep" aria-hidden />}
            {/* A HUD: the latest stages top right like a kill feed, the percentage bottom right like an ammo counter. One
                column, so they can't overlap at any frame size. */}
            <div className="absolute inset-0 flex flex-col justify-between gap-4 p-4 pb-6">
              <div className="flex min-h-0 flex-col items-end gap-1.5">
                <StageFeed
                  stages={job.stages}
                  stage={job.stage}
                  status={job.status}
                  detail={job.stageDetail}
                  below={job.download ? <DownloadAttached download={job.download} /> : null}
                />
              </div>
              {job.status !== "failed" && (
                <div className="flex flex-col items-end gap-4">
                  <p className="font-mono text-5xl leading-none font-medium text-foreground/90 tabular" aria-hidden>
                    {done ? <Loader2 className="size-8 animate-spin text-muted-foreground" /> : `${pct}%`}
                  </p>
                </div>
              )}
            </div>
            <div className="absolute inset-x-0 bottom-0 h-1 overflow-hidden bg-border" aria-hidden>
              <div
                className={cn("h-full origin-left bg-danger transition-transform duration-200 ease-out", job.status === "failed" && "bg-muted-foreground")}
                style={{ transform: `scaleX(${job.progress})` }}
              />
              {working && <span className="bar-glint" />}
            </div>
          </>
        )}
      </Frame>

      <div className="flex min-w-0 flex-col gap-5 md:gap-6">
        <div className="flex flex-col gap-2">
          <h1 className={cn("text-2xl font-semibold tracking-tight text-balance sm:text-3xl", done && "max-md:sr-only")}>
            {done ? "Your montage is ready" : job.status === "failed" ? "We couldn't finish this montage" : "Making your montage"}
          </h1>
          <p className="sr-only" aria-live="polite">
            {job.status === "running" || job.status === "queued"
              ? `${job.stage ?? "Waiting"}${job.stageDetail ? `, ${job.stageDetail}` : ""}${job.download ? `, ${downloadLabel(job.download)}${job.download.phase === "joining" || job.download.phase === "saving" ? "" : ` ${job.download.pct} percent`}` : ""}, ${pct} percent overall`
              : ""}
          </p>

          {job.status === "failed" ? (
            <p className="max-w-prose text-muted-foreground">{job.error}</p>
          ) : done ? (
            <p className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground max-md:justify-center">
              {job.kills !== null && <Stat value={job.kills} unit="kills" />}
              <Stat value={job.durationSec} unit="s" />
              <Stat value={formatCredits(job.credits)} unit="credits" />
              <span className="max-md:hidden">
                made in <span className="font-mono text-foreground tabular">{formatClock(elapsed)}</span>
              </span>
            </p>
          ) : (
            <p className="text-muted-foreground">
              {/* A live clock: the server's render is a second behind the browser's, by design. */}
              <span className="font-mono text-foreground tabular" suppressHydrationWarning>
                {formatClock(elapsed)}
              </span>{" "}
              elapsed. You can close this tab; your montage will be in{" "}
              <Link href="/library" className="text-foreground underline underline-offset-4">
                My videos
              </Link>
              .
            </p>
          )}
        </div>

        {done && <ResultActions jobId={job.id} poster={video?.poster ?? null} onError={setVideoError} />}
        {job.status === "failed" && (
          <Link href="/create" className={buttonVariants({ size: "lg", className: "w-full sm:w-auto sm:self-start" })}>
            Try again
          </Link>
        )}
        {videoError && (
          <p role="alert" className="text-sm text-danger">
            {videoError}
          </p>
        )}

        <MadeFrom title={job.title} durationSec={job.durationSec} sources={job.sources} />
        {!done && <AllSteps job={job} />}
      </div>
    </div>
  );
}

const mb = (bytes: number) => Math.round(bytes / 1_000_000).toLocaleString("en-IN");
// After the transfer Engine X joins picture and sound, then stores the file (up to a few minutes at 100%): say so.
const downloadLabel = (d: NonNullable<PublicJob["download"]>) =>
  d.phase === "joining" ? "Joining picture and sound" : d.phase === "saving" ? "Saving your video" : "Video download";

/** The video download's own progress, attached under its stage row: percent and MB, then joining and saving. */
function DownloadAttached({ download }: { download: NonNullable<PublicJob["download"]> }) {
  const after = download.phase === "joining" || download.phase === "saving";
  return (
    <div
      className="flex min-w-44 flex-col gap-1.5 rounded-b-[3px] border-l-2 border-danger bg-black/70 px-2.5 pt-0.5 pb-2 font-mono text-[11px] text-muted-foreground tabular"
      aria-hidden
    >
      <span className="flex justify-between gap-3">
        <span className={after ? "font-sans" : "text-foreground"}>{after ? downloadLabel(download) : `${download.pct}%`}</span>
        {download.totalBytes > 0 && <span>{after ? `${mb(download.totalBytes)} MB` : `${mb(download.bytes)} of ${mb(download.totalBytes)} MB`}</span>}
      </span>
      <span className="relative h-0.5 overflow-hidden rounded-full bg-white/15">
        <span
          className="block h-full origin-left bg-foreground/80 transition-transform duration-200 ease-out"
          style={{ transform: `scaleX(${download.pct / 100})` }}
        />
      </span>
    </div>
  );
}

function Stat({ value, unit }: { value: React.ReactNode; unit: string }) {
  return (
    <span>
      <span className="font-mono text-foreground tabular">{value}</span> {unit}
    </span>
  );
}

/** Every stage, not just the latest few the frame shows. Open by default on wider screens, closed on phones. */
function AllSteps({ job }: { job: PublicJob }) {
  const current = job.stage ? job.stages.indexOf(job.stage) : -1;
  const reached = job.status === "queued" ? 0 : Math.max(0, current);
  const box = useRef<HTMLDetailsElement>(null);
  // Once, after load: the server can't know the screen width. It's the last thing in its column, so opening moves nothing.
  useEffect(() => {
    if (box.current && window.matchMedia("(min-width: 768px)").matches) box.current.open = true;
  }, []);
  return (
    <details ref={box} className="group rounded-xl border bg-panel">
      <summary className="flex h-12 cursor-pointer list-none items-center justify-between rounded-xl px-4 text-sm text-muted-foreground select-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none [&::-webkit-details-marker]:hidden">
        <span>
          All steps (<span className="font-mono tabular">{reached}</span> of <span className="font-mono tabular">{job.stages.length}</span> done)
        </span>
        <span className="transition-transform group-open:rotate-180" aria-hidden>
          ▾
        </span>
      </summary>
      <ol className="flex flex-col gap-2.5 border-t px-4 py-3 text-sm">
        {job.stages.map((label, i) => {
          const isDone = i < reached;
          const isCurrent = i === current && job.status !== "queued";
          const failed = isCurrent && job.status === "failed";
          return (
            <li
              key={label}
              className={cn("flex items-center gap-3", isCurrent ? "text-foreground" : isDone ? "text-muted-foreground" : "text-muted-foreground/60")}
            >
              <span
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-full border",
                  isDone && "border-transparent bg-panel-raised",
                  isCurrent && (failed ? "border-danger text-danger" : "border-danger"),
                )}
                aria-hidden
              >
                {isDone ? (
                  <Check className="size-3" />
                ) : failed ? (
                  <X className="size-3" />
                ) : isCurrent ? (
                  <span className="size-1.5 rounded-full bg-danger" />
                ) : null}
              </span>
              <span>{label}</span>
              {isCurrent && job.download && <span className="ml-auto font-mono text-xs text-muted-foreground tabular">{job.download.pct}%</span>}
              <span className="sr-only">{isDone ? "done" : failed ? "failed" : isCurrent ? "in progress" : "to do"}</span>
            </li>
          );
        })}
      </ol>
    </details>
  );
}

const outline = buttonVariants({ size: "lg", variant: "outline", className: "h-11 w-full px-1.5 text-[13px] sm:h-11 sm:px-3 sm:text-sm" });

/** Download (primary), then share, save the cover and start another. */
function ResultActions({ jobId, poster, onError }: { jobId: string; poster: string | null; onError: (m: string | null) => void }) {
  const [downloading, startDownload] = useTransition();
  const [sharing, startShare] = useTransition();
  const [canShare, setCanShare] = useState(false);
  // A share sheet opens only within a few seconds of the tap, and fetching a whole video takes longer.
  // So the file is fetched as soon as sharing is possible; a tap before it's done falls back to "Share now".
  const shareFile = useRef<Promise<File> | null>(null);
  const [shareReady, setShareReady] = useState(false);
  const name = `montage-${jobId.slice(0, 8)}`;

  const fresh = async () => {
    const r = await videoUrlAction(jobId); // fresh link every time; they expire after an hour
    if (!r.ok) throw new Error(r.error.message);
    return r.data;
  };
  const fileToShare = () =>
    (shareFile.current ??= fresh()
      .then(async ({ url, fallback }) => {
        const res = await fetchEither(url, fallback);
        if (!res?.ok) throw new Error("Couldn't get your video. Try again.");
        return new File([await res.blob()], `${name}.mp4`, { type: "video/mp4" });
      })
      .catch((e) => {
        shareFile.current = null; // let the next tap try again
        throw e;
      }));

  useEffect(() => {
    const ok = typeof navigator.canShare === "function" && navigator.canShare({ files: [new File([""], "x.mp4", { type: "video/mp4" })] });
    setCanShare(ok);
    if (ok) fileToShare().catch(() => {}); // a failure here shows on the tap instead
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per result
  }, []);

  function download() {
    onError(null);
    startDownload(async () => {
      try {
        const { url, fallback } = await fresh();
        await saveFile(url, `${name}.mp4`, fallback);
      } catch (e) {
        onError(e instanceof Error ? e.message : "Couldn't download. Try again.");
      }
    });
  }

  function saveCover() {
    onError(null);
    startDownload(async () => {
      try {
        const { poster: p } = await fresh();
        if (p) await saveFile(p, `${name}.jpg`);
      } catch (e) {
        onError(e instanceof Error ? e.message : "Couldn't save the cover. Try again.");
      }
    });
  }

  function share() {
    onError(null);
    startShare(async () => {
      try {
        await navigator.share({ files: [await fileToShare()] });
        setShareReady(false);
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return; // closed the share sheet
        if (e instanceof DOMException && e.name === "NotAllowedError" && shareFile.current) return setShareReady(true);
        onError(e instanceof Error ? e.message : "Couldn't share. Try Download instead.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-2.5 md:max-w-sm">
      <Button size="lg" onClick={download} disabled={downloading} className="h-13 w-full rounded-xl text-base">
        {downloading ? <Loader2 className="animate-spin" aria-hidden /> : <Download aria-hidden />}
        Download
      </Button>
      <div className="grid auto-cols-fr grid-flow-col gap-2">
        {canShare && (
          <button type="button" onClick={share} disabled={sharing} className={outline}>
            {sharing && <Loader2 className="animate-spin" aria-hidden />}
            {shareReady ? "Share now" : "Share"}
          </button>
        )}
        {poster && (
          <button type="button" onClick={saveCover} disabled={downloading} className={outline}>
            Save cover
          </button>
        )}
        <Link href="/create" className={outline}>
          Make another
        </Link>
      </div>
    </div>
  );
}

/** Fetches `url`, or `fallback` (our Postgres copy) if that fails. */
async function fetchEither(url: string, fallback?: string | null) {
  const res = await fetch(url).catch(() => null);
  return res?.ok || !fallback ? res : fetch(fallback).catch(() => null);
}

/** Saves a file from storage under a readable name; falls back to opening it if the fetch fails. */
async function saveFile(url: string, filename: string, fallback?: string | null) {
  const res = await fetchEither(url, fallback);
  if (!res?.ok) return window.location.assign(fallback ?? url);
  const href = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement("a"), { href, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 30_000);
}

/** Live updates over SSE, falling back to polling every 5 s. */
function useLiveJob(initial: PublicJob): PublicJob {
  const [job, setJob] = useState(initial);
  const done = isFinished(job.status);

  useEffect(() => {
    if (done) return;
    let poll: ReturnType<typeof setInterval> | undefined;
    const es = new EventSource(`/api/jobs/${initial.id}/events`);
    es.onmessage = (m) => setJob(JSON.parse(m.data) as PublicJob);
    es.onerror = () => {
      es.close();
      poll ??= setInterval(async () => {
        const res = await fetch(`/api/jobs/${initial.id}`, { cache: "no-store" }).catch(() => null);
        if (res?.ok) setJob((await res.json()) as PublicJob);
      }, 5000);
    };
    return () => {
      es.close();
      clearInterval(poll);
    };
  }, [initial.id, done]);

  return job;
}

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

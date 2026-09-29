"use client";

import { Download, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { videoUrlAction } from "@/app/(user)/actions";
import { Button, buttonVariants } from "@/components/ui/button";
import { formatClock, formatCredits, formatTime } from "@/lib/format";
import { isFinished, type PublicJob } from "@/lib/jobs";
import { cn } from "@/lib/utils";
import { Frame, StageFeed } from "./feed";

type Video = { url: string; poster: string | null };

export function JobLive({ initial, initialVideo }: { initial: PublicJob; initialVideo: Video | null }) {
  const job = useLiveJob(initial);
  const [video, setVideo] = useState(initialVideo);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [downloading, startDownload] = useTransition();
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

  function download() {
    startDownload(async () => {
      const r = await videoUrlAction(job.id); // fresh link every time; they expire after an hour
      if (r.ok) window.location.assign(r.data.url);
      else setVideoError(r.error.message);
    });
  }

  const started = Date.parse(job.startedAt ?? job.createdAt);
  const elapsed = (job.finishedAt ? Date.parse(job.finishedAt) : now) - started;
  const pct = Math.round(job.progress * 100);

  return (
    <div className="grid gap-8 md:grid-cols-[minmax(0,340px)_minmax(0,1fr)] md:items-start lg:gap-14">
      <Frame className="mx-auto max-w-[min(340px,calc(60dvh*9/16))] md:mx-0 md:max-w-[340px]">
        {job.status === "succeeded" && video ? (
          <video
            src={video.url}
            poster={video.poster ?? undefined}
            controls
            playsInline
            preload="metadata"
            className="size-full bg-black object-contain"
            aria-label="Your montage"
          />
        ) : (
          <>
            {/* A HUD: the latest stages top right like a kill feed, the percentage bottom right like an ammo counter. One
                column, so they can't overlap at any frame size. */}
            <div className="absolute inset-0 flex flex-col justify-between gap-4 p-4 pb-6">
              <div className="flex min-h-0 flex-col items-end gap-1.5">
                <StageFeed stages={job.stages} stage={job.stage} status={job.status} detail={job.stageDetail} />
              </div>
              {job.status !== "failed" && (
                <p className="self-end font-mono text-4xl leading-none font-medium text-foreground/90 tabular sm:text-5xl" aria-hidden>
                  {job.status === "succeeded" ? <Loader2 className="size-8 animate-spin text-muted-foreground" /> : `${pct}%`}
                </p>
              )}
            </div>
            <div className="absolute inset-x-0 bottom-0 h-1 bg-border" aria-hidden>
              <div
                className={cn("h-full origin-left bg-danger transition-transform duration-700 ease-out", job.status === "failed" && "bg-muted-foreground")}
                style={{ transform: `scaleX(${job.progress})` }}
              />
            </div>
          </>
        )}
      </Frame>

      <div className="flex min-w-0 flex-col gap-6">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
            {job.status === "succeeded" ? "Your montage is ready" : job.status === "failed" ? "We couldn't finish this montage" : "Making your montage"}
          </h1>
          <p className="sr-only" aria-live="polite">
            {job.status === "running" || job.status === "queued" ? `${job.stage ?? "Waiting"}${job.stageDetail ? `, ${job.stageDetail}` : ""}, ${pct} percent` : ""}
          </p>

          {job.status === "failed" ? (
            <p className="max-w-prose text-muted-foreground">{job.error}</p>
          ) : job.status === "succeeded" ? (
            <p className="font-mono text-sm text-muted-foreground tabular">
              {job.kills !== null && <span className="text-foreground">{job.kills} kills</span>}
              {job.kills !== null && " · "}
              {job.durationSec} s · {formatCredits(job.credits)} credits · made in {formatClock(elapsed)}
            </p>
          ) : (
            <p className="text-muted-foreground">
              {/* A live clock: the server's render is a second behind the browser's, by design. */}
              <span className="font-mono text-foreground tabular" suppressHydrationWarning>
                {formatClock(elapsed)}
              </span>{" "}
              elapsed. You can close this tab; we&apos;ll keep working and your
              montage will be in <Link href="/library" className="text-foreground underline underline-offset-4">My videos</Link>.
            </p>
          )}
        </div>

        {job.status === "succeeded" && (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button size="lg" onClick={download} disabled={downloading} className="w-full sm:w-auto">
              {downloading ? <Loader2 className="animate-spin" aria-hidden /> : <Download aria-hidden />}
              Download
            </Button>
            <Link href="/" className={buttonVariants({ size: "lg", variant: "ghost", className: "w-full sm:w-auto" })}>
              Make another
            </Link>
          </div>
        )}
        {job.status === "failed" && (
          <Link href="/" className={buttonVariants({ size: "lg", className: "w-full sm:w-auto sm:self-start" })}>
            Try again
          </Link>
        )}
        {videoError && (
          <p role="alert" className="text-sm text-danger">
            {videoError}
          </p>
        )}

        <details className="group rounded-xl border bg-panel">
          <summary className="flex h-11 cursor-pointer list-none items-center justify-between px-4 text-sm text-muted-foreground select-none hover:text-foreground [&::-webkit-details-marker]:hidden">
            Show details
            <span className="transition-transform group-open:rotate-180" aria-hidden>
              ▾
            </span>
          </summary>
          <ol className="flex flex-col gap-1.5 border-t px-4 py-3 font-mono text-xs">
            {job.events.map((e, i) => (
              <li key={i} className={cn("flex gap-3", e.level === "error" ? "text-danger" : e.level === "warn" ? "text-warning" : "text-muted-foreground")}>
                <time dateTime={e.at} className="shrink-0 tabular">
                  {formatTime(e.at)}
                </time>
                <span className="font-sans">{e.message}</span>
              </li>
            ))}
          </ol>
        </details>
      </div>
    </div>
  );
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

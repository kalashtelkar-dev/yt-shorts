"use client";

import { Loader2, Maximize, Minimize, Pause, Play, Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { formatClock } from "@/lib/format";
import { cn } from "@/lib/utils";

type Props = {
  src: string;
  /** Played instead if `src` fails to load (our Postgres copy behind an Engine X link). */
  fallbackSrc?: string | null;
  poster?: string | null;
  label: string;
  /** "metadata" shows the length before play; "none" for grids of many videos. */
  preload?: "metadata" | "none";
  className?: string;
  /** How the video fills its box. */
  fit?: "contain" | "cover";
};

/** Our own controls over a plain <video>: big play button, scrubber, time, sound and full screen. */
export function VideoPlayer({ src, fallbackSrc, poster, label, preload = "metadata", className, fit = "contain" }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [muted, setMuted] = useState(false);
  const [full, setFull] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [chrome, setChrome] = useState(true);
  // The src that failed to load, if any: then the fallback plays (a new src starts fresh).
  const [failed, setFailed] = useState<string | null>(null);
  const current = failed === src && fallbackSrc ? fallbackSrc : src;

  useEffect(() => {
    const onFull = () => setFull(document.fullscreenElement === box.current);
    document.addEventListener("fullscreenchange", onFull);
    return () => {
      document.removeEventListener("fullscreenchange", onFull);
      clearTimeout(hideTimer.current);
    };
  }, []);

  // While playing, controls fade after a moment without movement; paused, they stay.
  function wake() {
    setChrome(true);
    clearTimeout(hideTimer.current);
    if (video.current && !video.current.paused) hideTimer.current = setTimeout(() => setChrome(false), 2500);
  }

  function toggle() {
    const v = video.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => setPlaying(false));
    else v.pause();
    wake();
  }

  function seek(to: number) {
    const v = video.current;
    if (!v || !Number.isFinite(to)) return;
    v.currentTime = Math.min(Math.max(0, to), v.duration || to);
    setTime(v.currentTime);
    wake();
  }

  function toggleFull() {
    const v = video.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    if (document.fullscreenElement) return void document.exitFullscreen();
    if (box.current?.requestFullscreen) return void box.current.requestFullscreen().catch(() => v?.webkitEnterFullscreen?.());
    v?.webkitEnterFullscreen?.(); // iPhone Safari: only the video element can go full screen
  }

  function onKey(e: React.KeyboardEvent) {
    const v = video.current;
    if (!v || (e.target as HTMLElement).tagName === "INPUT") return;
    const keys: Record<string, () => void> = {
      " ": toggle,
      k: toggle,
      ArrowRight: () => seek(v.currentTime + 5),
      ArrowLeft: () => seek(v.currentTime - 5),
      m: () => (v.muted = !v.muted),
      f: toggleFull,
    };
    const run = keys[e.key];
    if (run) {
      e.preventDefault();
      run();
    }
  }

  const pct = duration ? (time / duration) * 100 : 0;
  const show = chrome || !playing;

  return (
    <div
      ref={box}
      className={cn("group/player relative size-full overflow-hidden bg-black select-none", !show && "cursor-none", className)}
      onPointerMove={wake}
      onKeyDown={onKey}
    >
      <video
        ref={video}
        src={current}
        poster={poster ?? undefined}
        preload={preload}
        playsInline
        aria-label={label}
        onClick={toggle}
        onError={() => fallbackSrc && current !== fallbackSrc && setFailed(src)}
        onPlay={() => {
          setPlaying(true);
          setStarted(true);
          wake();
        }}
        onPause={() => {
          setPlaying(false);
          setChrome(true);
        }}
        onEnded={() => setPlaying(false)}
        onWaiting={() => setWaiting(true)}
        onPlaying={() => setWaiting(false)}
        onCanPlay={() => setWaiting(false)}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onDurationChange={(e) => setDuration(e.currentTarget.duration)}
        onVolumeChange={(e) => setMuted(e.currentTarget.muted)}
        className={cn("size-full", fit === "cover" && !full ? "object-cover" : "object-contain")}
      />

      {/* Centre: a big play button before the first play and whenever paused. */}
      {!playing && !waiting && (
        <button
          type="button"
          onClick={toggle}
          aria-label={started ? "Play" : `Play ${label}`}
          className="absolute top-1/2 left-1/2 flex size-16 -translate-1/2 items-center justify-center rounded-full border border-white/25 bg-black/60 text-white backdrop-blur-sm transition-transform duration-150 hover:scale-105 focus-visible:ring-3 focus-visible:ring-ring/60 focus-visible:outline-none"
        >
          <Play className="size-7 translate-x-0.5 fill-current" aria-hidden />
        </button>
      )}
      {waiting && playing && <Loader2 className="absolute top-1/2 left-1/2 size-9 -translate-1/2 animate-spin text-white/80" aria-hidden />}

      {/* Bottom bar: play, time, scrubber, sound, full screen. Hidden until the first play to keep the cover clean. */}
      {started && (
        <div
          className={cn(
            "absolute inset-x-2 bottom-2 flex flex-col rounded-xl bg-black/70 px-1.5 pt-1 pb-0.5 text-white backdrop-blur-sm transition-opacity duration-200",
            show ? "opacity-100" : "pointer-events-none opacity-0",
          )}
        >
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={time}
            onChange={(e) => seek(Number(e.target.value))}
            aria-label="Seek"
            aria-valuetext={`${formatClock(time * 1000)} of ${formatClock(duration * 1000)}`}
            className="video-range mx-1.5"
            style={{ "--progress": `${pct}%` } as React.CSSProperties}
          />
          <div className="flex items-center gap-0.5">
            <button type="button" onClick={toggle} aria-label={playing ? "Pause" : "Play"} className={ctrl}>
              {playing ? <Pause className="size-4 fill-current" aria-hidden /> : <Play className="size-4 fill-current" aria-hidden />}
            </button>
            <span className="min-w-0 flex-1 truncate px-1 font-mono text-[11px] text-white/80 tabular">
              {formatClock(time * 1000)} / {formatClock(duration * 1000)}
            </span>
            <button type="button" onClick={() => video.current && (video.current.muted = !video.current.muted)} aria-label={muted ? "Unmute" : "Mute"} className={ctrl}>
              {muted ? <VolumeX className="size-4" aria-hidden /> : <Volume2 className="size-4" aria-hidden />}
            </button>
            <button type="button" onClick={toggleFull} aria-label={full ? "Exit full screen" : "Full screen"} className={ctrl}>
              {full ? <Minimize className="size-4" aria-hidden /> : <Maximize className="size-4" aria-hidden />}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const ctrl =
  "flex size-8 shrink-0 items-center justify-center rounded-lg text-white/90 transition-colors hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:outline-none";

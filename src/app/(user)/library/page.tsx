import type { Metadata } from "next";
import Image from "next/image";
import { Clapperboard, Play, VideoOff } from "lucide-react";
import Link from "next/link";
import { BackLink } from "@/components/back-link";
import { buttonVariants } from "@/components/ui/button";
import { formatWhen } from "@/lib/format";
import type { LibraryItem, PublicStatus } from "@/lib/jobs";
import { cn } from "@/lib/utils";
import { listJobs } from "@/server/jobs/public";
import { env } from "@/config/env";
import { getViewer } from "@/server/session";

export const metadata: Metadata = { title: "My videos" };

const STATUS: Record<PublicStatus, { label: string; className: string }> = {
  queued: { label: "Waiting", className: "text-muted-foreground" },
  running: { label: "Making", className: "text-danger" },
  succeeded: { label: "Ready", className: "text-success" },
  failed: { label: "Failed", className: "text-muted-foreground" },
};

const FILTERS = [
  { key: "all", label: "All", has: () => true },
  { key: "ready", label: "Ready", has: (s: PublicStatus) => s === "succeeded" },
  { key: "making", label: "Making", has: (s: PublicStatus) => s === "queued" || s === "running" },
  { key: "failed", label: "Failed", has: (s: PublicStatus) => s === "failed" },
] as const;

export default async function LibraryPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const [viewer, { show }] = await Promise.all([getViewer(), searchParams]);
  const all: LibraryItem[] = viewer ? await listJobs(viewer.id) : [];
  const signedOut = env.AUTH_MODE === "full" && (!viewer || !!viewer.isAnonymous);
  const filter = FILTERS.find((f) => f.key === show) ?? FILTERS[0];
  const items = all.filter((i) => filter.has(i.status));

  return (
    <div className="flex flex-col gap-5">
      <BackLink href="/" className="-mb-2">
        Home
      </BackLink>
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">My videos</h1>
        {all.length > 0 && (
          <Link href="/" className={buttonVariants({ variant: "outline" })}>
            New montage
          </Link>
        )}
      </div>

      {all.length === 0 ? (
        <div className="flex max-w-lg flex-col items-start gap-4 rounded-xl border bg-panel p-6">
          <p className="text-muted-foreground">Montages you make show up here, with a download link when they&apos;re ready.</p>
          {signedOut ? (
            <Link href="/sign-in" className={buttonVariants({ size: "lg" })}>
              Sign in to see your videos
            </Link>
          ) : (
            <Link href="/" className={buttonVariants({ size: "lg" })}>
              Make your first montage
            </Link>
          )}
        </div>
      ) : (
        <>
          <nav aria-label="Show" className="-mx-4 -my-1 flex gap-2 overflow-x-auto px-4 py-1 [scrollbar-width:none] sm:mx-0 sm:px-1">
            {FILTERS.map((f) => (
              <Link
                key={f.key}
                href={f.key === "all" ? "/library" : `/library?show=${f.key}`}
                aria-current={f === filter ? "page" : undefined}
                className={cn(
                  "flex h-10 shrink-0 items-center rounded-full border px-4 text-sm transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                  f === filter ? "border-transparent bg-panel-raised text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {f.label}
              </Link>
            ))}
          </nav>

          {items.length === 0 ? (
            <p className="rounded-xl border bg-panel p-6 text-muted-foreground">
              Nothing here yet. <Link href="/library" className="text-foreground underline underline-offset-4">Show all videos</Link>
            </p>
          ) : (
            <ul className="grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 lg:grid-cols-4">
              {items.map((item, i) => (
                <li key={item.id}>
                  <Tile item={item} priority={i < 4} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function Tile({ item, priority }: { item: LibraryItem; priority: boolean }) {
  const status = STATUS[item.status];
  const making = item.status === "running" || item.status === "queued";
  const meta =
    item.status === "failed"
      ? `${item.durationSec} s, ${formatWhen(item.createdAt)}`
      : making
        ? `${item.durationSec} s, ${item.status === "queued" ? "waiting to start" : `${Math.round(item.progress * 100)}% done`}`
        : `${item.durationSec} s${item.kills !== null ? `, ${item.kills} kills` : ""}, ${formatWhen(item.createdAt)}`;
  return (
    <Link href={`/jobs/${item.id}`} className="group flex flex-col gap-2 rounded-xl focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
      <span className="relative block aspect-[9/16] overflow-hidden rounded-xl border bg-panel transition-colors group-hover:border-input">
        {item.poster ? (
          <Image src={item.poster} alt="" fill unoptimized priority={priority} sizes="(min-width: 1024px) 240px, (min-width: 640px) 30vw, 45vw" className="object-cover" />
        ) : (
          <TileFace item={item} />
        )}
        <span className={cn("absolute top-2 left-2 rounded-md bg-black/75 px-2 py-1 text-xs font-medium", status.className)}>{status.label}</span>
        {making && (
          <span className="absolute inset-x-0 bottom-0 h-1 bg-border" aria-hidden>
            <span className="block h-full origin-left bg-danger" style={{ transform: `scaleX(${item.progress})` }} />
          </span>
        )}
      </span>
      <span className="flex min-w-0 flex-col gap-0.5 px-0.5">
        <span className="truncate font-medium" title={item.videoTitle ?? undefined}>
          {item.title}
        </span>
        <span className="truncate text-sm text-muted-foreground">{meta}</span>
      </span>
    </Link>
  );
}

/** What a tile shows when there's no cover yet: why it failed, how far along it is, or a play mark. */
function TileFace({ item }: { item: LibraryItem }) {
  if (item.status === "failed") {
    return (
      <span className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[repeating-linear-gradient(135deg,transparent_0_10px,var(--panel-raised)_10px_11px)] p-4 pb-12 text-center">
        <span className="flex size-11 items-center justify-center rounded-full border bg-background">
          <VideoOff className="size-5 text-muted-foreground" aria-hidden />
        </span>
        <span className="text-sm font-medium">Didn&apos;t finish</span>
        <span className="line-clamp-4 text-xs text-muted-foreground">{item.error}</span>
        <span className="absolute inset-x-3 bottom-3 rounded-md border bg-background/80 px-2 py-1 text-xs text-success">Credits returned</span>
      </span>
    );
  }
  if (item.status === "running" || item.status === "queued") {
    return (
      <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center">
        <Clapperboard className="size-6 text-muted-foreground" aria-hidden />
        <span className="font-mono text-3xl tabular">{item.status === "queued" ? "0%" : `${Math.round(item.progress * 100)}%`}</span>
        <span className="text-xs text-muted-foreground">{item.status === "queued" ? "Waiting to start" : "Making your montage"}</span>
      </span>
    );
  }
  return (
    <span className="absolute inset-0 flex items-center justify-center">
      <span className="flex size-12 items-center justify-center rounded-full border bg-background/60">
        <Play className="size-5 translate-x-px" aria-hidden />
      </span>
    </span>
  );
}

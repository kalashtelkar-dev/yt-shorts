import type { Metadata } from "next";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { formatWhen } from "@/lib/format";
import type { LibraryItem, PublicStatus } from "@/lib/jobs";
import { cn } from "@/lib/utils";
import { listJobs } from "@/server/jobs/public";
import { getViewer } from "@/server/session";

export const metadata: Metadata = { title: "My videos" };

const STATUS: Record<PublicStatus, { label: string; className: string }> = {
  queued: { label: "Waiting", className: "text-muted-foreground" },
  running: { label: "Editing", className: "text-foreground" },
  succeeded: { label: "Ready", className: "text-success" },
  failed: { label: "Didn't finish", className: "text-danger" },
};

export default async function LibraryPage() {
  const viewer = await getViewer();
  const items: LibraryItem[] = viewer ? await listJobs(viewer.id) : [];

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">My videos</h1>
      {items.length === 0 ? (
        <div className="flex max-w-lg flex-col items-start gap-4 rounded-xl border bg-panel p-6">
          <p className="text-muted-foreground">Montages you make show up here, with a download link when they&apos;re ready.</p>
          <Link href="/" className={buttonVariants({ size: "lg" })}>
            Make your first montage
          </Link>
        </div>
      ) : (
        <ul className="flex flex-col divide-y overflow-hidden rounded-xl border bg-panel">
          {items.map((item) => (
            <li key={item.id}>
              <Link
                href={`/jobs/${item.id}`}
                className="flex min-h-16 items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-panel-raised focus-visible:bg-panel-raised focus-visible:outline-none"
              >
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="truncate font-medium">{item.videoTitle ?? item.title}</span>
                  <span className="font-mono text-xs text-muted-foreground tabular">
                    {formatWhen(item.createdAt)} · {item.durationSec} s{item.kills !== null && ` · ${item.kills} kills`}
                  </span>
                </span>
                <span className={cn("shrink-0 text-sm", STATUS[item.status].className)}>{STATUS[item.status].label}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

import { Info, X } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Empty, PageHeader, Pager, pageParam } from "@/components/admin/bits";
import { Button } from "@/components/ui/button";
import { SelectField } from "@/components/select-field";
import { VideoPlayer } from "@/components/video-player";
import { formatClock, formatCredits, formatRupees, formatWhen } from "@/lib/format";
import { requireAdmin } from "@/server/admin/guard";
import { galleryItems } from "@/server/admin/queries";

export const metadata: Metadata = { title: "Gallery" };
export const dynamic = "force-dynamic";

type Search = { style?: string; page?: string };

// Every finished montage in one place. Videos load only when played; details sit behind the i button.
export default async function GalleryPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireAdmin();
  const sp = await searchParams;
  const page = pageParam(sp.page);
  const { items, hasMore, slugs } = await galleryItems(sp.style || null, page);

  return (
    <>
      <PageHeader title="Gallery">
        <form className="flex w-full gap-2 sm:w-auto">
          <SelectField name="style" label="Style" defaultValue={sp.style ?? ""} options={[{ value: "", label: "All styles" }, ...slugs.map((s) => ({ value: s.slug, label: s.title }))]} className="sm:w-52" />
          <Button type="submit">Filter</Button>
        </form>
      </PageHeader>

      {items.length === 0 ? (
        <Empty>No finished montages{sp.style ? " in this style" : ""} yet.</Empty>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
          {items.map((g) => {
            const popId = `details-${g.id}`;
            const facts: [string, React.ReactNode][] = [
              ["Style", `${g.title}, ${g.durationSec} s`],
              ["Kills", g.kills ?? "—"],
              ["User", <Link key="u" href={`/admin/users/${g.userId}`} className="underline underline-offset-4">{g.isAnonymous ? `Guest ${g.userId.slice(0, 8)}` : g.email}</Link>],
              ["Credits", formatCredits(g.credits)],
              ["Run time", g.runMs ? formatClock(g.runMs) : "—"],
              ["Compute", g.computeCostPaise !== null ? formatRupees(g.computeCostPaise) : "—"],
              ["Made", formatWhen(g.createdAt.toISOString())],
              ["Finished", g.finishedAt ? formatWhen(g.finishedAt.toISOString()) : "—"],
              ["Source", g.source === "upload" ? "Uploaded file" : "YouTube link"],
              ["Video", g.videoTitle ?? "—"],
            ];
            return (
              <li key={g.id} className="flex flex-col gap-2">
                <div className="relative aspect-[9/16] overflow-hidden rounded-xl border bg-panel">
                  {g.video ? (
                    <VideoPlayer src={g.video} poster={g.poster} preload="none" fit="cover" label={`${g.title} montage`} />
                  ) : (
                    <span className="absolute inset-0 flex items-center justify-center p-3 text-center text-xs text-muted-foreground">Video link unavailable</span>
                  )}
                  <button
                    type="button"
                    popoverTarget={popId}
                    aria-label={`Details for ${g.title}, ${formatWhen(g.createdAt.toISOString())}`}
                    className="absolute top-2 right-2 flex size-9 items-center justify-center rounded-full bg-black/70 text-foreground hover:bg-black focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                  >
                    <Info className="size-4" aria-hidden />
                  </button>
                </div>
                <div className="flex min-w-0 flex-col gap-0.5 px-0.5">
                  <span className="truncate text-sm font-medium">{g.title}</span>
                  <span className="truncate font-mono text-xs text-muted-foreground tabular">
                    {g.durationSec} s{g.kills !== null && `, ${g.kills} kills`}, {formatWhen(g.createdAt.toISOString())}
                  </span>
                </div>

                <div
                  id={popId}
                  popover="auto"
                  className="m-auto w-[min(24rem,calc(100vw-2rem))] rounded-2xl border bg-panel p-5 text-foreground shadow-2xl backdrop:bg-black/60"
                >
                  <div className="mb-4 flex items-start justify-between gap-4">
                    <div className="flex min-w-0 flex-col gap-1">
                      <h2 className="font-semibold">{g.title}</h2>
                      <span className="font-mono text-xs break-all text-muted-foreground">{g.id}</span>
                    </div>
                    <button
                      type="button"
                      popoverTarget={popId}
                      popoverTargetAction="hide"
                      aria-label="Close details"
                      className="-m-1 flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                    >
                      <X className="size-4" aria-hidden />
                    </button>
                  </div>
                  <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
                    {facts.map(([k, v]) => (
                      <div key={k} className="contents">
                        <dt className="text-muted-foreground">{k}</dt>
                        <dd className="min-w-0 break-words">{v}</dd>
                      </div>
                    ))}
                  </dl>
                  <div className="mt-5 flex gap-2">
                    <Link href={`/admin/jobs?job=${g.id}`} className="flex-1 rounded-lg bg-primary px-3 py-2.5 text-center text-sm font-medium text-primary-foreground hover:bg-primary-hover focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
                      Open in queue
                    </Link>
                    <Link href={`/admin/jobs/${g.id}`} className="flex-1 rounded-lg border px-3 py-2.5 text-center text-sm font-medium hover:bg-panel-raised focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
                      All details
                    </Link>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <Pager page={page} hasMore={hasMore} params={{ style: sp.style || undefined }} />
    </>
  );
}

import Image from "next/image";
import type { MediaSource, PublicJob } from "@/lib/jobs";
import { cn } from "@/lib/utils";
import { seeded } from "@/lib/seeded";
import { youtubeThumb, youtubeWatch } from "@/lib/youtube";

/** What went into the montage: the edit style and length, and the gameplay and song the user gave (with YouTube's stills).
 * No client hooks, so the user's job page and the admin job pane both use it. */
export function MadeFrom({
  title,
  durationSec,
  sources,
  showEdit = true,
}: {
  title: string;
  durationSec: number;
  sources: PublicJob["sources"];
  showEdit?: boolean;
}) {
  const { gameplay, song } = sources;
  return (
    <section aria-label="Made from" className="flex flex-col gap-3 rounded-xl border bg-panel p-4">
      {/* Off where the style and length already head the view (the admin job pane). */}
      {showEdit && (
        <p className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm">
          <span className="text-muted-foreground">Edit</span>
          <span>
            {title} · <span className="font-mono tabular">{durationSec} s</span>
          </span>
        </p>
      )}
      <ul className="flex flex-col gap-2">
        <SourceRow label="Gameplay" kind="video" source={gameplay} fallback="Your uploaded video" />
        {song && <SourceRow label="Song" kind="audio" source={song} fallback="Your song" />}
      </ul>
    </section>
  );
}

function SourceRow({ label, kind, source, fallback }: { label: string; kind: "video" | "audio"; source: MediaSource; fallback: string }) {
  const body = (
    <>
      <span className="relative aspect-video w-24 shrink-0 overflow-hidden rounded-md bg-panel-raised">
        {source.youtubeId ? (
          <Image src={youtubeThumb(source.youtubeId)} alt="" fill sizes="96px" className="object-cover" />
        ) : kind === "audio" ? (
          <Waveform seed={source.title ?? "song"} />
        ) : (
          <FilmFrame />
        )}
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className={cn("line-clamp-2 text-sm", source.title ? "text-foreground" : "text-muted-foreground")}>
          {source.title ?? (source.youtubeId ? "YouTube video" : fallback)}
        </span>
      </span>
    </>
  );
  return (
    <li>
      {source.youtubeId ? (
        <a
          href={youtubeWatch(source.youtubeId)}
          target="_blank"
          rel="noopener noreferrer"
          className="-mx-2 flex items-center gap-3 rounded-lg p-2 transition-colors hover:bg-panel-raised focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          {body}
          <span className="sr-only"> (opens YouTube)</span>
        </a>
      ) : (
        <div className="flex items-center gap-3 py-2">{body}</div>
      )}
    </li>
  );
}

// Previews for uploaded files, which have no YouTube still: drawn, no image to load.

/** A song file: a waveform, its bars shaped by the file's name so each file looks its own and never changes. */
function Waveform({ seed }: { seed: string }) {
  // seeded() wants a number: hash the name, or every file would get the same shape
  const next = seeded([...seed].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7));
  const bars = Array.from({ length: 21 }, (_, i) => {
    const edge = Math.sin(((i + 0.5) / 21) * Math.PI); // quieter at the ends, like a track's intro and outro
    return Math.max(0.12, edge * (0.35 + 0.65 * next()));
  });
  return (
    <svg viewBox="0 0 96 54" className="size-full" aria-hidden>
      <rect x="4" y="26.5" width="88" height="1" className="fill-border" />
      {bars.map((h, i) => (
        <rect key={i} x={5 + i * 4.2} y={27 - h * 20} width="2.2" height={h * 40} rx="1.1" className={i % 7 === 3 ? "fill-danger" : "fill-muted-foreground"} />
      ))}
    </svg>
  );
}

/** A video file: a film frame with sprocket holes and a play mark. */
function FilmFrame() {
  const holes = Array.from({ length: 8 }, (_, i) => 6 + i * 11.5);
  return (
    <svg viewBox="0 0 96 54" className="size-full" aria-hidden>
      {holes.map((x) => (
        <g key={x}>
          <rect x={x} y="3" width="5" height="4" rx="1" className="fill-border" />
          <rect x={x} y="47" width="5" height="4" rx="1" className="fill-border" />
        </g>
      ))}
      <rect x="3" y="10" width="90" height="34" rx="3" className="fill-background" />
      <circle cx="48" cy="27" r="9" className="fill-none stroke-muted-foreground" strokeWidth="1.5" />
      <path d="M45.5 22.5 L53 27 L45.5 31.5 Z" className="fill-muted-foreground" />
    </svg>
  );
}

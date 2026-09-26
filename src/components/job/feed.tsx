import { Check, Crosshair, X } from "lucide-react";
import { cn } from "@/lib/utils";

// The one signature element: rows styled like an in-game kill feed, in a 9:16 frame.

export function Frame({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <div className={cn("relative aspect-[9/16] w-full overflow-hidden rounded-2xl border bg-panel", className)}>{children}</div>;
}

type Tone = "you" | "other" | "active" | "done" | "failed";

export function FeedRow({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "flex max-w-full items-center gap-2 rounded-[3px] border-l-2 bg-black/70 px-2.5 py-1.5 text-[13px] leading-tight",
        tone === "you" && "border-danger text-foreground",
        tone === "active" && "border-danger text-foreground",
        tone === "other" && "border-transparent text-muted-foreground",
        tone === "done" && "border-transparent text-muted-foreground",
        tone === "failed" && "border-danger text-danger",
      )}
    >
      {children}
    </div>
  );
}

/** Stages as kill-feed rows: finished ones dim, the current one marked. */
export function StageFeed({ stages, stage, status, detail }: { stages: string[]; stage: string | null; status: "queued" | "running" | "succeeded" | "failed"; detail?: string | null }) {
  if (status === "queued" || (status === "running" && !stage)) {
    return (
      <FeedRow tone="active">
        <Pulse /> Waiting for an editing server
      </FeedRow>
    );
  }
  const current = stage ? stages.indexOf(stage) : -1;
  const shown = status === "succeeded" ? stages : stages.slice(0, current + 1);
  return (
    <>
      {shown.map((label, i) => {
        const isCurrent = i === current && status !== "succeeded";
        const tone: Tone = isCurrent ? (status === "failed" ? "failed" : "active") : "done";
        return (
          <FeedRow key={label} tone={tone}>
            {isCurrent ? status === "failed" ? <X className="size-3.5 shrink-0" aria-hidden /> : <Pulse /> : <Check className="size-3.5 shrink-0" aria-hidden />}
            <span className="truncate">{label}</span>
            {isCurrent && detail && status === "running" && <span className="shrink-0 font-mono text-[11px] text-muted-foreground tabular">{detail}</span>}
          </FeedRow>
        );
      })}
    </>
  );
}

function Pulse() {
  return (
    <span className="relative flex size-2 shrink-0" aria-hidden>
      <span className="absolute inline-flex size-full animate-ping rounded-full bg-danger opacity-60 motion-reduce:hidden" />
      <span className="relative inline-flex size-2 rounded-full bg-danger" />
    </span>
  );
}

export function KillRow({ killer, victim, you }: { killer: string; victim: string; you: boolean }) {
  return (
    <FeedRow tone={you ? "you" : "other"}>
      <span className="max-w-[9rem] truncate font-medium">{killer}</span>
      <Crosshair className="size-3.5 shrink-0 opacity-70" aria-hidden />
      <span className="max-w-[7rem] truncate">{victim}</span>
    </FeedRow>
  );
}

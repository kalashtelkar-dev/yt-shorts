import type { TimelineLane } from "@/server/admin/queries";

// One colour per engine kind; util steps (text and number helpers, milliseconds each) are left out.
export const KIND: Record<string, { label: string; fill: string }> = {
  "media-fetch": { label: "Downloader", fill: "fill-series-fetch" },
  video: { label: "Video tools", fill: "fill-series-video" },
  ocr: { label: "OCR", fill: "fill-series-ocr" },
  llm: { label: "AI model", fill: "fill-series-llm" },
  transcribe: { label: "Audio AI", fill: "fill-series-audio" },
  "voice-activity": { label: "Audio AI", fill: "fill-series-audio" },
};

/** 7.24 → "7.2 s", 316.2 → "5 min 16 s" */
export function secs(s: number): string {
  if (s < 10) return `${s.toFixed(1)} s`;
  const r = Math.round(s);
  return r < 60 ? `${r} s` : `${Math.floor(r / 60)} min ${r % 60} s`;
}

type Bar = { step: string; engine: string; start: number; end: number; running: boolean; items: string };

/** Lanes of timed bars on one clock (seconds from the job's first step). */
export function timelineBars(lanes: TimelineLane[], now: number) {
  const at = (iso: string | null | undefined) => (iso ? Date.parse(iso) : NaN);
  const t0 = Math.min(...lanes.flatMap((l) => l.steps.map((s) => at(s.startedAt)).filter(Number.isFinite)));
  const rows = lanes.map((l) => {
    const bars: Bar[] = l.steps
      .filter((s) => s.engine && KIND[s.engine] && Number.isFinite(at(s.startedAt)))
      .map((s) => {
        const running = !s.finishedAt && s.status === "running";
        const end = running ? now : Number.isFinite(at(s.finishedAt)) ? at(s.finishedAt) : at(s.startedAt);
        const items = s.items ? ` · ${s.items.done}/${s.items.total} items` : "";
        return { step: s.step, engine: s.engine!, start: (at(s.startedAt) - t0) / 1000, end: (end - t0) / 1000, running, items };
      })
      .filter((b) => b.running || b.end - b.start >= 0.1)
      .sort((a, b) => a.start - b.start);
    return { name: l.name, bars, from: Math.min(...bars.map((b) => b.start)), to: Math.max(...bars.map((b) => b.end)) };
  });
  return rows.filter((r) => r.bars.length);
}

import "server-only";
import { seeded } from "@/lib/seeded";

// Lyric lines for the lyrical style: the song-index's aligned segments, cut into on-screen lines of 3–5 words.
// A line never mixes two segments, runs from its first word's start to its last word's end, and is split into two
// rows when it's too wide for one (l2 is then the second row). Times are song seconds, which equal montage seconds.
// Each line gets a random spot p (0-5, pipelines/build.py SPOTS: upper or lower third, left, middle or right), never the
// same as the line before; the seed makes one job's spots repeatable.

type Word = { word?: unknown; start?: unknown; end?: unknown };
type Segment = { start?: unknown; end?: unknown; words?: Word[] };
export type LyricLine = { start: number; end: number; l1: string; l2: string; p: number };
const SPOTS = 6;

const MAX_WORDS = 5;
const MAX_ROW = 16; // characters per row; the style's font sizes fit this across the frame
const HOLD_GAP = 0.3; // a line stays up until the next one when the gap is shorter than this
const MIN_SHOW = 0.25;
const SLUR = /n[i1!]gg|f[a@]gg?[o0]?t|retard/i;

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);
const round = (x: number) => Math.round(x * 100) / 100;
/** English letters, digits, curly apostrophes and hyphens only: a straight quote would end ffmpeg's quoted text. */
const clean = (w: unknown) =>
  String(w ?? "")
    .replace(/'/g, "’")
    .replace(/[^A-Za-z0-9’-]/g, "");

/** Sizes of n words cut as evenly as possible into groups of at most 5 (7 → 4+3, 11 → 4+4+3). */
function groupSizes(n: number): number[] {
  const k = Math.ceil(n / MAX_WORDS);
  return Array.from({ length: k }, (_, i) => Math.floor(n / k) + (i < n % k ? 1 : 0));
}

/** One or two rows, split at the word boundary that keeps the longer row shortest. */
function rows(words: string[]): [string, string] {
  const all = words.join(" ");
  if (all.length <= MAX_ROW || words.length < 2) return [all, ""];
  let best: [string, string] = [all, ""];
  for (let i = 1; i < words.length; i++) {
    const r: [string, string] = [words.slice(0, i).join(" "), words.slice(i).join(" ")];
    if (best[1] === "" || Math.max(r[0].length, r[1].length) < Math.max(best[0].length, best[1].length)) best = r;
  }
  return best;
}

export function lyricLines(segments: unknown, seed: string | number = 1): LyricLine[] {
  const lines: LyricLine[] = [];
  for (const seg of Array.isArray(segments) ? (segments as Segment[]) : []) {
    const raw = (Array.isArray(seg?.words) ? seg.words : []).map((w) => ({ text: clean(w.word), start: num(w.start), end: num(w.end) }));
    // aligners leave some words (numbers, shouts) untimed: borrow the neighbours' times
    for (let i = 0; i < raw.length; i++) {
      raw[i].start ??= raw[i - 1]?.end ?? num(seg.start);
      raw[i].end ??= raw.slice(i + 1).find((w) => w.start !== null)?.start ?? num(seg.end);
    }
    const words = raw.filter((w) => w.text && !SLUR.test(w.text) && w.start !== null && w.end !== null) as { text: string; start: number; end: number }[];
    let at = 0;
    for (const size of groupSizes(words.length)) {
      const group = words.slice(at, (at += size));
      const [l1, l2] = rows(group.map((w) => w.text));
      lines.push({ start: round(group[0].start), end: round(Math.max(group.at(-1)!.end, group[0].start)), l1, l2, p: 0 });
    }
  }
  lines.sort((a, b) => a.start - b.start);
  for (let i = 0; i < lines.length; i++) {
    const next = lines[i + 1];
    if (next && next.start - lines[i].end < HOLD_GAP) lines[i].end = Math.max(lines[i].start, next.start); // hold, never overlap
    if (lines[i].end - lines[i].start < MIN_SHOW) lines[i].end = round(next ? Math.min(lines[i].start + MIN_SHOW, next.start) : lines[i].start + MIN_SHOW);
  }
  const next = seeded(seed);
  const kept = lines.filter((l) => l.end > l.start);
  kept.forEach((l, i) => {
    const before = i ? kept[i - 1].p : -1;
    l.p = Math.floor(next() * (SPOTS - (before < 0 ? 0 : 1)));
    if (before >= 0 && l.p >= before) l.p++; // any spot but the last one
  });
  return kept;
}

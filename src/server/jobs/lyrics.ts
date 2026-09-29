import "server-only";
import { seeded } from "@/lib/seeded";

// Lyrics for the lyrical style, karaoke-style: the song-index's aligned segments are cut into lines of 3–5 words (never
// mixing two segments, two rows when wider than 16 characters). A line builds up word by word as each word is sung,
// stays until its last word ends, then vanishes and the next line starts. Every line gets a random spot p (0-5,
// pipelines/build.py SPOTS: upper or lower third, left, middle or right), never the same as the line before; the seed
// makes one job's spots repeatable. Times are song seconds, which equal montage seconds.
//
// Words never show before the voice: an aligner often stretches a phrase's first word back over the music before it, so a
// word whose start falls where the vocals stem is silent (song-index's voice-activity segments) moves to the moment the
// voice comes in, if that's before the word ends. Without voice data, or when the voice isn't found inside the word, the
// aligner's time stands.
//
// The pipeline draws one item per step: t is the row so far, shown from s to e. n is the full row's length, so every
// step of a row starts at the same x (the row doesn't shift as words are added). r: 0 a one-row line, 1 and 2 the top
// and bottom rows of a two-row line.

type Word = { word?: unknown; start?: unknown; end?: unknown };
type Segment = { start?: unknown; end?: unknown; words?: Word[] };
type Timed = { text: string; start: number; end: number };
export type LyricItem = { s: number; e: number; t: string; r: 0 | 1 | 2; n: number; p: number };

const MAX_WORDS = 5;
const MAX_ROW = 16; // characters per row; the style's font sizes fit this across ~72% of the frame
const HOLD_GAP = 0.3; // a line stays up until the next one when the gap is shorter than this
const MIN_SHOW = 0.25;
const SPOTS = 6;
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

/** Where a line breaks into two rows (0 = one row): the word boundary that keeps the longer row shortest. */
function rowBreak(words: string[]): number {
  if (words.join(" ").length <= MAX_ROW || words.length < 2) return 0;
  let best = 1;
  const longer = (i: number) => Math.max(words.slice(0, i).join(" ").length, words.slice(i).join(" ").length);
  for (let i = 2; i < words.length; i++) if (longer(i) < longer(best)) best = i;
  return best;
}

const VOICE_EDGE = 0.05; // seconds of slack at a voiced stretch's edges

/** Voiced stretches from voice-activity segments ({start, end} or [start, end]), in time order. */
function voiced(voice: unknown): [number, number][] {
  return (Array.isArray(voice) ? voice : [])
    .map((v) => (Array.isArray(v) ? [num(v[0]), num(v[1])] : [num((v as Word)?.start), num((v as Word)?.end)]))
    .filter((v): v is [number, number] => v[0] !== null && v[1] !== null && v[1] > v[0])
    .sort((a, b) => a[0] - b[0]);
}

/** The word's start, moved to where the voice comes in when the aligner put it in silence. */
function onVoice(w: Timed, spans: [number, number][]): number {
  if (!spans.length || spans.some(([a, b]) => w.start >= a - VOICE_EDGE && w.start <= b + VOICE_EDGE)) return w.start;
  const next = spans.find(([a]) => a > w.start);
  return next && next[0] < w.end ? next[0] : w.start;
}

export function lyricItems(segments: unknown, seed: string | number = 1, voice?: unknown): LyricItem[] {
  const spans = voiced(voice);
  const lines: { words: Timed[]; start: number; end: number }[] = [];
  for (const seg of Array.isArray(segments) ? (segments as Segment[]) : []) {
    const raw = (Array.isArray(seg?.words) ? seg.words : []).map((w) => ({ text: clean(w.word), start: num(w.start), end: num(w.end) }));
    // aligners leave some words (numbers, shouts) untimed: borrow the neighbours' times
    for (let i = 0; i < raw.length; i++) {
      raw[i].start ??= raw[i - 1]?.end ?? num(seg.start);
      raw[i].end ??= raw.slice(i + 1).find((w) => w.start !== null)?.start ?? num(seg.end);
    }
    const words = (raw.filter((w) => w.text && !SLUR.test(w.text) && w.start !== null && w.end !== null) as Timed[]).map((w) => ({ ...w, start: onVoice(w, spans) }));
    let at = 0;
    for (const size of groupSizes(words.length)) {
      const group = words.slice(at, (at += size));
      lines.push({ words: group, start: group[0].start, end: Math.max(group.at(-1)!.end, group[0].start) });
    }
  }
  lines.sort((a, b) => a.start - b.start);
  for (let i = 0; i < lines.length; i++) {
    const next = lines[i + 1];
    if (next && next.start - lines[i].end < HOLD_GAP) lines[i].end = Math.max(lines[i].start, next.start); // hold, never overlap
    if (lines[i].end - lines[i].start < MIN_SHOW) lines[i].end = next ? Math.min(lines[i].start + MIN_SHOW, next.start) : lines[i].start + MIN_SHOW;
  }

  const random = seeded(seed);
  const items: LyricItem[] = [];
  let spot = -1;
  for (const line of lines.filter((l) => l.end > l.start)) {
    const p = Math.floor(random() * (spot < 0 ? SPOTS : SPOTS - 1));
    spot = spot >= 0 && p >= spot ? p + 1 : p; // any spot but the last one
    const cut = rowBreak(line.words.map((w) => w.text));
    const rows = cut ? [line.words.slice(0, cut), line.words.slice(cut)] : [line.words];
    rows.forEach((row, ri) => {
      const r = (cut ? ri + 1 : 0) as 0 | 1 | 2;
      const n = row.map((w) => w.text).join(" ").length;
      row.forEach((w, k) => {
        // each step shows until the next word of this row starts; a row's last step stays until the line ends
        const s = Math.min(Math.max(w.start, line.start), line.end);
        const e = k < row.length - 1 ? Math.min(row[k + 1].start, line.end) : line.end;
        if (e > s) items.push({ s: round(s), e: round(e), t: row.slice(0, k + 1).map((x) => x.text).join(" "), r, n, p: spot });
      });
    });
  }
  return items;
}

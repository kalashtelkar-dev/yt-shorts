import "server-only";
import { seeded } from "@/lib/seeded";

// Lyrics for the styles that show the song's words (Smart Edit), karaoke-style: the song-index's aligned segments are cut into lines of 3–5 words (never
// mixing two segments, two rows when wider than 16 characters). A line builds up word by word as each word is sung,
// stays until its last word ends, then vanishes and the next line starts. Every line gets a random spot p (0-5,
// pipelines/build.py SPOTS: upper or lower third, left, middle or right), never the same as the line before; the seed
// makes one job's spots repeatable. Times are song seconds, which equal montage seconds.
//
// Words never show before the voice. The aligner sometimes stretches a phrase's first word back over what came before it:
// music, or an untranscribed producer tag ("Baby" at 1.07-2.71 s, sung from 2.37 s). A sung word has no silence inside it,
// so when the vocals stem (song-index's voice-activity segments) goes quiet and the voice comes in again within a word,
// the word starts at that last entry. Without voice data, or with no entry inside the word, the aligner's time stands.
//
// The pipeline draws one item per step: t is the row so far, shown from s to e. n is the full row's length, so every
// step of a row starts at the same x (the row doesn't shift as words are added). r: 0 a one-row line, 1 and 2 the top
// and bottom rows of a two-row line. a and b are the line's start and end: the line slides in from side (ix, iy) over its
// first moments and slides out toward side (ox, oy) after b, so every step of a line moves as one piece. Sides are -1/0/1
// on each axis (left, right, top or bottom), picked per line; a row's last step stays up SLIDE_OUT longer to slide away.

type Word = { word?: unknown; start?: unknown; end?: unknown };
type Segment = { start?: unknown; end?: unknown; words?: Word[] };
type Timed = { text: string; start: number; end: number };
export type LyricItem = { s: number; e: number; t: string; r: 0 | 1 | 2; n: number; p: number; a: number; b: number; ix: number; iy: number; ox: number; oy: number };

const MAX_WORDS = 5;
const MAX_ROW = 16; // characters per row; the style's font sizes fit this across ~72% of the frame
const HOLD_GAP = 0.3; // a line stays up until the next one when the gap is shorter than this
const MIN_SHOW = 0.25;
const SPOTS = 6;
const SIDES = [[-1, 0], [1, 0], [0, -1], [0, 1]] as const; // left, right, top, bottom
const SLIDE_OUT = 0.2; // seconds a line takes to slide out after its end
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

const VOICE_EDGE = 0.05; // seconds of slack after the aligner's start
const VOICE_TAIL = 0.1; // an entry this close to the word's end is the next word's

/** Voiced stretches from voice-activity segments ({start, end} or [start, end]), in time order. */
function voiced(voice: unknown): [number, number][] {
  return (Array.isArray(voice) ? voice : [])
    .map((v) => (Array.isArray(v) ? [num(v[0]), num(v[1])] : [num((v as Word)?.start), num((v as Word)?.end)]))
    .filter((v): v is [number, number] => v[0] !== null && v[1] !== null && v[1] > v[0])
    .sort((a, b) => a[0] - b[0]);
}

/** The word's start: the last point inside the word where the voice comes in, else the aligner's start. */
function onVoice(w: Timed, spans: [number, number][]): number {
  const entries = spans.map(([a]) => a).filter((a) => a > w.start + VOICE_EDGE && a < w.end - VOICE_TAIL);
  return entries.length ? Math.max(...entries) : w.start;
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
    const [ix, iy] = SIDES[Math.floor(random() * SIDES.length)];
    const [ox, oy] = SIDES[Math.floor(random() * SIDES.length)];
    const a = round(line.start), b = round(line.end);
    const cut = rowBreak(line.words.map((w) => w.text));
    const rows = cut ? [line.words.slice(0, cut), line.words.slice(cut)] : [line.words];
    rows.forEach((row, ri) => {
      const r = (cut ? ri + 1 : 0) as 0 | 1 | 2;
      const n = row.map((w) => w.text).join(" ").length;
      row.forEach((w, k) => {
        // each step shows until the next word of this row starts; a row's last step stays until the line has slid out
        const s = Math.min(Math.max(w.start, line.start), line.end);
        const e = k < row.length - 1 ? Math.min(row[k + 1].start, line.end) : line.end + SLIDE_OUT;
        if (e > s) items.push({ s: round(s), e: round(e), t: row.slice(0, k + 1).map((x) => x.text).join(" "), r, n, p: spot, a, b, ix, iy, ox, oy });
      });
    });
  }
  return items;
}

// The lyrics are drawn from a subtitle file (libass), one event per piece of a step, so the render's command no longer
// grows with every word (drawtext did, ~420 characters a word: a wordy 90 s song passed Linux's 128 KiB limit on one
// argument, spawn E2BIG, 2026-10-01). Subtitles do no arithmetic, so every time, spot, slide and fade is a number here;
// the pipeline adds the look (font, size, colours) and replaces each event's "@L" with the look's shadow offsets.
const X = [70, 540, 1010]; // a row's left edge, centre or right edge, by spot (p % 3) on the 1080 px frame
const Y = [653, 1229]; // a line's middle, upper or lower third (h*0.34, h*0.64 of 1920), by spot (p / 3)
const SLIDE_IN = 0.18; // seconds a line takes to slide in as its first word is sung
const SLIDE = 240; // px sideways
const SLIDE_Y = 160; // px up or down
const PIECES = 3; // a slide eases (a curve); libass moves in straight lines, so each slide is drawn as 3 straight moves
// Per look (the lyricLook digit; pipelines/build.py LOOKS, same order): drawtext's line height at the look's size, and
// how much lower libass draws a top-aligned line than drawtext drew one at the same y. With them a row lands where
// drawtext put it (centred on its spot's height, or 8 px above and below it for two rows); libass's own line boxes are
// taller and differ per font (Bungee's two rows came out 90 px further apart). Measured 2026-10-01 with ffmpeg 7.1.
const LOOK_ROWS: [lineHeight: number, shift: number][] = [[145, 53], [66, 19], [91, 65], [78, 22], [77, 13], [85, 26], [81, 15], [96, 21], [66, 12], [88, 16]];

const assTime = (sec: number) => {
  const cs = Math.max(0, Math.round(sec * 100));
  const two = (n: number) => String(n).padStart(2, "0");
  return `${Math.floor(cs / 360000)}:${two(Math.floor(cs / 6000) % 60)}:${two(Math.floor(cs / 100) % 60)}.${two(cs % 100)}`;
};
const assAlpha = (opacity: number) => `&H${Math.round((1 - opacity) * 255).toString(16).toUpperCase().padStart(2, "0")}&`;

/**
 * The subtitle events for these lyric items ([Events] lines, after a comment line so the text is never empty). Only
 * lines that start from `fromSec` (Smart Edit keeps its intro clear) and steps that start before `untilSec` (the
 * montage's length: only that much of the song is used) are kept. Each step shows its whole row with the
 * words not sung yet invisible, so the row is laid out once and never shifts as it builds; one-row lines are centred on
 * their spot's height, two-row lines sit 8 px above and below it, placed for the job's `look`. The slide and the fade follow the drawtext version:
 * in from side (ix, iy) easing out over SLIDE_IN from a, out toward (ox, oy) easing in over SLIDE_OUT after b.
 */
export function lyricEvents(items: LyricItem[], fromSec = 0, untilSec = Infinity, look: string | number = 0): string {
  const [lh, shift] = LOOK_ROWS[Number(look)] ?? LOOK_ROWS[0]; // an unknown look is look 0, as in the pipeline
  const rowKey = (it: LyricItem) => `${it.a}|${it.r}|${it.p}`;
  const fullRow = new Map<string, string>(); // a row's last step is the whole row
  for (const it of items) if (it.t.length > (fullRow.get(rowKey(it))?.length ?? -1)) fullRow.set(rowKey(it), it.t);
  const out = ["; lyrics"];
  for (const it of items) {
    if (!it.t || it.a < fromSec || it.s >= untilSec) continue;
    const col = it.p % 3;
    const x = X[col];
    // the row's top, as drawtext had it (y - lh/2 for one row; y - lh - 8 and y + 8 for two), moved up by the look's shift
    const y = Y[Math.floor(it.p / 3) % 2] + (it.r === 1 ? -lh - 8 : it.r === 2 ? 8 : -lh / 2) - shift;
    const an = 7 + col; // top-aligned; left, centre or right
    const at = (t: number) => {
      const slideIn = Math.max(0, 1 - (t - it.a) / SLIDE_IN) ** 2, slideOut = Math.max(0, (t - it.b) / SLIDE_OUT) ** 2;
      return {
        x: Math.round(x + it.ix * SLIDE * slideIn + it.ox * SLIDE * slideOut),
        y: Math.round(y + it.iy * SLIDE_Y * slideIn + it.oy * SLIDE_Y * slideOut),
        opacity: Math.max(0, Math.min(1, (t - it.a) / SLIDE_IN)) * (1 - Math.min(1, Math.max(0, (t - it.b) / SLIDE_OUT))),
      };
    };
    const cuts = [it.s, it.e];
    for (let j = 0; j <= PIECES; j++) cuts.push(it.a + (SLIDE_IN * j) / PIECES, it.b + (SLIDE_OUT * j) / PIECES);
    const times = [...new Set(cuts.map(round))].filter((t) => t >= it.s && t <= it.e).sort((p, q) => p - q);
    const rest = fullRow.get(rowKey(it))!.slice(it.t.length);
    const text = it.t + (rest ? `{\\alpha&HFF&}${rest}` : "");
    for (let k = 0; k + 1 < times.length; k++) {
      const from = at(times[k]), to = at(times[k + 1]);
      const place = from.x === to.x && from.y === to.y ? `\\pos(${from.x},${from.y})` : `\\move(${from.x},${from.y},${to.x},${to.y})`;
      const fade =
        from.opacity === 1 && to.opacity === 1 ? "" : from.opacity === to.opacity ? `\\alpha${assAlpha(from.opacity)}` : `\\alpha${assAlpha(from.opacity)}\\t(\\alpha${assAlpha(to.opacity)})`;
      out.push(`Dialogue: 0,${assTime(times[k])},${assTime(times[k + 1])},L,,0,0,0,,{@L\\an${an}${place}${fade}}${text}`);
    }
  }
  return out.join("\n");
}

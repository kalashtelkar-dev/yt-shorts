import "server-only";

// The song's beat and drop, measured before the planner sees the song (it used to guess them from hundreds of loudness
// numbers and put the drop outside the montage, 2026-09-30). Input: the song reader's loudness, "seconds,RMS dB" per
// line (0.05 s steps; the older 0.25 s steps parse too but miss some tempos by 0.1-0.3 s).
// Checked on six real songs (2026-09-30): the four with a known tempo came out within 4 ms.

export type SongBeats = { beatSec: number; beats: number[]; dropAtSec: number | null };

const SEARCH_SEC = 60; // the tempo is read from the song's first minute
const MIN_BEAT = 0.3, MAX_BEAT = 1.0, FAST_BEAT = 0.75; // prettier-ignore
const QUIET_DB = -35; // a lift from below this is the music starting, not a drop
const MIN_LIFT_DB = 6;

function parse(loudness: string): { t: number[]; db: number[] } {
  const t: number[] = [], db: number[] = []; // prettier-ignore
  for (const line of loudness.split("\n")) {
    const [a, b] = line.split(",");
    if (!a?.trim() || b === undefined) continue; // Number("") is 0: a blank line isn't a sample at 0 s
    const time = Number(a);
    if (!Number.isFinite(time)) continue;
    const level = Number(b);
    t.push(time);
    db.push(Number.isFinite(level) ? Math.max(-100, level) : -100); // "-inf" is silence
  }
  return { t, db };
}

const round2 = (x: number) => Math.round(x * 100) / 100;

/** Beat length, the beat times up to `capSec` (montage seconds = song seconds) and the drop inside them, or null if unreadable. */
export function songBeats(loudness: string, capSec: number): SongBeats | null {
  const { t, db } = parse(loudness);
  if (t.length < 40) return null;
  const step = (t[t.length - 1] - t[0]) / (t.length - 1);
  if (!(step > 0) || step > 0.5) return null;

  // How much louder each frame is than the one before: beats are where the sound jumps.
  const onset = db.map((d, i) => (i ? Math.max(0, d - db[i - 1]) : 0));
  const n = Math.min(onset.length - 1, Math.floor(SEARCH_SEC / step));
  const at = (sec: number) => {
    const x = sec / step, i = Math.floor(x), f = x - i; // prettier-ignore
    return i + 1 < n ? onset[i] * (1 - f) + onset[i + 1] * f : 0;
  };
  // Every beat length (1 ms steps) at every starting point (10 ms steps): the grid that lands on the most jumps wins.
  let best = { score: -1, beat: 0.5, first: 0 };
  const window = n * step;
  for (let ms = MIN_BEAT * 1000; ms <= MAX_BEAT * 1000; ms++) {
    const beat = ms / 1000;
    for (let first = 0; first < beat; first += 0.01) {
      let sum = 0, count = 0; // prettier-ignore
      for (let x = first; x < window; x += beat) {
        sum += at(x);
        count++;
      }
      const score = count ? sum / count : 0;
      if (score > best.score) best = { score, beat, first };
    }
  }
  // A slow grid is often every other beat: halve it into the range montages cut to.
  let { beat } = best;
  while (beat > FAST_BEAT) beat /= 2;
  const first = best.first % beat;

  const beats: number[] = [];
  for (let x = first; x <= capSec + 1e-9; x += beat) beats.push(round2(x));

  // The drop: the biggest 2 s lift in level inside the montage, with music already playing before it, on the nearest beat.
  const mean = (a: number, b: number) => {
    let sum = 0, count = 0; // prettier-ignore
    for (let i = Math.max(0, Math.ceil((a - t[0]) / step)); i < t.length && t[i] < b; i++) {
      sum += db[i];
      count++;
    }
    return count ? sum / count : -100;
  };
  let drop: { lift: number; at: number } | null = null;
  for (let x = 2; x <= capSec - 1; x += step) {
    const before = mean(x - 2, x);
    if (before < QUIET_DB) continue;
    const lift = mean(x, x + 2) - before;
    if (lift >= MIN_LIFT_DB && (!drop || lift > drop.lift)) drop = { lift, at: x };
  }
  const nearest = drop && beats.reduce((a, b) => (Math.abs(b - drop.at) < Math.abs(a - drop.at) ? b : a), beats[0]);
  return { beatSec: Math.round(beat * 1000) / 1000, beats, dropAtSec: nearest ?? null };
}

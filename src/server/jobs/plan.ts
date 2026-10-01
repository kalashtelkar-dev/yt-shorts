import "server-only";

// The montage's clip list, planned in code from measured data (the user's call, 2026-09-30). The planner model it replaces
// kept every hard rule but not the timing: on real jobs its cuts sat 0.29 s off the beat, it planned 78 s for 30 s, and
// slow motion landed outside the video. The style pipelines still check every clip (starts, speeds, lengths, one per kill).
// The rules are the ones the pipelines were built with (pipelines/build.py: HOLD, LEAD_*, ULTRA_*).

/** "ultra" is Smart Edit (its pipeline is still style-ultra-edit). */
export type PlanStyle = "kill" | "ultra";
export type KillEntry = { t: number; more?: string };
/** kill: the entry's t; 0 for the intro, -1 for the outro (the pipeline keeps one clip per kill value). */
export type Clip = { id: number; start: number; len: number; speed: number; role: "flex" | "kill"; kill: number };
export type Plan = { beatSec: number; dropAtSec: number; clips: Clip[]; totalKills: number };

const HOLD: Record<number, number> = { 15: 1, 30: 1.5, 60: 2, 90: 4 }; // seconds a kill stays on screen, by the length picked
const DEFAULT_HOLD = 2;
const LEAD_NORMAL = 2.5,
  LEAD_SLOW = 1.0,
  ULTRA_LEAD = 2.0; // prettier-ignore — the kill's place in its clip
const MAX_LEN = 20; // the pipeline drops longer clips
const ULTRA_CLIP_SEC = 6.669; // an Ultra kill clip's fixed warp (build.py ULTRA_CLIP_SEC)
const ULTRA_WINDOW = [-2, 4]; // the recording an Ultra kill clip shows, around its kill
// A clip ends this long before the player's death shows in the kill feed (its time is only good to the second), so a
// montage shows kills and never the player dying (the user, 2026-09-30).
const DEATH_MARGIN = 1;
const DROP_INSIDE = 0.5; // "on the drop": the slow clip plays at least this long past the drop

const round2 = (x: number) => Math.round(x * 100) / 100;
/** A clip's start in the recording: `lead` s before its kill, never before 0 (the pipeline's allowed starts do the same). */
const startOf = (t: number, lead: number) => round2(Math.max(0, t - lead));
/** The more offsets of a multi-kill ("+5 s, +7.5 s") as numbers. */
const offsets = (more?: string) => (more ? [...more.matchAll(/\+?(\d+(?:\.\d+)?)/g)].map((m) => Number(m[1])) : []);

export type PlanInput = {
  style: PlanStyle;
  kills: KillEntry[]; // in this run's order (shuffled by the app)
  flexStarts: number[]; // intro moments, recording seconds
  deaths: number[]; // when the player died, recording seconds (kill-feed rows with the player as the victim)
  beats: number[]; // montage seconds, up to the length
  beatSec: number;
  dropAtSec: number | null;
  lengthSec: number; // the length the user picked (sets the hold)
  capSec: number; // min(length, song)
  variation: string; // "Put the slow-motion clip first." etc. (create.ts SLOW_AT)
};

/** The first beat at or after `from` and no later than `to`, else null. */
function beatIn(beats: number[], from: number, to: number) {
  return beats.find((b) => b >= from - 1e-6 && b <= to + 1e-6) ?? null;
}
function nearestBeat(beats: number[], target: number, from: number, to: number) {
  const inRange = beats.filter((b) => b >= from - 1e-6 && b <= to + 1e-6);
  return inRange.length ? inRange.reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a)) : null;
}

function introEnd(p: PlanInput): number {
  if (p.style === "kill") {
    // 2-4 s, ending on the drop if it comes within 4 s, else on a beat around 3 s
    if (p.dropAtSec !== null && p.dropAtSec >= 2 && p.dropAtSec <= 4) return p.dropAtSec;
    return nearestBeat(p.beats, 3, 2, 4) ?? 3;
  }
  // Smart Edit: 1-1.5 s; a slow beat may have none there, so the first beat up to 2 s (the pipeline drops clips under 1 s)
  return nearestBeat(p.beats, 1.25, 1, 1.5) ?? beatIn(p.beats, 1, 2) ?? 1.25;
}

/** How much recording from `start` may play before the player's next death shows (Infinity if they don't die). */
const clearUntil = (p: PlanInput, start: number) => Math.min(...p.deaths.filter((d) => d > start).map((d) => d - DEATH_MARGIN - start), Infinity);

/** Lays the kill clips from montage time `from`, `slowAt` (an index into the kill clips, or -1) in slow motion. */
function layout(p: PlanInput, from: number, slowAt: number) {
  const hold = HOLD[p.lengthSec] ?? DEFAULT_HOLD;
  const clips: { entry: KillEntry; speed: number; len: number; at: number; end: number; shown: number[] }[] = [];
  let at = from;
  for (let i = 0; i < p.kills.length && at < p.capSec - 1e-6; i++) {
    const entry = p.kills[i];
    const slow = clips.length === slowAt;
    const speed = slow ? 0.5 : 1;
    const lead = slow ? LEAD_SLOW : LEAD_NORMAL;
    const clear = clearUntil(p, Math.max(0, entry.t - lead));
    // a multi-kill shows only its kills that are held before the player dies; slow motion shows the first kill only
    const shown = slow ? [0] : [0, ...offsets(entry.more)].filter((o) => lead + o + hold <= clear + 1e-6);
    if (!shown.length) continue; // the player dies too soon after this kill to hold it on screen: leave it out
    const minLen = Math.min(MAX_LEN, slow ? LEAD_SLOW + hold / 2 : LEAD_NORMAL + Math.max(...shown) + hold);
    if (minLen > clear + 1e-6) continue;
    // a kill clip starts only if its kill and hold fit before the end; the time left goes to an outro (planMontage)
    if (at + minLen / speed > p.capSec + 1e-6) break;
    const maxLen = Math.min(MAX_LEN, minLen + (slow ? 1 : 2), clear); // lengthened only to land the cut on a beat, never into a death
    const cut = beatIn(p.beats, at + minLen / speed, at + maxLen / speed) ?? at + minLen / speed;
    const len = round2((cut - at) * speed);
    clips.push({ entry, speed, len, at, end: cut, shown });
    at = cut;
  }
  return clips;
}

/** Which kill clip is slow motion, from the variation, among the clips that play before the end. */
function slowIndex(p: PlanInput, from: number): number {
  const normal = layout(p, from, -1);
  const shown = normal.filter((c) => c.at < p.capSec - 1e-6).length;
  if (!shown) return -1;
  const v = p.variation.toLowerCase();
  if (v.includes("on the drop")) {
    if (p.dropAtSec === null || p.dropAtSec < from) return 0; // no drop, or inside the intro: the first kill clip
    // the first clip whose slow version plays at (or starts on) the drop
    for (let i = 0; i < shown; i++) {
      const c = layout(p, from, i)[i];
      // playing through the drop (a clip that only ends on it misses the moment; one that starts on it counts)
      if (c && c.at <= p.dropAtSec + 1e-6 && c.end >= p.dropAtSec + DROP_INSIDE) return i;
      if (c && c.at > p.dropAtSec) return Math.max(0, i - 1);
    }
    return Math.floor((shown - 1) / 2);
  }
  if (v.includes("second to last")) return Math.max(0, shown - 2);
  if (v.includes("last")) return shown - 1;
  if (v.includes("middle")) return Math.floor((shown - 1) / 2);
  if (v.includes("third")) return Math.min(2, shown - 1);
  if (v.includes("second")) return Math.min(1, shown - 1);
  return 0; // "first", and anything unrecognised
}

/** The style a catalog item plans as (its slug names it; anything else plans like a kill montage). */
export const planStyle = (slug?: string): PlanStyle => (slug === "smart-edit" || slug?.includes("ultra") ? "ultra" : "kill"); // Smart Edit was "ultra-edit"

/** How long a plan plays, in seconds: an Ultra kill clip is its fixed warp, whatever its len says. */
export const planSec = (clips: Pick<Clip, "len" | "speed" | "role">[], style: PlanStyle) =>
  clips.reduce((t, c) => t + (style === "ultra" && c.role === "kill" ? ULTRA_CLIP_SEC : c.len / c.speed), 0);

/**
 * Why a finished montage is shorter than the length picked, for the result page (null when it isn't, or we don't know).
 * The planner stops at the song's end, or when the kills run out (plan.ts layout); a second either way is rounding.
 */
export function lengthNote(m: { pickedSec: number; lengthSec?: number | null; songSec?: number | null; kills?: number | null }): string | null {
  const { pickedSec, lengthSec, songSec, kills } = m;
  if (lengthSec == null || lengthSec >= pickedSec - 1) return null;
  if (songSec && songSec < pickedSec - 1 && lengthSec >= songSec - 1)
    return `Your song is ${Math.round(songSec)} s long, so your montage is too. Pick a longer song to fill all ${pickedSec} s.`;
  const found = kills ? `We found ${kills} kill${kills === 1 ? "" : "s"}, enough for ${lengthSec} s.` : `Your kills filled ${lengthSec} s.`;
  return `${found} A longer match with more kills fills all ${pickedSec} s.`;
}

export function planMontage(p: PlanInput): Plan {
  const clips: Clip[] = [];
  // the first intro moment with no death in it (a kill follows each, so there shouldn't be one; OCR can be off)
  const flexStart = p.flexStarts.find((f) => clearUntil(p, f) >= 4);
  const from = flexStart !== undefined && p.kills.length ? introEnd(p) : 0;
  if (flexStart !== undefined && p.kills.length) clips.push({ id: 1, start: flexStart, len: round2(from), speed: 1, role: "flex", kill: 0 });

  let totalKills = 0;
  let end = from;
  if (p.style === "ultra") {
    // every kill clip is the fixed 6 s warp (the pipeline sets len and speed); only whole ones, the rest is the outro
    const fit = Math.floor((p.capSec - from + 1e-6) / ULTRA_CLIP_SEC);
    // an Ultra kill clip can't be shortened (a fixed warp), so a kill with the player's death inside its window is left out
    const clean = p.kills.filter((k) => clearUntil(p, Math.max(0, k.t + ULTRA_WINDOW[0])) >= ULTRA_WINDOW[1] - ULTRA_WINDOW[0]);
    for (const k of clean.slice(0, fit)) {
      clips.push({ id: clips.length + 1, start: startOf(k.t, ULTRA_LEAD), len: 6, speed: 1, role: "kill", kill: k.t });
      totalKills++;
      end += ULTRA_CLIP_SEC;
    }
  } else {
    for (const c of layout(p, from, slowIndex(p, from))) {
      const slow = c.speed < 1;
      clips.push({
        id: clips.length + 1,
        start: startOf(c.entry.t, slow ? LEAD_SLOW : LEAD_NORMAL),
        len: c.len,
        speed: c.speed,
        role: "kill",
        kill: c.entry.t,
      });
      // kills that happen on screen before the end: the entry's own, and a multi-kill's next ones inside a normal clip
      const lead = slow ? LEAD_SLOW / 0.5 : LEAD_NORMAL;
      for (const o of c.shown) if (c.at + lead + o < p.capSec && o <= c.len - LEAD_NORMAL) totalKills++;
      end = c.end;
    }
  }
  // The end: no kill cut off mid-way (the user, 2026-09-30). Time left after the last whole kill clip is an outro, another
  // intro moment clear of deaths (a kill follows each moment 9 s in, and an outro is always shorter than a kill clip).
  const left = round2(p.capSec - end);
  const lastKill = clips.at(-1)?.role === "kill" ? clips.at(-1) : undefined;
  const outro = p.flexStarts.find((f) => f !== flexStart && clearUntil(p, f) >= left) ?? p.flexStarts.find((f) => clearUntil(p, f) >= left);
  if (left >= 1 && outro !== undefined && p.kills.length) {
    clips.push({ id: clips.length + 1, start: outro, len: left, speed: 1, role: "flex", kill: -1 });
  } else if (left > 0 && lastKill && p.style !== "ultra") {
    // under a second left: the last kill clip plays that much longer, if it stays clear of a death and under the limit
    const more = round2(left * lastKill.speed);
    if (lastKill.len + more <= MAX_LEN && clearUntil(p, lastKill.start) >= lastKill.len + more) lastKill.len = round2(lastKill.len + more);
  }
  return { beatSec: p.beatSec, dropAtSec: p.dropAtSec ?? 0, clips, totalKills };
}

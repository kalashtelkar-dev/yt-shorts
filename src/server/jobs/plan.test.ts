import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { songBeats } from "./beats";
import { lengthNote, planMontage, planSec, type PlanInput } from "./plan";

const grid = (first: number, beat: number, cap: number) => Array.from({ length: Math.floor((cap - first) / beat) + 1 }, (_, k) => Math.round((first + k * beat) * 100) / 100);
const KILLS = [640, 367, 185, 1024, 85, 391, 614, 702, 141, 120, 65, 542].map((t) => ({ t }));
const base = (over: Partial<PlanInput> = {}): PlanInput => ({
  style: "kill", kills: KILLS, flexStarts: [631], deaths: [], beats: grid(0.29, 0.671, 30), beatSec: 0.671, dropAtSec: 12.37, lengthSec: 30, capSec: 30,
  variation: "Put the slow-motion clip on the drop.", ...over,
});

/** When each clip plays in the montage. */
function timeline(clips: { len: number; speed: number }[]) {
  let at = 0;
  return clips.map((c) => {
    const w = { at, end: at + c.len / c.speed };
    at = w.end;
    return w;
  });
}
const onBeat = (x: number, beats: number[]) => beats.some((b) => Math.abs(b - x) <= 0.011);

describe("planMontage", () => {
  it("cuts on the beat, stops at the length, holds each kill, starts clips before their kill", () => {
    const p = base();
    const plan = planMontage(p);
    const t = timeline(plan.clips);
    for (const w of t.slice(0, -1)) expect(onBeat(w.end, p.beats)).toBe(true); // every cut inside the montage lands on a beat
    expect(t.at(-1)!.end).toBeCloseTo(30, 1); // it ends exactly at the length
    plan.clips.forEach((c, i) => c.role === "kill" && expect(t[i].end).toBeLessThanOrEqual(30.001)); // no kill cut off by the end
    expect(plan.clips[0]).toMatchObject({ role: "flex", start: 631, speed: 1 });
    for (const c of plan.clips.filter((x) => x.role === "kill")) {
      expect(c.len).toBeGreaterThanOrEqual(c.speed === 1 ? 4 : 1.75); // 30 s: 2.5 + 1.5 s hold, 1 + 0.75 slow
      expect(c.start).toBe(Math.round((c.kill - (c.speed === 1 ? 2.5 : 1)) * 100) / 100);
    }
    const kills = plan.clips.filter((c) => c.role === "kill").map((c) => c.kill);
    expect(kills).toEqual(KILLS.slice(0, kills.length).map((k) => k.t)); // in the run's order
  });

  it("puts the slow-motion clip on the drop, inside the video", () => {
    const plan = planMontage(base());
    const t = timeline(plan.clips);
    const slow = plan.clips.findIndex((c) => c.speed === 0.5);
    expect(slow).toBeGreaterThan(0);
    expect(plan.clips.filter((c) => c.speed === 0.5)).toHaveLength(1);
    expect(t[slow].at).toBeLessThanOrEqual(12.37);
    expect(t[slow].end).toBeGreaterThanOrEqual(12.37 + 0.5); // playing through the drop, not just ending on it
  });

  it("follows the other variations among the clips people actually see", () => {
    const at = (variation: string) => {
      const plan = planMontage(base({ variation }));
      const kills = plan.clips.filter((c) => c.role === "kill");
      return { i: kills.findIndex((c) => c.speed === 0.5), n: kills.length };
    };
    expect(at("Put the slow-motion clip first.").i).toBe(0);
    expect(at("Put the slow-motion clip second.").i).toBe(1);
    expect(at("Put the slow-motion clip third.").i).toBe(2);
    const last = at("Put the slow-motion clip last.");
    expect(last.i).toBe(last.n - 1);
    const second = at("Put the slow-motion clip second to last.");
    expect(second.i).toBe(second.n - 2);
  });

  it("a drop inside the intro: the intro ends on it and the first kill clip is slow", () => {
    const plan = planMontage(base({ dropAtSec: 3.64, beats: grid(0.29, 0.671, 30) }));
    expect(plan.clips[0].len).toBe(3.64);
    expect(plan.clips[1].speed).toBe(0.5);
  });

  it("Smart Edit intros are 1-1.5 s; no flex moment means the first kill opens the montage", () => {
    expect(planMontage(base({ style: "ultra" })).clips[0].len).toBeGreaterThanOrEqual(1);
    expect(planMontage(base({ style: "ultra" })).clips[0].len).toBeLessThanOrEqual(2); // 1.63: this song has no beat at 1-1.5 s
    expect(planMontage(base({ style: "ultra", beats: grid(0.2, 0.5, 30) })).clips[0].len).toBe(1.2);
    expect(planMontage(base({ flexStarts: [] })).clips[0].role).toBe("kill");
  });

  it("a kill in the first seconds of the recording starts its clip at 0", () => {
    expect(planMontage(base({ kills: [{ t: 1.5 }, ...KILLS], variation: "Put the slow-motion clip last." })).clips[1].start).toBe(0);
  });

  it("a multi-kill clip is long enough to hold its last kill", () => {
    const plan = planMontage(base({ kills: [{ t: 185, more: "+5 s" }, ...KILLS], variation: "Put the slow-motion clip last." }));
    expect(plan.clips[1].len).toBeGreaterThanOrEqual(2.5 + 5 + 1.5);
  });

  it("Ultra: the intro, only whole kill clips (fixed 6.67 s warps), then an outro to the end", () => {
    const plan = planMontage(base({ style: "ultra", flexStarts: [631, 358], capSec: 30 }));
    const kills = plan.clips.filter((c) => c.role === "kill");
    expect(kills).toHaveLength(4); // floor((30 - 1.63) / 6.669)
    expect(kills.every((c) => c.len === 6 && c.speed === 1 && c.start === c.kill - 2)).toBe(true);
    expect(plan.clips.at(-1)).toMatchObject({ role: "flex", start: 358, kill: -1 });
    expect(plan.clips[0].len + 4 * 6.669 + plan.clips.at(-1)!.len).toBeCloseTo(30, 1);
  });

  it("the end: no kill that can't finish; the time left is an outro flex (the user's example: kills done at 28 s, 2 s left)", () => {
    // beats every 0.5 s; intro to 3 s, then 4 s kill clips, 7 of them to 31 s: the 7th wouldn't finish, so 25 s of kills
    const p = base({ beats: grid(0, 0.5, 30), dropAtSec: null, variation: "Put the slow-motion clip first.", flexStarts: [631, 358], kills: KILLS.slice(0, 8) });
    const plan = planMontage(p);
    const t = timeline(plan.clips);
    const last = plan.clips.at(-1)!;
    expect(last).toMatchObject({ role: "flex", start: 358, kill: -1, speed: 1 }); // another intro moment, not the intro's
    expect(t.at(-1)!.end).toBeCloseTo(30, 2);
    expect(last.len).toBeGreaterThanOrEqual(1);
    expect(last.len).toBeLessThan(4); // shorter than any kill clip, so it can't reach the moment's own kill (9 s in)
  });

  it("with a real song's beats (Rolling in the Deep), 30 and 60 s", () => {
    const loudness = readFileSync(new URL("./fixtures/loudness-rolling-in-the-deep-60s.csv", import.meta.url), "utf8");
    for (const cap of [30, 60]) {
      const song = songBeats(loudness, cap)!;
      const p = base({ beats: song.beats, beatSec: song.beatSec, dropAtSec: song.dropAtSec, capSec: cap, lengthSec: cap });
      const t = timeline(planMontage(p).clips);
      for (const w of t.slice(0, -1)) expect(onBeat(w.end, song.beats)).toBe(true);
      expect(t.filter((w) => w.at >= cap)).toHaveLength(0);
    }
  });

  describe("never shows the player dying (deaths from the kill feed)", () => {
    /** Each kill clip's recording window, [start, start + len]. */
    const windows = (plan: ReturnType<typeof planMontage>) => plan.clips.filter((c) => c.role === "kill").map((c) => ({ kill: c.kill, from: c.start, to: c.start + c.len }));
    const first = { variation: "Put the slow-motion clip last." }; // slow motion out of the way of the first clips

    it("a death during a kill's hold: that kill is left out", () => {
      const plan = planMontage(base({ ...first, deaths: [641.5] })); // 640's kill, dead 1.5 s later
      expect(windows(plan).map((w) => w.kill)).not.toContain(640);
    });

    it("a death a few seconds after: the clip ends at least 1 s before it, never stretched into it", () => {
      const plan = planMontage(base({ ...first, deaths: [645.4] })); // 640: clip 637.5 + 4 s at least, a beat may add up to 2 s
      const w = windows(plan).find((x) => x.kill === 640)!;
      expect(w.to).toBeLessThanOrEqual(645.4 - 1 + 0.001);
    });

    it("a multi-kill shows only the kills before the death", () => {
      const plan = planMontage(base({ ...first, kills: [{ t: 185, more: "+5 s" }, ...KILLS], deaths: [191] }));
      const w = windows(plan).find((x) => x.kill === 185)!;
      expect(w.to).toBeLessThanOrEqual(190.001); // stops before 191 - 1, so the +5 s kill (190) isn't shown
      expect(w.to - w.from).toBeGreaterThanOrEqual(4); // but the first kill is held
    });

    it("no clip anywhere reaches a death", () => {
      const deaths = [96, 188, 395, 617, 705.5];
      for (const style of ["kill", "ultra"] as const) {
        const plan = planMontage(base({ style, deaths, flexStarts: [631, 358, 176] }));
        for (const c of plan.clips) for (const d of deaths) expect(d <= c.start || d >= c.start + c.len + 1 - 0.001).toBe(true);
      }
    });

    it("Ultra leaves out a kill with a death in its window; an intro moment with a death is passed over", () => {
      expect(planMontage(base({ style: "ultra", deaths: [642] })).clips.map((c) => c.kill)).not.toContain(640);
      expect(planMontage(base({ flexStarts: [631, 358], deaths: [632] })).clips[0].start).toBe(358);
    });
  });

  it("no kills: an empty plan", () => {
    expect(planMontage(base({ kills: [] }))).toMatchObject({ clips: [], totalKills: 0 });
  });
});

describe("planSec and lengthNote", () => {
  it("adds up how long the clips play: slow clips twice their recording, Ultra kill clips their fixed warp", () => {
    const clips = [
      { len: 3, speed: 1, role: "flex" as const },
      { len: 2, speed: 0.5, role: "kill" as const },
    ];
    expect(planSec(clips, "kill")).toBe(7);
    expect(planSec(clips, "ultra")).toBeCloseTo(3 + 6.669);
  });

  it("explains a montage shorter than picked: the song, else the kills", () => {
    expect(lengthNote({ pickedSec: 30, lengthSec: 30, songSec: 200, kills: 9 })).toBeNull();
    expect(lengthNote({ pickedSec: 30, lengthSec: 29, songSec: 200, kills: 9 })).toBeNull(); // rounding
    expect(lengthNote({ pickedSec: 30, lengthSec: null, songSec: 12, kills: 2 })).toBeNull(); // older jobs
    expect(lengthNote({ pickedSec: 30, lengthSec: 20, songSec: 20.4, kills: 6 })).toMatch(/^Your song is 20 s long.*all 30 s/);
    expect(lengthNote({ pickedSec: 30, lengthSec: 14, songSec: 200, kills: 3 })).toMatch(/^We found 3 kills, enough for 14 s\..*all 30 s/);
    expect(lengthNote({ pickedSec: 30, lengthSec: 8, songSec: 20, kills: 1 })).toMatch(/^We found 1 kill,/); // short song, but kills ran out first
  });
});

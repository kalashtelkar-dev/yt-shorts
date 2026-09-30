import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { songBeats } from "./beats";

/** A made-up song at 0.05 s steps: a hit every `beat` s from `first`, quiet between, `lift` dB louder from `dropAt`. */
function song(beat: number, first: number, seconds: number, dropAt: number | null = null, lift = 12) {
  const lines: string[] = [];
  for (let i = 0; i * 0.05 < seconds; i++) {
    const t = i * 0.05;
    const phase = (t - first + beat * 100) % beat;
    const hit = phase < 0.05 || beat - phase < 0.001;
    const base = dropAt !== null && t >= dropAt ? -20 + lift : -20;
    lines.push(`${t.toFixed(2)},${(hit ? base : base - 15).toFixed(2)}`);
  }
  return lines.join("\n");
}

describe("songBeats", () => {
  it("finds the beat, lays it over the montage and puts the drop on a beat", () => {
    const r = songBeats(song(0.5, 0.2, 60, 12.3), 30)!;
    expect(r.beatSec).toBeCloseTo(0.5, 2);
    expect(r.beats[0]).toBeCloseTo(0.2, 1);
    expect(r.beats.at(-1)).toBeLessThanOrEqual(30);
    expect(r.beats.length).toBeGreaterThanOrEqual(59);
    expect(r.dropAtSec).not.toBeNull();
    expect(Math.abs(r.dropAtSec! - 12.3)).toBeLessThanOrEqual(0.5); // on the beat nearest the lift
    expect(r.beats).toContain(r.dropAtSec);
  });

  it("halves a slow grid into the range montages cut to", () => {
    expect(songBeats(song(0.45, 0.1, 60), 30)!.beatSec).toBeCloseTo(0.45, 2);
    expect(songBeats(song(0.6, 0.1, 60), 30)!.beatSec).toBeCloseTo(0.6, 2);
  });

  it("no drop when nothing lifts inside the montage, or the lift is only the music starting", () => {
    expect(songBeats(song(0.5, 0.2, 60), 30)!.dropAtSec).toBeNull();
    expect(songBeats(song(0.5, 0.2, 60, 40), 30)!.dropAtSec).toBeNull(); // after the montage ends
    const intro = song(0.5, 0.2, 60).split("\n").map((l, i) => (i < 60 ? `${l.split(",")[0]},-inf` : l)).join("\n"); // 3 s of silence
    expect(songBeats(intro, 30)!.dropAtSec).toBeNull();
  });

  it("reads a real song: Rolling in the Deep is 105 BPM (0.571 s)", () => {
    const loudness = readFileSync(new URL("./fixtures/loudness-rolling-in-the-deep-60s.csv", import.meta.url), "utf8");
    const r = songBeats(loudness, 30)!;
    expect(Math.abs(r.beatSec - 0.571)).toBeLessThanOrEqual(0.005);
    expect(r.beats.length).toBeGreaterThan(50);
  });

  it("gives up on data it can't read", () => {
    expect(songBeats("", 30)).toBeNull();
    expect(songBeats("0,-20\n1,-20", 30)).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { lyricItems } from "./lyrics";

const seg = (words: [string, number | null, number | null][], start = words[0]?.[1] ?? 0, end = words.at(-1)?.[2] ?? 0) => ({
  start,
  end,
  words: words.map(([word, s, e]) => ({ word, ...(s === null ? {} : { start: s }), ...(e === null ? {} : { end: e }), score: 0.8 })),
});
const steps = (items: ReturnType<typeof lyricItems>) => items.map(({ s, e, t, r }) => [s, e, t, r]);

describe("lyricItems", () => {
  it("builds a line word by word as it's sung, holds it to its end, then the next line starts", () => {
    const items = lyricItems([seg([["I’m", 0.49, 0.69], ["so", 0.69, 0.9], ["cool", 0.93, 1.21]]), seg([["That’s", 8.75, 8.97], ["a", 9.01, 9.05], ["fact", 9.15, 9.43]])]);
    expect(steps(items)).toEqual([
      [0.49, 0.69, "I’m", 0],
      [0.69, 0.93, "I’m so", 0],
      [0.93, 1.41, "I’m so cool", 0], // stays to its last word's end, then slides out over 0.2 s (the next line is far away)
      [8.75, 9.01, "That’s", 0],
      [9.01, 9.15, "That’s a", 0],
      [9.15, 9.63, "That’s a fact", 0],
    ]);
    expect(items.slice(0, 3).map((i) => i.n)).toEqual([11, 11, 11]); // every step knows the full row, so it doesn't shift
  });

  it("cuts a segment into lines of 3-5 words; a wide line gets two rows, the top row staying while the bottom builds", () => {
    const items = lyricItems([
      seg([["Couple", 3.95, 4.35], ["racks", 4.37, 4.75], ["ayy", 4.91, 5.05], ["Couple", 5.53, 5.91], ["Grammys", 5.95, 6.37], ["on", 6.45, 6.57], ["him", 6.63, 6.79]]),
    ]);
    expect(steps(items)).toEqual([
      [3.95, 4.37, "Couple", 1],
      [4.37, 6.15, "Couple racks", 1], // the top row's last step lasts the whole line (+ its slide out)
      [4.91, 5.53, "ayy", 2],
      [5.53, 6.15, "ayy Couple", 2],
      [5.95, 6.45, "Grammys", 0], // held until the next line (gap < 0.3 s), then the 3-word line builds
      [6.45, 6.63, "Grammys on", 0],
      [6.63, 6.99, "Grammys on him", 0],
    ]);
    expect(new Set(items.slice(0, 4).map((i) => i.p)).size).toBe(1); // one spot per line
    expect(items[4].p).not.toBe(items[0].p); // the next line moves
  });

  it("moves each line as one piece: every step shares the line's start, end and slide directions", () => {
    const words = Array.from({ length: 40 }, (_, i) => [`w${i}`, i * 0.5, i * 0.5 + 0.4] as [string, number, number]);
    const items = lyricItems([seg(words.slice(0, 7)), seg(words.slice(8, 15)), seg(words.slice(16, 40))], 3);
    const lines = new Map<number, typeof items>();
    for (const it of items) lines.set(it.a, [...(lines.get(it.a) ?? []), it]);
    const sides = new Set<string>();
    for (const [a, steps] of lines) {
      expect(new Set(steps.map((x) => [x.b, x.ix, x.iy, x.ox, x.oy, x.p].join())).size).toBe(1); // one piece
      expect(Math.min(...steps.map((x) => x.s))).toBe(a); // slides in as its first word is sung, never before
      const { ix, iy, ox, oy, b } = steps[0];
      expect(Math.abs(ix) + Math.abs(iy)).toBe(1); // from one side: left, right, top or bottom
      expect(Math.abs(ox) + Math.abs(oy)).toBe(1);
      expect(Math.max(...steps.map((x) => x.e))).toBeCloseTo(b + 0.2, 5); // on screen until it has slid out
      sides.add(`${ix},${iy}`);
    }
    expect(sides.size).toBeGreaterThan(1); // the direction changes from line to line
  });

  it("groups evenly: 11 words -> 4 + 4 + 3", () => {
    const words = Array.from({ length: 11 }, (_, i) => [`w${i}`, i, i + 0.5] as [string, number, number]);
    const items = lyricItems([seg(words)]);
    const lineEnds = items.filter((it, n) => n === items.length - 1 || items[n + 1].t.split(" ").length === 1 && items[n + 1].r !== 2);
    expect(lineEnds.map((i) => i.t.split(" ").length)).toEqual([4, 4, 3]);
  });

  it("cleans words: no punctuation, curly apostrophes, no slurs; untimed words borrow their neighbours' times", () => {
    const items = lyricItems([seg([["I'm", 0.49, 0.69], ["so,", null, null], ["cool!", 0.93, 1.21], ["retarded", 1.3, 1.6]])]);
    expect(steps(items)).toEqual([
      [0.49, 0.69, "I’m", 0],
      [0.69, 0.93, "I’m so", 0],
      [0.93, 1.41, "I’m so cool", 0],
    ]);
  });

  it("puts each line in a random spot, never the same spot twice in a row, repeatable per seed", () => {
    const words = Array.from({ length: 60 }, (_, i) => [`w${i}`, i, i + 0.5] as [string, number, number]);
    // a line's first step is a single word on its first row
    const spots = (seed: number) => lyricItems([seg(words)], seed).filter((i) => i.t.split(" ").length === 1 && i.r !== 2).map((i) => i.p);
    for (let seed = 1; seed <= 20; seed++) {
      const p = spots(seed);
      expect(p).toHaveLength(12);
      expect(p.every((x) => Number.isInteger(x) && x >= 0 && x <= 5)).toBe(true);
      expect(p.every((x, i) => i === 0 || x !== p[i - 1])).toBe(true);
      expect(spots(seed)).toEqual(p);
    }
    expect(new Set(spots(7))).toEqual(new Set([0, 1, 2, 3, 4, 5]));
    expect(spots(1)).not.toEqual(spots(2));
  });

  it("never shows a word before the voice: a start in silence moves to where the vocals come in", () => {
    const words = seg([["Baby", 1.07, 2.71], ["bet", 2.77, 3.05], ["ayy", 3.51, 3.61]]);
    const voice = [{ start: 2.2, end: 3.1 }, { start: 3.5, end: 3.7 }];
    expect(steps(lyricItems([words], 1, voice))).toEqual([
      [2.2, 2.77, "Baby", 0], // the aligner said 1.07, but the vocals are silent until 2.2
      [2.77, 3.51, "Baby bet", 0],
      [3.51, 3.81, "Baby bet ayy", 0],
    ]);
    expect(lyricItems([words], 1, [[2.2, 3.1], [3.5, 3.7]])).toEqual(lyricItems([words], 1, voice)); // [start, end] pairs too
    // Industry Baby, real song-index output: a producer tag is voiced at 0.38-1.76 s, then silence, then "Baby" from 2.37 s
    expect(lyricItems([words], 1, [{ start: 0.38, end: 1.76 }, { start: 2.37, end: 18.82 }])[0].s).toBe(2.37);
    // the voice isn't found inside the word (or there's no voice data): the aligner's time stands
    expect(lyricItems([words], 1, [{ start: 5, end: 6 }])[0].s).toBe(1.07);
    expect(lyricItems([words], 1, [{ start: 0.5, end: 3.2 }])[0].s).toBe(1.07); // voiced right through the word
    expect(lyricItems([words], 1)[0].s).toBe(1.07);
  });

  it("returns nothing for no lyrics or a bad shape", () => {
    expect(lyricItems([])).toEqual([]);
    expect(lyricItems(undefined)).toEqual([]);
    expect(lyricItems([{ start: 1, end: 2 }])).toEqual([]);
  });
});

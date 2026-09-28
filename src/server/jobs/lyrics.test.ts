import { describe, expect, it } from "vitest";
import { lyricLines } from "./lyrics";

const seg = (words: [string, number | null, number | null][], start = words[0]?.[1] ?? 0, end = words.at(-1)?.[2] ?? 0) => ({
  start,
  end,
  words: words.map(([word, s, e]) => ({ word, ...(s === null ? {} : { start: s }), ...(e === null ? {} : { end: e }), score: 0.8 })),
});

describe("lyricLines", () => {
  it("cuts a segment into lines of 3-5 words, each timed from its first word to its last", () => {
    const lines = lyricLines([
      seg([["Couple", 3.95, 4.35], ["racks", 4.37, 4.75], ["ayy", 4.91, 5.05], ["Couple", 5.53, 5.91], ["Grammys", 5.95, 6.37], ["on", 6.45, 6.57], ["him", 6.63, 6.79]]),
    ]);
    expect(lines.map((l) => [l.l1, l.l2].filter(Boolean).join(" / "))).toEqual(["Couple racks / ayy Couple", "Grammys on him"]);
    expect(lines[0]).toMatchObject({ start: 3.95, end: 5.95 }); // held until the next line (gap < 0.3 s)
    expect(lines[1]).toMatchObject({ start: 5.95, end: 6.79 });
  });

  it("never mixes two segments, and keeps a short segment as its own line", () => {
    const lines = lyricLines([seg([["Baby", 1.07, 2.71], ["bet", 2.77, 3.05]]), seg([["That’s", 8.75, 8.97], ["a", 9.01, 9.05], ["fact", 9.15, 9.43]])]);
    expect(lines.map((l) => l.l1)).toEqual(["Baby bet", "That’s a fact"]);
    expect(lines[0].end).toBe(3.05); // a long gap before the next line: no hold
  });

  it("groups evenly: 11 words -> 4 + 4 + 3", () => {
    const words = Array.from({ length: 11 }, (_, i) => [`w${i}`, i, i + 0.5] as [string, number, number]);
    expect(lyricLines([seg(words)]).map((l) => `${l.l1} ${l.l2}`.trim().split(" ").length)).toEqual([4, 4, 3]);
  });

  it("puts a wide line on two rows, the longer row as short as possible", () => {
    const [line] = lyricLines([seg([["Everything", 0, 0.5], ["is", 0.5, 0.7], ["beautiful", 0.7, 1.2]])]);
    expect([line.l1, line.l2]).toEqual(["Everything", "is beautiful"]);
  });

  it("cleans words: no punctuation, curly apostrophes, no slurs; untimed words borrow their neighbours' times", () => {
    const [line] = lyricLines([seg([["I'm", 0.49, 0.69], ["so,", null, null], ["cool!", 0.93, 1.21], ["retarded", 1.3, 1.6]])]);
    expect(line).toMatchObject({ start: 0.49, end: 1.21, l1: "I’m so cool", l2: "" });
  });

  it("puts each line in a random spot, never the same spot twice in a row, repeatable per seed", () => {
    const words = Array.from({ length: 60 }, (_, i) => [`w${i}`, i, i + 0.5] as [string, number, number]);
    const spots = (seed: number) => lyricLines([seg(words)], seed).map((l) => l.p);
    for (let seed = 1; seed <= 20; seed++) {
      const p = spots(seed);
      expect(p.every((x) => Number.isInteger(x) && x >= 0 && x <= 5)).toBe(true);
      expect(p.every((x, i) => i === 0 || x !== p[i - 1])).toBe(true);
      expect(spots(seed)).toEqual(p);
    }
    expect(new Set(spots(7))).toEqual(new Set([0, 1, 2, 3, 4, 5])); // all six spots get used
    expect(spots(1)).not.toEqual(spots(2));
  });

  it("returns nothing for no lyrics or a bad shape", () => {
    expect(lyricLines([])).toEqual([]);
    expect(lyricLines(undefined)).toEqual([]);
    expect(lyricLines([{ start: 1, end: 2 }])).toEqual([]);
  });
});

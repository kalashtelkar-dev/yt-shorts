import { describe, expect, it } from "vitest";
import { lyricEvents, lyricItems, type LyricItem } from "./lyrics";

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

describe("lyricEvents", () => {
  // a one-row line at spot 0 (upper left): in from the left at 0.49, out downward after 1.21
  const L = { r: 0, n: 11, p: 0, a: 0.49, b: 1.21, ix: -1, iy: 0, ox: 0, oy: 1 } as const;
  const items: LyricItem[] = [
    { s: 0.49, e: 0.69, t: "I’m", ...L },
    { s: 0.69, e: 0.93, t: "I’m so", ...L },
    { s: 0.93, e: 1.41, t: "I’m so cool", ...L },
  ];
  const events = lyricEvents(items).split("\n");
  const at = (time: string) => events.find((e) => e.startsWith(`Dialogue: 0,${time},`))!;

  it("starts with a comment, so the file's events are never empty", () => {
    expect(lyricEvents([])).toBe("; lyrics");
    expect(events[0]).toBe("; lyrics");
  });

  it("slides in from its side as three straight moves, fading in, then holds", () => {
    expect(at("0:00:00.49")).toBe("Dialogue: 0,0:00:00.49,0:00:00.55,L,,0,0,0,,{@L\\an7\\move(-170,528,-37,528)\\alpha&HFF&\\t(\\alpha&HAA&)}I’m{\\alpha&HFF&} so cool");
    expect(at("0:00:00.55")).toContain("\\move(-37,528,43,528)");
    expect(at("0:00:00.61")).toContain("\\move(43,528,70,528)");
    expect(at("0:00:00.67")).toBe("Dialogue: 0,0:00:00.67,0:00:00.69,L,,0,0,0,,{@L\\an7\\pos(70,528)}I’m{\\alpha&HFF&} so cool");
  });

  it("shows the whole row with the words not sung yet hidden, so the row never shifts", () => {
    expect(at("0:00:00.69")).toMatch(/\\pos\(70,528\)}I’m so\{\\alpha&HFF&\} cool$/);
    expect(at("0:00:00.93")).toMatch(/}I’m so cool$/);
  });

  it("slides out downward after its end, fading out, and stops when it's gone", () => {
    const out = events.filter((e) => e.includes("\\move(70,"));
    expect(out[0]).toContain(",0:00:01.21,0:00:01.28,");
    expect(out.at(-1)).toMatch(/,0:00:01\.34,0:00:01\.41,.*\\move\(70,595,70,688\)\\alpha&HA6&\\t\(\\alpha&HFF&\)}I’m so cool$/);
  });

  it("places rows where drawtext did for the look: right edge, two rows 8 px either side of the lower third", () => {
    const two = lyricEvents([
      { s: 2, e: 3, t: "with my", r: 1, n: 7, p: 5, a: 1, b: 2.9, ix: 0, iy: 0, ox: 0, oy: 0 },
      { s: 2, e: 3, t: "pink", r: 2, n: 4, p: 5, a: 1, b: 2.9, ix: 0, iy: 0, ox: 0, oy: 0 },
    ]);
    expect(two).toContain("{@L\\an9\\pos(1010,1023)}with my");
    expect(two).toContain("{@L\\an9\\pos(1010,1184)}pink");
  });

  it("uses the look's line height: Bungee (look 2), and an unknown look as look 0", () => {
    const one = [{ s: 2, e: 3, t: "run", r: 0, n: 3, p: 4, a: 1, b: 2.9, ix: 0, iy: 0, ox: 0, oy: 0 }] as LyricItem[];
    expect(lyricEvents(one, 0, Infinity, "2")).toContain("{@L\\an8\\pos(540,1119)}run"); // 1229 - 91/2 - 65
    expect(lyricEvents(one, 0, Infinity, "x")).toBe(lyricEvents(one));
  });

  it("leaves out steps from untilSec on (past the montage's length)", () => {
    expect(lyricEvents(items, 0, 0.93)).not.toContain("}I’m so cool\n");
    expect(lyricEvents(items, 0, 0.93)).toContain("}I’m so{\\alpha&HFF&} cool");
  });

  it("leaves out lines that start before fromSec (an intro without lyrics)", () => {
    expect(lyricEvents(items, 0.5)).toBe("; lyrics");
    expect(lyricEvents(items, 0.49).split("\n").length).toBeGreaterThan(1);
  });
});

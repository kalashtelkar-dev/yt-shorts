import { describe, expect, it } from "vitest";
import type { RunStep } from "@/server/enginex/types";
import { MapInputError, mapInput, progressOf, stageFor } from ".";

const step = (name: string, status: string, items?: RunStep["items"]): RunStep => ({ step: name, engine: null, status, error: null, items: items ?? null });

describe("mapInput", () => {
  const ctx = { sourceUrl: "https://youtu.be/x", durationSec: 60, fields: { playerName: "Aqua", songRange: { start: 12, end: 42 }, lyricsLrc: "" } };

  it("resolves the supported expressions and literals as strings", () => {
    expect(
      mapInput(
        { youtubeUrl: "$source.url", playerName: "$fields.playerName", songStart: "$fields.songRange.start", songEnd: "$fields.songRange.end", durationSec: "$durationSec", style: "fast", fps: 60 },
        ctx,
      ),
    ).toEqual({ youtubeUrl: "https://youtu.be/x", playerName: "Aqua", songStart: "12", songEnd: "42", durationSec: "60", style: "fast", fps: "60" });
  });

  it("drops empty optional values", () => {
    expect(mapInput({ lyricsLrc: "$fields.lyricsLrc", missing: "$fields.nope" }, ctx)).toEqual({});
  });

  it("rejects anything outside the grammar", () => {
    for (const bad of ["$env.ENGINEX_API_KEY", "$fields.a.b.c", "$fields.__proto__x()", "${process.exit()}", "$source"]) {
      expect(() => mapInput({ x: bad }, ctx)).toThrow(MapInputError);
    }
  });

  it("does not read inherited properties", () => {
    expect(mapInput({ x: "$fields.constructor" }, ctx)).toEqual({});
  });

  it("refuses to send an object", () => {
    expect(() => mapInput({ x: "$fields.songRange" }, ctx)).toThrow(MapInputError);
  });
});

describe("progressOf", () => {
  it("counts fan-out items individually", () => {
    expect(progressOf([step("download", "succeeded"), step("read_feed", "running", { total: 10, done: 3, failed: 1 }), step("render", "queued")])).toEqual({ done: 5, total: 12 });
  });

  it("counts skipped steps as done", () => {
    expect(progressOf([step("a", "skipped"), step("b", "succeeded")])).toEqual({ done: 2, total: 2 });
  });
});

describe("stageFor", () => {
  const map = [
    { match: "download", label: "Downloading" },
    { match: "read_feed", label: "Reading the kill feed" },
    { match: "align_lyrics", label: "Syncing the lyrics" },
    { match: "make_montage", label: "Rendering" },
  ];

  it("picks the earliest listed stage among running steps", () => {
    expect(stageFor([step("align_lyrics", "running"), step("read_feed", "running")], map, null)).toBe("Reading the kill feed");
  });

  it("matches fan-out items by prefix", () => {
    expect(stageFor([step("read_feed#12", "running")], map, null)).toBe("Reading the kill feed");
  });

  it("keeps the previous stage when only unmapped steps run", () => {
    expect(stageFor([step("clip_count", "running")], map, "Downloading")).toBe("Downloading");
  });
});

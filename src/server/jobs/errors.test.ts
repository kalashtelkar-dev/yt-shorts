import { describe, expect, it } from "vitest";
import { isTransientFailure, publicErrorFor } from "./errors";

describe("engine-keyed errors", () => {
  it("read the same for Engine X's old and new engine names", () => {
    for (const [oldName, newName] of [["ytdlp", "media-fetch"], ["ffmpeg", "video"], ["vllm", "llm"], ["whisperx", "transcribe"]]) {
      expect(publicErrorFor(newName)).toBe(publicErrorFor(oldName));
    }
    expect(publicErrorFor("media-fetch")).toMatch(/couldn't download/);
    expect(publicErrorFor("something-new")).toMatch(/went wrong on our side/);
  });

  it("retry model and OCR failures under either name, not bad downloads", () => {
    expect(isTransientFailure("llm", "bad json")).toBe(true);
    expect(isTransientFailure("vllm", "bad json")).toBe(true);
    expect(isTransientFailure("media-fetch", "Video unavailable in your country")).toBe(true); // "unavailable" reads as a blip
    expect(isTransientFailure("media-fetch", "Private video")).toBe(false);
  });
});

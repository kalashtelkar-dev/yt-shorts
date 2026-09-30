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
    // the object store taking a file short (a real 60 s job, 2026-09-30): retried, not failed
    expect(isTransientFailure("video", 'step "feed_frames" (video/frames) failed: You did not provide the number of bytes specified by the Content-Length HTTP header.')).toBe(true);
    expect(isTransientFailure("media-fetch", "Video unavailable in your country")).toBe(true); // "unavailable" reads as a blip
    expect(isTransientFailure("media-fetch", "Private video")).toBe(false);
    // YouTube refusing the stream once (seen on 2026-09-30: the same video downloaded fine in a job 30 s earlier)
    expect(isTransientFailure("media-fetch", "ERROR: unable to download video data: HTTP Error 403: Forbidden - `impersonate` may help")).toBe(true);
    expect(isTransientFailure("media-fetch", "ERROR: Sign in to confirm your age. This video may be inappropriate for some users.")).toBe(false);
  });
});

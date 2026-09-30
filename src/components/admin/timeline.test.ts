import { describe, expect, it } from "vitest";
import { secs, timelineBars } from "./timeline";

const step = (step: string, engine: string, startedAt: string | null, finishedAt: string | null, status = "succeeded") => ({ step, engine, status, error: null, items: null, job: null, startedAt, finishedAt });

describe("timelineBars", () => {
  it("puts every lane on the job's clock, drops util and instant steps, and runs open steps to now", () => {
    const rows = timelineBars(
      [
        { name: "Song reader", steps: [step("music", "media-fetch", "2026-09-30T08:00:02.000Z", "2026-09-30T08:00:12.000Z")] },
        {
          name: "Editor",
          steps: [
            step("render", "video", "2026-09-30T08:00:00.000Z", null, "running"),
            step("join", "util", "2026-09-30T08:00:00.000Z", "2026-09-30T08:00:05.000Z"),
            step("llm", "llm", "2026-09-30T08:00:00.000Z", "2026-09-30T08:00:00.004Z"),
            step("later", "ocr", null, null, "queued"),
          ],
        },
      ],
      Date.parse("2026-09-30T08:00:30.000Z"),
    );
    expect(rows.map((r) => [r.name, r.from, r.to, r.bars.map((b) => b.step)])).toEqual([
      ["Song reader", 2, 12, ["music"]],
      ["Editor", 0, 30, ["render"]],
    ]);
    expect(rows[1].bars[0].running).toBe(true);
  });

  it("formats durations without a 60th second", () => {
    expect([secs(7.24), secs(59.6), secs(119.7), secs(316.2)]).toEqual(["7.2 s", "1 min 0 s", "2 min 0 s", "5 min 16 s"]);
  });
});

import { describe, expect, it } from "vitest";
import { downloadFromEvents } from "./download";

describe("downloadFromEvents", () => {
  it("takes the latest downloading event from an Engine X trail", () => {
    // Shapes from a real run (2026-09-30): claimed, then downloading events with a fraction; eta can be null.
    const events = [
      { at: "t0", kind: "claimed", data: { pod: "p", tier: "cpu" } },
      { at: "t1", kind: "downloading", data: { eta: null, bytes: 1024, fraction: 0, totalBytes: 751934681 } },
      { at: "t2", kind: "downloading", data: { eta: 186, bytes: 8387584, fraction: 0.0112, totalBytes: 751934681 } },
      { at: "t3", kind: "downloading", data: { eta: 42, bytes: 481238196, fraction: 0.64, totalBytes: 751934681 } },
    ];
    expect(downloadFromEvents(events)).toEqual({ pct: 64, bytes: 481238196, totalBytes: 751934681, etaSec: 42, phase: "downloading" });
    expect(downloadFromEvents(events.slice(0, 2))).toEqual({ pct: 0, bytes: 1024, totalBytes: 751934681, etaSec: null, phase: "downloading" });
    expect(downloadFromEvents(events.slice(0, 1))).toBeNull();
    expect(downloadFromEvents([])).toBeNull();
  });

  it("adds the picture and sound files up as one download, then reports joining and saving", () => {
    // A real 65-minute video's trail (2026-09-30): 1.49 GB of picture, 64 MB of sound, then Merger and MoveFiles.
    const picture = { eta: 8, bytes: 1139766486, fraction: 0.7626, totalBytes: 1494556985 };
    const events = [
      { at: "t1", kind: "downloading", data: picture },
      { at: "t2", kind: "finished", data: { eta: null, bytes: 1494556985, fraction: 1, totalBytes: 1494556985 } },
      { at: "t3", kind: "downloading", data: { eta: 0, bytes: 38678005, fraction: 0.608, totalBytes: 63613986 } },
      { at: "t4", kind: "finished", data: { eta: null, bytes: 63613986, fraction: 1, totalBytes: 63613986 } },
      { at: "t5", kind: "postprocessing", data: { step: "Merger", phase: "postprocessing" } },
      { at: "t6", kind: "postprocessing", data: { step: "MoveFiles", phase: "postprocessing" } },
    ];
    const at = (n: number) => downloadFromEvents(events.slice(0, n));
    expect(at(1)).toMatchObject({ pct: 76, totalBytes: 1494556985, phase: "downloading" });
    expect(at(2)).toMatchObject({ pct: 100, phase: "downloading" });
    // The sound's start grows the total; the bar holds at 99 instead of jumping back to 97.
    expect(at(3)).toMatchObject({ pct: 99, bytes: 1494556985 + 38678005, totalBytes: 1494556985 + 63613986 });
    expect(at(4)).toMatchObject({ pct: 100, bytes: 1558170971, totalBytes: 1558170971, phase: "downloading" });
    expect(at(5)).toMatchObject({ pct: 100, phase: "joining" });
    expect(at(6)).toMatchObject({ pct: 100, totalBytes: 1558170971, phase: "saving" });
  });
});

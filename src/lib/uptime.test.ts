import { describe, expect, it } from "vitest";
import { bucketStatus, fleetUptime, formatPct, uptimeOf, worstOf } from "./uptime";

const c = (up: number, degraded = 0, down = 0) => ({ checks: up + degraded + down, up, degraded, down });

describe("uptime", () => {
  it("applies the 99% rule per bucket", () => {
    expect(bucketStatus(c(0))).toBe("none");
    expect(bucketStatus(c(99, 0, 1))).toBe("up");
    expect(bucketStatus(c(98, 0, 2))).toBe("down");
    expect(bucketStatus(c(10, 20))).toBe("degraded");
    expect(bucketStatus(c(29, 0, 1))).toBe("down"); // one miss in a 15 min bucket of 30 checks is < 99%
  });

  it("computes range uptime from counts", () => {
    expect(uptimeOf([c(30), c(29, 0, 1)])).toBeCloseTo(59 / 60);
    expect(uptimeOf([c(0)])).toBeNull();
  });

  it("takes the worst critical probe per bucket and the lowest uptime", () => {
    expect(worstOf([["up", "none", "up"], ["up", "down", "degraded"]])).toEqual(["up", "down", "degraded"]);
    expect(fleetUptime([0.999, null, 0.95])).toBe(0.95);
    expect(fleetUptime([null])).toBeNull();
  });

  it("never rounds a failure up to 100%", () => {
    expect(formatPct(0.99999)).toBe("99.99%");
    expect(formatPct(1)).toBe("100.00%");
  });
});

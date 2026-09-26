import { describe, expect, it } from "vitest";
import type { ProbeStatus } from "@/lib/uptime";
import { incidentAction } from "./incidents";

const at = (s: number) => new Date(Date.UTC(2026, 8, 26, 10, 0, s));
const c = (status: ProbeStatus, s: number) => ({ status, at: at(s) });

describe("incidentAction", () => {
  it("ignores a single failed check", () => {
    expect(incidentAction(c("up", 0), c("down", 30), null)).toBeNull();
  });

  it("opens on the second failure, dated from the first", () => {
    expect(incidentAction(c("degraded", 0), c("down", 30), null)).toEqual({ kind: "open", severity: "down", startedAt: at(0) });
    expect(incidentAction(c("degraded", 0), c("degraded", 30), null)).toMatchObject({ kind: "open", severity: "degraded" });
  });

  it("escalates but never downgrades severity while open", () => {
    expect(incidentAction(c("degraded", 0), c("down", 30), { severity: "degraded" })).toEqual({ kind: "update", severity: "down" });
    expect(incidentAction(c("down", 0), c("degraded", 30), { severity: "down" })).toEqual({ kind: "update", severity: "down" });
  });

  it("resolves after two good checks, dated from the first", () => {
    expect(incidentAction(c("down", 0), c("up", 30), { severity: "down" })).toBeNull();
    expect(incidentAction(c("up", 30), c("up", 60), { severity: "down" })).toEqual({ kind: "resolve", resolvedAt: at(30) });
  });

  it("never acts on not-configured probes", () => {
    expect(incidentAction(c("down", 0), c("not_configured", 30), null)).toBeNull();
  });
});

import "server-only";
import type { ProbeStatus } from "@/lib/uptime";

type Check = { status: ProbeStatus; at: Date };
export type IncidentAction =
  | { kind: "open"; severity: "down" | "degraded"; startedAt: Date }
  | { kind: "update"; severity: "down" | "degraded" }
  | { kind: "resolve"; resolvedAt: Date }
  | null;

const failing = (s: ProbeStatus) => s === "down" || s === "degraded";
const worst = (a: ProbeStatus, b: ProbeStatus) => (a === "down" || b === "down" ? "down" : "degraded");

/**
 * What to do with a probe's incident given its previous and current check.
 * Two failing checks in a row open one (starting at the first failure); two good checks in a
 * row resolve it (at the first good check). Severity only escalates. "Not configured" never counts.
 */
export function incidentAction(prev: Check | null, curr: Check, open: { severity: ProbeStatus } | null): IncidentAction {
  if (curr.status === "not_configured") return null;
  if (!open) {
    return prev && failing(prev.status) && failing(curr.status) ? { kind: "open", severity: worst(prev.status, curr.status), startedAt: prev.at } : null;
  }
  if (failing(curr.status)) return { kind: "update", severity: open.severity === "down" ? "down" : worst(open.severity, curr.status) };
  if (curr.status === "up" && prev?.status === "up") return { kind: "resolve", resolvedAt: prev.at };
  return null;
}

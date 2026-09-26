import "server-only";
import type { InputMap, StageMapEntry } from "@/db/schema";
import type { RunStep } from "@/server/enginex/types";

export type MapContext = {
  sourceUrl: string;
  durationSec: number;
  fields: Record<string, unknown>;
};

export class MapInputError extends Error {}

/**
 * Builds the pipeline input from a catalog inputMap (PLAN.md §5.2). Supports only
 * `$source.url`, `$durationSec`, `$fields.<name>` and `$fields.<name>.<sub>`; anything else
 * starting with `$` is rejected. No eval, ever.
 * Values are sent as strings because every current pipeline input is `type: text`.
 * Empty values are left out so optional pipeline inputs use their own defaults.
 */
export function mapInput(inputMap: InputMap, ctx: MapContext): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [target, expr] of Object.entries(inputMap)) {
    const value = typeof expr === "string" && expr.startsWith("$") ? resolve(expr, ctx) : expr;
    if (value === undefined || value === null || value === "") continue;
    if (typeof value === "object") throw new MapInputError(`${target}: ${String(expr)} is not a single value`);
    out[target] = String(value);
  }
  return out;
}

function resolve(expr: string, ctx: MapContext): unknown {
  if (expr === "$source.url") return ctx.sourceUrl;
  if (expr === "$durationSec") return ctx.durationSec;
  const m = /^\$fields\.([A-Za-z_]\w*)(?:\.([A-Za-z_]\w*))?$/.exec(expr);
  if (!m) throw new MapInputError(`Unsupported mapping expression: ${expr}`);
  const field = Object.hasOwn(ctx.fields, m[1]) ? ctx.fields[m[1]] : undefined;
  if (!m[2]) return field;
  return field && typeof field === "object" && Object.hasOwn(field, m[2]) ? (field as Record<string, unknown>)[m[2]] : undefined;
}

/** Share of work done. Fan-out steps count each item, so the bar keeps moving during OCR. */
export function progressOf(steps: RunStep[]): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const s of steps) {
    if (s.items && s.items.total > 0) {
      total += s.items.total;
      done += Math.min(s.items.total, s.items.done + s.items.failed);
    } else {
      total += 1;
      if (s.status === "succeeded" || s.status === "skipped") done += 1;
    }
  }
  return { done, total };
}

/**
 * Friendly stage label. Among running steps that match a stageMap prefix, the one listed
 * earliest in the stageMap wins (parallel branches show the earlier phase). If nothing
 * matching is running, the previous stage stays.
 */
export function stageFor(steps: RunStep[], stageMap: StageMapEntry[], current: string | null): string | null {
  let best = Infinity;
  for (const s of steps) {
    if (s.status !== "running") continue;
    const i = stageMap.findIndex((e) => s.step.startsWith(e.match));
    if (i !== -1 && i < best) best = i;
  }
  return best === Infinity ? current : stageMap[best].label;
}

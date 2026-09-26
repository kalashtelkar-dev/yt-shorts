import "server-only";
import type { Probe } from "../types";

/** One probe per Engine X engine our enabled pipelines use: up while it has live workers. */
export function engineProbe(engine: string): Probe {
  return {
    id: `engine:${engine}`,
    name: engine,
    tier: "workers",
    critical: true,
    derived: true,
    async run(ctx) {
      const tiers = (await ctx.fleet()).available[engine];
      return tiers?.length ? { status: "up", message: `workers on ${tiers.join(" + ")}` } : { status: "down", message: "No live workers for this engine" };
    },
  };
}

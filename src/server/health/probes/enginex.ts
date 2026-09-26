import "server-only";
import type { Probe } from "../types";

// Authenticated call: checks the gateway is up *and* our API key still works.
export const enginexProbe: Probe = {
  id: "enginex",
  name: "Engine X gateway",
  tier: "engine",
  critical: true,
  degradedMs: 1500,
  async run(ctx) {
    const fleet = await ctx.fleet();
    return { status: "up", message: `${Object.keys(fleet.available).length} of ${fleet.known.length} engines have workers` };
  },
};

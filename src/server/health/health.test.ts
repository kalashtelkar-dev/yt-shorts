import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/db";
import { probeResults } from "@/db/schema";
import { runProbe, usedEngines } from ".";
import { healthView } from "./queries";
import type { Probe, SweepContext } from "./types";

const ctx: SweepContext = { fleet: async () => ({ known: [], available: {}, raw: {} }) };
const probe = (run: Probe["run"], degradedMs?: number): Probe => ({ id: "t", name: "t", tier: "data", critical: true, degradedMs, run });

describe("runProbe", () => {
  it("marks slow checks degraded and errors down (without leaking keys)", async () => {
    expect((await runProbe(probe(async () => ({ status: "up" })), ctx)).status).toBe("up");
    const slow = await runProbe(probe(() => new Promise((r) => setTimeout(() => r({ status: "up" }), 30)), 5), ctx);
    expect(slow).toMatchObject({ status: "degraded", message: expect.stringMatching(/Slow/) });
    const err = await runProbe(probe(async () => { throw new Error("auth failed for ek_live_abc123"); }), ctx);
    expect(err.status).toBe("down");
    expect(err.message).not.toContain("abc123");
  });

  it("times out after 5 s as down", async () => {
    const r = await runProbe(probe(() => new Promise(() => {})), ctx);
    expect(r).toMatchObject({ status: "down", message: expect.stringMatching(/Timed out/) });
  }, 7000);
});

describe("health view", () => {
  it("only lists engines the enabled pipelines use", async () => {
    // mock pipeline graph uses ytdlp, ffmpeg, ocr, vllm
    expect(await usedEngines()).toEqual(["ffmpeg", "ocr", "vllm", "ytdlp"]);
  });

  it("buckets checks and applies the 99% rule", async () => {
    await db.delete(probeResults).where(sql`probe_id = 'postgres'`);
    const now = Date.now();
    // Last 15 min: 29 up + 1 down (< 99%) → down bucket; the bucket before: all up.
    const rows = [
      ...Array.from({ length: 29 }, (_, i) => ({ probeId: "postgres", status: "up" as const, checkedAt: new Date(now - 1000 - i * 20_000) })),
      { probeId: "postgres", status: "down" as const, checkedAt: new Date(now - 2000) },
      ...Array.from({ length: 30 }, (_, i) => ({ probeId: "postgres", status: "up" as const, checkedAt: new Date(now - 16 * 60_000 - i * 20_000) })),
    ];
    await db.insert(probeResults).values(rows);
    const v = await healthView("24h");
    const pg = v.probes.find((p) => p.id === "postgres")!;
    expect(pg.buckets.at(-1)).toBe("down");
    expect(pg.buckets.at(-2)).toBe("up");
    expect(pg.uptime).toBeCloseTo(59 / 60);
    expect(pg.recent).toHaveLength(50);
    expect(v.probes.map((p) => p.id)).toEqual(expect.arrayContaining(["web", "worker", "postgres", "redis", "queue", "enginex", "storage", "engine:ocr"]));
  });
});

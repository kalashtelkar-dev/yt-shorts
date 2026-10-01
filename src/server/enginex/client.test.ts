import { describe, expect, it, vi } from "vitest";
import { createClient, normaliseRun, normaliseSigned } from "./client";
import { mockRunAt } from "./mock";
import { EngineXError } from "./types";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const noWait = () => 0;

function clientWith(...responses: (Response | Error)[]) {
  const fetchImpl = vi.fn(async () => {
    const r = responses.shift()!;
    if (r instanceof Error) throw r;
    return r;
  });
  return { client: createClient("https://ex.test", "ek_live_secret", fetchImpl as typeof fetch, noWait), fetchImpl };
}

describe("Engine X client", () => {
  it("retries 5xx and network errors, then succeeds", async () => {
    const { client, fetchImpl } = clientWith(json(502, {}), new TypeError("fetch failed"), json(200, { known: ["ocr", "vllm"], available: { ocr: ["cpu", "gpu"] } }));
    const fleet = await client.fleetStatus();
    expect(fleet.available).toEqual({ ocr: ["cpu", "gpu"] });
    expect(fleet.known).toEqual(["ocr", "vllm"]);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("gives up after 3 retries with a typed error", async () => {
    const { client, fetchImpl } = clientWith(...Array.from({ length: 4 }, () => json(503, { error: { code: "no_workers", message: "busy" } })));
    await expect(client.fleetStatus()).rejects.toMatchObject({ code: "no_workers", retryable: true, status: 503 });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("does not retry 4xx", async () => {
    const { client, fetchImpl } = clientWith(json(404, { error: { code: "not_found", message: "no such run" } }));
    await expect(client.getRun("r1")).rejects.toBeInstanceOf(EngineXError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("never retries runPipeline and sends the idempotency key", async () => {
    const { client, fetchImpl } = clientWith(json(502, {}));
    await expect(client.runPipeline("tpl_x", { a: 1 }, "job-1")).rejects.toMatchObject({ retryable: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const init = (fetchImpl.mock.calls[0] as unknown as [URL, RequestInit])[1];
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBe("job-1");
  });

  it("keeps the key out of error messages", async () => {
    const { client } = clientWith(json(401, { error: { code: "unauthorized", message: "bad key" } }));
    const err = await client.fleetStatus().catch((e) => e);
    expect(JSON.stringify({ ...err, message: err.message })).not.toContain("ek_live_secret");
  });

  it("reads the run id from the 202 body", async () => {
    const { client } = clientWith(json(202, { runId: "3f1c" }));
    expect(await client.runPipeline("tpl_x", {}, "job-2")).toEqual({ runId: "3f1c" });
  });

  it("shares a stored object from our bucket, waiting for the job", async () => {
    const { client, fetchImpl } = clientWith(json(200, { status: "succeeded", result: { url: "https://store.test/montages/j/video.mp4?sig" } }));
    expect(await client.shareStored("montages/j/video.mp4", 7200)).toBe("https://store.test/montages/j/video.mp4?sig");
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.toString()).toBe("https://ex.test/v1/storage/object-share?wait=10");
    // Bucket and connection from ENGINEX_STORE_* (vitest.config.ts); never longer than an hour.
    expect(JSON.parse(init.body as string)).toEqual({ connection: { use: "test-store" }, bucket: "test-bucket", key: "montages/j/video.mp4", expirySec: 3600 });
  });
});

describe("normalisers", () => {
  it("maps run status and fan-out items", () => {
    const run = normaliseRun("r", {
      status: "completed",
      runMs: 1200,
      steps: [{ step: "read_feed", engine: "ocr", status: "running", items: { total: 10, done: 4, failed: [1] } }],
    });
    expect(run.status).toBe("succeeded");
    expect(run.steps[0].items).toEqual({ total: 10, done: 4, failed: 1 });
  });

  it("accepts signed URLs as a map or a list", () => {
    expect(normaliseSigned(["a"], { urls: { a: "https://u/a" } })).toEqual({ a: "https://u/a" });
    expect(normaliseSigned(["a", "b"], { urls: [{ key: "b", url: "https://u/b" }, { key: "a", url: "https://u/a" }] })).toEqual({ a: "https://u/a", b: "https://u/b" });
    expect(normaliseSigned(["a", "b"], { urls: ["https://u/a", "https://u/b"] })).toEqual({ a: "https://u/a", b: "https://u/b" });
  });
});

describe("mock client", () => {
  const t0 = 1_700_000_000_000;
  it("progresses to success", () => {
    expect(mockRunAt(`mock-${t0}-ok-j`, t0 + 1000).status).toBe("running");
    const done = mockRunAt(`mock-${t0}-ok-j`, t0 + 60_000);
    expect(done.status).toBe("succeeded");
    expect(done.output?.montage).toBeTruthy();
  });

  it("fails at OCR", () => {
    const run = mockRunAt(`mock-${t0}-fail-j`, t0 + 60_000);
    expect(run.status).toBe("failed");
    expect(run.steps.find((s) => s.step === "read_feed")?.status).toBe("failed");
  });

  it("never finishes on timeout", () => {
    expect(mockRunAt(`mock-${t0}-timeout-j`, t0 + 3_600_000).status).toBe("running");
  });
});

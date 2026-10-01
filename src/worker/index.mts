// npm run dev:worker — BullMQ worker: starts jobs, polls Engine X, keeps a heartbeat (CLAUDE.md §7, §9).
import { Queue, Worker } from "bullmq";
import { runHealthSweep } from "@/server/health";
import { saveFilesFor, saveMissingFiles } from "@/server/jobs/files";
import { startJob, sweep } from "@/server/jobs/lifecycle";
import { bullConnection, QUEUE } from "@/server/queue";
import { redis } from "@/server/redis";

const queue = new Queue(QUEUE, { connection: bullConnection() });
await queue.upsertJobScheduler("sweep", { every: 5_000 }, { name: "sweep", opts: { removeOnComplete: true, removeOnFail: 50 } });
await queue.upsertJobScheduler("health", { every: 30_000 }, { name: "health", opts: { removeOnComplete: true, removeOnFail: 50 } });
await queue.upsertJobScheduler("files", { every: 60_000 }, { name: "files", opts: { removeOnComplete: true, removeOnFail: 50 } });

const worker = new Worker(
  QUEUE,
  async (job) => {
    if (job.name === "start") await startJob(job.data.jobId as string);
    else if (job.name === "sweep") await sweep();
    else if (job.name === "health") await runHealthSweep();
    else if (job.name === "save-files") await saveFilesFor(job.data.jobId as string);
    else if (job.name === "files") {
      // Safety net for copies the "save-files" task missed; a day's window so a file Engine X already cleared isn't retried forever.
      const r = await saveMissingFiles({ since: new Date(Date.now() - 24 * 3600_000), limit: 3 });
      for (const f of r.failed) console.error(`[files] job ${f.id}: ${f.error}`);
    }
  },
  { connection: bullConnection(), concurrency: 4 },
);
worker.on("failed", (job, err) => console.error(`[worker] ${job?.name} failed:`, err.message));

const beat = () => redis.set("worker:heartbeat", String(Date.now()), "EX", 60).catch(() => {});
await beat();
const heartbeat = setInterval(beat, 15_000);

console.log("[worker] running: jobs sweep every 5 s, health sweep every 30 s, file copies every 60 s");

async function shutdown() {
  clearInterval(heartbeat);
  await worker.close();
  await queue.close();
  redis.disconnect();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

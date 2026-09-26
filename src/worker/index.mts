// pnpm worker:dev — BullMQ worker: starts jobs, polls Engine X, keeps a heartbeat (CLAUDE.md §7, §9).
import { Queue, Worker } from "bullmq";
import { startJob, sweep } from "@/server/jobs/lifecycle";
import { bullConnection, QUEUE } from "@/server/queue";
import { redis } from "@/server/redis";

const queue = new Queue(QUEUE, { connection: bullConnection() });
await queue.upsertJobScheduler("sweep", { every: 5_000 }, { name: "sweep", opts: { removeOnComplete: true, removeOnFail: 50 } });

const worker = new Worker(
  QUEUE,
  async (job) => {
    if (job.name === "start") await startJob(job.data.jobId as string);
    else if (job.name === "sweep") await sweep();
  },
  { connection: bullConnection(), concurrency: 4 },
);
worker.on("failed", (job, err) => console.error(`[worker] ${job?.name} failed:`, err.message));

const beat = () => redis.set("worker:heartbeat", String(Date.now()), "EX", 60).catch(() => {});
await beat();
const heartbeat = setInterval(beat, 15_000);

console.log("[worker] running: sweep every 5 s");

async function shutdown() {
  clearInterval(heartbeat);
  await worker.close();
  await queue.close();
  redis.disconnect();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

import "server-only";
import { Queue } from "bullmq";
import Redis from "ioredis";
import { env } from "@/config/env";

export const QUEUE = "jobs";

// BullMQ needs its own connection with maxRetriesPerRequest: null.
export const bullConnection = () => new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

const g = globalThis as unknown as { jobsQueue?: Queue };
const queue = () => (g.jobsQueue ??= new Queue(QUEUE, { connection: bullConnection() }));

/** Start a job right away. If this is lost, the worker's sweep starts it within 5 s anyway. */
export async function enqueueStart(jobId: string) {
  await queue().add("start", { jobId }, { jobId: `start-${jobId}`, removeOnComplete: true, removeOnFail: 100 });
}

/** Copy a finished job's video and cover into Postgres in the background. If this is lost, the worker's file sweep does it within a minute. */
export async function enqueueSaveFiles(jobId: string) {
  await queue().add("save-files", { jobId }, { jobId: `files-${jobId}`, attempts: 3, backoff: { type: "exponential", delay: 30_000 }, removeOnComplete: true, removeOnFail: 100 });
}

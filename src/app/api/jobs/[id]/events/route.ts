import Redis from "ioredis";
import { env } from "@/config/env";
import { isFinished } from "@/lib/jobs";
import { getPublicJob } from "@/server/jobs/public";
import { getViewer } from "@/server/session";

export const dynamic = "force-dynamic";

// Live progress (SSE). The worker publishes on Redis `job:{id}`; each message re-reads the public view.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await getViewer();
  const first = viewer && (await getPublicJob(id, viewer.id));
  if (!viewer || !first) return new Response("Not found", { status: 404 });

  const encoder = new TextEncoder();
  // ponytail: one Redis connection per open progress page; share a subscriber if concurrent viewers grow large.
  const sub = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  let closed = false;
  let ping: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) => !closed && controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(ping);
        sub.disconnect();
        controller.close();
      };
      req.signal.addEventListener("abort", close);

      send(first);
      if (isFinished(first.status)) return close();

      ping = setInterval(() => !closed && controller.enqueue(encoder.encode(": ping\n\n")), 20_000);
      sub.on("message", async () => {
        const job = await getPublicJob(id, viewer.id).catch(() => null);
        if (!job) return close();
        send(job);
        if (isFinished(job.status)) close();
      });
      await sub.subscribe(`job:${id}`);
      // Catch a change that landed between the first read and the subscription.
      const latest = await getPublicJob(id, viewer.id);
      if (latest && (latest.status !== first.status || latest.progress !== first.progress || latest.stage !== first.stage)) send(latest);
      if (latest && isFinished(latest.status)) close();
    },
    cancel() {
      closed = true;
      clearInterval(ping);
      sub.disconnect();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" },
  });
}

import { getPublicJob } from "@/server/jobs/public";
import { getViewer } from "@/server/session";

export const dynamic = "force-dynamic";

// Polling fallback for the progress page when SSE isn't available.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await getViewer();
  const job = viewer && (await getPublicJob(id, viewer.id));
  if (!job) return Response.json({ error: { code: "not_found", message: "Not found" } }, { status: 404 });
  return Response.json(job, { headers: { "Cache-Control": "no-store" } });
}

import { db } from "@/db/client";
import { currentAdmin } from "@/server/admin/guard";
import { isFileKind, storedFileResponse, storedKeys } from "@/server/jobs/files";
import { getViewer } from "@/server/session";

export const dynamic = "force-dynamic";

const notFound = () => new Response("Not found", { status: 404 });

// A finished job's video or cover still: a redirect to a fresh share link from our bucket. The owner and admins only;
// others get a 404.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; kind: string }> }) {
  const { id, kind } = await params;
  if (!isFileKind(kind) || !/^[0-9a-f-]{36}$/i.test(id)) return notFound();
  const viewer = await getViewer();
  if (!viewer) return notFound();
  const job = await db.job.findFirst({ where: { id, status: "succeeded" }, select: { userId: true, outputMeta: true } });
  if (!job || (job.userId !== viewer.id && !(await currentAdmin()))) return notFound();
  const stored = storedKeys(job)[kind];
  if (!stored) return notFound();
  return storedFileResponse(stored).catch(() => new Response("Try again in a moment", { status: 503, headers: { "Retry-After": "5" } }));
}

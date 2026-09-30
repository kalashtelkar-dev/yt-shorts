import { db } from "@/db/client";
import { currentAdmin } from "@/server/admin/guard";
import { fileResponse, isFileKind } from "@/server/jobs/files";
import { getViewer } from "@/server/session";

export const dynamic = "force-dynamic";

const notFound = () => new Response("Not found", { status: 404 });

// A finished job's video or cover still, from Postgres. The owner and admins only; others get a 404.
export async function GET(req: Request, { params }: { params: Promise<{ id: string; kind: string }> }) {
  const { id, kind } = await params;
  if (!isFileKind(kind) || !/^[0-9a-f-]{36}$/i.test(id)) return notFound();
  const viewer = await getViewer();
  if (!viewer) return notFound();
  const job = await db.job.findFirst({ where: { id, status: "succeeded" }, select: { userId: true } });
  if (!job || (job.userId !== viewer.id && !(await currentAdmin()))) return notFound();
  return (await fileResponse(id, kind, req.headers.get("range"))) ?? notFound();
}

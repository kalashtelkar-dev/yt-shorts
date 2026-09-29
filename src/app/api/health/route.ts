import { db } from "@/db/client";

export const dynamic = "force-dynamic";

// Web self-check for the health page: the app serves requests and reaches its database.
export async function GET() {
  try {
    await db.$queryRaw`select 1`;
    return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ status: "error" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

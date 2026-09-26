import { env } from "@/config/env";

// Stand-in for Engine X storage in ENGINEX_MODE=mock: accepts an upload and throws it away.
export async function PUT(req: Request) {
  if (env.ENGINEX_MODE !== "mock") return new Response("Not found", { status: 404 });
  await req.arrayBuffer();
  return new Response(null, { status: 200 });
}

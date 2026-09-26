import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/server/auth";

const handler = toNextJsHandler(auth);

export const GET = handler.GET;

// Anonymous users are created only through ensureUser() (server-side, rate-limited per IP),
// never by calling this route directly.
export async function POST(req: Request) {
  if (new URL(req.url).pathname.endsWith("/sign-in/anonymous")) return new Response("Not found", { status: 404 });
  return handler.POST(req);
}

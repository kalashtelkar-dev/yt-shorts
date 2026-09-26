import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/server/auth";

const handler = toNextJsHandler(auth);

export const GET = handler.GET;

// Sign-in (anonymous and admin) runs through server actions, which apply our Redis rate limits.
// Only these POST endpoints are reachable directly; milestone 10 adds the full-auth ones.
const PUBLIC_POSTS = ["/sign-out"];

export async function POST(req: Request) {
  const path = new URL(req.url).pathname.replace(/^\/api\/auth/, "");
  if (!PUBLIC_POSTS.includes(path)) return new Response("Not found", { status: 404 });
  return handler.POST(req);
}

import { env } from "@/config/env";
import { handleWebhook } from "@/server/payments";

// Cashfree calls this when a payment succeeds, so credits arrive even if the buyer closed the tab.
// The raw body is verified against x-webhook-signature before anything is read from it.
export async function POST(req: Request) {
  if (!env.PAYMENTS_ENABLED || env.PAYMENTS_PROVIDER !== "cashfree") return new Response("Not found", { status: 404 });
  const signature = req.headers.get("x-webhook-signature") ?? "";
  const timestamp = req.headers.get("x-webhook-timestamp") ?? "";
  const body = await req.text();
  if (body.length > 1_000_000) return new Response("Too large", { status: 413 });
  try {
    const ok = await handleWebhook(body, signature, timestamp);
    return new Response(ok ? "ok" : "Bad signature", { status: ok ? 200 : 400 });
  } catch (e) {
    console.error("[cashfree webhook]", e instanceof Error ? e.message : "failed");
    return new Response("Error", { status: 500 }); // Cashfree retries
  }
}

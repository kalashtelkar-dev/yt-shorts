import { env } from "@/config/env";
import { handleWebhook } from "@/server/payments";

// Razorpay calls this when a payment is captured, so credits arrive even if the buyer closed the tab.
// The raw body is verified against X-Razorpay-Signature before anything is read from it.
export async function POST(req: Request) {
  if (!env.PAYMENTS_ENABLED || env.PAYMENTS_PROVIDER !== "razorpay") return new Response("Not found", { status: 404 });
  const signature = req.headers.get("x-razorpay-signature") ?? "";
  const body = await req.text();
  if (body.length > 1_000_000) return new Response("Too large", { status: 413 });
  try {
    const ok = await handleWebhook(body, signature);
    return new Response(ok ? "ok" : "Bad signature", { status: ok ? 200 : 400 });
  } catch (e) {
    console.error("[razorpay webhook]", e instanceof Error ? e.message : "failed");
    return new Response("Error", { status: 500 }); // Razorpay retries
  }
}

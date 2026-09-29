import "server-only";
import { env } from "@/config/env";
import type { Probe } from "../types";

// Checks the Razorpay keys work, with a read that creates nothing. Not critical: montages keep working
// when payments are down, only buying credits stops.
export const razorpayProbe: Probe = {
  id: "razorpay",
  name: "Payments (Razorpay)",
  tier: "payments",
  critical: false,
  degradedMs: 2000,
  async run() {
    if (!env.PAYMENTS_ENABLED || env.PAYMENTS_PROVIDER !== "razorpay" || !env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
      return { status: "not_configured", message: "Set PAYMENTS_PROVIDER=razorpay and its keys to take payments" };
    }
    const auth = Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString("base64");
    const res = await fetch("https://api.razorpay.com/v1/payments?count=1", { headers: { Authorization: `Basic ${auth}` }, cache: "no-store", signal: AbortSignal.timeout(5000) });
    return res.ok ? { status: "up" } : { status: "down", message: `HTTP ${res.status}` };
  },
};

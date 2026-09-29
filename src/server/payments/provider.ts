import "server-only";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { env } from "@/config/env";

// Payment providers behind one interface (PLAN.md §3). Razorpay in production; a mock for local testing that
// behaves the same way (order → checkout → signed payment), refused in production by src/config/env.ts.

export type PaymentsProvider = {
  name: "razorpay" | "mock";
  /** Public key the browser checkout needs (Razorpay key id). Never the secret. */
  keyId: string | null;
  createOrder(o: { amountPaise: number; receipt: string }): Promise<{ orderId: string }>;
  /** Checks the signature the checkout returned for a payment of this order. */
  verifyPayment(p: { orderId: string; paymentId: string; signature: string }): boolean;
  /** Checks a webhook body against its X-Razorpay-Signature header. */
  verifyWebhook(rawBody: string, signature: string): boolean;
};

export class PaymentsError extends Error {}

const hmac = (secret: string, data: string) => createHmac("sha256", secret).update(data).digest("hex");

/** Constant-time compare of two hex signatures. */
export function sameSignature(expected: string, given: string): boolean {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(given, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

function razorpay(): PaymentsProvider {
  const keyId = env.RAZORPAY_KEY_ID!;
  const secret = env.RAZORPAY_KEY_SECRET!;
  const webhookSecret = env.RAZORPAY_WEBHOOK_SECRET!;
  return {
    name: "razorpay",
    keyId,
    async createOrder({ amountPaise, receipt }) {
      const res = await fetch("https://api.razorpay.com/v1/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Basic ${Buffer.from(`${keyId}:${secret}`).toString("base64")}` },
        body: JSON.stringify({ amount: amountPaise, currency: "INR", receipt: receipt.slice(0, 40) }),
        signal: AbortSignal.timeout(15_000),
      }).catch(() => null);
      // Never log the response body or headers: the error text is enough.
      if (!res?.ok) throw new PaymentsError(`Razorpay order failed${res ? ` (HTTP ${res.status})` : ""}`);
      const data = (await res.json()) as { id?: unknown };
      if (typeof data.id !== "string") throw new PaymentsError("Razorpay order had no id");
      return { orderId: data.id };
    },
    verifyPayment: ({ orderId, paymentId, signature }) => sameSignature(hmac(secret, `${orderId}|${paymentId}`), signature),
    verifyWebhook: (rawBody, signature) => sameSignature(hmac(webhookSecret, rawBody), signature),
  };
}

// The mock signs with a fixed key: it only ever runs on a developer's machine.
const MOCK_KEY = "montage-mock-payments";
export const mockSignature = (orderId: string, paymentId: string) => hmac(MOCK_KEY, `${orderId}|${paymentId}`);

function mock(): PaymentsProvider {
  return {
    name: "mock",
    keyId: null,
    async createOrder() {
      return { orderId: `order_mock_${randomUUID().replaceAll("-", "").slice(0, 14)}` };
    },
    verifyPayment: ({ orderId, paymentId, signature }) => sameSignature(mockSignature(orderId, paymentId), signature),
    verifyWebhook: () => false,
  };
}

export function paymentsProvider(): PaymentsProvider {
  if (!env.PAYMENTS_ENABLED) throw new PaymentsError("Payments are switched off");
  return env.PAYMENTS_PROVIDER === "razorpay" ? razorpay() : mock();
}

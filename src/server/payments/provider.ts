import "server-only";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { env } from "@/config/env";

// Payment providers behind one interface (PLAN.md §3). Cashfree in production; a mock for local testing that
// behaves the same way (order → checkout → confirmed payment), refused in production by src/config/env.ts.

export type PaidPayment = { paymentId: string; method: string | null };

export type PaymentsProvider = {
  name: "cashfree" | "mock";
  /** `sessionId` is what the browser checkout opens (Cashfree's payment_session_id). Never a secret. */
  createOrder(o: { amountPaise: number; receipt: string; customer: { id: string; email: string } }): Promise<{ orderId: string; sessionId: string | null }>;
  /** The order's successful payment, asked of the provider itself; null if it isn't paid. `proof` is the mock checkout's signed payment. */
  paidPayment(orderId: string, proof?: { paymentId?: string; signature?: string }): Promise<PaidPayment | null>;
  /** Checks a webhook body against its x-webhook-signature and x-webhook-timestamp headers. */
  verifyWebhook(rawBody: string, signature: string, timestamp: string): boolean;
};

export class PaymentsError extends Error {}

const hmac = (secret: string, data: string) => createHmac("sha256", secret).update(data).digest("hex");

/** Constant-time compare of two signatures. */
export function sameSignature(expected: string, given: string): boolean {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(given, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Cashfree signs webhooks with the secret key: base64(HMAC-SHA256(timestamp + raw body)). */
export const cashfreeWebhookSignature = (secret: string, timestamp: string, rawBody: string) => createHmac("sha256", secret).update(timestamp + rawBody).digest("base64");

const CASHFREE_API_VERSION = "2023-08-01";

function cashfree(): PaymentsProvider {
  const secret = env.CASHFREE_SECRET_KEY!;
  const base = env.CASHFREE_ENV === "production" ? "https://api.cashfree.com/pg" : "https://sandbox.cashfree.com/pg";
  const headers = { "Content-Type": "application/json", "x-api-version": CASHFREE_API_VERSION, "x-client-id": env.CASHFREE_APP_ID!, "x-client-secret": secret };
  // Never log the response body or headers: the error text is enough.
  const call = (path: string, init?: RequestInit) => fetch(`${base}${path}`, { ...init, headers, cache: "no-store", signal: AbortSignal.timeout(15_000) }).catch(() => null);
  return {
    name: "cashfree",
    async createOrder({ amountPaise, receipt, customer }) {
      const res = await call("/orders", {
        method: "POST",
        body: JSON.stringify({
          order_id: receipt,
          order_amount: amountPaise / 100,
          order_currency: "INR",
          // ponytail: Cashfree requires a phone and we don't collect one; ask for it at checkout if Cashfree starts rejecting this.
          customer_details: { customer_id: customer.id.slice(0, 50), customer_email: customer.email, customer_phone: "9999999999" },
        }),
      });
      if (!res?.ok) throw new PaymentsError(`Cashfree order failed${res ? ` (HTTP ${res.status})` : ""}`);
      const data = (await res.json()) as { order_id?: unknown; payment_session_id?: unknown };
      if (typeof data.order_id !== "string" || typeof data.payment_session_id !== "string") throw new PaymentsError("Cashfree order had no session");
      return { orderId: data.order_id, sessionId: data.payment_session_id };
    },
    async paidPayment(orderId) {
      const res = await call(`/orders/${encodeURIComponent(orderId)}/payments`);
      if (!res?.ok) throw new PaymentsError(`Cashfree payment lookup failed${res ? ` (HTTP ${res.status})` : ""}`);
      const list = (await res.json()) as { cf_payment_id?: unknown; payment_status?: string; payment_group?: string }[];
      const paid = Array.isArray(list) ? list.find((p) => p.payment_status === "SUCCESS" && p.cf_payment_id != null) : undefined;
      return paid ? { paymentId: String(paid.cf_payment_id), method: paid.payment_group ?? null } : null;
    },
    verifyWebhook: (rawBody, signature, timestamp) => !!timestamp && sameSignature(cashfreeWebhookSignature(secret, timestamp, rawBody), signature),
  };
}

// The mock signs with a fixed key: it only ever runs on a developer's machine.
const MOCK_KEY = "montage-mock-payments";
export const mockSignature = (orderId: string, paymentId: string) => hmac(MOCK_KEY, `${orderId}|${paymentId}`);

function mock(): PaymentsProvider {
  return {
    name: "mock",
    async createOrder() {
      return { orderId: `order_mock_${randomUUID().replaceAll("-", "").slice(0, 14)}`, sessionId: null };
    },
    async paidPayment(orderId, proof) {
      if (!proof?.paymentId || !proof.signature) return null;
      return sameSignature(mockSignature(orderId, proof.paymentId), proof.signature) ? { paymentId: proof.paymentId, method: null } : null;
    },
    verifyWebhook: () => false,
  };
}

export function paymentsProvider(): PaymentsProvider {
  if (!env.PAYMENTS_ENABLED) throw new PaymentsError("Payments are switched off");
  return env.PAYMENTS_PROVIDER === "cashfree" ? cashfree() : mock();
}

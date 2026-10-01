import { describe, expect, it, vi } from "vitest";
import { cashfreeWebhookSignature, paymentsProvider } from "./provider";

vi.mock("@/config/env", async (orig) => {
  const actual = (await orig()) as { env: Record<string, unknown> };
  return { ...actual, env: { ...actual.env, PAYMENTS_ENABLED: true, PAYMENTS_PROVIDER: "cashfree", CASHFREE_APP_ID: "TEST_APP", CASHFREE_SECRET_KEY: "test_secret" } };
});

describe("cashfree webhook signature", () => {
  const body = JSON.stringify({ type: "PAYMENT_SUCCESS_WEBHOOK", data: { order: { order_id: "o1" } } });
  const ts = "1727770000000";

  it("accepts Cashfree's signature and refuses anything else", () => {
    const p = paymentsProvider();
    const good = cashfreeWebhookSignature("test_secret", ts, body);
    expect(p.verifyWebhook(body, good, ts)).toBe(true);
    expect(p.verifyWebhook(body + " ", good, ts)).toBe(false); // body changed
    expect(p.verifyWebhook(body, good, "1727770000001")).toBe(false); // timestamp changed
    expect(p.verifyWebhook(body, cashfreeWebhookSignature("other", ts, body), ts)).toBe(false);
    expect(p.verifyWebhook(body, good, "")).toBe(false);
  });
});

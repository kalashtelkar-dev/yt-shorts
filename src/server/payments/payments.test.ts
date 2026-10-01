import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db/client";
import { getBalance } from "@/server/credits";
import { getSettings } from "@/server/settings";
import { confirmPurchase, getInvoice, saveBillingProfile, startPurchase } from ".";

// Checkout with the mock provider, which confirms payments with a signed proof.
vi.mock("@/config/env", async (orig) => {
  const actual = (await orig()) as { env: Record<string, unknown> };
  return { ...actual, env: { ...actual.env, PAYMENTS_ENABLED: true, PAYMENTS_PROVIDER: "mock" } };
});

let user: { id: string; email: string; isAnonymous: boolean };

beforeEach(async () => {
  const id = crypto.randomUUID();
  user = { id, email: `${id}@test.local`, isAnonymous: false };
  await db.user.create({ data: { id, name: "t", email: user.email, isAnonymous: false } });
  const s = await getSettings();
  expect(s).toMatchObject({ sellPaisePerCredit: 20, minPurchasePaise: 10_000 }); // ₹0.20 a credit, ₹100 minimum
});

async function buy(amount = 100) {
  const start = await startPurchase(user, amount);
  if (!start.ok) throw new Error(start.error.message);
  const m = start.data.mock!;
  return { start: start.data, confirm: () => confirmPurchase(user.id, { orderId: start.data.orderId, paymentId: m.paymentId, signature: m.signature }) };
}

describe("buying credits", () => {
  it("refuses amounts outside the limits and guests", async () => {
    await saveBillingProfile(user.id, { stateCode: "29" });
    expect(await startPurchase(user, 99)).toMatchObject({ ok: false, error: { field: "amount" } });
    expect(await startPurchase(user, 100.5)).toMatchObject({ ok: false, error: { field: "amount" } });
    expect(await startPurchase({ ...user, isAnonymous: true }, 100)).toMatchObject({ ok: false, error: { code: "sign_in" } });
  });

  it("checks billing details when given", async () => {
    expect(await saveBillingProfile(user.id, { stateCode: "99" })).toMatchObject({ ok: false });
    expect(await saveBillingProfile(user.id, { stateCode: "27", gstin: "29AALCD7580N1ZQ" })).toMatchObject({ ok: false, error: { field: "gstin" } });
    expect(await saveBillingProfile(user.id, { stateCode: "29", gstin: "29aalcd7580n1zq", legalName: "Acme" })).toMatchObject({ ok: true });
  });

  it("adds 500 credits for ₹100 and issues one intra-state invoice, however often it's confirmed", async () => {
    await saveBillingProfile(user.id, { stateCode: "29" });
    const { start, confirm } = await buy(100);
    expect(start).toMatchObject({ amountPaise: 10_000, credits: 500, provider: "mock" });
    expect(await getBalance(user.id)).toBe(0); // nothing until the payment is verified

    const [a, b] = await Promise.all([confirm(), confirm()]);
    expect(a).toMatchObject({ ok: true, data: { credits: 500 } });
    expect(b).toMatchObject({ ok: true });
    expect(await getBalance(user.id)).toBe(500);
    expect(await db.creditLedger.count({ where: { userId: user.id } })).toBe(1);

    const inv = await db.invoice.findFirstOrThrow({ where: { userId: user.id } });
    expect(inv.number).toMatch(/^INV-\d{4}-\d{4,}$/);
    expect(inv).toMatchObject({ credits: 500, taxablePaise: 8475, cgstPaise: 762, sgstPaise: 763, igstPaise: 0, totalPaise: 10_000 });
    const p = await db.payment.findFirstOrThrow({ where: { userId: user.id } });
    expect(p.status).toBe("paid");
    expect(await getInvoice(inv.id, user.id)).not.toBeNull();
    expect(await getInvoice(inv.id, crypto.randomUUID())).toBeNull(); // someone else's invoice looks missing
  });

  it("pays without billing details: the invoice uses the seller's state", async () => {
    await (await buy(100)).confirm();
    const inv = await db.invoice.findFirstOrThrow({ where: { userId: user.id } });
    expect(inv).toMatchObject({ credits: 500, cgstPaise: 762, sgstPaise: 763, igstPaise: 0, totalPaise: 10_000, buyer: { gstin: null } });
  });

  it("charges IGST to buyers in another state", async () => {
    await saveBillingProfile(user.id, { stateCode: "27" });
    await (await buy(150)).confirm();
    const inv = await db.invoice.findFirstOrThrow({ where: { userId: user.id } });
    expect(inv).toMatchObject({ credits: 750, cgstPaise: 0, sgstPaise: 0, igstPaise: 15_000 - 12_712, totalPaise: 15_000 });
  });

  it("refuses a forged signature and someone else's order", async () => {
    await saveBillingProfile(user.id, { stateCode: "29" });
    const { start } = await buy(100);
    expect(await confirmPurchase(user.id, { orderId: start.orderId, paymentId: start.mock!.paymentId, signature: "0".repeat(64) })).toMatchObject({ ok: false, error: { code: "not_paid" } });
    expect(await confirmPurchase(crypto.randomUUID(), { orderId: start.orderId, paymentId: start.mock!.paymentId, signature: start.mock!.signature })).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(await getBalance(user.id)).toBe(0);
  });
});

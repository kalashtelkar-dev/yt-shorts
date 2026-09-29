import "server-only";
import { z } from "zod";
import { db } from "@/db/client";
import { Prisma, type Payment } from "@/generated/prisma/client";
import { creditsForPaise, financialYear, GST_STATES, GSTIN_RE, invoiceNumber, splitGst } from "@/lib/billing";
import type { ActionResult } from "@/lib/jobs";
import { addPurchase, type Tx } from "@/server/credits";
import { underLimit } from "@/server/redis";
import { getSettings } from "@/server/settings";
import { mockSignature, paymentsProvider, PaymentsError } from "./provider";

// Buying credits: order → checkout → a verified payment adds credits and issues a tax invoice, once.
// Both the browser (after checkout) and the Razorpay webhook can confirm; whichever comes first does the work.

const PURCHASE_STARTS_PER_HOUR = 20;
const fail = (code: string, message: string, field?: string) => ({ ok: false as const, error: { code, message, field } });

// ── Billing profile (buyer details for GST) ──

export const billingProfileInput = z.strictObject({
  stateCode: z.string().refine((c) => GST_STATES.some((s) => s.code === c), "Pick your state"),
  legalName: z.string().trim().max(120).optional().transform((v) => v || null),
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .optional()
    .transform((v) => v || null)
    .refine((v) => v === null || GSTIN_RE.test(v), "That GSTIN doesn't look right. It has 15 characters, like 29ABCDE1234F1Z5."),
});

export async function getBillingProfile(userId: string) {
  return db.billingProfile.findUnique({ where: { userId } });
}

export async function saveBillingProfile(userId: string, raw: unknown): Promise<ActionResult<null>> {
  const parsed = billingProfileInput.safeParse(raw);
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    return fail("invalid", i.message, String(i.path[0] ?? ""));
  }
  const v = parsed.data;
  // A GSTIN's first two digits are its state: they must match the state picked, or the tax split would be wrong.
  if (v.gstin && v.gstin.slice(0, 2) !== v.stateCode) return fail("invalid", "That GSTIN is registered in another state. Pick the state it belongs to.", "gstin");
  await db.billingProfile.upsert({ where: { userId }, create: { userId, ...v }, update: v });
  return { ok: true, data: null };
}

// ── Checkout ──

export type CheckoutStart = {
  orderId: string;
  provider: "razorpay" | "mock";
  keyId: string | null;
  amountPaise: number;
  credits: number;
  email: string;
  /** Mock provider only: the payment id and signature its fake checkout returns. */
  mock?: { paymentId: string; signature: string };
};

export async function startPurchase(user: { id: string; email: string; isAnonymous?: boolean | null }, amountRupees: unknown): Promise<ActionResult<CheckoutStart>> {
  if (user.isAnonymous) return fail("sign_in", "Sign in to buy credits.");
  const s = await getSettings();
  const amount = z.coerce.number().int().safeParse(amountRupees);
  const amountPaise = amount.success ? amount.data * 100 : NaN;
  if (!amount.success || amountPaise < s.minPurchasePaise || amountPaise > s.maxPurchasePaise) {
    return fail("invalid", `Pick an amount between ₹${s.minPurchasePaise / 100} and ₹${s.maxPurchasePaise / 100}.`, "amount");
  }
  const fresh = await db.user.findUnique({ where: { id: user.id }, select: { suspendedAt: true } });
  if (fresh?.suspendedAt) return fail("suspended", "Your account is paused, so you can't buy credits. Contact support if this looks wrong.");
  if (!(await getBillingProfile(user.id))) return fail("profile_needed", "Tell us your state first; it goes on your tax invoice.");
  if (!(await underLimit(`purchase:${user.id}`, PURCHASE_STARTS_PER_HOUR, 3600))) return fail("rate_limited", "Too many payment attempts. Try again in an hour.");

  const credits = creditsForPaise(amountPaise, s.sellPaisePerCredit);
  if (credits <= 0) return fail("unavailable", "Buying credits is paused right now. Try again later.");
  const provider = paymentsProvider();
  const id = crypto.randomUUID();
  let orderId: string;
  try {
    ({ orderId } = await provider.createOrder({ amountPaise, receipt: id }));
  } catch (e) {
    console.error("[startPurchase]", e instanceof PaymentsError ? e.message : "order failed");
    return fail("provider", "We couldn't open the payment page. Try again in a minute.");
  }
  await db.payment.create({ data: { id, userId: user.id, provider: provider.name, providerOrderId: orderId, amountPaise, credits } });
  const mockPaymentId = `pay_mock_${id.replaceAll("-", "").slice(0, 14)}`;
  return {
    ok: true,
    data: {
      orderId,
      provider: provider.name,
      keyId: provider.keyId,
      amountPaise,
      credits,
      email: user.email,
      mock: provider.name === "mock" ? { paymentId: mockPaymentId, signature: mockSignature(orderId, mockPaymentId) } : undefined,
    },
  };
}

const confirmInput = z.strictObject({ orderId: z.string().min(1).max(100), paymentId: z.string().min(1).max(100), signature: z.string().min(1).max(200) });

/** The browser's confirmation after checkout. The signature proves the provider saw this payment for this order. */
export async function confirmPurchase(userId: string, raw: unknown): Promise<ActionResult<{ credits: number; invoiceId: string }>> {
  const parsed = confirmInput.safeParse(raw);
  if (!parsed.success) return fail("invalid", "That payment couldn't be checked. If money left your account, contact support.");
  const { orderId, paymentId, signature } = parsed.data;
  const p = await db.payment.findFirst({ where: { providerOrderId: orderId, userId } });
  if (!p) return fail("not_found", "We couldn't find that payment. If money left your account, contact support.");
  if (!paymentsProvider().verifyPayment({ orderId, paymentId, signature })) {
    return fail("signature", "That payment couldn't be verified. If money left your account, contact support with the payment id.");
  }
  const r = await markPaid(orderId, paymentId, null, null);
  return r ? { ok: true, data: { credits: p.credits, invoiceId: r.invoiceId } } : fail("not_found", "We couldn't find that payment.");
}

/** Razorpay webhook: payment.captured / order.paid. Returns false when the signature is wrong. */
export async function handleWebhook(rawBody: string, signature: string): Promise<boolean> {
  const provider = paymentsProvider();
  if (!provider.verifyWebhook(rawBody, signature)) return false;
  const body = JSON.parse(rawBody) as { event?: string; payload?: { payment?: { entity?: { id?: string; order_id?: string; method?: string; status?: string } } } };
  const entity = body.payload?.payment?.entity;
  if ((body.event === "payment.captured" || body.event === "order.paid") && entity?.order_id && entity.id) {
    await markPaid(entity.order_id, entity.id, entity.method ?? null, { event: body.event, status: entity.status ?? null });
  }
  return true;
}

/**
 * Marks the order paid, adds its credits and issues its invoice, in one transaction. Idempotent: the payment row is
 * locked and a second call finds it paid (the ledger's unique paymentId backs this up). Null if the order is unknown.
 */
export async function markPaid(orderId: string, providerPaymentId: string, method: string | null, raw: unknown): Promise<{ invoiceId: string } | null> {
  return db.$transaction(async (tx) => {
    const [locked] = await tx.$queryRaw<{ id: string }[]>`select id from payments where provider_order_id = ${orderId} for update`;
    if (!locked) return null;
    const p = await tx.payment.findUniqueOrThrow({ where: { id: locked.id } });
    if (p.status === "paid") {
      const inv = await tx.invoice.findUniqueOrThrow({ where: { paymentId: p.id }, select: { id: true } });
      return { invoiceId: inv.id };
    }
    await tx.payment.update({
      where: { id: p.id },
      data: { status: "paid", providerPaymentId, method, paidAt: new Date(), ...(raw != null && { raw: raw as Prisma.InputJsonValue }) },
    });
    await addPurchase(tx, p.userId, p.id, p.credits);
    const invoiceId = await issueInvoice(tx, p);
    return { invoiceId };
  });
}

async function issueInvoice(tx: Tx, p: Payment): Promise<string> {
  // Read inside the transaction: getSettings() would take a second pool connection while this one is held.
  const s = await tx.settings.findUniqueOrThrow({ where: { id: 1 } });
  const profile = await tx.billingProfile.findUnique({ where: { userId: p.userId } });
  const user = await tx.user.findUnique({ where: { id: p.userId }, select: { email: true } });
  const buyerState = profile?.stateCode ?? s.seller.stateCode ?? "29";
  const split = splitGst(p.amountPaise, s.gstRateBps, buyerState === (s.seller.stateCode ?? "29"));
  const issuedAt = new Date();
  const fy = financialYear(issuedAt);
  // One atomic statement: two invoices can never get the same number.
  const [{ last }] = await tx.$queryRaw<{ last: number }[]>`
    insert into invoice_counters (fy, last) values (${fy}, 1)
    on conflict (fy) do update set last = invoice_counters.last + 1
    returning last`;
  const inv = await tx.invoice.create({
    data: {
      number: invoiceNumber(fy, last),
      userId: p.userId,
      paymentId: p.id,
      seller: s.seller,
      buyer: { email: user?.email ?? "", legalName: profile?.legalName ?? null, gstin: profile?.gstin ?? null, stateCode: buyerState },
      credits: p.credits,
      taxablePaise: split.taxablePaise,
      cgstPaise: split.cgstPaise,
      sgstPaise: split.sgstPaise,
      igstPaise: split.igstPaise,
      totalPaise: split.totalPaise,
      gstRateBps: s.gstRateBps,
      issuedAt,
    },
    select: { id: true },
  });
  return inv.id;
}

// ── Reading ──

/** An invoice with its payment, for its owner (userId) or an admin (null). */
export async function getInvoice(id: string, userId: string | null) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const row = await db.invoice.findFirst({ where: userId ? { id, userId } : { id }, include: { payment: true } });
  if (!row) return null;
  const { payment, ...invoice } = row;
  return { invoice, payment };
}

export async function listPayments(page: number, size = 20) {
  const found = await db.payment.findMany({
    include: { user: { select: { email: true, isAnonymous: true } }, invoice: { select: { id: true, number: true } } },
    orderBy: { createdAt: "desc" },
    take: size + 1,
    skip: page * size,
  });
  const rows = found.map(({ user, invoice, ...payment }) => ({ payment, email: user.email, isAnonymous: user.isAnonymous, invoiceId: invoice?.id ?? null, invoiceNumber: invoice?.number ?? null }));
  return { rows: rows.slice(0, size), hasMore: rows.length > size };
}

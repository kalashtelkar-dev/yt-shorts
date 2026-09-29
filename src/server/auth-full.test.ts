import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Full-auth flows run against the real Better Auth config with AUTH_MODE=full; emails are captured.
const sent = vi.hoisted(() => {
  process.env.AUTH_MODE = "full";
  return [] as { to: string; otp: string; purpose: string }[];
});
vi.mock("@/server/email", () => ({
  sendOtpEmail: async (to: string, otp: string, purpose: string) => void sent.push({ to, otp, purpose }),
  mailConfigured: () => false,
  mailer: () => ({}),
}));

import { db } from "@/db";
import { catalogItems, creditLedger, jobs, users, verifications } from "@/db/schema";
import { mergeGuest } from "./account";
import { auth } from "./auth";
import { adjustCredits, chargeForUsage, getBalance, grant, grantStarterOnce, refundJob } from "./credits";
import { applyHeldPassword, holdPassword, sendCode } from "./otp";
import { inboxKey } from "@/lib/email";
import { redis } from "./redis";
import { welcomeCredits } from "./session";

let email: string;
let ip: string; // fresh per test, so per-network hourly caps don't carry over between runs
const password = "correct horse 1";
const lastCode = () => sent.at(-1)!.otp;
const clearCooldown = (purpose: string) => redis.del(`otp-cooldown:${purpose}:${email}`);
const verify = (otp: string, headers?: Headers) => auth.api.verifyEmailOTP({ body: { email, otp }, headers: headers ?? new Headers() });
const errorCode = (p: Promise<unknown>) => p.then(() => "ok", (e) => (e.body?.code as string) ?? String(e));

beforeEach(async () => {
  sent.length = 0;
  email = `${crypto.randomUUID()}@test.local`;
  ip = crypto.randomUUID();
});

describe("sign-up codes", () => {
  it("sends a hashed, 6-digit, 10-minute code on sign-up", async () => {
    await auth.api.signUpEmail({ body: { email, password, name: "t" } });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: email, purpose: "email-verification" });
    expect(lastCode()).toMatch(/^\d{6}$/);

    const [row] = await db.select().from(verifications).where(eq(verifications.identifier, `email-verification-otp-${email}`));
    expect(row.value).not.toContain(lastCode()); // hashed at rest
    const minutes = (row.expiresAt.getTime() - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(9.9);
    expect(minutes).toBeLessThanOrEqual(10);
  });

  it("allows 5 wrong tries, then the code is dead", async () => {
    await auth.api.signUpEmail({ body: { email, password, name: "t" } });
    const code = lastCode();
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) expect(await errorCode(verify(wrong))).toBe("INVALID_OTP");
    expect(await errorCode(verify(code))).toBe("TOO_MANY_ATTEMPTS");
  });

  it("enforces the 60 s resend cooldown, then verifies once and signs in", async () => {
    await auth.api.signUpEmail({ body: { email, password, name: "t" } });
    expect(await sendCode(email, "email-verification", ip)).toMatchObject({ ok: true });
    expect(await sendCode(email, "email-verification", ip)).toMatchObject({ ok: false, error: { code: "cooldown" } });
    expect(sent).toHaveLength(2);

    const code = lastCode();
    const r = await verify(code);
    expect(r.token).toBeTruthy(); // signed in after verifying
    expect(await errorCode(verify(code))).not.toBe("ok"); // single use

    // A verified account gets no more sign-up codes.
    await clearCooldown("email-verification");
    await sendCode(email, "email-verification", ip);
    expect(sent).toHaveLength(2);
  });

  it("refuses password sign-in until the email is verified", async () => {
    await auth.api.signUpEmail({ body: { email, password, name: "t" } });
    expect(await errorCode(auth.api.signInEmail({ body: { email, password } }))).toBe("EMAIL_NOT_VERIFIED");
  });
});

describe("account pre-registration", () => {
  it("an attacker's earlier, unverified sign-up can't keep its password once the owner verifies", async () => {
    // The attacker signs up with the victim's email and their own password, then waits.
    await auth.api.signUpEmail({ body: { email, password: "attacker pass", name: "t" } });
    // The victim signs up in their own browser: Better Auth keeps the old password, we hold theirs.
    await auth.api.signUpEmail({ body: { email, password, name: "t" } });
    const nonce = await holdPassword(email, password);
    await clearCooldown("email-verification");
    await sendCode(email, "email-verification", ip);
    const { user } = await verify(lastCode());
    expect(await applyHeldPassword(nonce, email, user.id)).toBe(true);

    expect(await errorCode(auth.api.signInEmail({ body: { email, password: "attacker pass" } }))).toBe("INVALID_EMAIL_OR_PASSWORD");
    expect(await errorCode(auth.api.signInEmail({ body: { email, password } }))).toBe("ok");
    expect(await applyHeldPassword(nonce, email, user.id)).toBe(false); // single use
  });

  it("a held password only applies to the email it was held for", async () => {
    const nonce = await holdPassword(email, password);
    expect(await applyHeldPassword(nonce, `other-${email}`, "someone")).toBe(false);
  });
});

describe("inboxKey", () => {
  it("folds address variants of one inbox", () => {
    expect(inboxKey("Me.Name+yt@Gmail.com")).toBe("mename@gmail.com");
    expect(inboxKey("m.e@googlemail.com")).toBe("me@gmail.com");
    expect(inboxKey("first.last+x@example.com")).toBe("first.last@example.com");
  });
});

describe("password reset", () => {
  it("resets with a code and says nothing for unknown emails", async () => {
    await auth.api.signUpEmail({ body: { email, password, name: "t" } });
    await verify(lastCode());

    await sendCode(email, "forget-password", ip);
    expect(sent.at(-1)).toMatchObject({ purpose: "forget-password" });
    await auth.api.resetPasswordEmailOTP({ body: { email, otp: lastCode(), password: "a new password" } });
    expect(await errorCode(auth.api.signInEmail({ body: { email, password } }))).toBe("INVALID_EMAIL_OR_PASSWORD");
    expect(await errorCode(auth.api.signInEmail({ body: { email, password: "a new password" } }))).toBe("ok");

    const count = sent.length;
    expect(await sendCode(`nobody-${email}`, "forget-password", ip)).toMatchObject({ ok: true });
    expect(sent).toHaveLength(count);
  });
});

describe("change password", () => {
  const cookieOf = (h: Headers) => h.getSetCookie().map((c) => c.split(";")[0]).join("; ");

  it("needs the current password and signs out the other sessions", async () => {
    await auth.api.signUpEmail({ body: { email, password, name: "t" } });
    await verify(lastCode());
    const laptop = cookieOf((await auth.api.signInEmail({ body: { email, password }, returnHeaders: true })).headers);
    const phone = cookieOf((await auth.api.signInEmail({ body: { email, password }, returnHeaders: true })).headers);

    const change = (currentPassword: string) =>
      auth.api.changePassword({ body: { currentPassword, newPassword: "another password", revokeOtherSessions: true }, headers: new Headers({ cookie: laptop }) });
    expect(await errorCode(change("not it"))).toBe("INVALID_PASSWORD");
    expect(await errorCode(change(password))).toBe("ok");

    // The DB session is gone; the phone's 5-minute cookie cache (auth.ts) expires on its own.
    expect(await auth.api.getSession({ headers: new Headers({ cookie: phone }), query: { disableCookieCache: true } })).toBeNull();
    expect(await errorCode(auth.api.signInEmail({ body: { email, password: "another password" } }))).toBe("ok");
  });
});

describe("guest → account", () => {
  async function guestWithJob() {
    const res = await auth.api.signInAnonymous({ headers: new Headers(), returnHeaders: true });
    const guestId = res.response!.user.id;
    const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    const [item] = await db.insert(catalogItems).values({ slug: `t-${guestId}`, title: "t", templateId: "tpl_t" }).returning({ id: catalogItems.id });
    await grant(guestId, 500, "Starter credits");
    const jobId = await db.transaction(async (tx) => {
      const [job] = await tx
        .insert(jobs)
        .values({ userId: guestId, catalogItemId: item.id, catalogSlug: "t", templateId: "tpl_t", input: {}, source: "url", durationSec: 30, maxCredits: 200, status: "succeeded" })
        .returning({ id: jobs.id });
      // A finished montage that used 200 credits of editing time.
      await tx.update(jobs).set({ chargedCredits: await chargeForUsage(tx, guestId, job.id, 200) }).where(eq(jobs.id, job.id));
      return job.id;
    });
    return { guestId, cookie, jobId };
  }

  it("moves videos and credits when a guest verifies a new account", async () => {
    const { guestId, cookie, jobId } = await guestWithJob();
    await auth.api.signUpEmail({ body: { email, password, name: "t" } });
    const r = await verify(lastCode(), new Headers({ cookie }));
    const userId = r.user.id;

    expect(await getBalance(guestId)).toBe(0);
    expect(await getBalance(userId)).toBe(300);
    const [job] = await db.select({ userId: jobs.userId }).from(jobs).where(eq(jobs.id, jobId));
    expect(job.userId).toBe(userId);
    const transfers = await db.select({ delta: creditLedger.delta }).from(creditLedger).where(and(eq(creditLedger.kind, "transfer"), eq(creditLedger.reason, "Moved from your guest session")));
    expect(transfers.map((t) => t.delta)).toEqual(expect.arrayContaining([-300, 300]));

    // A refund after the move lands on the account, not the guest.
    await refundJob(jobId);
    expect(await getBalance(userId)).toBe(500);
    expect(await getBalance(guestId)).toBe(0);
    // The guest row stays (its ledger rows reference it).
    expect(await db.select({ id: users.id }).from(users).where(eq(users.id, guestId))).toHaveLength(1);
  });

  it("a guest who spent everything can't claim starter credits again as an account", async () => {
    const { guestId, cookie } = await guestWithJob();
    await db.transaction((tx) => adjustCredits(tx, guestId, guestId, -300, "spent")); // balance now 0
    await auth.api.signUpEmail({ body: { email, password, name: "t" } });
    const { user } = await verify(lastCode(), new Headers({ cookie }));
    expect(await getBalance(user.id)).toBe(0);
    expect(await grantStarterOnce(user.id, 600)).toBe(false);
  });

  it("merging twice or into itself changes nothing", async () => {
    const { guestId } = await guestWithJob();
    await mergeGuest(guestId, guestId);
    expect(await getBalance(guestId)).toBe(300);
  });
});

describe("welcome credits", () => {
  const account = async (addr: string) => {
    const id = crypto.randomUUID();
    await db.insert(users).values({ id, name: "t", email: addr });
    return { id, email: addr };
  };

  it("go to a new account once, and once per inbox", async () => {
    const tag = crypto.randomUUID().slice(0, 8);
    const a = await account(`me${tag}@gmail.com`);
    expect(await welcomeCredits(a, ip)).toBe(true);
    expect(await getBalance(a.id)).toBeGreaterThan(0);
    expect(await welcomeCredits(a, ip)).toBe(false);
    const variant = await account(`m.e${tag}+yt@gmail.com`);
    expect(await welcomeCredits(variant, ip)).toBe(false);
  });

  it("aren't granted after an admin already added credits (the balance on screen is real)", async () => {
    const a = await account(`${crypto.randomUUID()}@test.local`);
    await db.transaction((tx) => adjustCredits(tx, a.id, a.id, 600, "requested"));
    expect(await welcomeCredits(a, ip)).toBe(false);
    expect(await getBalance(a.id)).toBe(600);
  });
});

describe("starter credits for accounts", () => {
  it("are granted once, even under concurrency, and never after other credits", async () => {
    const id = crypto.randomUUID();
    await db.insert(users).values({ id, name: "t", email: `${id}@test.local` });
    const results = await Promise.all([grantStarterOnce(id, 300), grantStarterOnce(id, 300), grantStarterOnce(id, 300)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await getBalance(id)).toBe(300);
    expect(await grantStarterOnce(id, 300)).toBe(false);
  });
});

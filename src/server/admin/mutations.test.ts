import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { adminAuditLog, catalogItems, jobs, users } from "@/db/schema";
import { chargeForUsage, getBalance, grant } from "@/server/credits";
import { isAdmin, type Admin } from "./guard";
import { adjustUserCredits, refundJobByAdmin, retryJob, setRole, setSuspended } from "./mutations";

let admin: Admin;
let userId: string;
let catalogItemId: string;

const newUser = async (over: Partial<typeof users.$inferInsert> = {}) => {
  const id = crypto.randomUUID();
  await db.insert(users).values({ id, name: "t", email: `${id}@test.local`, ...over });
  return id;
};
const auditFor = (target: string) => db.select().from(adminAuditLog).where(eq(adminAuditLog.target, target));

/** A finished job: a succeeded one paid `used` credits for its editing time; a failed one paid nothing. */
async function finishedJob(status: "succeeded" | "failed", used = 100) {
  return db.transaction(async (tx) => {
    const [job] = await tx
      .insert(jobs)
      .values({ userId, catalogItemId, catalogSlug: "t", templateId: "tpl_old", input: { playerName: "x" }, source: "url", durationSec: 30, maxCredits: used, status })
      .returning({ id: jobs.id });
    if (status === "succeeded") {
      const charged = await chargeForUsage(tx, userId, job.id, used);
      await tx.update(jobs).set({ chargedCredits: charged }).where(eq(jobs.id, job.id));
    }
    return job.id;
  });
}

beforeEach(async () => {
  admin = { id: await newUser({ role: "admin" }), email: "a@test.local", name: "a" };
  userId = await newUser();
  const [item] = await db.insert(catalogItems).values({ slug: `t-${userId}`, title: "t", templateId: "tpl_new" }).returning({ id: catalogItems.id });
  catalogItemId = item.id;
  await grant(userId, 500, "test");
});

describe("isAdmin", () => {
  it("requires a real, active admin", () => {
    expect(isAdmin({ role: "admin", isAnonymous: false, suspendedAt: null })).toBe(true);
    expect(isAdmin({ role: "admin", isAnonymous: true, suspendedAt: null })).toBe(false);
    expect(isAdmin({ role: "admin", isAnonymous: false, suspendedAt: new Date() })).toBe(false);
    expect(isAdmin({ role: "user", isAnonymous: false, suspendedAt: null })).toBe(false);
    expect(isAdmin(undefined)).toBe(false);
  });
});

describe("admin mutations", () => {
  it("adjusts credits with a reason and audits before/after", async () => {
    expect(await adjustUserCredits(admin, userId, 250, "Goodwill")).toMatchObject({ ok: true, data: { balance: 750 } });
    expect(await adjustUserCredits(admin, userId, -50, "Correction")).toMatchObject({ ok: true, data: { balance: 700 } });
    const log = await auditFor(`user:${userId}`);
    expect(log.map((l) => l.action).sort()).toEqual(["credits.add", "credits.remove"]);
    expect(log.find((l) => l.action === "credits.add")).toMatchObject({ before: { balance: 500 }, after: { balance: 750, delta: 250 } });
  });

  it("refuses adjustments without a reason, zero, or below zero", async () => {
    expect(await adjustUserCredits(admin, userId, 10, " ")).toMatchObject({ ok: false });
    expect(await adjustUserCredits(admin, userId, 0, "why")).toMatchObject({ ok: false });
    expect(await adjustUserCredits(admin, userId, -501, "too much")).toMatchObject({ ok: false, error: { code: "insufficient" } });
    expect(await getBalance(userId)).toBe(500);
    expect(await auditFor(`user:${userId}`)).toHaveLength(0);
  });

  it("refunds a succeeded job once; failed jobs cost nothing", async () => {
    const ok = await finishedJob("succeeded");
    expect(await refundJobByAdmin(admin, ok, "Bad cut")).toMatchObject({ ok: true });
    expect(await refundJobByAdmin(admin, ok, "Again")).toMatchObject({ ok: false, error: { code: "already" } });
    expect(await getBalance(userId)).toBe(500);
    expect(await auditFor(`job:${ok}`)).toHaveLength(1);
  });

  it("retries as a new free job on the current template", async () => {
    const old = await finishedJob("failed");
    const r = await retryJob(admin, old);
    expect(r.ok).toBe(true);
    const [job] = await db.select().from(jobs).where(eq(jobs.id, r.ok ? r.data.jobId : ""));
    expect(job).toMatchObject({ status: "queued", templateId: "tpl_new", chargedCredits: 0, input: { playerName: "x" } });
    expect(await getBalance(userId)).toBe(500); // the failed job cost nothing, and the retry is free
  });

  it("protects admins from locking themselves out", async () => {
    expect(await setSuspended(admin, admin.id, true)).toMatchObject({ ok: false, error: { code: "self" } });
    expect(await setRole(admin, admin.id, "user")).toMatchObject({ ok: false, error: { code: "self" } });
  });

  it("won't make a guest an admin; suspends and audits", async () => {
    const guest = await newUser({ isAnonymous: true });
    expect(await setRole(admin, guest, "admin")).toMatchObject({ ok: false, error: { code: "anonymous" } });
    expect(await setSuspended(admin, userId, true)).toMatchObject({ ok: true });
    const [u] = await db.select().from(users).where(eq(users.id, userId));
    expect(u.suspendedAt).not.toBeNull();
    expect((await auditFor(`user:${userId}`)).map((l) => l.action)).toEqual(["user.suspend"]);
  });
});

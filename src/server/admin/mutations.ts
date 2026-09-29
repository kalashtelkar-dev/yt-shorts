import "server-only";
import { db, type Tx } from "@/db/client";
import { Prisma } from "@/generated/prisma/client";
import type { ActionResult } from "@/lib/jobs";
import { adjustCredits, getBalance, InsufficientCreditsError, refundJob } from "@/server/credits";
import { enqueueStart } from "@/server/queue";
import type { Admin } from "./guard";

// Every admin mutation writes admin_audit_log in the same transaction (CLAUDE.md §6).

const fail = (code: string, message: string): ActionResult<never> => ({ ok: false, error: { code, message } });

async function audit(tx: Tx, admin: Admin, action: string, target: string, before: unknown, after: unknown) {
  // Stored as JSON text would be (dates become strings); missing values as SQL NULL.
  const json = (v: unknown) => (v == null ? Prisma.DbNull : (JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue));
  await tx.adminAuditLog.create({ data: { adminId: admin.id, action, target, before: json(before), after: json(after) } });
}

async function findUser(tx: Tx, userId: string) {
  return tx.user.findUnique({ where: { id: userId } });
}

export async function adjustUserCredits(admin: Admin, userId: string, delta: number, reason: string): Promise<ActionResult<{ balance: number }>> {
  if (!Number.isInteger(delta) || delta === 0) return fail("invalid", "Enter a whole number of credits, like 500 or -200.");
  if (Math.abs(delta) > 1_000_000) return fail("invalid", "That's more than 1,000,000 credits. Split it up or check the number.");
  if (reason.trim().length < 3) return fail("invalid", "Add a reason so the change can be understood later.");
  try {
    await db.$transaction(async (tx) => {
      if (!(await findUser(tx, userId))) throw new Error("not_found");
      await adjustCredits(tx, admin.id, userId, delta, reason.trim()); // locks the balance row
      const { balance } = await tx.userBalance.findUniqueOrThrow({ where: { userId }, select: { balance: true } });
      const before = balance - delta;
      await audit(tx, admin, delta > 0 ? "credits.add" : "credits.remove", `user:${userId}`, { balance: before }, { balance: before + delta, delta, reason: reason.trim() });
    });
  } catch (e) {
    if (e instanceof InsufficientCreditsError) return fail("insufficient", `The balance is only ${e.balance}, so ${-delta} can't be removed.`);
    if (e instanceof Error && e.message === "not_found") return fail("not_found", "That user doesn't exist.");
    throw e;
  }
  return { ok: true, data: { balance: await getBalance(userId) } };
}

export async function setSuspended(admin: Admin, userId: string, suspend: boolean): Promise<ActionResult<null>> {
  if (userId === admin.id) return fail("self", "You can't suspend your own account.");
  const done = await db.$transaction(async (tx) => {
    const u = await findUser(tx, userId);
    if (!u) return false;
    const suspendedAt = suspend ? new Date() : null;
    await tx.user.update({ where: { id: userId }, data: { suspendedAt } });
    await audit(tx, admin, suspend ? "user.suspend" : "user.unsuspend", `user:${userId}`, { suspendedAt: u.suspendedAt }, { suspendedAt });
    return true;
  });
  return done ? { ok: true, data: null } : fail("not_found", "That user doesn't exist.");
}

export async function setRole(admin: Admin, userId: string, role: "user" | "admin"): Promise<ActionResult<null>> {
  if (userId === admin.id) return fail("self", "You can't change your own role. Ask another admin.");
  return db.$transaction(async (tx) => {
    const u = await findUser(tx, userId);
    if (!u) return fail("not_found", "That user doesn't exist.");
    if (role === "admin" && u.isAnonymous) return fail("anonymous", "Guest accounts can't be admins. The person needs a real account first.");
    if (u.role === role) return { ok: true as const, data: null };
    await tx.user.update({ where: { id: userId }, data: { role } });
    await audit(tx, admin, "user.role", `user:${userId}`, { role: u.role }, { role });
    return { ok: true as const, data: null };
  });
}

/** Give back what a job cost (e.g. a bad result). Failed jobs cost nothing (older ones were refunded automatically). */
export async function refundJobByAdmin(admin: Admin, jobId: string, reason: string): Promise<ActionResult<null>> {
  if (reason.trim().length < 3) return fail("invalid", "Add a reason for the refund.");
  return db.$transaction(async (tx) => {
    const job = await tx.job.findUnique({ where: { id: jobId }, select: { id: true, userId: true, status: true, chargedCredits: true } });
    if (!job) return fail("not_found", "That job doesn't exist.");
    if (["queued", "starting", "running"].includes(job.status)) return fail("running", "This job is still running. Wait for it to finish.");
    const refunded = await refundJob(jobId, `Refund by support: ${reason.trim()}`, tx, admin.id);
    if (!refunded) return fail("already", job.chargedCredits ? "This job was already refunded." : "This job didn't cost anything.");
    await audit(tx, admin, "job.refund", `job:${jobId}`, null, { credits: job.chargedCredits, userId: job.userId, reason: reason.trim() });
    await tx.jobEvent.create({ data: { jobId, message: "Credits refunded by support" } });
    return { ok: true as const, data: null };
  });
}

/**
 * Run the same montage again as a new job, free of charge for the user (support gesture).
 * Uses the catalog's current template, so a fixed pipeline is picked up; the input stays the same.
 */
export async function retryJob(admin: Admin, jobId: string): Promise<ActionResult<{ jobId: string }>> {
  const result = await db.$transaction(async (tx) => {
    const old = await tx.job.findUnique({ where: { id: jobId } });
    if (!old) return fail("not_found", "That job doesn't exist.");
    if (["queued", "starting", "running"].includes(old.status)) return fail("running", "This job is still running. Wait for it to finish.");
    const item = await tx.catalogItem.findUnique({ where: { id: old.catalogItemId } });
    if (!item) return fail("not_found", "This job's style no longer exists.");
    const job = await tx.job.create({
      data: {
        userId: old.userId,
        catalogItemId: item.id,
        catalogSlug: item.slug,
        templateId: item.templateId,
        input: old.input as Prisma.InputJsonValue,
        source: old.source,
        sourceUrl: old.sourceUrl,
        uploadKey: old.uploadKey,
        durationSec: old.durationSec,
        chargedCredits: 0,
      },
      select: { id: true },
    });
    await tx.jobEvent.create({ data: { jobId: job.id, message: "Queued (retry by support, no charge)" } });
    await audit(tx, admin, "job.retry", `job:${jobId}`, { templateId: old.templateId }, { newJobId: job.id, templateId: item.templateId });
    return { ok: true as const, data: { jobId: job.id } };
  });
  if (result.ok) await enqueueStart(result.data.jobId).catch(() => {});
  return result;
}

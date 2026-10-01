// npm run admin:create <email> — creates an admin account (or resets an existing account's password and
// makes it admin). Prints a generated password once. Public sign-up is off until AUTH_MODE=full.
import { randomBytes } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { db } from "@/db/client";

const email = process.argv[2]?.trim().toLowerCase();
if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error("Usage: npm run admin:create you@example.com");
  process.exit(1);
}

const password = randomBytes(15).toString("base64url"); // 20 characters
const hash = await hashPassword(password);

const created = await db.$transaction(async (tx) => {
  const existing = await tx.user.findUnique({ where: { email } });
  if (existing?.isAnonymous) throw new Error("That email belongs to a guest account; use another email.");
  const userId = existing?.id ?? crypto.randomUUID();
  if (existing) {
    await tx.user.update({ where: { id: userId }, data: { role: "admin", emailVerified: true, suspendedAt: null } });
  } else {
    await tx.user.create({ data: { id: userId, name: email.split("@")[0], email, emailVerified: true, role: "admin" } });
  }
  const cred = await tx.account.findFirst({ where: { userId, providerId: "credential" }, select: { id: true } });
  if (cred) await tx.account.update({ where: { id: cred.id }, data: { password: hash } });
  else await tx.account.create({ data: { id: crypto.randomUUID(), accountId: userId, providerId: "credential", userId, password: hash } });
  return !existing;
});

console.log(`${created ? "Created" : "Updated"} admin ${email}`);
console.log(`Password (shown once, change it after milestone 10 adds password reset): ${password}`);
console.log("Sign in at /admin/sign-in");
process.exit(0);

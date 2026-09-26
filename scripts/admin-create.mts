// pnpm admin:create <email> — creates an admin account (or resets an existing account's password and
// makes it admin). Prints a generated password once. Public sign-up is off until AUTH_MODE=full.
import { randomBytes } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, users } from "@/db/schema";

const email = process.argv[2]?.trim().toLowerCase();
if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error("Usage: pnpm admin:create you@example.com");
  process.exit(1);
}

const password = randomBytes(15).toString("base64url"); // 20 characters
const hash = await hashPassword(password);

const created = await db.transaction(async (tx) => {
  const [existing] = await tx.select().from(users).where(eq(users.email, email));
  if (existing?.isAnonymous) throw new Error("That email belongs to a guest account; use another email.");
  const userId = existing?.id ?? crypto.randomUUID();
  if (existing) {
    await tx.update(users).set({ role: "admin", emailVerified: true, suspendedAt: null }).where(eq(users.id, userId));
  } else {
    await tx.insert(users).values({ id: userId, name: email.split("@")[0], email, emailVerified: true, role: "admin" });
  }
  const [cred] = await tx.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.userId, userId), eq(accounts.providerId, "credential")));
  if (cred) await tx.update(accounts).set({ password: hash }).where(eq(accounts.id, cred.id));
  else await tx.insert(accounts).values({ id: crypto.randomUUID(), accountId: userId, providerId: "credential", userId, password: hash });
  return !existing;
});

console.log(`${created ? "Created" : "Updated"} admin ${email}`);
console.log(`Password (shown once, change it after milestone 10 adds password reset): ${password}`);
console.log("Sign in at /admin/sign-in");
process.exit(0);

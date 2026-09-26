import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { anonymous } from "better-auth/plugins";
import { and, eq } from "drizzle-orm";
import { env } from "@/config/env";
import { db } from "@/db";
import * as schema from "@/db/schema";

// AUTH_MODE=anonymous for now. Google, email+password and email OTP arrive in milestone 10.
export const auth = betterAuth({
  appName: "MontageAI",
  baseURL: env.APP_URL,
  secret: env.BETTER_AUTH_SECRET ?? "dev-only-secret-change-me-dev-only-secret",
  database: drizzleAdapter(db, { provider: "pg", usePlural: true, schema }),
  user: {
    additionalFields: {
      role: { type: "string", input: false, defaultValue: "user" },
      suspendedAt: { type: "date", input: false, required: false },
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 365, // anonymous visitors keep their history for a year
    updateAge: 60 * 60 * 24,
    cookieCache: { enabled: true, maxAge: 5 * 60 },
  },
  advanced: { database: { generateId: () => crypto.randomUUID() } },
  // Admins sign in with email + password. Public sign-up arrives with AUTH_MODE=full (milestone 10);
  // until then admin accounts are created with `pnpm admin:create`.
  emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 8 },
  databaseHooks: {
    session: {
      create: {
        // Bootstrap: verified, non-anonymous accounts whose email is in ADMIN_EMAILS become admins.
        after: async (session) => {
          if (!env.ADMIN_EMAILS.length) return;
          const [user] = await db.select().from(schema.users).where(eq(schema.users.id, session.userId));
          if (user && !user.isAnonymous && user.emailVerified && user.role !== "admin" && env.ADMIN_EMAILS.includes(user.email.toLowerCase())) {
            await db.update(schema.users).set({ role: "admin" }).where(and(eq(schema.users.id, user.id), eq(schema.users.role, "user")));
          }
        },
      },
    },
  },
  plugins: [
    anonymous({
      emailDomainName: "anon.montage.local",
      // ponytail: linking is milestone 10; until then keep the anonymous row so ledger FKs never break.
      disableDeleteAnonymousUser: true,
    }),
    nextCookies(), // must stay last
  ],
});

export type SessionUser = typeof auth.$Infer.Session.user;

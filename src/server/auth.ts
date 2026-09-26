import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { anonymous, emailOTP } from "better-auth/plugins";
import { and, eq } from "drizzle-orm";
import { env } from "@/config/env";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { mergeGuest } from "./account";
import { sendOtpEmail } from "./email";

// AUTH_MODE=anonymous: every visitor is a guest (anonymous user); only admins have passwords.
// AUTH_MODE=full: email + password sign-up verified by an emailed code, and password reset codes.
// Every flow runs through server actions (src/app/(auth)/actions.ts), which add our rate limits;
// the HTTP endpoints stay closed except sign-out (api/auth/[...all]).
const full = env.AUTH_MODE === "full";

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
  // In anonymous mode admin accounts come from `pnpm admin:create` (already verified).
  emailAndPassword: { enabled: true, disableSignUp: !full, requireEmailVerification: true, minPasswordLength: 8, revokeSessionsOnPasswordReset: true },
  emailVerification: { autoSignInAfterVerification: true },
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
    emailOTP({
      otpLength: 6,
      expiresIn: 10 * 60,
      allowedAttempts: 5, // then the code is deleted and a new one is needed
      storeOTP: "hashed",
      disableSignUp: true, // codes verify accounts and reset passwords; they never create accounts
      overrideDefaultEmailVerification: true,
      // Not awaited, so response time doesn't reveal whether an account exists.
      sendVerificationOTP: async ({ email, otp, type }) => {
        void sendOtpEmail(email, otp, type).catch((e) => console.error("[email] send failed:", e instanceof Error ? e.message : e));
      },
    }),
    anonymous({
      emailDomainName: "anon.montage.local",
      // A guest who signs up or signs in keeps their videos and credits.
      onLinkAccount: async ({ anonymousUser, newUser }) => {
        if (!newUser.user.isAnonymous) await mergeGuest(anonymousUser.user.id, newUser.user.id);
      },
      // The guest row stays: its ledger rows reference it (the ledger is append-only).
      disableDeleteAnonymousUser: true,
    }),
    nextCookies(), // must stay last
  ],
});

export type SessionUser = typeof auth.$Infer.Session.user;

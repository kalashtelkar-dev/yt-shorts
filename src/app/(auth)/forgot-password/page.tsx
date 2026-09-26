import type { Metadata } from "next";
import { AuthHeading, TextLink } from "@/components/auth-bits";
import { ForgotForm, ResendCode, ResetForm } from "@/components/auth-forms";
import { pendingEmail } from "@/server/otp";

export const metadata: Metadata = { title: "Reset your password" };

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ step?: string }> }) {
  const email = (await searchParams).step === "code" ? await pendingEmail() : null;
  if (email) {
    return (
      <>
        <AuthHeading title="Choose a new password">
          If <span className="break-all text-foreground">{email}</span> has an account, we sent it a 6-digit code. It works for 10 minutes.
        </AuthHeading>
        <ResetForm />
        <ResendCode purpose="forget-password" />
        <p className="text-sm text-muted-foreground">
          Wrong email? <TextLink href="/forgot-password">Start again</TextLink>
        </p>
      </>
    );
  }
  return (
    <>
      <AuthHeading title="Reset your password">Enter your account email and we&apos;ll send you a code.</AuthHeading>
      <ForgotForm />
      <p className="text-sm text-muted-foreground">
        Remembered it? <TextLink href="/sign-in">Sign in</TextLink>
      </p>
    </>
  );
}

import type { Metadata } from "next";
import { AuthHeading, TextLink } from "@/components/auth-bits";
import { ResendCode, VerifyForm } from "@/components/auth-forms";
import { pendingEmail } from "@/server/otp";

export const metadata: Metadata = { title: "Check your email" };

export default async function VerifyPage() {
  const email = await pendingEmail();
  if (!email) {
    return (
      <>
        <AuthHeading title="This page has expired">Codes are tied to the browser you signed up in, for 30 minutes.</AuthHeading>
        <p className="text-sm text-muted-foreground">
          <TextLink href="/sign-in">Sign in</TextLink> to get a new code, or <TextLink href="/sign-up">create an account</TextLink>.
        </p>
      </>
    );
  }
  return (
    <>
      <AuthHeading title="Check your email">
        If <span className="break-all text-foreground">{email}</span> is new to us, we sent it a 6-digit code. It works for 10 minutes.
      </AuthHeading>
      <VerifyForm />
      <ResendCode purpose="email-verification" />
      <p className="text-sm text-muted-foreground">
        Already have an account with this email? <TextLink href="/sign-in">Sign in</TextLink>
      </p>
    </>
  );
}

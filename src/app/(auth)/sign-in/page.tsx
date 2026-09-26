import type { Metadata } from "next";
import { AuthHeading, TextLink } from "@/components/auth-bits";
import { SignInForm } from "@/components/auth-forms";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ reset?: string }> }) {
  const reset = !!(await searchParams).reset;
  return (
    <>
      <AuthHeading title="Sign in" />
      {reset && (
        <p role="status" className="rounded-lg border bg-panel p-3 text-sm">
          Password saved. Sign in with your new password.
        </p>
      )}
      <SignInForm />
      <div className="flex flex-col gap-2 text-sm text-muted-foreground">
        <p>
          <TextLink href="/forgot-password">Forgot your password?</TextLink>
        </p>
        <p>
          New here? <TextLink href="/sign-up">Create an account</TextLink>
        </p>
      </div>
    </>
  );
}

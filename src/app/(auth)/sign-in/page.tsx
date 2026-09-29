import type { Metadata } from "next";
import { AuthHeading, AuthTabs, TextLink } from "@/components/auth-bits";
import { SignInForm } from "@/components/auth-forms";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ reset?: string }> }) {
  const reset = !!(await searchParams).reset;
  return (
    <>
      <AuthTabs active="sign-in" />
      <AuthHeading title="Welcome back" />
      {reset && (
        <p role="status" className="rounded-lg border bg-panel p-3 text-sm">
          Password saved. Sign in with your new password.
        </p>
      )}
      <SignInForm />
      <p className="-mt-2 text-center text-sm">
        <TextLink href="/forgot-password">Forgot your password?</TextLink>
      </p>
    </>
  );
}

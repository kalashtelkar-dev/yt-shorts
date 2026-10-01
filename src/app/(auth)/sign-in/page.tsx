import type { Metadata } from "next";
import { AuthHeading, AuthTabs, ConsentNote, TextLink } from "@/components/auth-bits";
import { GoogleSignIn, SignInForm } from "@/components/auth-forms";
import { googleEnabled } from "@/server/auth";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ reset?: string; google?: string }> }) {
  const { reset, google } = await searchParams;
  return (
    <>
      <AuthTabs active="sign-in" />
      <AuthHeading title="Welcome back" />
      {reset && (
        <p role="status" className="rounded-lg border bg-panel p-3 text-sm">
          Password saved. Sign in with your new password.
        </p>
      )}
      {google && (
        <p role="alert" className="rounded-lg border bg-panel p-3 text-sm text-danger">
          {google === "busy" ? "Too many attempts. Wait 15 minutes, then try again." : "Google sign-in didn't finish. Try again, or use your email and password."}
        </p>
      )}
      {googleEnabled && <GoogleSignIn />}
      <SignInForm />
      <p className="-mt-2 text-center text-sm">
        <TextLink href="/forgot-password">Forgot your password?</TextLink>
      </p>
      {/* Google can create an account from here too. */}
      {googleEnabled && <ConsentNote />}
    </>
  );
}

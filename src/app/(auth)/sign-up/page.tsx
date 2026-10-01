import type { Metadata } from "next";
import { AuthHeading, AuthTabs, ConsentNote } from "@/components/auth-bits";
import { GoogleSignIn, SignUpForm } from "@/components/auth-forms";
import { googleEnabled } from "@/server/auth";
import { getSettings } from "@/server/settings";

export const metadata: Metadata = { title: "Create your account" };

export default async function SignUpPage() {
  const { starterCredits } = await getSettings();
  return (
    <>
      <AuthTabs active="sign-up" />
      <AuthHeading title="Create your account">
        Your videos stay in your account, on any device. New accounts start with {starterCredits.toLocaleString("en-IN")} free credits.
      </AuthHeading>
      {googleEnabled && <GoogleSignIn />}
      <SignUpForm />
      <ConsentNote />
    </>
  );
}

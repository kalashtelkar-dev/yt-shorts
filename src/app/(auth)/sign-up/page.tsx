import type { Metadata } from "next";
import { AuthHeading, TextLink } from "@/components/auth-bits";
import { SignUpForm } from "@/components/auth-forms";
import { getSettings } from "@/server/settings";

export const metadata: Metadata = { title: "Create your account" };

export default async function SignUpPage() {
  const { starterCredits } = await getSettings();
  return (
    <>
      <AuthHeading title="Create your account">
        Your videos stay in your account, on any device. New accounts start with {starterCredits.toLocaleString("en-IN")} free credits.
      </AuthHeading>
      <SignUpForm />
      <p className="text-sm text-muted-foreground">
        Already have an account? <TextLink href="/sign-in">Sign in</TextLink>
      </p>
    </>
  );
}

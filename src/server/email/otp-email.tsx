import "server-only";
import { Body, Container, Head, Heading, Html, Preview, Section, Text } from "@react-email/components";
import { brand } from "@/config/brand";

export type OtpPurpose = "email-verification" | "forget-password" | "sign-in" | "change-email";

const COPY: Record<OtpPurpose, { subject: string; lead: string }> = {
  "email-verification": { subject: `Your ${brand.name} sign-up code`, lead: "Enter this code to finish creating your account." },
  "forget-password": { subject: `Your ${brand.name} password reset code`, lead: "Enter this code to choose a new password." },
  "sign-in": { subject: `Your ${brand.name} sign-in code`, lead: "Enter this code to sign in." },
  "change-email": { subject: `Confirm your new ${brand.name} email`, lead: "Enter this code to confirm your new email address." },
};

export const otpSubject = (purpose: OtpPurpose) => COPY[purpose].subject;

// Email clients ignore CSS variables, so this file is the one place with inline colours (the app's tokens).
export function OtpEmail({ otp, purpose }: { otp: string; purpose: OtpPurpose }) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{`${otp} is your code. It expires in 10 minutes.`}</Preview>
      <Body style={{ backgroundColor: "#0a0a0a", color: "#ffffff", fontFamily: "Inter, Arial, sans-serif", margin: 0, padding: "32px 16px" }}>
        <Container style={{ maxWidth: 440, backgroundColor: "#111111", border: "1px solid #1f1f1f", borderRadius: 12, padding: 32 }}>
          <Text style={{ margin: 0, fontSize: 14, color: "#8a8a8a" }}>{brand.name}</Text>
          <Heading as="h1" style={{ margin: "12px 0 8px", fontSize: 22, fontWeight: 600 }}>
            {COPY[purpose].lead}
          </Heading>
          <Section style={{ margin: "24px 0", padding: "16px 0", border: "1px solid #1f1f1f", borderRadius: 8, textAlign: "center" }}>
            <Text style={{ margin: 0, fontFamily: "ui-monospace, Menlo, monospace", fontSize: 32, letterSpacing: 8, fontWeight: 600 }}>{otp}</Text>
          </Section>
          <Text style={{ margin: 0, fontSize: 14, color: "#8a8a8a" }}>The code expires in 10 minutes and works once. If you didn&apos;t ask for it, you can ignore this email.</Text>
        </Container>
      </Body>
    </Html>
  );
}

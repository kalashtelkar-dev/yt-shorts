import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, publicSeller, Section, SellerBlock } from "@/components/legal";
import { brand } from "@/config/brand";
import { getSettings } from "@/server/settings";

export const metadata: Metadata = {
  title: "Contact us",
  description: `How to reach the team behind ${brand.name} for help, payments, privacy requests and complaints.`,
  alternates: { canonical: "/contact" },
};

export default async function ContactPage() {
  const s = await getSettings();
  const email = s.seller.email ? <a href={`mailto:${s.seller.email}`}>{s.seller.email}</a> : "the email below";
  return (
    <LegalPage title="Contact us" intro={`${brand.name} is run by ${s.seller.legalName ?? "Deepsoch AI"}. Write to us about anything: a montage, a payment, your data, or a complaint.`}>
      <SellerBlock seller={publicSeller(s.seller)} />

      <Section title="Help with a montage or payment">
        <p>
          Email {email} from the address on your account. For a payment, include the payment reference from your invoice or bank statement. We reply within 2 working days, Monday to Friday. Refunds follow our <Link href="/refunds">refund policy</Link>.
        </p>
      </Section>

      <Section title="Grievance officer">
        <p>
          Complaints about the service, content or your personal data go to our grievance officer at {email}. We acknowledge them within 48 hours and aim to resolve them within 15 days. For your rights over your personal data, see our <Link href="/privacy">privacy policy</Link>.
        </p>
      </Section>
    </LegalPage>
  );
}

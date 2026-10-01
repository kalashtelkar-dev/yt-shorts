import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, publicSeller, Section, SellerBlock } from "@/components/legal";
import { brand } from "@/config/brand";
import { getSettings } from "@/server/settings";

export const metadata: Metadata = {
  title: "Privacy policy",
  description: `What personal data ${brand.name} collects, why, who it's shared with, how long it's kept, and your rights under India's Digital Personal Data Protection Act, 2023.`,
  alternates: { canonical: "/privacy" },
};

// The notice the Digital Personal Data Protection Act, 2023 asks for: what we collect and why, how to withdraw
// consent and use your rights, and how to complain to the Data Protection Board of India.
export default async function PrivacyPage() {
  const s = await getSettings();
  const owner = s.seller.legalName ?? "Deepsoch AI";
  const email = s.seller.email ? <a href={`mailto:${s.seller.email}`}>{s.seller.email}</a> : "the email on our contact page";
  return (
    <LegalPage
      title="Privacy policy"
      intro={`${owner} runs ${brand.name} and decides how your personal data is used: under India's Digital Personal Data Protection Act, 2023 ("DPDP Act"), we are the Data Fiduciary and you are the Data Principal. This page explains, in plain words, what we collect, why, and the choices you have.`}
    >
      <Section title="What we collect">
        <ul>
          <li>
            <strong>Account details:</strong> your email address and a password (stored only as a one-way hash). If you sign in with Google, the name, email and profile picture Google shares with us.
          </li>
          <li>
            <strong>What you give us to edit:</strong> gameplay recordings or YouTube links, your in-game name, songs or song links, and the montages and cover images we make from them.
          </li>
          <li>
            <strong>Payments and invoices:</strong> the amount, date, order and payment references and the payment method type (for example &ldquo;UPI&rdquo;). If you add them, your state, business name and GSTIN for your tax invoice. Card, UPI and bank details go to Cashfree Payments directly; we never see or store them.
          </li>
          <li>
            <strong>Technical data:</strong> your IP address and browser or device type, recorded with your sign-in session and used for security and fair-use limits.
          </li>
          <li>
            <strong>Messages:</strong> the codes and receipts we email you, and anything you write to us.
          </li>
        </ul>
      </Section>

      <Section title="Why we use it">
        <ul>
          <li>To make your montages and keep them in your library.</li>
          <li>To run your account: sign-in, verification codes and password resets.</li>
          <li>To take payments, add credits and issue GST tax invoices.</li>
          <li>To keep the service safe and fair: stopping abuse, repeat free-credit sign-ups and attacks.</li>
          <li>To answer your questions and complaints, and to tell you about changes that affect you.</li>
        </ul>
        <p>
          We use your data only for these purposes. We don&apos;t sell it, we don&apos;t show ads, and we don&apos;t use it to build advertising profiles.
        </p>
      </Section>

      <Section title="Your consent">
        <p>
          We process your personal data with your consent, which you give when you create an account, make a montage or buy credits after seeing this notice. Some processing doesn&apos;t need consent under section 7 of the DPDP Act, such as keeping invoices and payment records that tax law requires.
        </p>
        <p>
          You can withdraw your consent at any time by writing to {email}, as easily as you gave it. We will then stop processing and delete your data, except what the law requires us to keep. Withdrawing consent doesn&apos;t affect processing done before it, and without it we can no longer provide the service to you.
        </p>
      </Section>

      <Section title="Who we share it with">
        <p>Only with service providers that process data for us, under contract and only on our instructions:</p>
        <ul>
          <li>our video-processing provider, which downloads and edits your videos and songs;</li>
          <li>Cashfree Payments, for payments;</li>
          <li>Google, only if you choose &ldquo;Continue with Google&rdquo;;</li>
          <li>our email provider, to send codes and receipts;</li>
          <li>our hosting and database providers.</li>
        </ul>
        <p>
          We also share data when the law requires it, for example with tax authorities or in response to a lawful order. Some providers may process data outside India, as the DPDP Act permits.
        </p>
      </Section>

      <Section title="How long we keep it">
        <ul>
          <li>Videos and songs you give us are kept by our processing provider only while your montage is being made, and cleared within hours after.</li>
          <li>Your montages, covers and account details are kept while your account is open, and deleted within 30 days of you asking us to delete them or your account.</li>
          <li>Sign-in sessions last up to a year unless you sign out. Fair-use records tied to your IP address expire within 24 hours.</li>
          <li>Invoices, payments and the credit history behind them are kept for 8 years, as Indian tax law requires, even after your account is deleted.</li>
        </ul>
      </Section>

      <Section title="Cookies" id="cookies">
        <p>
          We use only the cookies the service needs to work: keeping you signed in and securing sign-in. We don&apos;t use analytics or advertising cookies. One more cookie remembers that you&apos;ve seen our cookie notice, for a year. When you pay, Cashfree&apos;s checkout may set its own cookies.
        </p>
      </Section>

      <Section title="Your rights">
        <p>Under the DPDP Act you can:</p>
        <ul>
          <li>ask for a summary of the personal data we hold about you and how we use it, and who we&apos;ve shared it with;</li>
          <li>ask us to correct, complete or update it;</li>
          <li>ask us to erase it, unless the law requires us to keep it;</li>
          <li>withdraw your consent;</li>
          <li>have a grievance about how we handle your data resolved;</li>
          <li>nominate someone to use these rights for you if you die or become unable to.</li>
        </ul>
        <p>
          Write to {email} from your account&apos;s email address (so we know it&apos;s you). We reply within 30 days. If you&apos;re not satisfied with how we resolve a grievance, you can complain to the Data Protection Board of India.
        </p>
      </Section>

      <Section title="Children">
        <p>
          {brand.name} is meant for adults. A person under 18 may use it only with the verifiable consent of a parent or legal guardian, who can contact us to give it or to have the child&apos;s data erased. We don&apos;t track, monitor the behaviour of, or target advertising at children. If we learn that we hold a child&apos;s data without that consent, we delete it.
        </p>
      </Section>

      <Section title="Security">
        <p>
          Connections are encrypted, passwords and email codes are stored only as hashes, and access to personal data is limited to people who need it. If a personal data breach happens, we&apos;ll inform you and the Data Protection Board of India as the DPDP Act requires.
        </p>
      </Section>

      <Section title="Changes">
        <p>We&apos;ll update this page when how we handle data changes, and tell you by email or on the site if a change matters.</p>
      </Section>

      <Section title="Grievance officer and contact">
        <p>
          For anything about your personal data, write to our grievance officer at {email}. Our full details are on the <Link href="/contact">contact page</Link>:
        </p>
        <SellerBlock seller={publicSeller(s.seller)} />
      </Section>
    </LegalPage>
  );
}

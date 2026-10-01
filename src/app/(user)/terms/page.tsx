import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, publicSeller, Section, SellerBlock } from "@/components/legal";
import { brand } from "@/config/brand";
import { getSettings } from "@/server/settings";

export const metadata: Metadata = {
  title: "Terms and conditions",
  description: `The terms for using ${brand.name}: your videos and songs, credits and payments, and what we're responsible for.`,
  alternates: { canonical: "/terms" },
};

export default async function TermsPage() {
  const s = await getSettings();
  const owner = s.seller.legalName ?? "Deepsoch AI";
  const rupeesPerCredit = (s.sellPaisePerCredit / 100).toFixed(2);
  return (
    <LegalPage
      title="Terms and conditions"
      intro={`These terms are an agreement between you and ${owner} ("we", "us"), which runs ${brand.name}. By using ${brand.name}, making a montage or buying credits, you agree to them. If you don't agree, please don't use the service.`}
    >
      <Section title="1. Who we are">
        <p>
          {brand.name} turns gameplay videos into short vertical montages. It is run by {owner}:
        </p>
        <SellerBlock seller={publicSeller(s.seller)} />
      </Section>

      <Section title="2. Using MontageAI">
        <ul>
          <li>You must be 18 or older. If you are under 18, a parent or legal guardian must agree to these terms and to our <Link href="/privacy">privacy policy</Link> for you, and supervise your use.</li>
          <li>You need an account to make montages and buy credits. Your videos and credits stay in your account, on any device.</li>
          <li>Keep your password and the codes we email you private. You are responsible for what happens in your account.</li>
          <li>Give us a real email address that you can read; we use it for sign-in codes, receipts and important notices.</li>
        </ul>
      </Section>

      <Section title="3. Your videos and songs">
        <ul>
          <li>Only use gameplay recordings, YouTube links and songs that you own or have permission to use.</li>
          <li>You keep all rights in what you give us. You allow us to store, copy and process it only to make your montage, show it to you and keep your library, for as long as described in our <Link href="/privacy">privacy policy</Link>.</li>
          <li>The montage we make is yours to download and post, subject to the rights of others in what it contains. Songs are usually protected by copyright: you are responsible for having the rights to post a montage with music on YouTube, Instagram, TikTok or anywhere else.</li>
          <li>If someone tells us that content you used infringes their rights, we may remove it and, if it keeps happening, close the account.</li>
        </ul>
      </Section>

      <Section title="4. What you must not do">
        <ul>
          <li>Upload or link anything illegal, sexually explicit, hateful, or that harms or harasses others.</li>
          <li>Use other people&apos;s videos or music without their permission.</li>
          <li>Get around our limits, run automated or bulk requests, create accounts to collect free credits again, or interfere with the service or other users.</li>
          <li>Copy, resell or reverse engineer the service.</li>
        </ul>
        <p>We may suspend or close accounts that break these rules, and remove credits that were gained by abusing them.</p>
      </Section>

      <Section title="5. Credits and payments">
        <ul>
          <li>
            Editing is paid for with credits. <strong>One credit is one second of editing time.</strong> Before you start, we show the range of credits a montage can cost.
          </li>
          <li>Nothing is charged when a montage starts. When it finishes, we charge the seconds it actually took, never more than the top of the range you were shown. A montage that fails, is cancelled or times out costs nothing.</li>
          <li>
            Credits cost ₹{rupeesPerCredit} each, including GST. Each purchase gets a GST tax invoice. Payments are processed by Cashfree Payments; we never see or store your card, UPI or bank details.
          </li>
          <li>New accounts may get free starter credits, once per person. Credits have no cash value, can&apos;t be transferred, and don&apos;t expire while your account is open.</li>
          <li>Prices can change; a change never affects credits you already have.</li>
          <li>Refunds follow our <Link href="/refunds">refund and cancellation policy</Link>.</li>
        </ul>
      </Section>

      <Section title="6. The service">
        <ul>
          <li>Montages are made automatically by software. It can miss a kill, pick the wrong moment, or fail on some videos. We work to make it better but don&apos;t promise any particular result.</li>
          <li>The service may sometimes be slow or unavailable, for example during maintenance. We may change, add or remove features.</li>
          <li>Keep your own copy of anything important: download your montages.</li>
        </ul>
      </Section>

      <Section title="7. Our responsibility">
        <p>
          {brand.name} is provided &ldquo;as is&rdquo;. To the extent the law allows, we are not liable for indirect or consequential losses (such as lost views, followers or income), and our total liability for any claim is limited to the amount you paid us in the three months before it. Nothing here limits rights you have under the Consumer Protection Act, 2019 or other law that can&apos;t be excluded.
        </p>
        <p>If your use of the service breaks these terms or the law and someone makes a claim against us because of it, you agree to cover our reasonable costs of that claim.</p>
      </Section>

      <Section title="8. Closing your account">
        <p>
          You can stop using {brand.name} at any time and ask us to delete your account by writing to us (see <Link href="/contact">contact</Link>). We may suspend or close an account that breaks these terms; where we reasonably can, we&apos;ll tell you why. Unused paid credits on an account closed for breaking these terms are not refunded.
        </p>
      </Section>

      <Section title="9. Changes to these terms">
        <p>We may update these terms. If a change matters, we&apos;ll tell you on the site or by email before it applies. Using the service after that means you accept the new terms.</p>
      </Section>

      <Section title="10. Law and disputes">
        <p>
          These terms are governed by the laws of India. Please contact us first, and we&apos;ll try to sort things out. If we can&apos;t, the courts in Bengaluru, Karnataka have jurisdiction.
        </p>
      </Section>

      <Section title="11. Contact and grievances">
        <p>
          Questions, complaints and grievances go to our grievance officer at {s.seller.email ? <a href={`mailto:${s.seller.email}`}>{s.seller.email}</a> : "the address on our contact page"}. We acknowledge them within 48 hours and aim to resolve them within 15 days. All our details are on the <Link href="/contact">contact page</Link>.
        </p>
      </Section>
    </LegalPage>
  );
}

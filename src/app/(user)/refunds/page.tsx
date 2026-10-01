import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, Section } from "@/components/legal";
import { brand } from "@/config/brand";
import { getSettings } from "@/server/settings";

export const metadata: Metadata = {
  title: "Refund and cancellation policy",
  description: `How ${brand.name} charges for montages, when credit purchases are refunded, and how credits and montages are delivered.`,
  alternates: { canonical: "/refunds" },
};

export default async function RefundsPage() {
  const s = await getSettings();
  const email = s.seller.email ? <a href={`mailto:${s.seller.email}`}>{s.seller.email}</a> : "the email on our contact page";
  return (
    <LegalPage title="Refund and cancellation policy" intro={`${brand.name} sells credits, a digital service delivered instantly. Here is when you pay, and when you get money back.`}>
      <Section title="Montages: you only pay for what works">
        <ul>
          <li>Nothing is charged when a montage starts.</li>
          <li>When it finishes, you&apos;re charged one credit per second of editing, never more than the top of the range shown before you started.</li>
          <li>A montage that fails, is cancelled or times out costs nothing, automatically. You don&apos;t need to ask.</li>
        </ul>
      </Section>

      <Section title="Credit purchases">
        <p>Credits are added to your account the moment your payment is confirmed, so purchases are final and unused credits can&apos;t be exchanged for money. We refund the full amount when:</p>
        <ul>
          <li>money left your account but no credits were added;</li>
          <li>you were charged twice for the same purchase;</li>
          <li>the law requires a refund.</li>
        </ul>
        <p>
          Write to {email} within 30 days of the payment with your registered email and the payment reference from your invoice or bank statement. Once we confirm the problem, we start the refund within 2 working days, back to the original payment method. Your bank usually shows it within 5–7 working days.
        </p>
      </Section>

      <Section title="Cancellation">
        <p>There are no subscriptions or recurring charges, so there&apos;s nothing to cancel. Each purchase is a one-time payment. A payment you abandon or that fails isn&apos;t charged; if your bank still debits it, it&apos;s usually reversed automatically within 5–7 working days, and if not, write to us.</p>
      </Section>

      <Section title="Delivery">
        <p>
          Everything is delivered online; nothing is shipped. Credits appear in your account straight after payment, with a GST tax invoice under <Link href="/account/billing">Billing</Link>. Montages appear in <Link href="/library">My videos</Link> when they&apos;re ready, usually within minutes, to watch and download.
        </p>
      </Section>

      <Section title="Questions">
        <p>
          Write to {email} or see the <Link href="/contact">contact page</Link>. We reply within 2 working days.
        </p>
      </Section>
    </LegalPage>
  );
}

import Link from "next/link";
import { brand } from "@/config/brand";
import type { Seller } from "@/db/types";

// The legal pages (terms, privacy, refunds, contact) and the footer that links them. Business details come from
// settings.seller (admin Billing), so they match the tax invoices.

export const LEGAL_UPDATED = "1 October 2026";

export function LegalPage({ title, intro, children }: { title: string; intro?: React.ReactNode; children: React.ReactNode }) {
  return (
    <article data-backdrop="dim" className="mx-auto flex w-full max-w-2xl flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight text-balance">{title}</h1>
        <p className="text-sm text-muted-foreground">Last updated {LEGAL_UPDATED}</p>
        {intro && <p className="leading-relaxed text-muted-foreground">{intro}</p>}
      </header>
      {children}
    </article>
  );
}

export function Section({ title, id, children }: { title: string; id?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="flex flex-col gap-3 text-[15px] leading-relaxed [&_a]:underline [&_a]:underline-offset-4 [&_li]:pl-1 [&_strong]:font-medium [&_ul]:flex [&_ul]:list-disc [&_ul]:flex-col [&_ul]:gap-2 [&_ul]:pl-5">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

/** The business details the legal pages show. Only these reach the page: no phone or PAN. */
export const publicSeller = ({ legalName, address, email, gstin }: Seller) => ({ legalName, address, email, gstin });
type PublicSeller = ReturnType<typeof publicSeller>;

/** Who we are and how to reach us, as one block. */
export function SellerBlock({ seller }: { seller: PublicSeller }) {
  return (
    <dl className="grid gap-4 rounded-2xl border bg-panel p-5 text-sm sm:grid-cols-[9rem_1fr] sm:gap-x-6 sm:gap-y-3">
      {[
        ["Business", seller.legalName],
        ["Address", seller.address],
        ["Email", seller.email && <a href={`mailto:${seller.email}`}>{seller.email}</a>],
        ["GSTIN", seller.gstin && <span className="font-mono">{seller.gstin}</span>],
      ]
        .filter(([, v]) => v)
        .map(([k, v]) => (
          <div key={String(k)} className="flex flex-col gap-0.5 sm:contents">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="break-words [&_a]:underline [&_a]:underline-offset-4">{v}</dd>
          </div>
        ))}
    </dl>
  );
}

const footerLink = "rounded hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none";

/** The landing page: what MontageAI is, where to go next, who runs it. */
export function SiteFooter({ seller, payments }: { seller: PublicSeller; payments: boolean }) {
  const owner = seller.legalName ?? "Deepsoch AI";
  const columns = [
    {
      title: "Product",
      links: [
        { href: "/create", label: "Make a montage" },
        { href: "/library", label: "My videos" },
        ...(payments ? [{ href: "/account", label: "Add credits" }] : []),
      ],
    },
    {
      title: "Help",
      links: [
        { href: "/contact", label: "Contact us" },
        { href: "/refunds", label: "Refunds" },
      ],
    },
    {
      title: "Legal",
      links: [
        { href: "/terms", label: "Terms" },
        { href: "/privacy", label: "Privacy" },
        { href: "/privacy#cookies", label: "Cookies" },
      ],
    },
  ];
  return (
    <footer className="flex flex-col gap-8 border-t py-8 text-sm text-muted-foreground print:hidden">
      <div className="grid gap-8 sm:grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))]">
        <div className="flex flex-col gap-2">
          <span className="font-semibold text-foreground">{brand.name}</span>
          <p className="max-w-xs leading-relaxed">{brand.tagline}, ready for Shorts, Reels and TikTok.</p>
          {seller.email && (
            <a href={`mailto:${seller.email}`} className={`${footerLink} self-start underline underline-offset-4`}>
              {seller.email}
            </a>
          )}
          {payments && <span className="text-xs">Payments by Cashfree</span>}
        </div>
        <div className="grid grid-cols-3 gap-4 sm:contents">
          {columns.map((c) => (
            <nav key={c.title} aria-label={c.title} className="flex flex-col gap-2.5">
              <span className="text-foreground">{c.title}</span>
              {c.links.map((l) => (
                <Link key={l.href} href={l.href} className={`${footerLink} self-start`}>
                  {l.label}
                </Link>
              ))}
            </nav>
          ))}
        </div>
      </div>
      <p className="flex flex-col gap-1 border-t pt-6 text-xs sm:flex-row sm:flex-wrap sm:gap-x-4">
        <span>
          © {new Date().getFullYear()} {owner}. All rights reserved.
        </span>
        <span>Bengaluru, India</span>
        {seller.gstin && <span className="font-mono">GSTIN {seller.gstin}</span>}
      </p>
    </footer>
  );
}

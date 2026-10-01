import "server-only";
import Image from "next/image";
import Link from "next/link";
import { CreditCalculator } from "@/components/credit-calculator";
import { HowItWorks } from "@/components/how-it-works";
import { buttonVariants } from "@/components/ui/button";
import { brand } from "@/config/brand";
import { env } from "@/config/env";
import { db } from "@/db/client";
import { formatCredits } from "@/lib/format";
import { cn } from "@/lib/utils";
import { getSettings } from "@/server/settings";
import keyArt from "../../public/create-preview.jpg";

/**
 * The landing page (design C, "key art poster"): the art with the headline, the styles, and what a top-up buys.
 * Styles, ranges and prices come from the catalog and settings, so the page never disagrees with the app.
 */
export async function Landing() {
  const [items, s] = await Promise.all([
    db.catalogItem.findMany({
      select: { title: true, description: true, durations: true, creditRanges: true },
      where: { enabled: true },
      orderBy: { sortOrder: "asc" },
    }),
    getSettings(),
  ]);
  // Each style at its shortest length, for "what ₹X gets you".
  const styles = items.flatMap((i) => {
    const d = [...i.durations].sort((a, b) => a - b).find((x) => i.creditRanges[String(x)]);
    const r = d ? i.creditRanges[String(d)] : null;
    return r ? [{ title: i.title, min: r.min, max: r.max }] : [];
  });
  const free = s.starterCredits > 0 ? `${formatCredits(s.starterCredits)} free credits when you sign up` : null;

  // Structured data for search results: what the app is and that it starts free.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: brand.name,
    url: env.APP_URL,
    description: brand.seoDescription,
    applicationCategory: "MultimediaApplication",
    operatingSystem: "Any (web browser)",
    offers: { "@type": "Offer", price: "0", priceCurrency: "INR", description: free ?? "Pay per second of editing" },
    publisher: { "@type": "Organization", name: s.seller.legalName ?? "Deepsoch AI" },
  };

  return (
    <div data-backdrop="bright" className="flex flex-col gap-10 sm:gap-12">
      {/* Our own static object; "<" is escaped so no string can close the script tag. */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <section className="relative overflow-hidden rounded-3xl border bg-background">
        <div className="relative aspect-[4/5] sm:aspect-[16/10] lg:absolute lg:inset-y-0 lg:right-0 lg:aspect-auto lg:w-[62%]">
          <Image src={keyArt} alt="" fill priority placeholder="blur" sizes="(min-width: 1024px) 640px, 100vw" className="object-cover object-[center_22%]" />
          {/* Scrims so the headline reads over the art: from below on phones, from the left on desktop. */}
          <div
            aria-hidden
            className="absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-background via-background/70 to-transparent lg:inset-y-0 lg:right-auto lg:left-0 lg:h-full lg:w-2/3 lg:bg-gradient-to-r lg:via-background/40"
          />
          <h1 className="absolute inset-x-5 bottom-5 font-display text-[2.5rem] leading-none sm:text-6xl lg:hidden">
            Turn gameplay
            <br />
            into montages.
          </h1>
        </div>
        <div className="relative flex flex-col gap-5 px-5 pt-3 pb-6 sm:px-8 sm:pb-8 lg:min-h-[34rem] lg:max-w-[33rem] lg:justify-center lg:p-14">
          <h1 className="font-display text-[3.6rem] leading-none max-lg:hidden">
            Turn gameplay
            <br />
            into montages.
          </h1>
          <p className="max-w-md text-lg lg:max-w-sm leading-relaxed text-muted-foreground">
            Paste your match and pick a song. {brand.name} finds your kills and makes a short vertical video you can post tonight.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4 lg:flex-col lg:items-start lg:gap-3">
            <Link href="/create" className={cn(buttonVariants({ size: "lg" }), "h-13 px-7 text-base")}>
              Make my montage
            </Link>
            {free && <span className="text-sm text-muted-foreground max-sm:text-center sm:whitespace-nowrap">{free}</span>}
          </div>
        </div>
      </section>

      <section aria-labelledby="how-heading" className="reveal flex flex-col gap-4">
        <h2 id="how-heading" className="font-display text-2xl">
          How it works
        </h2>
        <HowItWorks />
      </section>

      <section aria-labelledby="styles-heading" className="reveal flex flex-col gap-4">
        <h2 id="styles-heading" className="font-display text-2xl">
          Pick a style
        </h2>
        <ul className="grid gap-x-6 sm:auto-cols-fr sm:grid-flow-col">
          {items.map((i, n) => (
            <li key={i.title} className={cn("flex flex-col gap-1.5 border-t py-4", "sm:border-t-2", n === 0 && "sm:border-t-danger")}>
              <span className="font-semibold">{i.title}</span>
              <span className="text-sm leading-relaxed text-muted-foreground">{i.description}</span>
            </li>
          ))}
        </ul>
      </section>

      {styles.length > 0 && (
        <section aria-label="Pricing" className="reveal">
          <CreditCalculator
            minRupees={Math.ceil(s.minPurchasePaise / 100)}
            maxRupees={Math.max(Math.ceil(s.minPurchasePaise / 100), 2000)}
            paisePerCredit={s.sellPaisePerCredit}
            styles={styles}
          />
        </section>
      )}

    </div>
  );
}

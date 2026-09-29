import { asc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { signOutAction, signOutEverywhereAction } from "@/app/(auth)/actions";
import { ChangePasswordForm } from "@/components/auth-forms";
import { BillingDetailsForm, BuyCredits } from "@/components/buy-credits";
import { Button, buttonVariants } from "@/components/ui/button";
import { env } from "@/config/env";
import { db } from "@/db";
import { catalogItems } from "@/db/schema";
import { purchaseAmounts, stateName } from "@/lib/billing";
import { formatCredits } from "@/lib/format";
import { cn } from "@/lib/utils";
import { availableCredits } from "@/server/credits";
import { getBillingProfile } from "@/server/payments";
import { getViewer, viewerBalance } from "@/server/session";
import { getSettings } from "@/server/settings";

export const metadata: Metadata = { title: "Your account" };

// Accounts exist only with AUTH_MODE=full (CLAUDE.md §6). (Streamed under (user)/loading.tsx, so the
// 404 / redirect arrive with status 200 and take effect in the browser, like every user page.)
export default async function AccountPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  if (env.AUTH_MODE !== "full") notFound();
  const viewer = await getViewer();
  if (!viewer || viewer.isAnonymous) redirect("/sign-in");
  const tab = (await searchParams).tab === "profile" ? "profile" : "credits";
  const [balance, available, profile, s, items] = await Promise.all([
    viewerBalance(viewer),
    availableCredits(viewer.id),
    getBillingProfile(viewer.id),
    getSettings(),
    db
      .select({ title: catalogItems.title, durations: catalogItems.durations, creditRanges: catalogItems.creditRanges })
      .from(catalogItems)
      .where(eq(catalogItems.enabled, true))
      .orderBy(asc(catalogItems.sortOrder)),
  ]);
  const held = balance - available;
  // "That makes about": each style at its shortest length.
  const styles = items.flatMap((i) => {
    const d = [...i.durations].sort((a, b) => a - b).find((x) => i.creditRanges[String(x)]);
    const r = d ? i.creditRanges[String(d)] : null;
    return r && d ? [{ title: i.title, min: r.min, max: r.max, durationSec: d }] : [];
  });
  const profileView = profile && { stateCode: profile.stateCode, legalName: profile.legalName, gstin: profile.gstin };

  return (
    <div className="flex flex-col gap-6">
      <nav aria-label="Account" className="grid max-w-md grid-cols-2 gap-1 rounded-xl border bg-panel p-1">
        {(
          [
            ["credits", "Credits", "/account"],
            ["profile", "Profile", "/account?tab=profile"],
          ] as const
        ).map(([key, label, href]) => (
          <Link
            key={key}
            href={href}
            aria-current={tab === key ? "page" : undefined}
            className={cn(
              "flex h-11 items-center justify-center rounded-lg text-sm font-medium transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
              tab === key ? "bg-panel-raised text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </Link>
        ))}
      </nav>

      {tab === "credits" ? (
        <div className="grid gap-8 lg:grid-cols-[minmax(0,28rem)_minmax(0,1fr)] lg:items-start lg:gap-14">
          <section className="flex flex-col gap-4" aria-labelledby="buy-heading">
            <div className="flex items-baseline justify-between gap-4">
              <h1 id="buy-heading" className="text-2xl font-semibold tracking-tight sm:text-3xl">
                Add credits
              </h1>
              <span className="text-sm text-muted-foreground lg:hidden">
                You have <span className="font-mono text-foreground tabular">{formatCredits(balance)}</span>
              </span>
            </div>
            {env.PAYMENTS_ENABLED ? (
              <BuyCredits
                amounts={purchaseAmounts(s.minPurchasePaise, s.maxPurchasePaise)}
                paisePerCredit={s.sellPaisePerCredit}
                gstPercent={s.gstRateBps / 100}
                styles={styles}
                profile={profileView}
              />
            ) : (
              <p className="rounded-2xl border bg-panel p-5 text-muted-foreground">Buying credits opens soon. Until then, your free credits work as usual.</p>
            )}
          </section>

          <aside className="flex flex-col gap-4" aria-label="Your credits">
            <div className="flex flex-col gap-4 rounded-2xl border bg-panel p-5">
              <div className="flex items-end justify-between gap-4">
                <div className="flex flex-col gap-1">
                  <span className="text-sm text-muted-foreground">Your credits</span>
                  <span className="font-mono text-4xl leading-none tabular">{formatCredits(balance)}</span>
                </div>
                <span className="pb-1 text-right text-sm text-muted-foreground">About {Math.round(balance / 60)} min of editing</span>
              </div>
              {held > 0 && (
                <p className="text-sm text-muted-foreground">
                  <span className="font-mono text-foreground tabular">{formatCredits(held)}</span> are set aside for montages being made; what they don&apos;t use comes back.
                </p>
              )}
            </div>
            <ul className="flex flex-col gap-2 rounded-2xl border p-5 text-sm text-muted-foreground">
              <li>
                <span className="text-foreground">1 credit is 1 second of editing.</span> Longer, fancier edits take more.
              </li>
              <li>To start, you need the most a montage usually takes; it then uses only the time it needs.</li>
              <li>Credits come off after it&apos;s made. A montage that fails costs nothing.</li>
            </ul>
            <Link href="/account/billing" className={cn(buttonVariants({ variant: "outline", size: "lg" }), "justify-between")}>
              Billing and invoices <span aria-hidden>›</span>
            </Link>
          </aside>
        </div>
      ) : (
        <div className="grid gap-8 lg:grid-cols-2 lg:items-start lg:gap-14">
          <div className="flex flex-col gap-6">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Profile</h1>
            <dl className="flex flex-col divide-y rounded-xl border bg-panel">
              {[
                ["Email", <span key="e" className="break-all">{viewer.email}</span>],
                ["Member since", new Date(viewer.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" })],
                ["Invoice state", profile ? stateName(profile.stateCode) : "Not set yet"],
              ].map(([label, value]) => (
                <div key={String(label)} className="flex items-baseline justify-between gap-4 px-4 py-3">
                  <dt className="shrink-0 text-sm text-muted-foreground">{label}</dt>
                  <dd className="min-w-0 text-right text-sm">{value}</dd>
                </div>
              ))}
            </dl>
            <Link href="/account/billing" className={cn(buttonVariants({ variant: "outline", size: "lg" }), "justify-between")}>
              Billing and invoices <span aria-hidden>›</span>
            </Link>
            <BillingDetailsForm initial={profileView} submitLabel="Save details" />
          </div>

          <div className="flex flex-col gap-10">
            <section className="flex flex-col gap-4" aria-labelledby="password-heading">
              <h2 id="password-heading" className="text-lg font-semibold">
                Change password
              </h2>
              <ChangePasswordForm email={viewer.email} />
            </section>
            <section className="flex flex-col gap-4 border-t pt-8" aria-labelledby="signout-heading">
              <h2 id="signout-heading" className="text-lg font-semibold">
                Sign out
              </h2>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
                <form action={signOutAction}>
                  <Button type="submit" variant="outline" size="lg" className="w-full sm:w-auto">
                    Sign out
                  </Button>
                </form>
                <form action={signOutEverywhereAction}>
                  <button type="submit" className="rounded text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
                    Sign out on every device
                  </button>
                </form>
              </div>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}

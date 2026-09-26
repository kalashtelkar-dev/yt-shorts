import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { signOutAction, signOutEverywhereAction } from "@/app/(auth)/actions";
import { ChangePasswordForm } from "@/components/auth-forms";
import { Button } from "@/components/ui/button";
import { env } from "@/config/env";
import { formatCredits } from "@/lib/format";
import { getViewer, viewerBalance } from "@/server/session";

export const metadata: Metadata = { title: "Your account" };

// Accounts exist only with AUTH_MODE=full (CLAUDE.md §6). (Streamed under (user)/loading.tsx, so the
// 404 / redirect arrive with status 200 and take effect in the browser, like every user page.)
export default async function AccountPage() {
  if (env.AUTH_MODE !== "full") notFound();
  const viewer = await getViewer();
  if (!viewer || viewer.isAnonymous) redirect("/sign-in");
  const balance = await viewerBalance(viewer);

  return (
    <div className="flex max-w-lg flex-col gap-10">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Your account</h1>

      <dl className="flex flex-col divide-y rounded-xl border bg-panel">
        {[
          ["Email", <span key="e" className="break-all">{viewer.email}</span>],
          ["Credits", <span key="c" className="font-mono tabular">{formatCredits(balance)}</span>],
          ["Member since", new Date(viewer.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" })],
        ].map(([label, value]) => (
          <div key={String(label)} className="flex items-baseline justify-between gap-4 px-4 py-3">
            <dt className="shrink-0 text-sm text-muted-foreground">{label}</dt>
            <dd className="min-w-0 text-right text-sm">{value}</dd>
          </div>
        ))}
      </dl>

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
  );
}

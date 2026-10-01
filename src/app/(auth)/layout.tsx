import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { CookieNotice } from "@/components/cookie-notice";
import { COOKIE_CONSENT } from "@/lib/consent";
import { BackLink } from "@/components/back-link";
import { Wordmark } from "@/components/logo";
import { notFound, redirect } from "next/navigation";
import { env } from "@/config/env";
import { getViewer } from "@/server/session";

export const metadata: Metadata = { robots: { index: false } };
// Never prerendered: AUTH_MODE and the starter credits are read per request.
export const dynamic = "force-dynamic";

// Built now, reachable only with AUTH_MODE=full (CLAUDE.md §6).
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  if (env.AUTH_MODE !== "full") notFound();
  const viewer = await getViewer();
  if (viewer && !viewer.isAnonymous) redirect("/");

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-4 sm:px-6">
      <header className="flex h-14 items-center border-b">
        <Link href="/" className="-mx-1 flex items-center rounded px-1 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
          <Wordmark />
        </Link>
      </header>
      <main className="flex flex-1 justify-center py-10 sm:py-16">
        <div className="flex w-full max-w-sm flex-col gap-8">
          <BackLink href="/" className="-mb-5">
            Home
          </BackLink>
          {children}
        </div>
      </main>
      {!(await cookies()).has(COOKIE_CONSENT) && <CookieNotice />}
    </div>
  );
}

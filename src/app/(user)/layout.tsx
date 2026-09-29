import { CircleUser } from "lucide-react";
import Link from "next/link";
import { LogoMark } from "@/components/logo";
import { brand } from "@/config/brand";
import { env } from "@/config/env";
import { formatCredits } from "@/lib/format";
import { getViewer, viewerBalance } from "@/server/session";

const navLink = "rounded-md px-2 py-2 text-muted-foreground hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none";

export default async function UserLayout({ children }: { children: React.ReactNode }) {
  const viewer = await getViewer();
  const balance = await viewerBalance(viewer);
  // Sign-in entry points exist only with AUTH_MODE=full (CLAUDE.md §6).
  const account = env.AUTH_MODE === "full" ? (viewer && !viewer.isAnonymous ? "signed-in" : "signed-out") : null;
  // With accounts, only signed-in users have credits; guests see "Sign in" instead of a balance.
  const showBalance = account !== "signed-out";

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-4 sm:px-6">
      <header className="flex h-14 items-center justify-between gap-4 border-b print:hidden">
        <Link href="/" className="-mx-1 flex items-center gap-2 rounded px-1 font-semibold tracking-tight focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
          <LogoMark />
          {brand.name}
        </Link>
        <nav className="flex items-center gap-1 text-sm sm:gap-4">
          <Link href="/library" className={navLink}>
            My videos
          </Link>
          {showBalance &&
            (account === "signed-in" ? (
              <Link
                href="/account"
                className="rounded-md border bg-panel px-2.5 py-1 font-mono text-xs tabular hover:border-input focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                aria-label={`${balance} credits. Add credits`}
              >
                {formatCredits(balance)} <span className="text-muted-foreground max-sm:hidden">credits</span>
              </Link>
            ) : (
              <span className="rounded-md border bg-panel px-2.5 py-1 font-mono text-xs tabular" aria-label={`${balance} credits`}>
                {formatCredits(balance)} <span className="text-muted-foreground max-sm:hidden">credits</span>
              </span>
            ))}
          {account === "signed-out" && (
            <Link href="/sign-in" className={navLink}>
              Sign in
            </Link>
          )}
          {account === "signed-in" && (
            <Link href="/account" className={`${navLink} flex items-center gap-1.5`} aria-label="Your account">
              <CircleUser className="size-4" aria-hidden />
              <span className="max-sm:hidden">Account</span>
            </Link>
          )}
        </nav>
      </header>
      <main className="flex flex-1 flex-col py-5 sm:py-10">{children}</main>
    </div>
  );
}

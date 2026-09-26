import Link from "next/link";
import { brand } from "@/config/brand";
import { formatCredits } from "@/lib/format";
import { getBalance } from "@/server/credits";
import { getViewer } from "@/server/session";
import { getSettings } from "@/server/settings";

export default async function UserLayout({ children }: { children: React.ReactNode }) {
  const viewer = await getViewer();
  // First-time visitors see the starter credits they'll get when they make their first montage.
  const balance = viewer ? await getBalance(viewer.id) : (await getSettings()).starterCredits;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-4 sm:px-6">
      <header className="flex h-14 items-center justify-between gap-4 border-b">
        <Link href="/" className="-mx-1 rounded px-1 font-semibold tracking-tight focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
          {brand.name}
        </Link>
        <nav className="flex items-center gap-1 text-sm sm:gap-4">
          <Link href="/library" className="rounded-md px-2 py-2 text-muted-foreground hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
            My videos
          </Link>
          <span className="rounded-md border bg-panel px-2.5 py-1 font-mono text-xs tabular" aria-label={`${balance} credits`}>
            {formatCredits(balance)} <span className="text-muted-foreground">credits</span>
          </span>
        </nav>
      </header>
      <main className="flex-1 py-8 sm:py-12">{children}</main>
    </div>
  );
}

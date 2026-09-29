import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

/** The back arrow at the top of every page but Create: to the page's parent, so it works from a shared link too. */
export function BackLink({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) {
  return (
    <Link
      href={href}
      className={cn(
        "-ml-1 flex h-9 items-center gap-1.5 self-start rounded px-1 text-sm text-muted-foreground hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none print:hidden",
        className,
      )}
    >
      <ArrowLeft className="size-4" aria-hidden /> {children}
    </Link>
  );
}

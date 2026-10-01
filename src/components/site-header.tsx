"use client";

import { useEffect, useState } from "react";

// Sticky header: flat with a bottom rule at the top of the page, a floating translucent panel once scrolled.
// The look lives in globals.css (.site-header); this only flips data-scrolled.
export function SiteHeader({ children }: { children: React.ReactNode }) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <header data-scrolled={scrolled || undefined} className="site-header sticky top-[env(safe-area-inset-top,0px)] z-40 flex h-14 items-center justify-between gap-4 print:hidden">
      {children}
    </header>
  );
}

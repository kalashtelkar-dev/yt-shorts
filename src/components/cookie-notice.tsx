"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { COOKIE_CONSENT } from "@/lib/consent";

/**
 * The cookie notice. We set only cookies the service needs (sign-in and its security), so there's
 * nothing optional to refuse: "Accept" records that the visitor has seen it, for a year. The layout renders this
 * only when that cookie is missing, so it never flashes for people who already accepted.
 */
export function CookieNotice() {
  const [open, setOpen] = useState(true);
  if (!open) return null;
  function accept() {
    const secure = location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${COOKIE_CONSENT}=essential; Max-Age=${60 * 60 * 24 * 365}; Path=/; SameSite=Lax${secure}`;
    setOpen(false);
  }
  return (
    <section
      aria-label="Cookie notice"
      className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-50 mx-auto flex max-w-xl flex-col gap-3 rounded-2xl border bg-panel p-4 shadow-2xl sm:flex-row sm:items-center sm:gap-5 print:hidden"
    >
      <p className="text-sm leading-relaxed text-muted-foreground">
        We use only the cookies MontageAI needs to work: keeping you signed in and secure. No ads or tracking.{" "}
        <Link href="/privacy#cookies" className="text-foreground underline underline-offset-4 hover:text-muted-foreground">
          Privacy policy
        </Link>
      </p>
      <Button type="button" variant="outline" size="lg" onClick={accept} className="shrink-0">
        Accept
      </Button>
    </section>
  );
}

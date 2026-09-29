import Link from "next/link";

// Server-rendered pieces shared by the auth pages.

export function AuthHeading({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-2xl font-semibold tracking-tight text-balance">{title}</h1>
      {children && <p className="text-muted-foreground">{children}</p>}
    </div>
  );
}

export function TextLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="rounded text-foreground underline underline-offset-4 hover:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
      {children}
    </Link>
  );
}

/** Sign in / Create account switch at the top of both pages. */
export function AuthTabs({ active }: { active: "sign-in" | "sign-up" }) {
  const tabs = [
    { href: "/sign-in", key: "sign-in", label: "Sign in" },
    { href: "/sign-up", key: "sign-up", label: "Create account" },
  ] as const;
  return (
    <nav aria-label="Account" className="grid grid-cols-2 gap-1 rounded-xl border bg-panel p-1">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={active === t.key ? "page" : undefined}
          className={
            "flex h-11 items-center justify-center rounded-lg text-sm font-medium transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none " +
            (active === t.key ? "bg-panel-raised text-foreground" : "text-muted-foreground hover:text-foreground")
          }
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

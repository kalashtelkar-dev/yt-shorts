import { LogOut } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { LogoIcon, Wordmark } from "@/components/logo";
import { signOutAction } from "@/app/admin/actions";
import { AdminNav } from "@/components/admin/nav";
import { brand } from "@/config/brand";
import { requireAdmin } from "@/server/admin/guard";

export const metadata: Metadata = { title: { default: "Admin", template: `%s · Admin · ${brand.name}` }, robots: { index: false } };

const signOutClass =
  "flex items-center gap-2 rounded-md px-2 py-2 text-sm text-muted-foreground hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin();
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[5rem_minmax(0,1fr)]">
      <aside className="border-b bg-background print:hidden lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col lg:border-r lg:border-b-0 lg:py-4">
        <div className="flex h-14 items-center justify-between gap-4 px-4 lg:mb-4 lg:h-auto lg:justify-center lg:px-0">
          <Link href="/admin/health" className="flex items-center gap-2 rounded font-semibold tracking-tight focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none" title={`${brand.name} admin`} aria-label={`${brand.name} admin home`}>
            <LogoIcon className="max-lg:hidden" />
            <Wordmark className="h-8 lg:hidden" />
            <span className="font-normal text-muted-foreground lg:hidden">Admin</span>
          </Link>
          <form action={signOutAction} className="flex items-center gap-3 lg:hidden">
            <span className="hidden text-sm text-muted-foreground sm:inline">{admin.email}</span>
            <button type="submit" className={signOutClass}>
              Sign out
            </button>
          </form>
        </div>
        <AdminNav />
        <form action={signOutAction} className="mt-auto flex justify-center max-lg:hidden">
          <button type="submit" className={signOutClass} aria-label={`Sign out ${admin.email}`} title={`Sign out ${admin.email}`}>
            <LogOut className="size-5" aria-hidden />
          </button>
        </form>
      </aside>
      <main className="mx-auto flex w-full max-w-[1600px] min-w-0 flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
    </div>
  );
}

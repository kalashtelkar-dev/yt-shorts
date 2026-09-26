import type { Metadata } from "next";
import { signOutAction } from "@/app/admin/actions";
import { AdminNav } from "@/components/admin/nav";
import { brand } from "@/config/brand";
import { requireAdmin } from "@/server/admin/guard";

export const metadata: Metadata = { title: { default: "Admin", template: `%s · Admin · ${brand.name}` }, robots: { index: false } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin();
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-7xl flex-col px-4 sm:px-6">
      <header className="flex h-14 items-center justify-between gap-4 border-b">
        <span className="font-semibold tracking-tight">
          {brand.name} <span className="font-normal text-muted-foreground">Admin</span>
        </span>
        <form action={signOutAction} className="flex items-center gap-3 text-sm">
          <span className="hidden text-muted-foreground sm:inline">{admin.email}</span>
          <button type="submit" className="rounded-md px-2 py-2 text-muted-foreground hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
            Sign out
          </button>
        </form>
      </header>
      <div className="grid flex-1 grid-cols-[minmax(0,1fr)] gap-6 py-6 lg:grid-cols-[180px_minmax(0,1fr)] lg:gap-10 lg:py-8">
        <aside className="min-w-0 lg:sticky lg:top-6 lg:self-start">
          <AdminNav />
        </aside>
        <main className="flex min-w-0 flex-col gap-6">{children}</main>
      </div>
    </div>
  );
}

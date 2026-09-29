import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SignInForm } from "@/components/admin/sign-in-form";
import { LogoMark } from "@/components/logo";
import { brand } from "@/config/brand";
import { currentAdmin } from "@/server/admin/guard";

export const metadata: Metadata = { title: "Admin sign-in", robots: { index: false } };

export default async function AdminSignIn() {
  if (await currentAdmin()) redirect("/admin/health");
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 px-4 py-12">
      <div className="flex flex-col gap-2">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <LogoMark className="size-5" />
          {brand.name}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">Admin sign-in</h1>
      </div>
      <SignInForm />
    </main>
  );
}

import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { InvoiceDocument } from "@/components/invoice";
import { env } from "@/config/env";
import { getInvoice } from "@/server/payments";
import { getViewer } from "@/server/session";

export const metadata: Metadata = { title: "Tax invoice" };

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  if (env.AUTH_MODE !== "full") notFound();
  const viewer = await getViewer();
  if (!viewer || viewer.isAnonymous) redirect("/sign-in");
  const row = await getInvoice((await params).id, viewer.id); // someone else's invoice looks missing
  if (!row) notFound();
  return (
    <div className="flex flex-col gap-4">
      <Link href="/account/billing" className="-ml-1 flex items-center gap-1.5 self-start rounded px-1 py-1 text-sm text-muted-foreground hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none print:hidden">
        <ArrowLeft className="size-4" aria-hidden /> Billing
      </Link>
      <InvoiceDocument invoice={row.invoice} payment={row.payment} />
    </div>
  );
}

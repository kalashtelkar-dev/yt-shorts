import type { Metadata } from "next";
import { BackLink } from "@/components/back-link";
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
      <BackLink href="/account/billing">Billing</BackLink>
      <InvoiceDocument invoice={row.invoice} payment={row.payment} />
    </div>
  );
}

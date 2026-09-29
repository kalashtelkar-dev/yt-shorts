import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/admin/bits";
import { InvoiceDocument } from "@/components/invoice";
import { requireAdmin } from "@/server/admin/guard";
import { getInvoice } from "@/server/payments";

export const metadata: Metadata = { title: "Invoice" };

export default async function AdminInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const row = await getInvoice((await params).id, null);
  if (!row) notFound();
  return (
    <>
      <div className="print:hidden">
        <PageHeader title={row.invoice.number} back={{ href: "/admin/billing", label: "Back to billing" }} />
      </div>
      <InvoiceDocument invoice={row.invoice} payment={row.payment} />
    </>
  );
}

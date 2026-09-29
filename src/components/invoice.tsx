import { LogoMark } from "@/components/logo";
import type { invoices, payments } from "@/db/schema";
import { rupeesInWords, stateName } from "@/lib/billing";
import { formatCredits, formatRupees as rupees } from "@/lib/format";
import { PrintButton } from "./print-button";

// A GST tax invoice for one credit purchase (paid, so there are no bank details or due date). Printed or saved
// as PDF from the browser. Seller and buyer come from the snapshots taken when it was issued.

type Invoice = typeof invoices.$inferSelect;
type Payment = typeof payments.$inferSelect;

const dateFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" });

export function InvoiceDocument({ invoice: inv, payment }: { invoice: Invoice; payment: Payment }) {
  const s = inv.seller;
  const b = inv.buyer;
  const intra = inv.igstPaise === 0;
  const half = inv.gstRateBps / 200; // % for CGST and SGST each
  const taxRows: [string, number][] = intra
    ? [
        [`CGST ${half}%`, inv.cgstPaise],
        [`SGST ${half}%`, inv.sgstPaise],
      ]
    : [[`IGST ${inv.gstRateBps / 100}%`, inv.igstPaise]];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end print:hidden">
        <PrintButton />
      </div>
      <article className="mx-auto w-full max-w-[210mm] overflow-x-auto rounded-lg bg-paper p-6 text-[13px] leading-relaxed text-ink shadow-sm sm:p-10 print:max-w-none print:rounded-none print:p-0 print:shadow-none">
        <h1 className="border-b-2 border-ink pb-3 text-center text-sm font-semibold tracking-[0.3em]">TAX INVOICE</h1>

        <header className="flex flex-col gap-6 border-b border-ink-rule py-6 sm:flex-row sm:justify-between">
          <div className="flex gap-4">
            <LogoMark className="size-12" />
            <div className="flex flex-col">
              <span className="text-lg font-semibold">{s.legalName ?? "MontageAI"}</span>
              {s.address && <span className="max-w-sm text-ink-muted">{s.address}</span>}
              <span className="text-ink-muted">{[s.gstin && `GSTIN ${s.gstin}`, s.pan && `PAN ${s.pan}`].filter(Boolean).join("   ")}</span>
              <span className="text-ink-muted">{[s.email, s.phone, s.website].filter(Boolean).join("   ")}</span>
            </div>
          </div>
          <dl className="grid shrink-0 grid-cols-[auto_auto] content-start gap-x-4 sm:text-right">
            <dt className="text-ink-muted">Invoice</dt>
            <dd className="font-semibold">{inv.number}</dd>
            <dt className="text-ink-muted">Date</dt>
            <dd>{dateFmt.format(inv.issuedAt)}</dd>
            <dt className="text-ink-muted">Place of supply</dt>
            <dd>
              {stateName(b.stateCode)} ({b.stateCode})
            </dd>
          </dl>
        </header>

        <section className="grid gap-6 border-b border-ink-rule py-6 sm:grid-cols-2">
          <div className="flex flex-col">
            <span className="mb-1 text-xs font-medium tracking-wide text-ink-muted">Bill to</span>
            {b.legalName && <span className="font-semibold">{b.legalName}</span>}
            {b.gstin && <span>GSTIN {b.gstin}</span>}
            <span className="break-all">{b.email}</span>
            <span>
              {stateName(b.stateCode)}, India
            </span>
          </div>
          <div className="flex flex-col">
            <span className="mb-1 text-xs font-medium tracking-wide text-ink-muted">Supply</span>
            <span>{intra ? "Intra-state (CGST + SGST)" : "Inter-state (IGST)"}</span>
            <span className="text-ink-muted">
              Paid {payment.paidAt ? dateFmt.format(payment.paidAt) : ""}
              {payment.method ? ` by ${payment.method}` : ""}
            </span>
            {payment.providerPaymentId && <span className="font-mono text-xs break-all text-ink-muted">Payment {payment.providerPaymentId}</span>}
          </div>
        </section>

        <table className="mt-6 w-full min-w-[32rem] border-collapse text-left">
          <thead>
            <tr className="border-b border-ink text-xs tracking-wide text-ink-muted">
              <th className="py-2 pr-2 font-medium">#</th>
              <th className="py-2 pr-2 font-medium">Description</th>
              <th className="py-2 pr-2 font-medium">SAC</th>
              <th className="py-2 pr-2 text-right font-medium">Qty</th>
              <th className="py-2 pr-2 text-right font-medium">GST</th>
              <th className="py-2 text-right font-medium">Taxable value</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-ink-rule">
              <td className="py-3 pr-2 text-ink-muted">1</td>
              <td className="py-3 pr-2">MontageAI credits ({formatCredits(inv.credits)} credits, 1 credit = 1 second of video editing)</td>
              <td className="py-3 pr-2">{s.sac ?? "—"}</td>
              <td className="py-3 pr-2 text-right">1</td>
              <td className="py-3 pr-2 text-right">{inv.gstRateBps / 100}%</td>
              <td className="py-3 text-right">{rupees(inv.taxablePaise)}</td>
            </tr>
          </tbody>
        </table>

        <div className="mt-6 flex flex-col items-end">
          <dl className="grid w-full max-w-xs grid-cols-[1fr_auto] gap-y-1 [&>dd]:pl-6">
            <dt className="text-ink-muted">Taxable value</dt>
            <dd className="text-right">{rupees(inv.taxablePaise)}</dd>
            {taxRows.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-ink-muted">{k}</dt>
                <dd className="text-right">{rupees(v)}</dd>
              </div>
            ))}
            <dt className="mt-2 border-t border-ink pt-2 font-semibold">Total</dt>
            <dd className="mt-2 border-t border-ink pt-2 text-right text-base font-semibold">{rupees(inv.totalPaise)}</dd>
          </dl>
          <p className="mt-2 text-right text-ink-muted italic">{rupeesInWords(inv.totalPaise)}</p>
        </div>

        <footer className="mt-12 flex flex-col gap-8 sm:flex-row sm:items-end sm:justify-between">
          <p className="max-w-sm text-xs text-ink-muted">Computer-generated invoice for a paid purchase. Amounts in INR. Credits don&apos;t transfer and are used for video editing on MontageAI.</p>
          <div className="flex flex-col items-end text-right">
            {s.signatory && <span className="font-semibold">{s.signatory}</span>}
            <span className="text-xs tracking-wide text-ink-muted">Authorised signatory, {s.legalName ?? "MontageAI"}</span>
          </div>
        </footer>
      </article>
    </div>
  );
}

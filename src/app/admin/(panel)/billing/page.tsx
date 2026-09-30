import type { Metadata } from "next";
import Link from "next/link";
import { saveSettingsAction } from "@/app/admin/actions";
import { ActionForm } from "@/components/admin/action-form";
import { Empty, Field, PageHeader, Pager, pageOf, pageParam, Panel, Table, UserLabel } from "@/components/admin/bits";
import { Input } from "@/components/ui/input";
import { env } from "@/config/env";
import { formatClock, formatCredits, formatRupees, formatWhen } from "@/lib/format";
import { cn } from "@/lib/utils";
import { costReport } from "@/server/admin/billing";
import { requireAdmin } from "@/server/admin/guard";
import { listPayments } from "@/server/payments";
import { getSettings } from "@/server/settings";

export const metadata: Metadata = { title: "Billing" };
export const dynamic = "force-dynamic";

const rupeesText = (paise: number) => (paise / 100).toFixed(2);
const STATUS: Record<string, string> = { paid: "text-success", created: "text-muted-foreground", failed: "text-danger" };

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ page?: string; tp?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const page = pageParam(sp.page);
  const tp = pageParam(sp.tp);
  const [s, report, txns] = await Promise.all([getSettings(), costReport(30), listPayments(tp)]);
  const net = report.netPaisePerCredit;
  const revenue = Math.round(report.totals.netCredits * net);
  const rows = pageOf(report.rows, page);

  const tiles = [
    { label: "Compute cost", value: formatRupees(report.totals.costPaise), sub: `${formatRupees(report.totals.failedCostPaise)} of it on runs that failed` },
    { label: "Credits used", value: formatCredits(report.totals.netCredits), sub: "Charged for finished montages" },
    { label: "Earned after GST", value: formatRupees(revenue), sub: `${formatRupees(s.sellPaisePerCredit)} a credit incl. GST` },
    {
      label: "Margin",
      value: formatRupees(revenue - report.totals.costPaise),
      sub: "Earned minus compute cost",
      tone: revenue - report.totals.costPaise < 0 ? "text-danger" : "",
    },
  ];

  return (
    <>
      <PageHeader title="Billing" />
      <p className="-mt-3 text-sm text-muted-foreground">
        Last {report.days} days. Credit ranges per style and length are set in the{" "}
        <Link href="/admin/catalog" className="text-foreground underline underline-offset-4">
          catalog
        </Link>
        .
      </p>

      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="flex flex-col gap-1 rounded-xl border bg-panel p-4">
            <dt className="text-sm text-muted-foreground">{t.label}</dt>
            <dd className={cn("font-mono text-3xl font-medium tabular", t.tone)}>{t.value}</dd>
            <dd className="text-xs text-muted-foreground">{t.sub}</dd>
          </div>
        ))}
      </dl>

      <Panel title="Cost per montage">
        {report.rows.length === 0 ? (
          <Empty>No finished jobs in the last {report.days} days.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Style</th>
                <th className="text-right">Jobs</th>
                <th className="text-right">Succeeded</th>
                <th className="text-right">Median run</th>
                <th className="text-right">Range shown</th>
                <th className="text-right">Avg charged</th>
                <th className="text-right">Cost per montage</th>
                <th className="text-right">Earned per montage</th>
                <th className="text-right">Margin</th>
              </tr>
            </thead>
            <tbody>
              {rows.rows.map((r) => {
                const perMontage = r.succeeded ? Math.round(r.costPaise / r.succeeded) : null; // failed runs' cost spread over successes
                const avgCredits = r.succeeded ? Math.round(r.netCredits / r.succeeded) : null;
                const earned = avgCredits !== null ? Math.round(avgCredits * net) : null;
                const margin = earned !== null && perMontage !== null ? earned - perMontage : null;
                return (
                  <tr key={`${r.slug}-${r.durationSec}`}>
                    <td className="whitespace-nowrap">
                      {r.title} <span className="font-mono text-xs text-muted-foreground">{r.durationSec} s</span>
                    </td>
                    <td className="text-right font-mono tabular">{r.jobs}</td>
                    <td className="text-right font-mono tabular">{r.succeeded}</td>
                    <td className="text-right font-mono tabular">{r.medianRunMs ? formatClock(r.medianRunMs) : "—"}</td>
                    <td className="text-right font-mono tabular">{r.range ? `${formatCredits(r.range.min)}–${formatCredits(r.range.max)}` : "—"}</td>
                    <td className="text-right font-mono tabular">{avgCredits === null ? "—" : formatCredits(avgCredits)}</td>
                    <td className="text-right font-mono tabular">{perMontage === null ? "—" : formatRupees(perMontage)}</td>
                    <td className="text-right font-mono tabular">{earned === null ? "—" : formatRupees(earned)}</td>
                    <td className={cn("text-right font-mono tabular", margin !== null && margin < 0 && "text-danger")}>{margin === null ? "—" : formatRupees(margin)}</td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
        <Pager page={page} hasMore={rows.hasMore} params={{ tp: tp ? String(tp) : undefined }} />
        <p className="pt-3 text-xs text-muted-foreground">
          Cost per montage includes the compute of failed runs for the same style and length, at {formatRupees(report.costPaisePerSecond)} per second. Older montages were charged a fixed price.
        </p>
      </Panel>

      <Panel title="Transactions">
        {!env.PAYMENTS_ENABLED && <p className="mb-3 text-sm text-muted-foreground">Checkout is switched off (PAYMENTS_ENABLED=false), so users can&apos;t buy credits yet.</p>}
        {env.PAYMENTS_ENABLED && env.PAYMENTS_PROVIDER === "mock" && <p className="mb-3 text-sm text-warning">Mock payments are on: purchases here are local tests, not real money.</p>}
        {txns.rows.length === 0 ? (
          <Empty>No purchases yet.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>When</th>
                <th>User</th>
                <th className="text-right">Paid</th>
                <th className="text-right">Credits</th>
                <th>Status</th>
                <th>Invoice</th>
              </tr>
            </thead>
            <tbody>
              {txns.rows.map(({ payment: p, email, isAnonymous, invoiceId, invoiceNumber }) => (
                <tr key={p.id}>
                  <td className="font-mono text-xs whitespace-nowrap text-muted-foreground tabular">{formatWhen(p.createdAt.toISOString())}</td>
                  <td>
                    <UserLabel id={p.userId} email={email} isAnonymous={isAnonymous} />
                  </td>
                  <td className="text-right font-mono tabular">{formatRupees(p.amountPaise)}</td>
                  <td className="text-right font-mono tabular">{formatCredits(p.credits)}</td>
                  <td className={STATUS[p.status]}>
                    {p.status === "created" ? "Not paid" : p.status === "paid" ? "Paid" : "Failed"}
                    {p.provider === "mock" && <span className="ml-1.5 text-xs text-warning">test</span>}
                  </td>
                  <td>
                    {invoiceId ? (
                      <Link href={`/admin/billing/invoices/${invoiceId}`} className="font-mono text-xs hover:underline">
                        {invoiceNumber}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <Pager page={tp} hasMore={txns.hasMore} params={{ page: page ? String(page) : undefined }} param="tp" />
      </Panel>

      <Panel title="Pricing, limits and invoice details" className="max-w-4xl">
        <ActionForm action={saveSettingsAction} submitLabel="Save settings">
          <h3 className="text-sm font-medium">Pricing</h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Engine X cost per second (₹)">
              <Input name="costRupeesPerSecond" type="number" step="0.01" min={0} required defaultValue={rupeesText(s.costPaisePerSecond)} className="font-mono" />
            </Field>
            <Field label="Price per credit, GST included (₹)">
              <Input name="sellRupeesPerCredit" type="number" step="0.01" min={0.01} required defaultValue={rupeesText(s.sellPaisePerCredit)} className="font-mono" />
            </Field>
            <Field label="GST rate (%)">
              <Input name="gstPercent" type="number" step="0.01" min={0} max={50} required defaultValue={s.gstRateBps / 100} className="font-mono" />
            </Field>
            <Field label="Smallest top-up, GST included (₹)">
              <Input name="minPurchaseRupees" type="number" step="1" min={1} required defaultValue={s.minPurchasePaise / 100} className="font-mono" />
            </Field>
            <Field label="Largest top-up (₹)">
              <Input name="maxPurchaseRupees" type="number" step="1" min={1} required defaultValue={s.maxPurchasePaise / 100} className="font-mono" />
            </Field>
            <Field label="Free starter credits for new accounts">
              <Input name="starterCredits" type="number" step={1} min={0} required defaultValue={s.starterCredits} className="font-mono" />
            </Field>
          </div>

          <h3 className="mt-4 text-sm font-medium">Limits</h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Montages running at once per user">
              <Input name="maxConcurrentJobsPerUser" type="number" step={1} min={1} max={50} required defaultValue={s.maxConcurrentJobsPerUser} className="font-mono" />
            </Field>
            <Field label="Montages running at once per admin">
              <Input name="maxConcurrentJobsPerAdmin" type="number" step={1} min={1} max={50} required defaultValue={s.maxConcurrentJobsPerAdmin} className="font-mono" />
            </Field>
            <Field label="Montages running at once, whole site (the rest wait in line)">
              <Input name="maxConcurrentJobsTotal" type="number" step={1} min={1} max={500} required defaultValue={s.maxConcurrentJobsTotal} className="font-mono" />
            </Field>
            <Field label="Stop a run after (minutes)">
              <Input name="maxRunMinutes" type="number" step={1} min={5} required defaultValue={s.maxRunMinutes} className="font-mono" />
            </Field>
            <Field label="Largest upload (MB)">
              <Input name="maxUploadMb" type="number" step={1} min={1} required defaultValue={s.maxUploadMb} className="font-mono" />
            </Field>
          </div>

          <h3 className="mt-4 text-sm font-medium">On tax invoices</h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Legal name">
              <Input name="seller.legalName" defaultValue={s.seller.legalName ?? ""} maxLength={120} />
            </Field>
            <Field label="GSTIN">
              <Input name="seller.gstin" defaultValue={s.seller.gstin ?? ""} maxLength={15} className="font-mono uppercase" />
            </Field>
            <Field label="Address">
              <Input name="seller.address" defaultValue={s.seller.address ?? ""} maxLength={300} />
            </Field>
            <Field label="State code (GST, e.g. 29 for Karnataka)">
              <Input name="seller.stateCode" defaultValue={s.seller.stateCode ?? ""} maxLength={2} inputMode="numeric" className="font-mono" />
            </Field>
            <Field label="PAN">
              <Input name="seller.pan" defaultValue={s.seller.pan ?? ""} maxLength={10} className="font-mono uppercase" />
            </Field>
            <Field label="SAC code for the credits">
              <Input name="seller.sac" defaultValue={s.seller.sac ?? ""} maxLength={8} inputMode="numeric" className="font-mono" placeholder="Ask your accountant" />
            </Field>
            <Field label="Support email">
              <Input name="seller.email" type="email" defaultValue={s.seller.email ?? ""} />
            </Field>
            <Field label="Phone">
              <Input name="seller.phone" defaultValue={s.seller.phone ?? ""} maxLength={30} />
            </Field>
            <Field label="Website">
              <Input name="seller.website" defaultValue={s.seller.website ?? ""} maxLength={120} />
            </Field>
            <Field label="Authorised signatory (name)">
              <Input name="seller.signatory" defaultValue={s.seller.signatory ?? ""} maxLength={80} />
            </Field>
          </div>
          <p className="text-xs text-muted-foreground">Each invoice keeps the details it was issued with; changes here apply to new invoices.</p>
        </ActionForm>
      </Panel>
    </>
  );
}

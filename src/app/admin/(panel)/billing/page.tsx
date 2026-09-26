import type { Metadata } from "next";
import Link from "next/link";
import { saveSettingsAction } from "@/app/admin/actions";
import { ActionForm } from "@/components/admin/action-form";
import { Empty, Field, PageHeader, Panel, Table } from "@/components/admin/bits";
import { Input } from "@/components/ui/input";
import { formatClock, formatCredits, formatRupees } from "@/lib/format";
import { cn } from "@/lib/utils";
import { costReport } from "@/server/admin/billing";
import { requireAdmin } from "@/server/admin/guard";
import { getSettings } from "@/server/settings";

export const metadata: Metadata = { title: "Billing" };
export const dynamic = "force-dynamic";

const rupees = (paise: number | null) => (paise === null ? "" : (paise / 100).toFixed(2));

export default async function BillingPage() {
  await requireAdmin();
  const [s, report] = await Promise.all([getSettings(), costReport(30)]);
  const sell = report.sellPaisePerCredit;
  const revenue = sell ? report.totals.netCredits * sell : null;

  const tiles = [
    { label: "Compute cost", value: formatRupees(report.totals.costPaise), sub: `${formatRupees(report.totals.failedCostPaise)} of it on runs that failed` },
    { label: "Credits earned", value: formatCredits(report.totals.netCredits), sub: "Charged and not refunded" },
    { label: "Revenue at sell price", value: revenue === null ? "—" : formatRupees(revenue), sub: sell ? `${formatRupees(sell)} per credit` : "Set a sell price below" },
    {
      label: "Margin",
      value: revenue === null ? "—" : formatRupees(revenue - report.totals.costPaise),
      sub: revenue === null ? "Needs a sell price" : "Revenue minus compute cost",
      tone: revenue === null ? "" : revenue - report.totals.costPaise < 0 ? "text-danger" : "",
    },
  ];

  return (
    <>
      <PageHeader title="Billing" />
      <p className="-mt-3 text-sm text-muted-foreground">Last {report.days} days. Prices per style and length are set in the <Link href="/admin/catalog" className="text-foreground underline underline-offset-4">catalog</Link>.</p>

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
                <th className="text-right">Cost per montage</th>
                <th className="text-right">Price</th>
                <th className="text-right">Margin per montage</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((r) => {
                const perMontage = r.succeeded ? Math.round(r.costPaise / r.succeeded) : null; // failed runs' cost spread over successes
                const pricePaise = r.price !== null && sell ? r.price * sell : null;
                const margin = pricePaise !== null && perMontage !== null ? pricePaise - perMontage : null;
                return (
                  <tr key={`${r.slug}-${r.durationSec}`}>
                    <td className="whitespace-nowrap">
                      {r.title} <span className="font-mono text-xs text-muted-foreground">{r.durationSec} s</span>
                    </td>
                    <td className="text-right font-mono tabular">{r.jobs}</td>
                    <td className="text-right font-mono tabular">{r.succeeded}</td>
                    <td className="text-right font-mono tabular">{r.medianRunMs ? formatClock(r.medianRunMs) : "—"}</td>
                    <td className="text-right font-mono tabular">{perMontage === null ? "—" : formatRupees(perMontage)}</td>
                    <td className="text-right font-mono tabular">
                      {r.price === null ? "—" : `${formatCredits(r.price)} cr`}
                      {pricePaise !== null && <span className="block text-xs text-muted-foreground">{formatRupees(pricePaise)}</span>}
                    </td>
                    <td className={cn("text-right font-mono tabular", margin !== null && margin < 0 && "text-danger")}>{margin === null ? "—" : formatRupees(margin)}</td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
        <p className="pt-3 text-xs text-muted-foreground">
          Cost per montage includes the compute of failed runs for the same style and length. Compute is billed at {formatRupees(report.costPaisePerSecond)} per second.
        </p>
      </Panel>

      <Panel title="Pricing and limits" className="max-w-3xl">
        <ActionForm action={saveSettingsAction} submitLabel="Save settings">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Engine X cost per second (₹)">
              <Input name="costRupeesPerSecond" type="number" step="0.01" min={0} required defaultValue={rupees(s.costPaisePerSecond)} className="font-mono" />
            </Field>
            <Field label="Sell price per credit (₹, for checkout later)">
              <Input name="sellRupeesPerCredit" type="number" step="0.01" min={0.01} defaultValue={rupees(s.sellPaisePerCredit)} placeholder="Not set" className="font-mono" />
            </Field>
            <Field label="Free starter credits for new visitors">
              <Input name="starterCredits" type="number" step={1} min={0} required defaultValue={s.starterCredits} className="font-mono" />
            </Field>
            <Field label="Montages running at once per user">
              <Input name="maxConcurrentJobsPerUser" type="number" step={1} min={1} max={50} required defaultValue={s.maxConcurrentJobsPerUser} className="font-mono" />
            </Field>
            <Field label="Stop a run after (minutes)">
              <Input name="maxRunMinutes" type="number" step={1} min={5} required defaultValue={s.maxRunMinutes} className="font-mono" />
            </Field>
            <Field label="Largest upload (MB)">
              <Input name="maxUploadMb" type="number" step={1} min={1} required defaultValue={s.maxUploadMb} className="font-mono" />
            </Field>
          </div>
        </ActionForm>
      </Panel>

      <Panel title="Transactions" className="max-w-3xl">
        <p className="text-sm text-muted-foreground">Payments aren&apos;t switched on yet. Razorpay purchases will be listed here once checkout launches.</p>
      </Panel>
    </>
  );
}

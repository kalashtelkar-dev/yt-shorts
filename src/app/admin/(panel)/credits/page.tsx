import type { Metadata } from "next";
import Link from "next/link";
import { adjustCreditsAction } from "@/app/admin/actions";
import { ActionForm } from "@/components/admin/action-form";
import { Empty, Field, PageHeader, Pager, pageParam, Panel, Table, UserLabel } from "@/components/admin/bits";
import { Input } from "@/components/ui/input";
import { formatCredits, formatWhen } from "@/lib/format";
import { requireAdmin } from "@/server/admin/guard";
import { recentAdjustments } from "@/server/admin/queries";

export const metadata: Metadata = { title: "Credits" };

const KIND: Record<string, string> = { grant: "Starter grant", admin_add: "Added", admin_remove: "Removed", refund: "Refund" };

export default async function CreditsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  await requireAdmin();
  const page = pageParam((await searchParams).page);
  const { rows, hasMore } = await recentAdjustments(page);
  return (
    <>
      <PageHeader title="Credits" />
      <Panel title="Add or remove credits" className="max-w-xl">
        <ActionForm action={adjustCreditsAction} submitLabel="Apply">
          <Field label="User (email or user ID)">
            <Input name="user" required autoComplete="off" placeholder="name@example.com or a user ID" />
          </Field>
          <Field label="Credits (use a minus sign to remove)">
            <Input name="delta" type="number" inputMode="numeric" step={1} required placeholder="500 or -200" />
          </Field>
          <Field label="Reason">
            <Input name="reason" required minLength={3} maxLength={500} placeholder="Shown in the ledger and audit log" />
          </Field>
        </ActionForm>
      </Panel>

      <Panel title="Recent grants, adjustments and refunds">
        {rows.length === 0 ? (
          <Empty>Nothing yet.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>When</th>
                <th>User</th>
                <th>Type</th>
                <th className="text-right">Change</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ entry: l, email, isAnonymous }) => (
                <tr key={l.id}>
                  <td className="font-mono text-xs whitespace-nowrap text-muted-foreground tabular">{formatWhen(l.createdAt.toISOString())}</td>
                  <td><UserLabel id={l.userId} email={email} isAnonymous={isAnonymous} /></td>
                  <td>{KIND[l.kind] ?? l.kind}</td>
                  <td className="text-right font-mono tabular">{l.delta > 0 ? `+${formatCredits(l.delta)}` : formatCredits(l.delta)}</td>
                  <td className="text-muted-foreground">
                    {l.reason}
                    {l.jobId && (
                      <>
                        {" "}
                        <Link href={`/admin/jobs/${l.jobId}`} className="font-mono text-xs hover:underline">job {l.jobId.slice(0, 8)}</Link>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <Pager page={page} hasMore={hasMore} params={{}} />
      </Panel>
    </>
  );
}

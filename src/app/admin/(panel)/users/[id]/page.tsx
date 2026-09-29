import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { adjustCreditsAction, roleAction, suspendAction } from "@/app/admin/actions";
import { ActionForm } from "@/components/admin/action-form";
import { Empty, Field, JobStatus, PageHeader, Pager, pageParam, Panel, selectClass, Table } from "@/components/admin/bits";
import { Input } from "@/components/ui/input";
import { formatCredits, formatWhen } from "@/lib/format";
import { requireAdmin } from "@/server/admin/guard";
import { userDetail } from "@/server/admin/queries";

export const metadata: Metadata = { title: "User" };

const KIND: Record<string, string> = {
  grant: "Starter grant",
  admin_add: "Added by admin",
  admin_remove: "Removed by admin",
  charge: "Montage",
  refund: "Refund",
  purchase: "Purchase",
  reserve: "Reserve",
  release: "Release",
};

export default async function UserPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ lp?: string; jp?: string }> }) {
  const admin = await requireAdmin();
  const { id } = await params;
  const sp = await searchParams;
  const lp = pageParam(sp.lp);
  const jp = pageParam(sp.jp);
  const u = await userDetail(id, lp, jp);
  if (!u) notFound();
  const self = u.id === admin.id;

  return (
    <>
      <PageHeader title={u.isAnonymous ? `Guest · ${u.id.slice(0, 8)}` : u.email} back={{ href: "/admin/users", label: "Back to users" }}>
        <p className="font-mono text-xs text-muted-foreground">{u.id}</p>
      </PageHeader>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel title="Account">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Balance</dt>
            <dd className="font-mono tabular">{formatCredits(u.balance)} credits</dd>
            <dt className="text-muted-foreground">Type</dt>
            <dd>{u.isAnonymous ? "Guest (no sign-in)" : u.emailVerified ? "Account, email verified" : "Account, email not verified"}</dd>
            <dt className="text-muted-foreground">Role</dt>
            <dd className="capitalize">{u.role}</dd>
            <dt className="text-muted-foreground">Status</dt>
            <dd>{u.suspendedAt ? <span className="text-danger">Suspended {formatWhen(u.suspendedAt.toISOString())}</span> : "Active"}</dd>
            <dt className="text-muted-foreground">Joined</dt>
            <dd>{formatWhen(u.createdAt.toISOString())}</dd>
          </dl>
        </Panel>

        <Panel title="Adjust credits">
          <ActionForm action={adjustCreditsAction} submitLabel="Apply">
            <input type="hidden" name="user" value={u.id} />
            <Field label="Credits (use a minus sign to remove)">
              <Input name="delta" type="number" inputMode="numeric" step={1} required placeholder="500 or -200" />
            </Field>
            <Field label="Reason">
              <Input name="reason" required minLength={3} maxLength={500} placeholder="e.g. Refund for a broken edit" />
            </Field>
          </ActionForm>
        </Panel>

        <Panel title="Access">
          {self ? (
            <p className="text-sm text-muted-foreground">This is your account. Another admin has to change your role or suspend you.</p>
          ) : (
            <div className="flex flex-col gap-5">
              <ActionForm action={suspendAction} submitLabel={u.suspendedAt ? "Unsuspend" : "Suspend"} variant={u.suspendedAt ? "secondary" : "destructive"}>
                <input type="hidden" name="userId" value={u.id} />
                <input type="hidden" name="suspend" value={u.suspendedAt ? "false" : "true"} />
                <p className="text-sm text-muted-foreground">Suspended users can browse but can&apos;t start new montages.</p>
              </ActionForm>
              {!u.isAnonymous && (
                <ActionForm action={roleAction} submitLabel="Save role">
                  <input type="hidden" name="userId" value={u.id} />
                  <Field label="Role">
                    <select name="role" defaultValue={u.role} className={selectClass}>
                      <option value="user">User</option>
                      <option value="admin">Admin</option>
                    </select>
                  </Field>
                </ActionForm>
              )}
            </div>
          )}
        </Panel>
      </div>

      <Panel title="Credit ledger">
        {u.ledger.length === 0 ? (
          <Empty>No credit movements yet.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>When</th>
                <th>Type</th>
                <th className="text-right">Change</th>
                <th>Reason</th>
                <th>Job</th>
              </tr>
            </thead>
            <tbody>
              {u.ledger.map((l) => (
                <tr key={l.id}>
                  <td className="font-mono text-xs whitespace-nowrap text-muted-foreground tabular">{formatWhen(l.createdAt.toISOString())}</td>
                  <td>{KIND[l.kind] ?? l.kind}</td>
                  <td className="text-right font-mono tabular">{l.delta > 0 ? `+${formatCredits(l.delta)}` : formatCredits(l.delta)}</td>
                  <td className="text-muted-foreground">{l.reason}</td>
                  <td>{l.jobId && <Link href={`/admin/jobs/${l.jobId}`} className="font-mono text-xs hover:underline">{l.jobId.slice(0, 8)}</Link>}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <Pager page={lp} hasMore={u.ledgerHasMore} params={{ jp: jp ? String(jp) : undefined }} param="lp" />
      </Panel>

      <Panel title="Jobs">
        {u.jobs.length === 0 ? (
          <Empty>No montages yet.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Created</th>
                <th>Style</th>
                <th>Length</th>
                <th>Status</th>
                <th className="text-right">Credits</th>
              </tr>
            </thead>
            <tbody>
              {u.jobs.map((j) => (
                <tr key={j.id}>
                  <td className="font-mono text-xs whitespace-nowrap tabular">
                    <Link href={`/admin/jobs/${j.id}`} className="hover:underline">{formatWhen(j.createdAt.toISOString())}</Link>
                  </td>
                  <td>{j.catalogSlug}</td>
                  <td className="font-mono tabular">{j.durationSec} s</td>
                  <td><JobStatus status={j.status} /></td>
                  <td className="text-right font-mono tabular">{formatCredits(j.chargedCredits)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <Pager page={jp} hasMore={u.jobsHasMore} params={{ lp: lp ? String(lp) : undefined }} param="jp" />
      </Panel>
    </>
  );
}

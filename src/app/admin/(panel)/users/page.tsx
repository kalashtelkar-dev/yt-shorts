import type { Metadata } from "next";
import Link from "next/link";
import { Empty, PageHeader, Pager, Panel, selectClass, Table } from "@/components/admin/bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCredits, formatWhen } from "@/lib/format";
import { requireAdmin } from "@/server/admin/guard";
import { listUsers } from "@/server/admin/queries";

export const metadata: Metadata = { title: "Users" };

type Search = { q?: string; kind?: string; page?: string };

export default async function UsersPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireAdmin();
  const sp = await searchParams;
  const kind = sp.kind === "anonymous" || sp.kind === "all" ? sp.kind : "real";
  const page = Math.max(0, Number(sp.page) || 0);
  const { rows, hasMore } = await listUsers(sp.q ?? "", kind, page);

  return (
    <>
      <PageHeader title="Users" />
      <form className="flex flex-col gap-3 sm:flex-row" role="search">
        <Input name="q" defaultValue={sp.q} placeholder="Search email, name or user ID" aria-label="Search users" className="sm:max-w-sm" />
        <select name="kind" defaultValue={kind} aria-label="Account type" className={`${selectClass} sm:w-48`}>
          <option value="real">Accounts</option>
          <option value="anonymous">Guests</option>
          <option value="all">Everyone</option>
        </select>
        <Button type="submit">
          Search
        </Button>
      </form>
      <Panel>
        {rows.length === 0 ? (
          <Empty>{kind === "real" ? "No accounts yet. Guests appear under “Guests”." : "No users match."}</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th className="text-right">Balance</th>
                <th className="text-right">Jobs</th>
                <th>Joined</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id}>
                  <td>
                    <Link href={`/admin/users/${u.id}`} className="hover:underline">
                      {u.isAnonymous ? <span className="text-muted-foreground">Guest · {u.id.slice(0, 8)}</span> : u.email}
                    </Link>
                  </td>
                  <td className="capitalize">{u.role}</td>
                  <td className="text-right font-mono tabular">{formatCredits(u.balance)}</td>
                  <td className="text-right font-mono tabular">{u.jobCount}</td>
                  <td className="font-mono text-xs whitespace-nowrap text-muted-foreground tabular">{formatWhen(u.createdAt.toISOString())}</td>
                  <td>{u.suspendedAt ? <span className="text-danger">Suspended</span> : <span className="text-muted-foreground">Active</span>}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <Pager page={page} hasMore={hasMore} params={{ q: sp.q, kind }} />
      </Panel>
    </>
  );
}

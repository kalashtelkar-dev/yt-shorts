import type { Metadata } from "next";
import { HealthDashboard } from "@/components/admin/health/dashboard";
import { pageParam } from "@/components/pager";
import type { Range } from "@/lib/uptime";
import { requireAdmin } from "@/server/admin/guard";
import { healthView } from "@/server/health/queries";

export const metadata: Metadata = { title: "Service health" };
export const dynamic = "force-dynamic";

export default async function HealthPage({ searchParams }: { searchParams: Promise<{ range?: string; ip?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const range: Range = sp.range === "7d" || sp.range === "90d" ? sp.range : "24h";
  return <HealthDashboard view={await healthView(range, pageParam(sp.ip))} />;
}

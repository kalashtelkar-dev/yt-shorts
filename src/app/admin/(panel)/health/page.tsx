import type { Metadata } from "next";
import { HealthDashboard } from "@/components/admin/health/dashboard";
import type { Range } from "@/lib/uptime";
import { requireAdmin } from "@/server/admin/guard";
import { healthView } from "@/server/health/queries";

export const metadata: Metadata = { title: "Service health" };
export const dynamic = "force-dynamic";

export default async function HealthPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  await requireAdmin();
  const r = (await searchParams).range;
  const range: Range = r === "7d" || r === "90d" ? r : "24h";
  return <HealthDashboard view={await healthView(range)} />;
}

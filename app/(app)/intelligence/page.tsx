import type { Metadata } from "next";
import { ExecutiveDashboardView } from "@/components/dashboard/executive-dashboard";
import { getNavItem } from "@/components/shell/navigation";
import { getExecutiveDashboard } from "@/db/queries/dashboard";

const { label } = getNavItem("intelligence");

export const metadata: Metadata = { title: label };

/*
 * Dashboard Directivo (Hito 5, DEC-037): las métricas del mes en curso se
 * agregan en PostgreSQL en cada request, por el loader tenant-scoped:
 * requireTenant() → withTenant() → RLS. La página no conoce Drizzle.
 */
export default async function IntelligencePage() {
  const dashboard = await getExecutiveDashboard();
  return <ExecutiveDashboardView title={label} dashboard={dashboard} />;
}

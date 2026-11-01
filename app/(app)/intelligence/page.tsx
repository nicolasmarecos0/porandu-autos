import type { Metadata } from "next";
import { ExecutiveDashboardView } from "@/components/dashboard/executive-dashboard";
import { getNavItem } from "@/components/shell/navigation";
import { getExecutiveDashboard } from "@/db/queries/dashboard";

const { label } = getNavItem("intelligence");

export const metadata: Metadata = { title: label };

/*
 * Dashboard Directivo (Hito 5, DEC-037; DEC-043): el rango viaja en la URL
 * (`?range=…`, o `?range=custom&from=…&to=…`) y las métricas se agregan en
 * PostgreSQL en cada request, por el loader tenant-scoped: requireTenant() →
 * withTenant() → RLS. La página no conoce Drizzle ni valida el rango: le
 * pasa los `searchParams` tal cual al loader, que los trata como input no
 * confiable (un rango inválido cae al mes en curso con un aviso).
 *
 * Dinámica: lee cookies (la sesión y la organización activa). Sin caché
 * compartida entre requests (DEC-043 §6).
 */
export default async function IntelligencePage({
  searchParams,
}: PageProps<"/intelligence">) {
  const dashboard = await getExecutiveDashboard(await searchParams);
  return <ExecutiveDashboardView title={label} dashboard={dashboard} />;
}

import type { Metadata } from "next";

import {
  CockpitMetricsRestricted,
  CockpitMetricsView,
} from "@/components/cockpit/metrics/metrics-view";
import { getCockpitMetrics } from "@/db/queries/cockpit-metrics";

const TITLE = "Métricas del salón";

export const metadata: Metadata = { title: TITLE };

/*
 * Métricas del salón: la vista ejecutiva de la sección Cockpit (DEC-001;
 * propuesta DEC-050). El período viaja en la URL (`?period=7d|30d|90d|all`)
 * y las métricas se agregan en PostgreSQL en cada request, por el loader
 * tenant-scoped: requireTenant() → withTenant() → RLS. La página no conoce
 * Drizzle ni valida el período: le pasa los `searchParams` tal cual al
 * loader, que los trata como input no confiable (un período inválido cae a
 * los últimos 30 días con un aviso).
 *
 * Dinámica: lee cookies (la sesión y la organización activa). Sin caché
 * compartida entre requests (DEC-043 §6). Solo lee.
 *
 * Es la vista de la gerencia (Hito 22, DEC-054 §5): para un seller el
 * loader no lee nada y la página muestra un estado vacío que lo explica.
 */
export default async function CockpitMetricsPage({
  searchParams,
}: PageProps<"/cockpit/metrics">) {
  const result = await getCockpitMetrics(await searchParams);
  if (result.kind === "restricted") {
    return <CockpitMetricsRestricted title={TITLE} />;
  }
  return <CockpitMetricsView title={TITLE} metrics={result.metrics} />;
}

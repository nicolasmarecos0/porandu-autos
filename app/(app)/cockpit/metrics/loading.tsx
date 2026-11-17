import { MetricsSkeleton } from "@/components/shell/route-skeletons";

/** Estado de carga de /cockpit/metrics (DEC-058). */
export default function CockpitMetricsLoading() {
  return <MetricsSkeleton title="Métricas del salón" withViewSwitch />;
}

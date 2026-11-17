import { getNavItem } from "@/components/shell/navigation";
import { MetricsSkeleton } from "@/components/shell/route-skeletons";

const { label } = getNavItem("intelligence");

/** Estado de carga de /intelligence (DEC-058). */
export default function IntelligenceLoading() {
  return <MetricsSkeleton title={label} />;
}

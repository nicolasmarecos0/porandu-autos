import { getNavItem } from "@/components/shell/navigation";
import { CockpitFeedSkeleton } from "@/components/shell/route-skeletons";

const { label } = getNavItem("cockpit");

/*
 * Estado de carga de /cockpit (DEC-058). Está en el grupo `(feed)` para que
 * su boundary no envuelva a /cockpit/metrics, que tiene el suyo: el prefetch
 * de Next llega hasta el primer loading.js de la ruta.
 */
export default function CockpitLoading() {
  return <CockpitFeedSkeleton title={label} />;
}

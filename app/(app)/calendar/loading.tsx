import { getNavItem } from "@/components/shell/navigation";
import { CalendarSkeleton } from "@/components/shell/route-skeletons";

const { label } = getNavItem("calendar");

/** Estado de carga de /calendar (DEC-058). */
export default function CalendarLoading() {
  return <CalendarSkeleton title={label} />;
}

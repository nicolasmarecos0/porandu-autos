import type { Metadata } from "next";
import { ModulePlaceholder } from "@/components/shell/module-placeholder";
import { getNavItem } from "@/components/shell/navigation";

const { label } = getNavItem("calendar");

export const metadata: Metadata = { title: label };

export default function CalendarPage() {
  return <ModulePlaceholder title={label} />;
}

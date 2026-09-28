import type { Metadata } from "next";
import { ModulePlaceholder } from "@/components/shell/module-placeholder";
import { getNavItem } from "@/components/shell/navigation";

const { label } = getNavItem("recovery");

export const metadata: Metadata = { title: label };

export default function RecoveryPage() {
  return <ModulePlaceholder title={label} />;
}

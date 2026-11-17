import { getNavItem } from "@/components/shell/navigation";
import { InboxSkeleton } from "@/components/shell/route-skeletons";

const { label } = getNavItem("conversations");

/** Estado de carga de /conversations (DEC-058). */
export default function ConversationsLoading() {
  return <InboxSkeleton title={label} />;
}

import type { Metadata } from "next";
import { InboxView } from "@/components/inbox/inbox-view";
import { getNavItem } from "@/components/shell/navigation";
import { getInbox } from "@/db/queries/conversations";

const { label } = getNavItem("conversations");

export const metadata: Metadata = { title: label };

/*
 * Bandeja de conversaciones (Hito 8, DEC-040 §1): las conversaciones activas
 * y el historial de la elegida (`?c=<id>`) salen de PostgreSQL por el loader
 * tenant-scoped: requireTenant() → withTenant() → RLS. La página no conoce
 * Drizzle. Responder es POST /api/messages/send, desde el composer.
 */
export default async function ConversationsPage({
  searchParams,
}: PageProps<"/conversations">) {
  const { c } = await searchParams;
  const inbox = await getInbox(typeof c === "string" ? c : undefined);
  return <InboxView title={label} inbox={inbox} />;
}

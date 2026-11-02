import type { Metadata } from "next";
import { CockpitView } from "@/components/cockpit/cockpit-view";
import { getNavItem } from "@/components/shell/navigation";
import { getCockpitFeed } from "@/db/queries/cockpit";

const { label } = getNavItem("cockpit");

export const metadata: Metadata = { title: label };

/*
 * Cockpit (Hito 15, DEC-047): el feed de actividad del día sale de
 * PostgreSQL por el loader tenant-scoped (requireTenant() → withTenant() →
 * RLS), en una transacción por request. La página no conoce Drizzle ni las
 * reglas del feed.
 *
 * Dinámica: lee cookies (la sesión y la organización activa). Sin caché
 * compartida entre requests (DEC-043 §6). Solo lee: abrir el Cockpit no
 * marca conversaciones como vistas ni cambia estados.
 */
export default async function CockpitPage() {
  const feed = await getCockpitFeed();
  return <CockpitView title={label} feed={feed} />;
}

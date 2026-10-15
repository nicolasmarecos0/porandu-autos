import type { Metadata } from "next";
import { TeamPanel } from "@/components/settings/team-panel";
import { getTeam } from "@/db/queries/settings";

export const metadata: Metadata = { title: "Configuración · Equipo" };

/*
 * Equipo (Hito 6, DEC-038 §6): los miembros activos de la organización
 * activa, desde el loader tenant-scoped (requireTenant() → withTenant() →
 * private.organization_members()). Un admin gestiona; un seller solo ve.
 */
export default async function SettingsTeamPage() {
  const team = await getTeam();
  return <TeamPanel team={team} />;
}

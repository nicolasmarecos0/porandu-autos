import type { Metadata } from "next";
import { OrganizationSettingsPanel } from "@/components/settings/organization-form";
import { getOrganizationSettings } from "@/db/queries/settings";

export const metadata: Metadata = { title: "Configuración · General" };

/*
 * Configuración general (Hito 6, DEC-038 §2): nombre del concesionario y
 * moneda por defecto, desde el loader tenant-scoped (requireTenant() →
 * withTenant() → RLS). Editable solo para admin; la página no conoce
 * Drizzle.
 */
export default async function SettingsGeneralPage() {
  const settings = await getOrganizationSettings();
  return <OrganizationSettingsPanel settings={settings} />;
}

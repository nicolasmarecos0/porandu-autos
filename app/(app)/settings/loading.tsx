import { SettingsSkeleton } from "@/components/shell/route-skeletons";

/*
 * Estado de carga de /settings y /settings/team (DEC-058). Vive dentro del
 * layout de Configuración, que pinta el encabezado y las pestañas sin datos.
 */
export default function SettingsLoading() {
  return <SettingsSkeleton label="la configuración" />;
}

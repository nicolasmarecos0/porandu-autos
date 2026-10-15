import type { ReactNode } from "react";
import { getNavItem } from "@/components/shell/navigation";
import { PageHeader } from "@/components/shell/page-header";
import { SettingsTabs } from "@/components/settings/settings-tabs";

const { label } = getNavItem("settings");

/*
 * Configuración (Hito 6, DEC-038 §8): encabezado y navegación interna
 * (General, Equipo) compartidos. No carga datos ni autoriza: cada página
 * pide su contexto con su loader (requireTenant() → withTenant()).
 */
export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title={label} />
      <SettingsTabs />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-gutter">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-section">
          {children}
        </div>
      </div>
    </div>
  );
}

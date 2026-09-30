import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { TopBar } from "@/components/shell/top-bar";
import { Button } from "@/components/ui/button";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { signOut } from "@/lib/auth/actions";
import { HOME_PATH } from "@/lib/auth/paths";
import { getActiveMemberships } from "@/lib/tenant/session";

export const metadata: Metadata = { title: "Sin acceso" };

/*
 * Usuario autenticado sin ninguna membership activa (H0.7). Solo informa y
 * permite cerrar sesión: no hay alta de organizaciones, solicitudes de
 * acceso ni invitaciones en B1.
 */
export default async function NoAccessPage() {
  // Si recuperó el acceso, esta pantalla ya no corresponde.
  if ((await getActiveMemberships()).length > 0) redirect(HOME_PATH);

  return (
    <div className="flex min-h-dvh flex-col">
      <TopBar />
      <main className="flex flex-1 items-start justify-center px-gutter py-16">
        <Panel className="w-full max-w-sm">
          <PanelHeader>
            <h1 className="text-heading text-text-primary">Sin acceso</h1>
          </PanelHeader>
          <div className="flex flex-col gap-4 p-4">
            <p className="text-body text-text-secondary">
              Tu cuenta no tiene acceso a ninguna organización en este momento.
              Si creés que es un error, consultá con el administrador de tu
              organización.
            </p>
            <form action={signOut}>
              <Button type="submit" variant="primary" className="h-9 w-full">
                Cerrar sesión
              </Button>
            </form>
          </div>
        </Panel>
      </main>
    </div>
  );
}

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SignOutButton } from "@/components/shell/sign-out-button";
import { TopBar } from "@/components/shell/top-bar";
import { OrganizationPicker } from "@/components/tenant/organization-picker";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { HOME_PATH } from "@/lib/auth/paths";
import { NO_ACCESS_PATH } from "@/lib/tenant/paths";
import { getActiveMemberships } from "@/lib/tenant/session";

export const metadata: Metadata = { title: "Elegir organización" };

/*
 * Selector de organización (H0.7). Exige usuario verificado y lista solo sus
 * memberships activas, leídas de la base en esta request. La elección la
 * valida la Server Action `selectOrganization`.
 */
export default async function SelectOrganizationPage() {
  const memberships = await getActiveMemberships();
  if (memberships.length === 0) redirect(NO_ACCESS_PATH);
  // Con una sola organización no hay nada que elegir: requireTenant() la usa.
  if (memberships.length === 1) redirect(HOME_PATH);

  return (
    <div className="flex min-h-dvh flex-col">
      <TopBar>
        <SignOutButton />
      </TopBar>
      <main className="flex flex-1 items-start justify-center px-gutter py-16">
        <Panel className="w-full max-w-md">
          <PanelHeader>
            <h1 className="text-heading text-text-primary">
              Elegí una organización
            </h1>
          </PanelHeader>
          <div className="p-4">
            <OrganizationPicker
              organizations={memberships.map(
                ({ organizationId, organizationName, role }) => ({
                  organizationId,
                  organizationName,
                  role,
                }),
              )}
            />
          </div>
        </Panel>
      </main>
    </div>
  );
}

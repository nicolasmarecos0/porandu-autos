import "server-only";

import { requireTenant } from "@/lib/tenant/session";

import { can, CAPABILITIES, type Capability } from "./roles";

/*
 * Qué puede hacer quien mira (Hito 22, DEC-054 §6): las capacidades del rol
 * de la membership activa, para que una página oculte o deshabilite lo que
 * no le corresponde. Es un loader de la request (requireTenant(), con su
 * cache() del render), no una autorización: cada Server Action y cada
 * loader restringido vuelve a exigir el rol, y la base también.
 */
export type ViewerCapabilities = Readonly<Record<Capability, boolean>>;

export async function getViewerCapabilities(): Promise<ViewerCapabilities> {
  const { role } = await requireTenant();
  return Object.fromEntries(
    CAPABILITIES.map((capability) => [capability, can(role, capability)]),
  ) as ViewerCapabilities;
}

"use server";

import { redirect } from "next/navigation";

import { listActiveMemberships } from "@/db/queries/memberships";
import { HOME_PATH } from "@/lib/auth/paths";
import { requireUser } from "@/lib/auth/session";

import { writeActiveOrganization } from "./cookie";
import { parseOrganizationId } from "./resolution";

/*
 * Selector de organización (H0.7). Es un endpoint público: el
 * `organizationId` del formulario es input no confiable.
 *
 * 1. Exige un usuario verificado (claims de Supabase Auth).
 * 2. Solo lee `organizationId` y exige un UUID. Cualquier otro campo (rol,
 *    userId, destino) se ignora.
 * 3. Vuelve a leer de la base las memberships activas del usuario y solo
 *    acepta una organización donde hoy tiene membership activa.
 * 4. Recién entonces escribe la cookie, con el UUID de la membership leída
 *    de la base (no el del input), y redirige a /cockpit. No hay `next`.
 *
 * Una organización inexistente, ajena, con la membership inactiva o un valor
 * que no es UUID dan el mismo error genérico: no se revela nada de otras
 * organizaciones.
 */

export type SelectOrganizationState = Readonly<{
  error: "invalid_selection";
}> | null;

const INVALID_SELECTION = { error: "invalid_selection" } as const;

export async function selectOrganization(
  _previous: SelectOrganizationState,
  formData: FormData,
): Promise<SelectOrganizationState> {
  const user = await requireUser();

  const organizationId = parseOrganizationId(formData.get("organizationId"));
  if (!organizationId) return INVALID_SELECTION;

  const memberships = await listActiveMemberships(user);
  const membership = memberships.find(
    (candidate) => candidate.organizationId === organizationId,
  );
  if (!membership) return INVALID_SELECTION;

  await writeActiveOrganization(membership.organizationId);
  redirect(HOME_PATH);
}

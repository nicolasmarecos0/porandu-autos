import "server-only";

import { redirect } from "next/navigation";
import { cache } from "react";

import {
  listActiveMemberships,
  type ActiveMembership,
} from "@/db/queries/memberships";
import { requireUser } from "@/lib/auth/session";

import { readActiveOrganization } from "./cookie";
import { NO_ACCESS_PATH, SELECT_ORGANIZATION_PATH } from "./paths";
import { resolveTenant, type TenantContext } from "./resolution";

/*
 * Tenant Resolution en server code (H0.7):
 *
 *   AuthenticatedUser → memberships activas → organización activa →
 *   TenantContext confiable → withTenant()
 *
 * Deduplicación: `cache()` de React memoriza el resultado solo dentro del
 * render de una request (Server Components). No es una caché persistente ni
 * compartida entre usuarios o requests: cada request vuelve a verificar los
 * claims y a leer las memberships, así que una revocación rige desde el
 * request siguiente. Fuera de un render (Server Actions, tests) `cache()` no
 * memoriza y cada llamada vuelve a consultar.
 *
 * El layout de (app) llama a requireTenant() como gate de UX, pero no
 * sustituye la validación junto a los datos: un layout no se vuelve a
 * renderizar en cada navegación y no le pasa nada a las páginas. Todo loader
 * o Server Action tenant-scoped obtiene su propio contexto con
 * requireTenant() y se lo pasa a withTenant(), que rechaza cualquier
 * contexto que no haya emitido Tenant Resolution.
 */

/** Memberships activas del usuario verificado (una lectura por request). */
export const getActiveMemberships = cache(
  async (): Promise<readonly ActiveMembership[]> => {
    const user = await requireUser();
    return listActiveMemberships(user);
  },
);

/**
 * TenantContext de la request. Sin usuario → /login; sin memberships
 * activas → /no-access; con varias y sin una elección válida →
 * /select-organization.
 */
export const requireTenant = cache(async (): Promise<TenantContext> => {
  const user = await requireUser();
  const memberships = await getActiveMemberships();
  const preferred = await readActiveOrganization();

  const resolution = resolveTenant(user, memberships, preferred);
  if (resolution.kind === "no-access") redirect(NO_ACCESS_PATH);
  if (resolution.kind === "select-organization") {
    redirect(SELECT_ORGANIZATION_PATH);
  }
  return resolution.context;
});

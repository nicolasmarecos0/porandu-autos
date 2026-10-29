import "server-only";

import { redirect } from "next/navigation";
import { cache } from "react";

import {
  listActiveMemberships,
  type ActiveMembership,
} from "@/db/queries/memberships";
import { LOGIN_PATH } from "@/lib/auth/paths";
import { getAuthenticatedUser, requireUser } from "@/lib/auth/session";

import { readActiveOrganization } from "./cookie";
import { NO_ACCESS_PATH, SELECT_ORGANIZATION_PATH } from "./paths";
import {
  resolveTenant,
  type TenantContext,
  type TenantResolution,
} from "./resolution";

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
 *
 * Un Route Handler tenant-scoped (Hito 8, DEC-040 §3) responde JSON, no
 * redirige: usa resolveRequestTenant(), la misma resolución sin redirects.
 * requireTenant() es ese mismo resultado con sus redirects.
 */

/** Resolución de la request; sin usuario verificado, `unauthenticated`. */
export type RequestTenant =
  TenantResolution | Readonly<{ kind: "unauthenticated" }>;

/** Memberships activas del usuario verificado (una lectura por request). */
export const getActiveMemberships = cache(
  async (): Promise<readonly ActiveMembership[]> => {
    const user = await requireUser();
    return listActiveMemberships(user);
  },
);

/**
 * Tenant de la request, sin redirects: el usuario verificado, sus
 * memberships activas leídas en esta request y la organización preferida
 * (la cookie, solo un hint). Sin usuario no consulta memberships.
 */
export const resolveRequestTenant = cache(async (): Promise<RequestTenant> => {
  const user = await getAuthenticatedUser();
  if (!user) return { kind: "unauthenticated" };
  const memberships = await listActiveMemberships(user);
  const preferred = await readActiveOrganization();
  return resolveTenant(user, memberships, preferred);
});

/**
 * TenantContext de la request. Sin usuario → /login; sin memberships
 * activas → /no-access; con varias y sin una elección válida →
 * /select-organization.
 */
export const requireTenant = cache(async (): Promise<TenantContext> => {
  const resolution = await resolveRequestTenant();
  if (resolution.kind === "unauthenticated") redirect(LOGIN_PATH);
  if (resolution.kind === "no-access") redirect(NO_ACCESS_PATH);
  if (resolution.kind === "select-organization") {
    redirect(SELECT_ORGANIZATION_PATH);
  }
  return resolution.context;
});

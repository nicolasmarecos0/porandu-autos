import { sql } from "drizzle-orm";

/*
 * Patrón de policy de referencia para H0 (ADR-001 §4):
 * `organization_id IN (SELECT private.user_org_ids())`.
 *
 * `private.user_org_ids()` devuelve las organizaciones con membership activa
 * del usuario de la request (`auth.uid()`). Es SECURITY DEFINER y vive en la
 * migración 0001_tenant_isolation: drizzle-kit no modela funciones.
 */
export const userOrgIds = sql`(SELECT private.user_org_ids())`;

/*
 * Organizaciones donde el usuario de la request es `admin` con membership
 * activa (Hito 6, DEC-038 §4). Mismo patrón que `private.user_org_ids()`:
 * SECURITY DEFINER, STABLE y en `private`, en la migración
 * 0012_team_settings. Las policies de escritura de `organizations` y
 * `memberships` la usan en USING y WITH CHECK.
 */
export const userAdminOrgIds = sql`(SELECT private.user_admin_org_ids())`;

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

/*
 * Schema de Drizzle: punto de entrada único para drizzle-kit y para el
 * cliente de runtime. Los imports entre archivos del schema son relativos
 * porque drizzle-kit los carga fuera de Next, sin el alias `@/`.
 *
 * Toda tabla de `public` nace con RLS habilitado (ADR-001 §3.5). Las
 * policies se declaran junto a cada tabla (drizzle-kit las genera); el rol
 * app_runtime, `private.user_org_ids()` y los grants de `authenticated` son
 * SQL custom de 0001_tenant_isolation.
 */
export * from "./organizations";
export * from "./profiles";
export * from "./memberships";

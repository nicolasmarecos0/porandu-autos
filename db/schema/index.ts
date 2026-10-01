/*
 * Schema de Drizzle: punto de entrada único para drizzle-kit y para el
 * cliente de runtime. Los imports entre archivos del schema son relativos
 * porque drizzle-kit los carga fuera de Next, sin el alias `@/`.
 *
 * Toda tabla de `public` nace con RLS habilitado (ADR-001 §3.5). Las
 * policies se declaran junto a cada tabla (drizzle-kit las genera); el rol
 * app_runtime y `private.user_org_ids()` son SQL custom de
 * 0001_tenant_isolation, y los grants de `authenticated`, SQL custom de la
 * migración que crea cada tabla (0001 para las de H0, 0002 para contacts y
 * opportunities) o que habilita una escritura (0003: alta de contacts y
 * opportunities).
 */
export * from "./organizations";
export * from "./profiles";
export * from "./memberships";
export * from "./contacts";
export * from "./opportunities";

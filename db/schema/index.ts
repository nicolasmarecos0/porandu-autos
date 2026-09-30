/*
 * Schema de Drizzle: punto de entrada único para drizzle-kit y para el
 * cliente de runtime. Los imports entre archivos del schema son relativos
 * porque drizzle-kit los carga fuera de Next, sin el alias `@/`.
 *
 * Toda tabla de `public` nace con RLS habilitado (ADR-001 §3.5). Las
 * policies y los grants para `authenticated` llegan con tenant isolation
 * (H0.5); hasta entonces el acceso de `anon` y `authenticated` falla cerrado.
 */
export * from "./organizations";
export * from "./profiles";
export * from "./memberships";

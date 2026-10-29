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
 * opportunities, 0004 para vehicles, 0007 para opportunity_demand_facts,
 * 0009 para opportunity_notes, 0011 para messages) o que habilita una
 * escritura (0003: alta de contacts y opportunities; 0005: alta de
 * vehicles; 0006: UPDATE de vehicles.status, por columna; 0007: alta
 * append-only de opportunity_demand_facts; 0008: UPDATE de la etapa de
 * opportunities, por columna; 0009: UPDATE de opportunities.vehicle_id, por
 * columna, y alta append-only de opportunity_notes; 0010: UPDATE de los
 * metadatos del cierre de opportunities, por columna; 0011: alta
 * append-only de messages; 0012: UPDATE de organizations y alta y UPDATE
 * de memberships, solo para admin, por columna salvo el alta; 0013: lectura
 * de conversations, y whatsapp_lines sin grants; 0014: lectura de
 * whatsapp_lines). Los triggers y sus funciones (0008 a 0012), las
 * funciones de equipo de 0012, la función de ingesta de 0013 y la de envío
 * de 0014 son SQL custom: drizzle-kit no los modela.
 */
export * from "./organizations";
export * from "./profiles";
export * from "./memberships";
export * from "./contacts";
export * from "./opportunities";
export * from "./vehicles";
export * from "./opportunity-demand-facts";
export * from "./opportunity-notes";
export * from "./messages";
export * from "./whatsapp-lines";
export * from "./conversations";

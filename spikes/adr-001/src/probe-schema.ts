import { pgTable, text, uuid } from "drizzle-orm/pg-core";

/*
 * Tabla `tenant_probe`: existe solo en las bases de test del spike. La crea el
 * harness (test/support/global-setup.ts) con la credencial de migración, NO
 * drizzle-kit. Sigue el patrón previsto para las tablas tenant de Hito 1
 * (RLS FOR ALL sobre private.user_org_ids(), grants CRUD explícitos a
 * authenticated) y permite probar escrituras propias y cruzadas en H0, donde
 * ninguna tabla real admite escrituras.
 */
export const tenantProbe = pgTable("tenant_probe", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  label: text("label").notNull(),
});

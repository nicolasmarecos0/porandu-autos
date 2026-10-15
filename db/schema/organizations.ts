import { sql } from "drizzle-orm";
import { check, pgPolicy, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { authenticatedRole } from "drizzle-orm/supabase";

import { oneOf } from "./checks";
import { timestamps } from "./columns";
import { userAdminOrgIds, userOrgIds } from "./policies";

/*
 * Moneda por defecto del concesionario (Hito 6, DEC-038 §2): las monedas
 * vigentes de P1 (DEC-025 §6). CHECK reemplazable, no enum.
 */
export const organizationCurrencies = ["PYG", "USD"] as const;

/*
 * Raíz del tenant (ADR-001 §3.6). No lleva `organization_id`: toda tabla
 * tenant-scoped apunta a esta con FK.
 *
 * - `name`: nombre visible del concesionario. De 1 a 120 caracteres,
 *   recortado y sin caracteres de control (DEC-038 §2).
 * - `default_currency`: preferencia de moneda (DEC-038 §2), `PYG` por
 *   defecto.
 *
 * Lectura: las organizaciones donde el usuario tiene membership activa.
 * Edición (Hito 6, DEC-038 §4): solo un `admin` activo, y solo `name`,
 * `default_currency` y `updated_at` (grant por columna, 0012). La policy de
 * UPDATE exige la organización entre las del usuario como `admin`, antes y
 * después. `updated_at` lo fija la base (trigger de 0012). Sin INSERT ni
 * DELETE: el alta de organizaciones es provisioning (fuera del Hito 6).
 */
export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    defaultCurrency: text("default_currency").notNull().default("PYG"),
    ...timestamps,
  },
  (t) => [
    check(
      "organizations_name_check",
      sql`char_length(${t.name}) BETWEEN 1 AND 120 AND ${t.name} = btrim(${t.name}) AND ${t.name} !~ '[[:cntrl:]]'`,
    ),
    check(
      "organizations_default_currency_check",
      oneOf(t.defaultCurrency, organizationCurrencies),
    ),
    pgPolicy("organizations_select_member", {
      for: "select",
      to: authenticatedRole,
      using: sql`${t.id} IN ${userOrgIds}`,
    }),
    pgPolicy("organizations_update_admin", {
      for: "update",
      to: authenticatedRole,
      using: sql`${t.id} IN ${userAdminOrgIds}`,
      withCheck: sql`${t.id} IN ${userAdminOrgIds}`,
    }),
  ],
).enableRLS();

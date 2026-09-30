import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  pgEnum,
  pgPolicy,
  pgTable,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { authenticatedRole } from "drizzle-orm/supabase";

import { timestamps } from "./columns";
import { organizations } from "./organizations";
import { userOrgIds } from "./policies";
import { profiles } from "./profiles";

/*
 * Roles de B1: `admin` y `seller` (Build Baseline §3.1 "admin | vendedor",
 * con el identificador en inglés según DEC-011).
 */
export const membershipRole = pgEnum("membership_role", ["admin", "seller"]);

/*
 * Relación usuario ↔ organización. Es tenant-scoped (ADR-001 §3.6):
 * `organization_id` NOT NULL, con FK a `organizations` e índice que empieza
 * por `organization_id` (el de la unique).
 *
 * - `user_id` es el id de `auth.users` (el que devuelve `auth.uid()`), vía
 *   `profiles`: un usuario necesita perfil para tener membership.
 * - `active`: solo una membership activa da acceso (ADR-001 §4). Revocar es
 *   pasar a `false`.
 * - Borrar una organización con memberships se rechaza (RESTRICT). Borrar un
 *   usuario de `auth.users` borra su perfil y sus memberships (CASCADE).
 *
 * Lectura: las memberships de las organizaciones donde el usuario tiene
 * membership activa. Sin policies de escritura (default deny).
 */
export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    role: membershipRole("role").notNull(),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (t) => [
    unique("memberships_organization_id_user_id_key").on(
      t.organizationId,
      t.userId,
    ),
    // Memberships de un usuario (resolución del tenant y
    // private.user_org_ids()).
    index("memberships_user_id_idx").on(t.userId),
    pgPolicy("memberships_select_member", {
      for: "select",
      to: authenticatedRole,
      using: sql`${t.organizationId} IN ${userOrgIds}`,
    }),
  ],
).enableRLS();

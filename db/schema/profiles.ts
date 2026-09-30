import { sql } from "drizzle-orm";
import { pgPolicy, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { authenticatedRole, authUid, authUsers } from "drizzle-orm/supabase";

import { timestamps } from "./columns";

/*
 * Identidad de aplicación del usuario, 1:1 con `auth.users` (Supabase Auth):
 * el PK es el mismo id que devuelve `auth.uid()`. Pertenece al usuario, no a
 * una organización, así que no lleva `organization_id` (ADR-001 §3.6).
 * El email vive en `auth.users` y no se duplica. `full_name` es opcional:
 * un dato de presentación no impide crear el perfil.
 *
 * Lectura: solo el perfil propio. Compartir organización no expone el
 * perfil de otro usuario. Sin policies de escritura (default deny).
 */
export const profiles = pgTable(
  "profiles",
  {
    id: uuid("id")
      .primaryKey()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    fullName: text("full_name"),
    ...timestamps,
  },
  (t) => [
    pgPolicy("profiles_select_own", {
      for: "select",
      to: authenticatedRole,
      using: sql`${t.id} = ${authUid}`,
    }),
  ],
).enableRLS();

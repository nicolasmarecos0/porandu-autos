import { pgTable, text, uuid } from "drizzle-orm/pg-core";
import { authUsers } from "drizzle-orm/supabase";

import { timestamps } from "./columns";

/*
 * Identidad de aplicación del usuario, 1:1 con `auth.users` (Supabase Auth):
 * el PK es el mismo id que devuelve `auth.uid()`. Pertenece al usuario, no a
 * una organización, así que no lleva `organization_id` (ADR-001 §3.6).
 * El email vive en `auth.users` y no se duplica.
 */
export const profiles = pgTable("profiles", {
  id: uuid("id")
    .primaryKey()
    .references(() => authUsers.id, { onDelete: "cascade" }),
  fullName: text("full_name").notNull(),
  ...timestamps,
}).enableRLS();

import { sql } from "drizzle-orm";
import { pgPolicy, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { authenticatedRole } from "drizzle-orm/supabase";

import { timestamps } from "./columns";
import { organizations } from "./organizations";
import { userOrgIds } from "./policies";

/*
 * Persona (o empresa) con la que trata una organización (TB §10, "contacts"):
 * lo mínimo que muestra la identidad del prospecto en Opportunities (H1.1).
 * Es tenant-scoped (ADR-001 §3.6): `organization_id` NOT NULL, con FK a
 * `organizations` e índice que empieza por `organization_id` (el de la
 * unique).
 *
 * - `name`: nombre visible; las iniciales del avatar se derivan de él.
 * - `phone`: tal como se capturó. La UI solo lo muestra enmascarado. La
 *   normalización (E.164) y la unicidad por organización (TB §10) llegan con
 *   el alta de contactos.
 * - `city`: opcional.
 * - unique (organization_id, id): destino de la FK compuesta de
 *   `opportunities`, que impide apuntar a un contacto de otra organización.
 * - Borrar una organización con contactos se rechaza (RESTRICT).
 *
 * Lectura: los contactos de las organizaciones donde el usuario tiene
 * membership activa. Sin policies de escritura (default deny).
 */
export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    phone: text("phone"),
    city: text("city"),
    ...timestamps,
  },
  (t) => [
    unique("contacts_organization_id_id_key").on(t.organizationId, t.id),
    pgPolicy("contacts_select_member", {
      for: "select",
      to: authenticatedRole,
      using: sql`${t.organizationId} IN ${userOrgIds}`,
    }),
  ],
).enableRLS();

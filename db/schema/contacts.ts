import { sql } from "drizzle-orm";
import {
  check,
  pgPolicy,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
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
 * - `phone`: tal como se capturó. La UI solo lo muestra enmascarado.
 * - `phone_normalized` (H1.2): el mismo teléfono en E.164, la identidad del
 *   contacto dentro de la organización (MC §32, TB §10). Lo calcula el código
 *   (lib/contacts/phone.ts); la base solo exige la forma E.164 y que exista
 *   el teléfono original. Opcional: contactos importados o históricos pueden
 *   no tener un teléfono normalizable, y los de H1.1 no se backfillean.
 * - unique parcial (organization_id, phone_normalized): un teléfono es un
 *   solo contacto por organización (no globalmente). Es la autoridad final de
 *   la deduplicación, también ante altas concurrentes.
 * - `city`: opcional.
 * - unique (organization_id, id): destino de la FK compuesta de
 *   `opportunities`, que impide apuntar a un contacto de otra organización.
 * - Borrar una organización con contactos se rechaza (RESTRICT).
 *
 * Lectura y alta (H1.2): los contactos de las organizaciones donde el
 * usuario tiene membership activa. Sin UPDATE ni DELETE (default deny).
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
    phoneNormalized: text("phone_normalized"),
    city: text("city"),
    ...timestamps,
  },
  (t) => [
    unique("contacts_organization_id_id_key").on(t.organizationId, t.id),
    uniqueIndex("contacts_organization_id_phone_normalized_key")
      .on(t.organizationId, t.phoneNormalized)
      .where(sql`${t.phoneNormalized} IS NOT NULL`),
    // E.164: `+`, código de país sin 0 inicial y hasta 15 dígitos.
    check(
      "contacts_phone_normalized_check",
      sql`${t.phoneNormalized} IS NULL OR (${t.phone} IS NOT NULL AND ${t.phoneNormalized} ~ '^\\+[1-9][0-9]{1,14}$')`,
    ),
    pgPolicy("contacts_select_member", {
      for: "select",
      to: authenticatedRole,
      using: sql`${t.organizationId} IN ${userOrgIds}`,
    }),
    pgPolicy("contacts_insert_member", {
      for: "insert",
      to: authenticatedRole,
      withCheck: sql`${t.organizationId} IN ${userOrgIds}`,
    }),
  ],
).enableRLS();

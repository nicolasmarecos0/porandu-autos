import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { timestamps } from "./columns";
import { organizations } from "./organizations";

/*
 * Líneas de WhatsApp de cada organización (Hito 7, DEC-039 §5): el
 * `phone_number_id` de la Cloud API con el que llega cada webhook es lo único
 * que determina el tenant de un mensaje entrante. Es tenant-scoped (ADR-001
 * §3.6): `organization_id` NOT NULL, FK simple a `organizations` e índice
 * que empieza por `organization_id`.
 *
 * - `phone_number_id`: el identificador de la línea en el proveedor, solo
 *   dígitos. Único global: una línea pertenece a una sola organización.
 * - `active`: una línea inactiva no recibe nada (`unknown_line`, sin
 *   escribir), como una membership revocada.
 * - Borrar una organización con líneas se rechaza (RESTRICT).
 *
 * Las da de alta el provisioning con el rol dueño, como las cuentas
 * (DEC-038 §3). RLS habilitado y sin policies ni grants para
 * `authenticated` (default deny): ningún miembro las lee ni las escribe. La
 * función de ingesta (SECURITY DEFINER, 0013) las lee como dueña.
 */
export const whatsappLines = pgTable(
  "whatsapp_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    phoneNumberId: text("phone_number_id").notNull(),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (t) => [
    unique("whatsapp_lines_phone_number_id_key").on(t.phoneNumberId),
    index("whatsapp_lines_organization_id_idx").on(t.organizationId),
    check(
      "whatsapp_lines_phone_number_id_check",
      sql`${t.phoneNumberId} ~ '^[0-9]{1,32}$'`,
    ),
  ],
).enableRLS();

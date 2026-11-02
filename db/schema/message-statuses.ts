import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  pgPolicy,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { authenticatedRole } from "drizzle-orm/supabase";

import { oneOf } from "./checks";
import { messages } from "./messages";
import { organizations } from "./organizations";
import { userOrgIds } from "./policies";

/*
 * Estados de entrega que se registran (Hito 12C, DEC-044 §3.1). No son un
 * enum de Postgres: un CHECK que una migración puede reemplazar. Espejan
 * DELIVERY_STATUSES de domains/conversations/delivery.ts (un test vigila que
 * coincidan).
 */
export const messageStatusValues = [
  "sent",
  "delivered",
  "read",
  "failed",
] as const;

/*
 * Estados de entrega de los mensajes enviados (Hito 12C, DEC-044 §3): lo que
 * WhatsApp informa de un saliente después de aceptarlo. Es el "visto" del
 * cliente, no el leído interno del equipo (conversation_reads). Append-only:
 * cada estado recibido es una fila inmutable, y el mensaje no cambia (C-11):
 * el estado no es una columna de `messages`. Es tenant-scoped (ADR-001
 * §3.6): `organization_id` NOT NULL, FK simple a `organizations` y la PK,
 * que empieza por `organization_id`, como índice.
 *
 * - PK (organization_id, message_id, status): un estado por mensaje, una
 *   sola fila. Es la autoridad de la idempotencia ante los reintentos y las
 *   entregas simultáneas del proveedor (el segundo es `duplicate`).
 * - `message_id`: el saliente. FK compuesta (organization_id, message_id) →
 *   messages (organization_id, id), RESTRICT: de la misma organización.
 * - `status`: `sent`, `delivered`, `read` o `failed` (CHECK). El vigente no
 *   es el último que llegó: es el de mayor precedencia entre los recibidos
 *   (`sent` < `failed` < `delivered` < `read`), en
 *   domains/conversations/delivery.ts. Un `failed` nunca pisa un
 *   `delivered` ni un `read`.
 * - `occurred_at`: cuándo ocurrió, según el proveedor (su `timestamp`).
 * - `created_at`: reloj de la base, cuándo lo registró Porandú.
 *
 * Lectura: los estados de las organizaciones con membership activa, como los
 * mensajes. Sin INSERT, UPDATE ni DELETE para `authenticated`: solo la
 * escribe `private.ingest_whatsapp_status()` (SECURITY DEFINER, 0019), la
 * ingesta del webhook sin usuario (DEC-039 §4). Sin UPDATE, DELETE ni
 * TRUNCATE tampoco para service_role (C-11).
 */
export const messageStatuses = pgTable(
  "message_statuses",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    messageId: uuid("message_id").notNull(),
    status: text("status", { enum: messageStatusValues }).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({
      name: "message_statuses_pkey",
      columns: [t.organizationId, t.messageId, t.status],
    }),
    // El mensaje es de la misma organización.
    foreignKey({
      name: "message_statuses_message_fk",
      columns: [t.organizationId, t.messageId],
      foreignColumns: [messages.organizationId, messages.id],
    }).onDelete("restrict"),
    check(
      "message_statuses_status_check",
      oneOf(t.status, messageStatusValues),
    ),
    pgPolicy("message_statuses_select_member", {
      for: "select",
      to: authenticatedRole,
      using: sql`${t.organizationId} IN ${userOrgIds}`,
    }),
  ],
).enableRLS();

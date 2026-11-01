import { sql } from "drizzle-orm";
import {
  foreignKey,
  pgPolicy,
  pgTable,
  primaryKey,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { authenticatedRole, authUid } from "drizzle-orm/supabase";

import { conversations } from "./conversations";
import { organizations } from "./organizations";
import { userOrgIds } from "./policies";
import { profiles } from "./profiles";

/*
 * Hasta dónde leyó cada miembro cada conversación (Hito 12B, DEC-044 §2). Es
 * el leído interno del equipo: no es el "visto" de WhatsApp y no se le
 * informa al cliente (DEC-044 §3.4). Es tenant-scoped (ADR-001 §3.6):
 * `organization_id` NOT NULL, FK simple a `organizations` y la PK, que
 * empieza por `organization_id`, como índice.
 *
 * - PK (organization_id, conversation_id, user_id): un cursor por miembro y
 *   conversación. No hay responsable asignado (DEC-023): que un vendedor lea
 *   no marca leído para otro.
 * - `conversation_id`: FK compuesta (organization_id, conversation_id) →
 *   conversations (organization_id, id), RESTRICT: de la misma
 *   organización.
 * - `user_id`: el miembro (`auth.uid()`). FK a `profiles` con CASCADE, como
 *   memberships (DEC-018): el cursor es estado del miembro, no un registro
 *   de auditoría, y se va con su perfil.
 * - `read_up_to`: el `created_at` (reloj de la base) del mensaje más nuevo
 *   que el miembro tenía en pantalla al marcar visto. Nunca `now()`,
 *   `sent_at` ni un reloj del cliente. Solo avanza (`GREATEST`).
 * - `updated_at`: cuándo avanzó por última vez.
 *
 * Lectura: solo las filas propias (`user_id = auth.uid()`) de las
 * organizaciones con membership activa. Sin INSERT, UPDATE ni DELETE para
 * `authenticated`: solo la escribe `private.mark_conversation_read()`
 * (SECURITY DEFINER, 0018), que exige usuario, membership activa, la
 * conversación abierta y un mensaje de ella.
 */
export const conversationReads = pgTable(
  "conversation_reads",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    conversationId: uuid("conversation_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    readUpTo: timestamp("read_up_to", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({
      name: "conversation_reads_pkey",
      columns: [t.organizationId, t.conversationId, t.userId],
    }),
    // La conversación es de la misma organización.
    foreignKey({
      name: "conversation_reads_conversation_fk",
      columns: [t.organizationId, t.conversationId],
      foreignColumns: [conversations.organizationId, conversations.id],
    }).onDelete("restrict"),
    pgPolicy("conversation_reads_select_own", {
      for: "select",
      to: authenticatedRole,
      using: sql`${t.organizationId} IN ${userOrgIds} AND ${t.userId} = ${authUid}`,
    }),
  ],
).enableRLS();

import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { authenticatedRole } from "drizzle-orm/supabase";

import { oneOf } from "./checks";
import { timestamps } from "./columns";
import { contacts } from "./contacts";
import { organizations } from "./organizations";
import { userOrgIds } from "./policies";

/*
 * Canales y estados de una conversación (Hito 7, DEC-039 §6). No son enums de
 * Postgres: CHECKs que una migración puede reemplazar. Espejan
 * CONVERSATION_CHANNELS y CONVERSATION_STATUSES de
 * domains/conversations/conversations.ts (un test vigila que coincidan).
 */
export const conversationChannels = ["whatsapp"] as const;

export const conversationStatuses = ["open", "closed"] as const;

/**
 * Largo máximo del preview del último mensaje, en caracteres. Espeja
 * MESSAGE_PREVIEW_MAX_LENGTH de domains/conversations/conversations.ts.
 */
export const conversationPreviewMaxLength = 160;

/*
 * Conversación con un contacto por un canal (Hito 7, DEC-039 §6): agrupa los
 * mensajes ingeridos y guarda el último para ordenar la bandeja. Es
 * tenant-scoped (ADR-001 §3.6): `organization_id` NOT NULL, FK simple a
 * `organizations` e índices que empiezan por `organization_id`.
 *
 * - `contact_id`: FK compuesta (organization_id, contact_id) → contacts: de
 *   la misma organización.
 * - `channel`: `whatsapp`, la única fuente que la crea hoy.
 * - `status`: `open` (activa) o `closed`. La unique parcial
 *   (organization_id, contact_id, channel) WHERE status = 'open' deja una
 *   sola activa por contacto y canal, y es la autoridad ante dos mensajes
 *   simultáneos del mismo número. Ningún flujo la cierra todavía.
 * - `last_message_at` y `last_message_preview`: cuándo envió el cliente el
 *   último mensaje (`sent_at`) y su texto en una línea (1 a 160 caracteres,
 *   recortado, sin caracteres de control). Juntos o ninguno.
 * - unique (organization_id, id, contact_id): destino de la FK compuesta de
 *   `messages`, que impide asociar un mensaje a la conversación de otro
 *   contacto o de otra organización.
 * - Todas las FKs son RESTRICT.
 *
 * Lectura: las conversaciones de las organizaciones con membership activa.
 * Sin INSERT, UPDATE ni DELETE para `authenticated`: solo la escribe
 * `private.ingest_whatsapp_message()` (SECURITY DEFINER, 0013).
 */
export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    contactId: uuid("contact_id").notNull(),
    channel: text("channel", { enum: conversationChannels }).notNull(),
    status: text("status", { enum: conversationStatuses })
      .notNull()
      .default("open"),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    lastMessagePreview: text("last_message_preview"),
    ...timestamps,
  },
  (t) => [
    unique("conversations_organization_id_id_contact_id_key").on(
      t.organizationId,
      t.id,
      t.contactId,
    ),
    uniqueIndex("conversations_open_contact_channel_key")
      .on(t.organizationId, t.contactId, t.channel)
      .where(sql`${t.status} = 'open'`),
    foreignKey({
      name: "conversations_contact_fk",
      columns: [t.organizationId, t.contactId],
      foreignColumns: [contacts.organizationId, contacts.id],
    }).onDelete("restrict"),
    check(
      "conversations_channel_check",
      oneOf(t.channel, conversationChannels),
    ),
    check("conversations_status_check", oneOf(t.status, conversationStatuses)),
    check(
      "conversations_last_message_check",
      sql`(${t.lastMessageAt} IS NULL) = (${t.lastMessagePreview} IS NULL)`,
    ),
    check(
      "conversations_last_message_preview_check",
      sql`char_length(${t.lastMessagePreview}) BETWEEN 1 AND ${sql.raw(String(conversationPreviewMaxLength))} AND ${t.lastMessagePreview} = btrim(${t.lastMessagePreview}) AND ${t.lastMessagePreview} !~ '[[:cntrl:]]'`,
    ),
    pgPolicy("conversations_select_member", {
      for: "select",
      to: authenticatedRole,
      using: sql`${t.organizationId} IN ${userOrgIds}`,
    }),
  ],
).enableRLS();

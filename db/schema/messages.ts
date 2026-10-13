import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { authenticatedRole, authUid } from "drizzle-orm/supabase";

import { oneOf } from "./checks";
import { contacts } from "./contacts";
import { opportunities } from "./opportunities";
import { organizations } from "./organizations";
import { userOrgIds } from "./policies";
import { profiles } from "./profiles";

/*
 * Canales y direcciones de un mensaje (Hito 4, DEC-036 §4). No son enums de
 * Postgres: un CHECK que una migración puede reemplazar. Espejan
 * MESSAGE_CHANNELS y MESSAGE_DIRECTIONS de domains/conversations/messages.ts
 * (un test vigila que coincidan).
 */
export const messageChannels = ["whatsapp", "email", "manual"] as const;

export const messageDirections = ["inbound", "outbound"] as const;

/**
 * Largo máximo del texto, en caracteres (`char_length`). Espeja
 * MESSAGE_MAX_LENGTH de domains/conversations/messages.ts.
 */
export const messageMaxLength = 4096;

/*
 * Mensajes de una conversación con el cliente (Hito 4, DEC-036 §4): una fila
 * inmutable por mensaje recibido o enviado, tal como lo registra un miembro.
 * Append-only, como la demanda y la bitácora: nada se edita ni se borra. Es
 * tenant-scoped (ADR-001 §3.6): `organization_id` (el tenant) NOT NULL, FK
 * simple a `organizations` e índices que empiezan por `organization_id`.
 *
 * - `contact_id`: con quién es el mensaje. FK compuesta
 *   (organization_id, contact_id) → contacts: de la misma organización.
 * - `opportunity_id` (opcional): el negocio al que se asocia. FK compuesta
 *   (organization_id, opportunity_id, contact_id) → opportunities: la
 *   oportunidad es de la misma organización y su contacto es el del
 *   mensaje. Sin oportunidad, MATCH SIMPLE no la exige.
 * - `channel` y `direction`: obligatorios, de las listas cerradas (CHECK).
 *   `whatsapp` dice por dónde ocurrió, no que haya una integración.
 * - `content`: el texto, ya normalizado por el servidor como una nota. El
 *   CHECK exige lo esencial: de 1 a 4096 caracteres, sin espacios ni saltos
 *   de línea en los bordes y sin caracteres de control salvo el salto de
 *   línea.
 * - `recorded_by`: el miembro que lo registró. FK a `profiles` con RESTRICT
 *   (como C-9 de la demanda).
 * - `created_at`: reloj de la base (`defaultNow()`); la policy de INSERT
 *   exige `created_at = now()`.
 * - Índices (organization_id, opportunity_id, created_at DESC) para el muro
 *   de una oportunidad y (organization_id, contact_id, created_at DESC) para
 *   la FK y la conversación de un contacto.
 * - Todas las FKs son RESTRICT.
 *
 * Insertar un mensaje con oportunidad mueve su `last_activity_at`: lo hace
 * el trigger `messages_touch_activity` de la migración 0011 (drizzle-kit no
 * modela triggers).
 *
 * Lectura: los mensajes de las organizaciones con membership activa. Alta:
 * un miembro activo, como autor de la request y con el reloj de la base. Sin
 * policies ni grants de UPDATE o DELETE: append-only (también para
 * service_role, como C-11; el owner `postgres` es la limitación documentada).
 */
export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    contactId: uuid("contact_id").notNull(),
    opportunityId: uuid("opportunity_id"),
    channel: text("channel", { enum: messageChannels }).notNull(),
    direction: text("direction", { enum: messageDirections }).notNull(),
    content: text("content").notNull(),
    recordedBy: uuid("recorded_by")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "messages_contact_fk",
      columns: [t.organizationId, t.contactId],
      foreignColumns: [contacts.organizationId, contacts.id],
    }).onDelete("restrict"),
    // La oportunidad es de la misma organización y del mismo contacto.
    foreignKey({
      name: "messages_opportunity_fk",
      columns: [t.organizationId, t.opportunityId, t.contactId],
      foreignColumns: [
        opportunities.organizationId,
        opportunities.id,
        opportunities.contactId,
      ],
    }).onDelete("restrict"),
    index("messages_organization_id_opportunity_id_idx").on(
      t.organizationId,
      t.opportunityId,
      t.createdAt.desc().nullsFirst(),
    ),
    index("messages_organization_id_contact_id_idx").on(
      t.organizationId,
      t.contactId,
      t.createdAt.desc().nullsFirst(),
    ),
    check("messages_channel_check", oneOf(t.channel, messageChannels)),
    check("messages_direction_check", oneOf(t.direction, messageDirections)),
    // Como opportunity_notes.body: recortado (espacios y saltos de línea) y
    // sin caracteres de control salvo el salto de línea (chr(10)).
    check(
      "messages_content_check",
      sql`char_length(${t.content}) BETWEEN 1 AND ${sql.raw(String(messageMaxLength))} AND ${t.content} = btrim(${t.content}, ' ' || chr(10)) AND translate(${t.content}, chr(10), '') !~ '[[:cntrl:]]'`,
    ),
    pgPolicy("messages_select_member", {
      for: "select",
      to: authenticatedRole,
      using: sql`${t.organizationId} IN ${userOrgIds}`,
    }),
    // Alta: un miembro activo de la organización, como autor de la request
    // y con el reloj de la base.
    pgPolicy("messages_insert_member", {
      for: "insert",
      to: authenticatedRole,
      withCheck: sql`${t.organizationId} IN ${userOrgIds} AND ${t.recordedBy} = ${authUid} AND ${t.createdAt} = now()`,
    }),
  ],
).enableRLS();

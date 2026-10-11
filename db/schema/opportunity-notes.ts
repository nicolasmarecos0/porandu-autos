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

import { opportunities } from "./opportunities";
import { organizations } from "./organizations";
import { userOrgIds } from "./policies";
import { profiles } from "./profiles";

/**
 * Largo máximo de una nota, en caracteres (`char_length`). Espeja
 * NOTE_MAX_LENGTH de domains/opportunities/notes.ts (un test vigila que
 * coincidan).
 */
export const opportunityNoteMaxLength = 1000;

/*
 * Bitácora comercial de una oportunidad (Hito 2, DEC-033 §1): una fila
 * inmutable por nota del vendedor. Append-only, como el ledger de demanda
 * (DEC-030): nada se edita ni se borra. Es tenant-scoped (ADR-001 §3.6):
 * `organization_id` NOT NULL, FK simple a `organizations` e índice que
 * empieza por `organization_id`.
 *
 * - `opportunity_id`: FK compuesta (organization_id, opportunity_id) →
 *   opportunities: la oportunidad es de la misma organización.
 * - `body`: el texto, ya normalizado por el servidor
 *   (domains/opportunities/notes.ts). El CHECK exige lo esencial: de 1 a
 *   1000 caracteres, sin espacios ni saltos de línea en los bordes y sin
 *   caracteres de control salvo el salto de línea.
 * - `recorded_by`: el miembro que escribió la nota. FK a `profiles` con
 *   RESTRICT (como C-9 de la demanda): dar de baja un usuario es
 *   `memberships.active = false`.
 * - `recorded_at`: reloj de la base (`defaultNow()`); la policy de INSERT
 *   exige `recorded_at = now()`.
 * - Índice (organization_id, opportunity_id, recorded_at DESC): la bitácora
 *   de una oportunidad, de la nota más reciente a la más vieja.
 * - Todas las FKs son RESTRICT.
 *
 * Lectura: las notas de las organizaciones con membership activa. Alta: un
 * miembro activo, como autor de la request y con el reloj de la base. Sin
 * policies ni grants de UPDATE o DELETE: append-only (también para
 * service_role, como C-11; el owner `postgres` es la limitación documentada).
 */
export const opportunityNotes = pgTable(
  "opportunity_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    opportunityId: uuid("opportunity_id").notNull(),
    body: text("body").notNull(),
    recordedBy: uuid("recorded_by")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "opportunity_notes_opportunity_fk",
      columns: [t.organizationId, t.opportunityId],
      foreignColumns: [opportunities.organizationId, opportunities.id],
    }).onDelete("restrict"),
    index("opportunity_notes_organization_id_opportunity_id_idx").on(
      t.organizationId,
      t.opportunityId,
      t.recordedAt.desc().nullsFirst(),
    ),
    // Recortado (espacios y saltos de línea) y sin caracteres de control
    // salvo el salto de línea (chr(10)).
    check(
      "opportunity_notes_body_check",
      sql`char_length(${t.body}) BETWEEN 1 AND ${sql.raw(String(opportunityNoteMaxLength))} AND ${t.body} = btrim(${t.body}, ' ' || chr(10)) AND translate(${t.body}, chr(10), '') !~ '[[:cntrl:]]'`,
    ),
    pgPolicy("opportunity_notes_select_member", {
      for: "select",
      to: authenticatedRole,
      using: sql`${t.organizationId} IN ${userOrgIds}`,
    }),
    // Alta: un miembro activo de la organización, como autor de la request
    // y con el reloj de la base.
    pgPolicy("opportunity_notes_insert_member", {
      for: "insert",
      to: authenticatedRole,
      withCheck: sql`${t.organizationId} IN ${userOrgIds} AND ${t.recordedBy} = ${authUid} AND ${t.recordedAt} = now()`,
    }),
  ],
).enableRLS();

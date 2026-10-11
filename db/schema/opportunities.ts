import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { authenticatedRole } from "drizzle-orm/supabase";

import { oneOf } from "./checks";
import { timestamps } from "./columns";
import { contacts } from "./contacts";
import { organizations } from "./organizations";
import { userOrgIds } from "./policies";

/*
 * Etapas comerciales de la oportunidad (H1.6, DEC-032 §1): `won` y `lost`
 * son terminales. No es un enum de Postgres: se valida con un CHECK que una
 * migración puede reemplazar. El CHECK admite todas las etapas; qué par
 * etapa anterior → etapa nueva es válido lo decide el trigger de
 * `0008_opportunity_stages` (DEC-028 §6), que espeja
 * domains/opportunities/stages.ts.
 */
export const opportunityStages = [
  "new",
  "qualifying",
  "negotiating",
  "won",
  "lost",
] as const;

/*
 * Motivo de pérdida estructurado (DEC-032 §3): obligatorio con `lost`,
 * ausente en cualquier otra etapa.
 */
export const opportunityLossReasons = [
  "price",
  "vehicle_not_available",
  "bought_elsewhere",
  "no_response",
  "unqualified",
  "other",
] as const;

/*
 * Origen de la oportunidad (TB §7 "source / channel"). Mismo criterio: los
 * canales de hoy, con un CHECK reemplazable cuando se sumen otros.
 */
export const opportunitySources = [
  "whatsapp",
  "meta_ads",
  "web",
  "showroom",
  "referral",
] as const;

/*
 * Oportunidad comercial ("leads" en TB §10; Opportunity en la UI, DEC-015):
 * lo mínimo que muestra la cola de Opportunities con datos reales (H1.1).
 * Es tenant-scoped (ADR-001 §3.6): `organization_id` NOT NULL, con FK a
 * `organizations` e índice que empieza por `organization_id`.
 *
 * - `contact_id`: FK compuesta (organization_id, contact_id) → contacts: el
 *   contacto es siempre de la misma organización. RESTRICT: no se borra un
 *   contacto con oportunidades.
 * - `stage` y `source`: obligatorios y sin default, con CHECK.
 * - `loss_reason` (H1.6): el motivo de la pérdida. Existe si y solo si la
 *   etapa es `lost` (CHECK) y es inmutable: de una etapa terminal no se
 *   sale.
 * - `interest_model` / `interest_version`: legado de H1.1/H1.2, congelado y
 *   de solo lectura (DEC-030 §10). La demanda estructurada vive en
 *   `opportunity_demand_facts` (H1.4): estas columnas ya no se escriben, no
 *   se backfillean y solo se muestran mientras `desired_vehicle` nunca se
 *   cargó.
 * - `last_activity_at`: última interacción significativa (recencia, MC §12),
 *   no la última actualización técnica (`updated_at`).
 * - Índice (organization_id, last_activity_at DESC): la cola de una
 *   organización, de la actividad más reciente a la más vieja.
 * - unique (organization_id, id) (H1.4): destino de la FK compuesta de
 *   `opportunity_demand_facts`, que impide apuntar a una oportunidad de otra
 *   organización.
 *
 * No se persisten scores, urgencia, NBA, señales, matches, trade-in ni
 * responsable: no tienen fuente todavía (H1.1).
 *
 * Lectura y alta (H1.2): las oportunidades de las organizaciones donde el
 * usuario tiene membership activa. Toda alta nace en la etapa `new`: la fija
 * el código (nunca el cliente) y la exige el WITH CHECK de la policy de
 * INSERT. El CHECK de `stage` admite todas las etapas.
 *
 * Cambio de etapa (H1.6, DEC-032): la única edición. `authenticated` recibe
 * UPDATE solo sobre `stage`, `loss_reason` y `updated_at` (grant por
 * columna, en la migración), y una única policy de UPDATE tenant-scoped
 * (`opportunities_update_stage`: organización con membership activa, antes y
 * después). El par etapa anterior → etapa nueva lo valida un trigger BEFORE
 * UPDATE (migración, drizzle-kit no modela triggers): como las policies
 * permisivas de un mismo comando se combinan con OR (DEC-028 §5), la
 * máquina de estados vive en el trigger y no en policies por transición.
 * Sin DELETE (default deny).
 */
export const opportunities = pgTable(
  "opportunities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    contactId: uuid("contact_id").notNull(),
    stage: text("stage", { enum: opportunityStages }).notNull(),
    source: text("source", { enum: opportunitySources }).notNull(),
    lossReason: text("loss_reason", { enum: opportunityLossReasons }),
    interestModel: text("interest_model"),
    interestVersion: text("interest_version"),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "opportunities_organization_id_contact_id_contacts_fk",
      columns: [t.organizationId, t.contactId],
      foreignColumns: [contacts.organizationId, contacts.id],
    }).onDelete("restrict"),
    // Mismo orden que la query (DESC, que en Postgres es NULLS FIRST).
    index("opportunities_organization_id_last_activity_at_idx").on(
      t.organizationId,
      t.lastActivityAt.desc().nullsFirst(),
    ),
    // Busca las oportunidades de un contacto (y la FK compuesta).
    index("opportunities_organization_id_contact_id_idx").on(
      t.organizationId,
      t.contactId,
    ),
    unique("opportunities_organization_id_id_key").on(t.organizationId, t.id),
    check("opportunities_stage_check", oneOf(t.stage, opportunityStages)),
    check("opportunities_source_check", oneOf(t.source, opportunitySources)),
    // Un NULL pasa el CHECK de valores; la coherencia con la etapa la da el
    // siguiente: motivo si y solo si `lost`.
    check(
      "opportunities_loss_reason_check",
      oneOf(t.lossReason, opportunityLossReasons),
    ),
    check(
      "opportunities_loss_reason_stage_check",
      sql`(${t.stage} = 'lost' AND ${t.lossReason} IS NOT NULL) OR (${t.stage} <> 'lost' AND ${t.lossReason} IS NULL)`,
    ),
    pgPolicy("opportunities_select_member", {
      for: "select",
      to: authenticatedRole,
      using: sql`${t.organizationId} IN ${userOrgIds}`,
    }),
    // Alta: organización con membership activa y siempre en la etapa
    // inicial.
    pgPolicy("opportunities_insert_member", {
      for: "insert",
      to: authenticatedRole,
      withCheck: sql`${t.organizationId} IN ${userOrgIds} AND ${t.stage} = 'new'`,
    }),
    // Cambio de etapa (H1.6): organización con membership activa, antes y
    // después. Qué transición es válida lo decide el trigger de la
    // migración 0008 (DEC-032 §4), no esta policy.
    pgPolicy("opportunities_update_stage", {
      for: "update",
      to: authenticatedRole,
      using: sql`${t.organizationId} IN ${userOrgIds}`,
      withCheck: sql`${t.organizationId} IN ${userOrgIds}`,
    }),
  ],
).enableRLS();

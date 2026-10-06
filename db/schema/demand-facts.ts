import { sql, type SQL } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  numeric,
  pgPolicy,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type PgColumn,
} from "drizzle-orm/pg-core";
import { authenticatedRole, authUid } from "drizzle-orm/supabase";

import { oneOf } from "./checks";
import { opportunities } from "./opportunities";
import { organizations } from "./organizations";
import { userOrgIds } from "./policies";
import { profiles } from "./profiles";

/*
 * Facts de la demanda (H1.4, DEC-030 §1). Es la lista cerrada del dominio
 * (domains/demand/facts.ts, un test vigila que coincidan): agregar un fact
 * requiere migración y DEC. CHECK reemplazable, no enum.
 */
export const demandFacts = [
  "desired_vehicle",
  "year_range",
  "budget_max",
  "purchase_type",
  "trade_in_intent",
  "down_payment",
] as const;

/** Estados persistidos. `unknown` es derivado y nunca se persiste. */
export const demandFactStatuses = [
  "detected",
  "confirmed",
  "corrected",
  "rejected",
] as const;

/*
 * Fuentes admitidas en H1.4: solo el vendedor (`member`). Las fuentes de
 * máquina (H2a+) amplían este CHECK con su migración y su policy.
 */
export const demandSourceKinds = ["member"] as const;

/** Estados que un miembro puede escribir (policy de INSERT). */
export const demandMemberStatuses = [
  "confirmed",
  "corrected",
  "rejected",
] as const;

/** Tipo de compra (pregunta 1). */
export const demandPurchaseTypes = ["cash", "financed", "undecided"] as const;

/** Monedas de la demanda (DEC-025 §6): las mismas que vehicles, sin FX. */
export const demandCurrencies = ["PYG", "USD"] as const;

/** Largos máximos de los textos (C-12), solo en esta tabla. */
export const demandTextMaxLength = {
  brand: 40,
  model: 80,
  evidence_text: 500,
} as const;

/**
 * Texto opcional de una línea (C-12): NULL, o de 1 a `max` caracteres,
 * recortado y sin caracteres de control.
 */
function boundedText(column: PgColumn, max: number): SQL {
  return sql`(${column} IS NULL OR (char_length(${column}) BETWEEN 1 AND ${sql.raw(String(max))} AND ${column} = btrim(${column}) AND ${column} !~ '[[:cntrl:]]'))`;
}

/*
 * Ledger append-only de la demanda de una oportunidad (H1.4, DEC-030 §2 y
 * §9). Una fila por afirmación: nada se actualiza ni se borra. Current Truth
 * no se persiste: la deriva el resolver puro de domains/demand. Es
 * tenant-scoped (ADR-001 §3.6): `organization_id` NOT NULL, FK simple a
 * `organizations` e índices que empiezan por `organization_id`.
 *
 * - `opportunity_id`: FK compuesta (organization_id, opportunity_id) →
 *   opportunities: la oportunidad es de la misma organización.
 * - `fact`, `status`, `source_kind`: CHECKs. En H1.4 solo escribe un miembro
 *   (`member`) y una fila `detected` es imposible: `(status = 'detected') =
 *   (source_kind <> 'member')`.
 * - `recorded_by`: el miembro que registró la fila. FK a `profiles` con
 *   RESTRICT (C-9): un autor con historial no se borra; dar de baja un
 *   usuario es `memberships.active = false`.
 * - `recorded_at`: reloj de la base (`defaultNow()`, nunca `$defaultFn`); la
 *   policy de INSERT exige `recorded_at = now()`.
 * - `target_fact_id`: el fact sobre el que actúa un acto humano (confirma,
 *   corrige o rechaza). FK compuesta → `…_scope_key`: misma oportunidad y
 *   mismo fact.
 * - `previous_member_fact_id`: el acto humano anterior del mismo fact (la
 *   cadena humana lineal). FK compuesta que incluye `source_kind` →
 *   `…_scope_source_key`: el predecesor también es humano. Un solo root y
 *   un solo sucesor por acto (dos índices únicos parciales: drizzle-orm no
 *   tiene `nullsNotDistinct` en índices); dos escrituras sobre el mismo
 *   head chocan (23505) y la segunda se re-planifica (compare-and-set).
 * - Valor por fact: `brand` / `model` (desired_vehicle), `year_min` /
 *   `year_max` (year_range), `amount` + `currency` (budget_max y
 *   down_payment; `numeric(14, 2)`, exacto, DEC-025 §5), `purchase_type`,
 *   `trade_in` (trade_in_intent). Un `rejected` no tiene valor. El CHECK
 *   `…_value_check` exige exactamente la forma de cada fact, sin NULL que
 *   lo deje pasar (`num_nonnulls`, `ELSE false`).
 * - `evidence_text`: nota corta del vendedor, hasta 500 caracteres. Nunca
 *   conversaciones, mensajes completos, archivos ni fotos. Origin no se
 *   persiste en H1.4 (C-5).
 * - Textos recortados, sin caracteres de control y con largo máximo (C-12).
 * - Todas las FKs, entrantes y salientes, son RESTRICT.
 *
 * Lectura: las filas de las organizaciones con membership activa. Alta: solo
 * un miembro activo, como autor de la request, con el reloj de la base y un
 * estado humano. Sin policies ni grants de UPDATE o DELETE: append-only
 * (también para service_role, C-11; el owner `postgres` es la limitación
 * documentada).
 */
export const opportunityDemandFacts = pgTable(
  "opportunity_demand_facts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    opportunityId: uuid("opportunity_id").notNull(),
    fact: text("fact", { enum: demandFacts }).notNull(),
    status: text("status", { enum: demandFactStatuses }).notNull(),
    sourceKind: text("source_kind", { enum: demandSourceKinds }).notNull(),
    recordedBy: uuid("recorded_by").references(() => profiles.id, {
      onDelete: "restrict",
    }),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    targetFactId: uuid("target_fact_id"),
    previousMemberFactId: uuid("previous_member_fact_id"),
    brand: text("brand"),
    model: text("model"),
    yearMin: smallint("year_min"),
    yearMax: smallint("year_max"),
    amount: numeric("amount", { precision: 14, scale: 2 }),
    currency: text("currency", { enum: demandCurrencies }),
    purchaseType: text("purchase_type", { enum: demandPurchaseTypes }),
    tradeIn: boolean("trade_in"),
    evidenceText: text("evidence_text"),
  },
  (t) => [
    foreignKey({
      name: "opportunity_demand_facts_opportunity_fk",
      columns: [t.organizationId, t.opportunityId],
      foreignColumns: [opportunities.organizationId, opportunities.id],
    }).onDelete("restrict"),
    // Destino de la FK de `target` y lectura por lote de una organización
    // (organization_id = $1 AND opportunity_id = ANY($2)).
    unique("opportunity_demand_facts_scope_key").on(
      t.organizationId,
      t.opportunityId,
      t.fact,
      t.id,
    ),
    // Destino de la FK de `previous`: incluye la fuente del predecesor.
    unique("opportunity_demand_facts_scope_source_key").on(
      t.organizationId,
      t.opportunityId,
      t.fact,
      t.sourceKind,
      t.id,
    ),
    foreignKey({
      name: "opportunity_demand_facts_target_fk",
      columns: [t.organizationId, t.opportunityId, t.fact, t.targetFactId],
      foreignColumns: [t.organizationId, t.opportunityId, t.fact, t.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "opportunity_demand_facts_previous_fk",
      columns: [
        t.organizationId,
        t.opportunityId,
        t.fact,
        t.sourceKind,
        t.previousMemberFactId,
      ],
      foreignColumns: [
        t.organizationId,
        t.opportunityId,
        t.fact,
        t.sourceKind,
        t.id,
      ],
    }).onDelete("restrict"),
    // Cadena humana lineal: un solo root y un solo sucesor por acto.
    uniqueIndex("opportunity_demand_facts_member_root_key")
      .on(t.organizationId, t.opportunityId, t.fact)
      .where(
        sql`${t.sourceKind} = 'member' AND ${t.previousMemberFactId} IS NULL`,
      ),
    uniqueIndex("opportunity_demand_facts_member_next_key")
      .on(t.organizationId, t.opportunityId, t.fact, t.previousMemberFactId)
      .where(
        sql`${t.sourceKind} = 'member' AND ${t.previousMemberFactId} IS NOT NULL`,
      ),
    check("opportunity_demand_facts_fact_check", oneOf(t.fact, demandFacts)),
    check(
      "opportunity_demand_facts_status_check",
      oneOf(t.status, demandFactStatuses),
    ),
    check(
      "opportunity_demand_facts_source_kind_check",
      oneOf(t.sourceKind, demandSourceKinds),
    ),
    check(
      "opportunity_demand_facts_currency_check",
      oneOf(t.currency, demandCurrencies),
    ),
    check(
      "opportunity_demand_facts_purchase_type_check",
      oneOf(t.purchaseType, demandPurchaseTypes),
    ),
    // Forma exacta de cada fact. Seguro frente a NULL: `num_nonnulls` nunca
    // es NULL y el CASE termina en `ELSE false`.
    check(
      "opportunity_demand_facts_value_check",
      sql`CASE
        WHEN ${t.status} = 'rejected' THEN num_nonnulls(${t.brand}, ${t.model}, ${t.yearMin}, ${t.yearMax}, ${t.amount}, ${t.currency}, ${t.purchaseType}, ${t.tradeIn}) = 0
        WHEN ${t.fact} = 'desired_vehicle' THEN num_nonnulls(${t.brand}, ${t.model}) >= 1 AND num_nonnulls(${t.yearMin}, ${t.yearMax}, ${t.amount}, ${t.currency}, ${t.purchaseType}, ${t.tradeIn}) = 0
        WHEN ${t.fact} = 'year_range' THEN num_nonnulls(${t.yearMin}, ${t.yearMax}) >= 1 AND coalesce(${t.yearMin} BETWEEN 1900 AND 2100, true) AND coalesce(${t.yearMax} BETWEEN 1900 AND 2100, true) AND coalesce(${t.yearMin} <= ${t.yearMax}, true) AND num_nonnulls(${t.brand}, ${t.model}, ${t.amount}, ${t.currency}, ${t.purchaseType}, ${t.tradeIn}) = 0
        WHEN ${t.fact} = 'budget_max' THEN num_nonnulls(${t.amount}, ${t.currency}) = 2 AND ${t.amount} > 0 AND (${t.currency} <> 'PYG' OR ${t.amount} = trunc(${t.amount})) AND num_nonnulls(${t.brand}, ${t.model}, ${t.yearMin}, ${t.yearMax}, ${t.purchaseType}, ${t.tradeIn}) = 0
        WHEN ${t.fact} = 'down_payment' THEN num_nonnulls(${t.amount}, ${t.currency}) = 2 AND ${t.amount} >= 0 AND (${t.currency} <> 'PYG' OR ${t.amount} = trunc(${t.amount})) AND num_nonnulls(${t.brand}, ${t.model}, ${t.yearMin}, ${t.yearMax}, ${t.purchaseType}, ${t.tradeIn}) = 0
        WHEN ${t.fact} = 'purchase_type' THEN ${t.purchaseType} IS NOT NULL AND num_nonnulls(${t.brand}, ${t.model}, ${t.yearMin}, ${t.yearMax}, ${t.amount}, ${t.currency}, ${t.tradeIn}) = 0
        WHEN ${t.fact} = 'trade_in_intent' THEN ${t.tradeIn} IS NOT NULL AND num_nonnulls(${t.brand}, ${t.model}, ${t.yearMin}, ${t.yearMax}, ${t.amount}, ${t.currency}, ${t.purchaseType}) = 0
        ELSE false
      END`,
    ),
    // `rejected` y `corrected` siempre actúan sobre un fact; una detección
    // no apunta a nada ni forma parte de la cadena humana.
    check(
      "opportunity_demand_facts_status_target_check",
      sql`(${t.status} NOT IN ('rejected', 'corrected') OR ${t.targetFactId} IS NOT NULL) AND (${t.status} <> 'detected' OR (${t.targetFactId} IS NULL AND ${t.previousMemberFactId} IS NULL))`,
    ),
    // Prioridad humana: solo una máquina detecta; un humano nunca.
    check(
      "opportunity_demand_facts_source_status_check",
      sql`(${t.status} = 'detected') = (${t.sourceKind} <> 'member')`,
    ),
    check(
      "opportunity_demand_facts_member_author_check",
      sql`${t.sourceKind} <> 'member' OR ${t.recordedBy} IS NOT NULL`,
    ),
    check(
      "opportunity_demand_facts_member_chain_check",
      sql`${t.sourceKind} = 'member' OR ${t.previousMemberFactId} IS NULL`,
    ),
    check(
      "opportunity_demand_facts_self_reference_check",
      sql`(${t.targetFactId} IS NULL OR ${t.targetFactId} <> ${t.id}) AND (${t.previousMemberFactId} IS NULL OR ${t.previousMemberFactId} <> ${t.id})`,
    ),
    // C-12: recortados, sin caracteres de control y con largo máximo.
    check(
      "opportunity_demand_facts_text_check",
      sql`${boundedText(t.brand, demandTextMaxLength.brand)} AND ${boundedText(t.model, demandTextMaxLength.model)} AND ${boundedText(t.evidenceText, demandTextMaxLength.evidence_text)}`,
    ),
    pgPolicy("opportunity_demand_facts_select_member", {
      for: "select",
      to: authenticatedRole,
      using: sql`${t.organizationId} IN ${userOrgIds}`,
    }),
    // Alta: un miembro activo de la organización, como autor de la request,
    // con el reloj de la base y un estado humano. La futura identidad de
    // sistema (ADR-002) no puede satisfacer esta policy.
    pgPolicy("opportunity_demand_facts_insert_member", {
      for: "insert",
      to: authenticatedRole,
      withCheck: sql`${t.organizationId} IN ${userOrgIds} AND ${t.sourceKind} = 'member' AND ${oneOf(t.status, demandMemberStatuses)} AND ${t.recordedBy} = ${authUid} AND ${t.recordedAt} = now()`,
    }),
  ],
).enableRLS();

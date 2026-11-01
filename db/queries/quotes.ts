import "server-only";

import { and, asc, desc, eq, inArray, isNotNull } from "drizzle-orm";

import type {
  QuotableVehicleRow,
  QuoteRow,
} from "@/domains/quotes/presentation";
import { QUOTABLE_VEHICLE_STATUSES } from "@/domains/quotes/statuses";

import { quotes, vehicles } from "../schema";
import type { ScopedTransaction } from "../tenant";

/*
 * Lectura de las cotizaciones de una oportunidad (Hito 10, DEC-042 §9).
 * Solo lee: corre dentro de una transacción withTenant() que ya abrió quien
 * llama (el loader de /opportunities/[id]) y filtra siempre por la
 * organización del contexto (defensa en profundidad sobre RLS). La
 * escritura vive aparte, en quotes-write.ts, con su única puerta.
 *
 * La presentación (autor "Vos" u "Otro miembro", montos es-PY, estado
 * "Vencida", acciones permitidas) la arma domains/quotes/presentation.ts.
 */

/** A lo sumo las opciones que muestra el select de unidades del drawer. */
export const QUOTE_VEHICLE_OPTION_LIMIT = 200;

/** A lo sumo las cotizaciones que muestra el panel de una oportunidad. */
export const OPPORTUNITY_QUOTE_LIMIT = 100;

/**
 * Cotizaciones de una oportunidad con su unidad, de la más reciente a la
 * más vieja (el número es correlativo). La unidad es de la misma
 * organización por la FK compuesta; se une igual por las dos columnas.
 */
export function selectOpportunityQuotes(
  tx: ScopedTransaction,
  organizationId: string,
  opportunityId: string,
): Promise<QuoteRow[]> {
  return tx
    .select({
      id: quotes.id,
      number: quotes.number,
      status: quotes.status,
      currency: quotes.currency,
      listPrice: quotes.listPrice,
      discountKind: quotes.discountKind,
      discountValue: quotes.discountValue,
      totalPrice: quotes.totalPrice,
      validUntil: quotes.validUntil,
      notes: quotes.notes,
      createdBy: quotes.createdBy,
      createdAt: quotes.createdAt,
      approvedBy: quotes.approvedBy,
      approvedAt: quotes.approvedAt,
      sentAt: quotes.sentAt,
      decidedAt: quotes.decidedAt,
      vehicleId: quotes.vehicleId,
      vehicleBrand: vehicles.brand,
      vehicleModel: vehicles.model,
      vehicleYear: vehicles.year,
      vehicleStatus: vehicles.status,
    })
    .from(quotes)
    .innerJoin(
      vehicles,
      and(
        eq(vehicles.organizationId, quotes.organizationId),
        eq(vehicles.id, quotes.vehicleId),
      ),
    )
    .where(
      and(
        eq(quotes.organizationId, organizationId),
        eq(quotes.opportunityId, opportunityId),
      ),
    )
    .orderBy(desc(quotes.number))
    .limit(OPPORTUNITY_QUOTE_LIMIT);
}

/**
 * Unidades que se pueden cotizar: disponibles o reservadas y con precio
 * publicado (la lista sale de ahí). Por marca, modelo y año.
 */
export async function selectQuotableVehicles(
  tx: ScopedTransaction,
  organizationId: string,
): Promise<QuotableVehicleRow[]> {
  const rows = await tx
    .select({
      id: vehicles.id,
      brand: vehicles.brand,
      model: vehicles.model,
      year: vehicles.year,
      price: vehicles.price,
      currency: vehicles.currency,
    })
    .from(vehicles)
    .where(
      and(
        eq(vehicles.organizationId, organizationId),
        inArray(vehicles.status, [...QUOTABLE_VEHICLE_STATUSES]),
        isNotNull(vehicles.price),
        isNotNull(vehicles.currency),
      ),
    )
    .orderBy(asc(vehicles.brand), asc(vehicles.model), desc(vehicles.year))
    .limit(QUOTE_VEHICLE_OPTION_LIMIT);
  // El CHECK de vehicles exige precio y moneda juntos: el filtro ya los
  // garantiza, esto solo lo hace visible al tipo.
  return rows.flatMap((row) =>
    row.price !== null && row.currency !== null
      ? [{ ...row, price: row.price, currency: row.currency }]
      : [],
  );
}

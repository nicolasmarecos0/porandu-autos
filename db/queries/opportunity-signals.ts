import "server-only";

import { and, eq, inArray, max, ne } from "drizzle-orm";

import { todayInAsuncion } from "@/domains/opportunities/closure";
import { tradeInLabel } from "@/domains/opportunities/trade-in-presentation";
import { ACTIVE_TRADE_IN_STATUSES } from "@/domains/opportunities/trade-ins";
import {
  NO_INTENT_SIGNALS,
  quoteSignal,
  testDriveSignal,
  type IntentSignals,
  type QuoteRecord,
  type TestDriveRecord,
  type TradeInRecord,
} from "@/domains/scoring/signals";

import { messages, quotes, testDrives, tradeIns } from "../schema";
import type { ScopedTransaction } from "../tenant";

/*
 * Señales comerciales por lote (DEC-058): lo que el motor de Intent y el
 * derivador de "¿Por qué ahora?" leen de la agenda, las cotizaciones, los
 * mensajes del cliente y la toma del usado. Corren dentro de la transacción
 * withTenant() de quien llama (la cola y el embudo) y filtran por la
 * organización del contexto, defensa en profundidad sobre RLS. Solo leen:
 * ni el texto de los mensajes, ni los autores, ni los importes de la
 * tasación viajan.
 *
 * Una lista de oportunidades vacía no consulta nada.
 */

function groupBy<T>(
  rows: readonly (T & { opportunityId: string })[],
): Map<string, T[]> {
  const byOpportunity = new Map<string, T[]>();
  for (const { opportunityId, ...rest } of rows) {
    const list = byOpportunity.get(opportunityId) ?? [];
    list.push(rest as T);
    byOpportunity.set(opportunityId, list);
  }
  return byOpportunity;
}

/** Pruebas de manejo de las oportunidades, sin las canceladas. */
async function selectTestDriveRecords(
  tx: ScopedTransaction,
  organizationId: string,
  opportunityIds: readonly string[],
): Promise<Map<string, TestDriveRecord[]>> {
  const rows = await tx
    .select({
      opportunityId: testDrives.opportunityId,
      status: testDrives.status,
      scheduledAt: testDrives.scheduledAt,
    })
    .from(testDrives)
    .where(
      and(
        eq(testDrives.organizationId, organizationId),
        inArray(testDrives.opportunityId, [...opportunityIds]),
        ne(testDrives.status, "cancelled"),
      ),
    );
  return groupBy<TestDriveRecord>(rows);
}

/** Cotizaciones de las oportunidades, sin las anuladas. */
async function selectQuoteRecords(
  tx: ScopedTransaction,
  organizationId: string,
  opportunityIds: readonly string[],
): Promise<Map<string, QuoteRecord[]>> {
  const rows = await tx
    .select({
      opportunityId: quotes.opportunityId,
      number: quotes.number,
      status: quotes.status,
      currency: quotes.currency,
      totalPrice: quotes.totalPrice,
      validUntil: quotes.validUntil,
    })
    .from(quotes)
    .where(
      and(
        eq(quotes.organizationId, organizationId),
        inArray(quotes.opportunityId, [...opportunityIds]),
        ne(quotes.status, "withdrawn"),
      ),
    );
  return groupBy<QuoteRecord>(
    rows.map(({ currency, totalPrice, ...row }) => ({
      ...row,
      total: { amount: totalPrice, currency },
    })),
  );
}

/** Último mensaje recibido del cliente en cada oportunidad: solo el momento. */
async function selectLastInboundTimes(
  tx: ScopedTransaction,
  organizationId: string,
  opportunityIds: readonly string[],
): Promise<Map<string, Date>> {
  const rows = await tx
    .select({
      opportunityId: messages.opportunityId,
      lastInboundAt: max(messages.createdAt),
    })
    .from(messages)
    .where(
      and(
        eq(messages.organizationId, organizationId),
        inArray(messages.opportunityId, [...opportunityIds]),
        eq(messages.direction, "inbound"),
      ),
    )
    .groupBy(messages.opportunityId);
  const byOpportunity = new Map<string, Date>();
  for (const row of rows) {
    if (row.opportunityId && row.lastInboundAt) {
      byOpportunity.set(row.opportunityId, row.lastInboundAt);
    }
  }
  return byOpportunity;
}

/**
 * Señales de Intent de cada oportunidad (DEC-058): el último mensaje del
 * cliente, la prueba de manejo y la cotización que cuentan en `now`. Una
 * oportunidad sin ninguna no aparece en el mapa (NO_INTENT_SIGNALS).
 */
export async function selectIntentSignals(
  tx: ScopedTransaction,
  organizationId: string,
  opportunityIds: readonly string[],
  now: Date,
): Promise<Map<string, IntentSignals>> {
  const byOpportunity = new Map<string, IntentSignals>();
  if (opportunityIds.length === 0) return byOpportunity;
  const drives = await selectTestDriveRecords(
    tx,
    organizationId,
    opportunityIds,
  );
  const quoteRows = await selectQuoteRecords(
    tx,
    organizationId,
    opportunityIds,
  );
  const inbound = await selectLastInboundTimes(
    tx,
    organizationId,
    opportunityIds,
  );
  const today = todayInAsuncion(now);
  for (const id of opportunityIds) {
    const signals: IntentSignals = {
      lastInboundAt: inbound.get(id) ?? null,
      testDrive: testDriveSignal(drives.get(id) ?? [], now),
      quote: quoteSignal(quoteRows.get(id) ?? [], today),
    };
    if (
      signals.lastInboundAt !== null ||
      signals.testDrive !== null ||
      signals.quote !== null
    ) {
      byOpportunity.set(id, signals);
    }
  }
  return byOpportunity;
}

/** Las señales de una oportunidad del mapa, o ninguna. */
export function intentSignalsOf(
  signals: ReadonlyMap<string, IntentSignals>,
  opportunityId: string,
): IntentSignals {
  return signals.get(opportunityId) ?? NO_INTENT_SIGNALS;
}

/**
 * La toma vigente (pendiente, tasada o aceptada) de cada oportunidad: su
 * estado y el usado ("Toyota Fortuner 2019"). Sin chapa ni importes.
 */
export async function selectTradeInRecords(
  tx: ScopedTransaction,
  organizationId: string,
  opportunityIds: readonly string[],
): Promise<Map<string, TradeInRecord>> {
  const byOpportunity = new Map<string, TradeInRecord>();
  if (opportunityIds.length === 0) return byOpportunity;
  const rows = await tx
    .select({
      opportunityId: tradeIns.opportunityId,
      status: tradeIns.status,
      brand: tradeIns.brand,
      model: tradeIns.model,
      year: tradeIns.year,
    })
    .from(tradeIns)
    .where(
      and(
        eq(tradeIns.organizationId, organizationId),
        inArray(tradeIns.opportunityId, [...opportunityIds]),
        inArray(tradeIns.status, [...ACTIVE_TRADE_IN_STATUSES]),
      ),
    );
  for (const row of rows) {
    if (row.status === "rejected") continue;
    byOpportunity.set(row.opportunityId, {
      status: row.status,
      label: tradeInLabel(row),
    });
  }
  return byOpportunity;
}

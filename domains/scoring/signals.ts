import type { TestDriveStatus } from "@/domains/calendar/test-drives";
import type { Money } from "@/domains/money";
import { isQuoteExpired, type QuoteStatus } from "@/domains/quotes/statuses";

/*
 * Señales comerciales de una oportunidad (DEC-058): lo que el motor de
 * Intent y el derivador de "¿Por qué ahora?" leen además de la etapa, la
 * demanda y el stock. Son hechos ya persistidos (agenda, cotizaciones, toma
 * de usados y mensajes del cliente) resumidos en una señal por fuente.
 * Puro: no carga datos ni conoce la base, React o Next.
 */

/** Una prueba de manejo de la oportunidad, como la lee el loader. */
export type TestDriveRecord = Readonly<{
  status: TestDriveStatus;
  scheduledAt: Date;
}>;

/** Una cotización de la oportunidad, como la lee el loader. */
export type QuoteRecord = Readonly<{
  number: number;
  status: QuoteStatus;
  total: Money;
  /** Último día de validez, "AAAA-MM-DD" (Asunción). */
  validUntil: string;
}>;

/** La toma vigente de la oportunidad (DEC-052): pendiente, tasada o aceptada. */
export type TradeInRecord = Readonly<{
  status: "pending" | "appraised" | "accepted";
  /** "Toyota Fortuner 2019". */
  label: string;
}>;

/**
 * La prueba de manejo que cuenta para la oportunidad:
 * - `upcoming`: agendada o confirmada, todavía por delante;
 * - `completed`: realizada;
 * - `overdue`: agendada o confirmada, ya pasó y no tiene resultado;
 * - `no_show`: el cliente no se presentó.
 */
export type TestDriveSignal = Readonly<{
  state: "upcoming" | "completed" | "overdue" | "no_show";
  at: Date;
  /** Confirmada por el cliente (solo en `upcoming` y `overdue`). */
  confirmed: boolean;
}>;

/**
 * La cotización que cuenta para la oportunidad:
 * - `accepted`: el cliente la aceptó;
 * - `sent`: enviada y vigente;
 * - `pending`: en borrador o aprobada, vigente y sin enviar;
 * - `expired`: abierta y vencida;
 * - `rejected`: el cliente la rechazó.
 * Una anulada no cuenta.
 */
export type QuoteSignal = Readonly<{
  state: "accepted" | "sent" | "pending" | "expired" | "rejected";
  number: number;
  total: Money;
  validUntil: string;
}>;

/** Lo que el motor de Intent necesita además de la etapa y la recencia. */
export type IntentSignals = Readonly<{
  /** Último mensaje recibido del cliente, o null si nunca escribió. */
  lastInboundAt: Date | null;
  testDrive: TestDriveSignal | null;
  quote: QuoteSignal | null;
}>;

export const NO_INTENT_SIGNALS: IntentSignals = Object.freeze({
  lastInboundAt: null,
  testDrive: null,
  quote: null,
});

const TEST_DRIVE_PRIORITY: readonly TestDriveSignal["state"][] = [
  "upcoming",
  "completed",
  "overdue",
  "no_show",
];

/**
 * La prueba de manejo que cuenta, en orden de prioridad: la próxima por
 * delante (la más cercana), la última realizada, la última vencida sin
 * resultado y la última a la que no asistió. Las canceladas no cuentan.
 */
export function testDriveSignal(
  records: readonly TestDriveRecord[],
  now: Date,
): TestDriveSignal | null {
  const signals: TestDriveSignal[] = [];
  for (const record of records) {
    const confirmed = record.status === "confirmed";
    switch (record.status) {
      case "scheduled":
      case "confirmed":
        signals.push({
          state: record.scheduledAt >= now ? "upcoming" : "overdue",
          at: record.scheduledAt,
          confirmed,
        });
        break;
      case "completed":
      case "no_show":
        signals.push({
          state: record.status,
          at: record.scheduledAt,
          confirmed: false,
        });
        break;
      case "cancelled":
        break;
    }
  }
  for (const state of TEST_DRIVE_PRIORITY) {
    const candidates = signals.filter((signal) => signal.state === state);
    if (candidates.length === 0) continue;
    // La próxima es la más cercana; las pasadas, la más reciente.
    return candidates.reduce((best, signal) =>
      state === "upcoming"
        ? signal.at < best.at
          ? signal
          : best
        : signal.at > best.at
          ? signal
          : best,
    );
  }
  return null;
}

function quoteState(
  quote: QuoteRecord,
  today: string,
): QuoteSignal["state"] | null {
  switch (quote.status) {
    case "accepted":
    case "rejected":
      return quote.status;
    case "withdrawn":
      return null;
    case "draft":
    case "approved":
    case "sent":
      if (isQuoteExpired(quote.validUntil, today)) return "expired";
      return quote.status === "sent" ? "sent" : "pending";
  }
}

const QUOTE_PRIORITY: readonly QuoteSignal["state"][] = [
  "accepted",
  "sent",
  "pending",
  "expired",
  "rejected",
];

/**
 * La cotización que cuenta, en orden de prioridad: aceptada, enviada y
 * vigente, sin enviar, vencida y rechazada. Dentro de un estado, la más
 * nueva (el número más alto). `today` es el día de Asunción, "AAAA-MM-DD".
 */
export function quoteSignal(
  records: readonly QuoteRecord[],
  today: string,
): QuoteSignal | null {
  let best: QuoteSignal | null = null;
  for (const record of records) {
    const state = quoteState(record, today);
    if (state === null) continue;
    const candidate: QuoteSignal = {
      state,
      number: record.number,
      total: record.total,
      validUntil: record.validUntil,
    };
    if (
      best === null ||
      QUOTE_PRIORITY.indexOf(state) < QUOTE_PRIORITY.indexOf(best.state) ||
      (state === best.state && record.number > best.number)
    ) {
      best = candidate;
    }
  }
  return best;
}

import { readUuid } from "@/domains/calendar/test-drives";
import {
  isQuoteStatus,
  type QuoteStatus,
  type QuoteTransitionError,
} from "@/domains/quotes/statuses";
import {
  QUOTE_FIELDS,
  QUOTE_STATUS_CHANGE_FIELDS,
  type QuoteFieldError,
  type QuoteTermsValues,
} from "@/domains/quotes/request";

/*
 * Pedidos y respuestas de las Server Actions de cotizaciones (Hito 10,
 * DEC-042 §8). Los pedidos son input no confiable: solo se leen los campos
 * de QUOTE_FIELDS y QUOTE_STATUS_CHANGE_FIELDS. Organización, autor, lista,
 * moneda, número, estado inicial y reloj nunca salen del cliente. Nada de
 * esto expone la base: ni SQLSTATE, ni constraints, ni datos de otra
 * organización.
 */

/** Campos del formulario de alta, ids incluidos. */
export type QuoteFormField = keyof typeof QUOTE_FIELDS;

export type QuoteFormError =
  | QuoteFieldError
  /** La unidad ya no está en stock o no es de la organización activa. */
  | "unavailable"
  /** La unidad está en stock pero no tiene precio publicado. */
  | "without_price";

export type QuoteFormErrors = Partial<Record<QuoteFormField, QuoteFormError>>;

/** Lo que el usuario cargó, para devolverlo al formulario tras un error. */
export type QuoteFormValues = Readonly<Record<QuoteFormField, string>>;

/** Respuesta de createQuote(). */
export type CreateQuoteState =
  | Readonly<{
      status: "invalid";
      errors: QuoteFormErrors;
      values: QuoteFormValues;
    }>
  /** La oportunidad ya no admite cotizaciones (cerrada u otra etapa). */
  | Readonly<{ status: "opportunity_unavailable"; values: QuoteFormValues }>
  /** Falla inesperada: nada se escribió y se puede reintentar. */
  | Readonly<{ status: "failed"; values: QuoteFormValues }>
  | Readonly<{ status: "created"; quoteId: string; number: number }>
  | null;

/** Largo máximo que se lee de cada campo: corta un payload abusivo. */
const FIELD_LIMITS: Readonly<Record<QuoteFormField, number>> = {
  opportunityId: 64,
  vehicleId: 64,
  discountKind: 16,
  discountValue: 32,
  validUntil: 16,
  // Las condiciones tienen 500 caracteres; se deja margen para que el
  // dominio informe "too_long" en vez de truncar en silencio.
  notes: 2_000,
};

function read(formData: FormData, field: QuoteFormField): string {
  const raw = formData.get(QUOTE_FIELDS[field]);
  return typeof raw === "string" ? raw.slice(0, FIELD_LIMITS[field]) : "";
}

export type ParsedCreateQuote =
  | Readonly<{
      ok: true;
      opportunityId: string;
      vehicleId: string;
      terms: QuoteTermsValues;
      values: QuoteFormValues;
    }>
  | Readonly<{
      ok: false;
      errors: QuoteFormErrors;
      values: QuoteFormValues;
      /** La oportunidad no es un UUID: no hay a qué asociar la cotización. */
      opportunityMissing: boolean;
    }>;

/**
 * Lee el alta. Los ids tienen que ser UUID (que lo sean no significa que
 * sean de la organización activa: eso lo deciden el filtro explícito y
 * RLS). Las condiciones se validan después, en la transacción, contra la
 * lista real de la unidad.
 */
export function parseCreateQuoteRequest(formData: FormData): ParsedCreateQuote {
  const values: QuoteFormValues = {
    opportunityId: read(formData, "opportunityId").trim(),
    vehicleId: read(formData, "vehicleId").trim(),
    discountKind: read(formData, "discountKind").trim(),
    discountValue: read(formData, "discountValue"),
    validUntil: read(formData, "validUntil").trim(),
    notes: read(formData, "notes"),
  };
  const opportunityId = readUuid(values.opportunityId);
  const vehicleId = readUuid(values.vehicleId);
  if (!opportunityId || !vehicleId) {
    return {
      ok: false,
      errors: vehicleId ? {} : { vehicleId: "required" },
      values,
      opportunityMissing: !opportunityId,
    };
  }
  return {
    ok: true,
    opportunityId,
    vehicleId,
    terms: {
      discountKind: values.discountKind,
      discountValue: values.discountValue,
      validUntil: values.validUntil,
      notes: values.notes,
    },
    values,
  };
}

/** Respuesta de changeQuoteStatus(). */
export type ChangeQuoteStatusState =
  | Readonly<{ status: "changed"; quoteId: string; to: QuoteStatus }>
  /** Ya no estaba en el estado de partida: `current` es el real. */
  | Readonly<{ status: "unchanged"; quoteId: string; current: QuoteStatus }>
  /** No existe, no es de la organización activa o el pedido es inválido. */
  | Readonly<{ status: "not_found" }>
  /** La oportunidad ya tiene otra cotización aceptada. */
  | Readonly<{ status: "already_accepted" }>
  /** Un rechazo del dominio o de la base, sin cambios. */
  | Readonly<{ status: QuoteTransitionError }>
  /** Falla inesperada: no cambió nada y se puede reintentar. */
  | Readonly<{ status: "failed" }>
  | null;

export type ParsedQuoteStatusChange =
  | Readonly<{
      ok: true;
      quoteId: string;
      from: QuoteStatus;
      to: QuoteStatus;
    }>
  | Readonly<{ ok: false }>;

export function parseQuoteStatusChangeRequest(
  formData: FormData,
): ParsedQuoteStatusChange {
  const quoteId = readUuid(formData.get(QUOTE_STATUS_CHANGE_FIELDS.quoteId));
  const from = formData.get(QUOTE_STATUS_CHANGE_FIELDS.from);
  const to = formData.get(QUOTE_STATUS_CHANGE_FIELDS.to);
  if (!quoteId || !isQuoteStatus(from) || !isQuoteStatus(to)) {
    return { ok: false };
  }
  return { ok: true, quoteId, from, to };
}

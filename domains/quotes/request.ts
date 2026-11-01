import { z } from "zod";

import {
  MAX_AMOUNT_INTEGER_DIGITS,
  parseAmount,
  type Money,
} from "@/domains/money";
import { isCalendarDate } from "@/domains/opportunities/closure";
import { noteLength, normalizeNoteBody } from "@/domains/opportunities/notes";

import {
  discountExceeds,
  hasCents,
  MAX_DISCOUNT_PERCENT,
  toCents,
  type Discount,
  type DiscountKind,
} from "./pricing";

/*
 * Alta de una cotización (Hito 10, DEC-042 §4). Valida con Zod (DEC-009,
 * como el cierre de DEC-034 §7) lo que el vendedor carga en el formulario:
 * el descuento, la validez y las condiciones. Input no confiable: el
 * servidor lo valida siempre y el navegador también, para avisar antes de
 * enviar.
 *
 * La oportunidad y la unidad llegan como ids y las resuelve el servidor en
 * la organización activa. El precio de lista y su moneda no salen del
 * pedido: son el precio publicado de la unidad (DEC-042 §3). Organización,
 * autor, número, estado y reloj tampoco.
 */

/** Campos que el servidor lee del formulario de alta. */
export const QUOTE_FIELDS = {
  opportunityId: "opportunityId",
  vehicleId: "vehicleId",
  discountKind: "discountKind",
  discountValue: "discountValue",
  validUntil: "validUntil",
  notes: "notes",
} as const;

/** Campos del pedido de cambio de estado. */
export const QUOTE_STATUS_CHANGE_FIELDS = {
  quoteId: "quoteId",
  from: "from",
  to: "to",
} as const;

/** Campos de la cotización que valida este módulo (sin los ids). */
export type QuoteTermsField =
  "discountKind" | "discountValue" | "validUntil" | "notes";

/** Lo que tipeó el usuario en cada campo, tal cual llegó. */
export type QuoteTermsValues = Readonly<Record<QuoteTermsField, string>>;

/** Días de validez que propone el formulario. */
export const DEFAULT_VALIDITY_DAYS = 7;

/**
 * Validez máxima, en días desde el alta. El CHECK
 * `quotes_valid_until_check` exige lo mismo con el reloj de la base.
 */
export const MAX_VALIDITY_DAYS = 30;

/** Largo máximo de las condiciones, en caracteres (como `char_length`). */
export const QUOTE_NOTES_MAX_LENGTH = 500;

/** Condiciones de una cotización, ya validadas. */
export type QuoteTerms = Readonly<{
  discount: Discount;
  /** Último día de validez, inclusive, "AAAA-MM-DD" (Asunción). */
  validUntil: string;
  /** Normalizadas como la bitácora (DEC-033 §1); null si no hay. */
  notes: string | null;
}>;

export const QUOTE_FIELD_ERRORS = [
  "required",
  "invalid_option",
  "invalid_amount",
  "invalid_percent",
  "not_positive",
  "pyg_decimals",
  "too_large",
  "invalid_date",
  "in_the_past",
  "too_far",
  "too_long",
] as const;

export type QuoteFieldError = (typeof QUOTE_FIELD_ERRORS)[number];

export type QuoteTermsErrors = Partial<
  Record<QuoteTermsField, QuoteFieldError>
>;

export type ParsedQuoteTerms =
  | Readonly<{ ok: true; terms: QuoteTerms }>
  | Readonly<{ ok: false; errors: QuoteTermsErrors }>;

/** Copy visible (es-PY) de cada error de campo. */
export const QUOTE_FIELD_ERROR_LABELS: Readonly<
  Record<QuoteFieldError, string>
> = {
  required: "Completá este campo.",
  invalid_option: "Elegí una opción de la lista.",
  invalid_amount: "Escribí un monto válido, por ejemplo 1.500.000.",
  invalid_percent: "Escribí un porcentaje válido, por ejemplo 7,5.",
  not_positive: "El descuento tiene que ser mayor que cero.",
  pyg_decimals: "Los guaraníes no llevan decimales.",
  too_large: `El descuento no puede superar el ${MAX_DISCOUNT_PERCENT} % del precio de lista.`,
  invalid_date: "Elegí una fecha válida.",
  in_the_past: "La validez no puede terminar antes de hoy.",
  too_far: `La validez no puede superar los ${MAX_VALIDITY_DAYS} días.`,
  too_long: `Las condiciones no pueden superar los ${QUOTE_NOTES_MAX_LENGTH} caracteres.`,
};

/* ── Fechas de calendario ───────────────────────────────────────────────── */

/** `date` + `days` días de calendario ("2026-11-01" + 7 → "2026-11-08"). */
export function addDays(date: string, days: number): string {
  if (!isCalendarDate(date)) throw new Error(`invalid calendar date: ${date}`);
  const [year, month, day] = date.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
}

/** Validez que propone el formulario para una cotización creada `today`. */
export function defaultValidUntil(today: string): string {
  return addDays(today, DEFAULT_VALIDITY_DAYS);
}

/* ── Validación (Zod) ───────────────────────────────────────────────────── */

/** Porcentaje es-PY: hasta dos enteros y dos decimales con coma ("7,5"). */
const PERCENT = /^(\d{1,2})(?:,(\d{1,2}))?$/;

/** Porcentaje es-PY → decimal canónico ("7,5" → "7.50"), o null. */
export function parsePercent(raw: string): string | null {
  const match = PERCENT.exec(raw.trim());
  if (!match) return null;
  const integer = match[1]!.replace(/^0+(?=\d)/, "");
  return `${integer}.${(match[2] ?? "").padEnd(2, "0")}`;
}

const required = z.string().trim().min(1, "required");

function addIssue(
  ctx: z.RefinementCtx,
  field: QuoteTermsField,
  message: QuoteFieldError,
) {
  ctx.addIssue({ code: "custom", path: [field], message });
}

/** Descuento validado contra el precio de lista, o un error en su valor. */
function readDiscount(
  kind: DiscountKind,
  rawValue: string,
  listPrice: Money,
  ctx: z.RefinementCtx,
): Discount | null {
  if (kind === "none") return { kind };
  const raw = rawValue.trim();
  if (raw === "") {
    addIssue(ctx, "discountValue", "required");
    return null;
  }
  const value = kind === "amount" ? parseAmount(raw) : parsePercent(raw);
  if (
    value === null ||
    value.split(".")[0]!.length > MAX_AMOUNT_INTEGER_DIGITS
  ) {
    addIssue(
      ctx,
      "discountValue",
      kind === "amount" ? "invalid_amount" : "invalid_percent",
    );
    return null;
  }
  if (toCents(value) === BigInt(0)) {
    addIssue(ctx, "discountValue", "not_positive");
    return null;
  }
  // PYG no tiene unidad menor (DEC-025 §6).
  if (kind === "amount" && listPrice.currency === "PYG" && hasCents(value)) {
    addIssue(ctx, "discountValue", "pyg_decimals");
    return null;
  }
  const discount: Discount = { kind, value };
  if (discountExceeds(listPrice, discount, MAX_DISCOUNT_PERCENT)) {
    addIssue(ctx, "discountValue", "too_large");
    return null;
  }
  return discount;
}

function termsSchema(listPrice: Money, today: string) {
  const latest = addDays(today, MAX_VALIDITY_DAYS);
  return z
    .object({
      discountKind: required.pipe(
        z.enum(["none", "amount", "percent"], { error: "invalid_option" }),
      ),
      discountValue: z.string(),
      validUntil: required
        .refine(isCalendarDate, "invalid_date")
        .refine((value) => value >= today, "in_the_past")
        .refine((value) => value <= latest, "too_far"),
      notes: z
        .string()
        .transform(normalizeNoteBody)
        .refine(
          (notes) => noteLength(notes) <= QUOTE_NOTES_MAX_LENGTH,
          "too_long",
        )
        .transform((notes) => (notes === "" ? null : notes)),
    })
    .transform((value, ctx) => {
      const discount = readDiscount(
        value.discountKind,
        value.discountValue,
        listPrice,
        ctx,
      );
      if (discount === null) return z.NEVER;
      return {
        discount,
        validUntil: value.validUntil,
        notes: value.notes,
      } satisfies QuoteTerms;
    });
}

function isQuoteFieldError(value: string): value is QuoteFieldError {
  return (QUOTE_FIELD_ERRORS as readonly string[]).includes(value);
}

/** El primer error de cada campo, con el código de este módulo. */
function errorsOf(error: z.ZodError): QuoteTermsErrors {
  const errors: QuoteTermsErrors = {};
  for (const issue of error.issues) {
    const field = issue.path[0] as QuoteTermsField;
    if (errors[field] !== undefined) continue;
    errors[field] = isQuoteFieldError(issue.message)
      ? issue.message
      : "invalid_option";
  }
  return errors;
}

/**
 * Valida las condiciones de una cotización nueva. `listPrice` es el precio
 * publicado de la unidad (lo lee el servidor, no el pedido) y `today` el
 * día de Asunción (todayInAsuncion()). El valor del descuento se valida
 * cuando el resto de los campos ya es válido: nunca se evalúa contra un
 * tipo de descuento inválido.
 */
export function parseQuoteTerms(
  values: QuoteTermsValues,
  listPrice: Money,
  today: string,
): ParsedQuoteTerms {
  const parsed = termsSchema(listPrice, today).safeParse(values);
  if (!parsed.success) return { ok: false, errors: errorsOf(parsed.error) };
  return { ok: true, terms: parsed.data };
}

import { z } from "zod";

import {
  CURRENCIES,
  formatMoney,
  MAX_AMOUNT_INTEGER_DIGITS,
  parseAmount,
  type Currency,
  type Money,
} from "@/domains/money";

import {
  DELIVERY_STATUS_LABELS,
  LOSS_REASON_LABELS,
  PAYMENT_METHOD_LABELS,
} from "./labels";
import { noteLength, normalizeNoteBody } from "./notes";
import { canTransition, TERMINAL_STAGES, type Stage } from "./stages";

/*
 * Cierre comercial de una oportunidad (DEC-034): pasar a `won` o `lost` es
 * un solo acto, que escribe la etapa y sus metadatos juntos. Módulo puro y
 * apto para el navegador: el formulario de cierre lo usa para ofrecer las
 * opciones y avisar antes de enviar, pero la regla la imponen el servidor
 * (parseClosure() y planOpportunityClosure() sobre la fila bloqueada) y la
 * base (CHECKs de cierre y el trigger de la oportunidad, que espejan estas
 * listas).
 *
 * - Perdida: motivo estructurado obligatorio y notas opcionales.
 * - Ganada: unidad vinculada (la vendida), precio final con su moneda,
 *   forma de pago y estado y fecha de entrega.
 * - Una vez cerrada, ni la etapa ni sus metadatos cambian.
 */

/** Resultados de un cierre: las etapas terminales (DEC-032 §1). */
export const CLOSURE_OUTCOMES = TERMINAL_STAGES;

export type ClosureOutcome = (typeof CLOSURE_OUTCOMES)[number];

export function isClosureOutcome(value: unknown): value is ClosureOutcome {
  return (
    typeof value === "string" &&
    (CLOSURE_OUTCOMES as readonly string[]).includes(value)
  );
}

/**
 * Motivo de pérdida estructurado (DEC-034 §2, reemplaza la lista de DEC-032
 * §3). `other` es la salida cuando ninguno aplica; el detalle va en las
 * notas.
 */
export const LOSS_REASONS = [
  "price",
  "vehicle_unavailable",
  "competitor",
  "financing_rejected",
  "ghosted",
  "other",
] as const;

export type LossReason = (typeof LOSS_REASONS)[number];

export function isLossReason(value: unknown): value is LossReason {
  return (
    typeof value === "string" &&
    (LOSS_REASONS as readonly string[]).includes(value)
  );
}

/** Forma de pago de una venta (DEC-034 §3). */
export const PAYMENT_METHODS = [
  "cash",
  "financing",
  "trade_in",
  "mixed",
] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/**
 * Estado de la entrega al cerrar la venta (DEC-034 §3): siempre con fecha.
 * `scheduled`: hoy o después; `delivered`: hoy o antes.
 */
export const DELIVERY_STATUSES = ["scheduled", "delivered"] as const;

export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

/** Largo máximo de las notas de una pérdida (como `char_length`). */
export const LOSS_NOTES_MAX_LENGTH = 500;

/**
 * Fechas de entrega posibles: las del CHECK
 * `opportunities_delivery_date_check`. Una cota de cordura, no una regla
 * comercial (esa es la de hoy, según el estado).
 */
export const DELIVERY_DATE_RANGE = {
  min: "2000-01-01",
  max: "2100-12-31",
} as const;

/**
 * Campos que el servidor lee del pedido: la oportunidad, el resultado y los
 * campos de ese resultado. Organización, usuario, etapa de origen, unidad y
 * reloj nunca salen del cliente.
 */
export const CLOSURE_FIELDS = {
  opportunityId: "opportunityId",
  outcome: "outcome",
  lossReason: "lossReason",
  lossNotes: "lossNotes",
  salePrice: "salePrice",
  saleCurrency: "saleCurrency",
  paymentMethod: "paymentMethod",
  deliveryStatus: "deliveryStatus",
  deliveryDate: "deliveryDate",
} as const;

/** Campos de cada resultado; los del otro resultado se ignoran. */
export const OUTCOME_FIELDS = {
  won: [
    "salePrice",
    "saleCurrency",
    "paymentMethod",
    "deliveryStatus",
    "deliveryDate",
  ],
  lost: ["lossReason", "lossNotes"],
} as const satisfies Record<
  ClosureOutcome,
  readonly (keyof typeof CLOSURE_FIELDS)[]
>;

export type WonField = (typeof OUTCOME_FIELDS.won)[number];
export type LostField = (typeof OUTCOME_FIELDS.lost)[number];
export type ClosureField = WonField | LostField;

/** Lo que tipeó el usuario en cada campo, tal cual llegó. */
export type ClosureValues<F extends ClosureField = ClosureField> = Readonly<
  Record<F, string>
>;

/** Una venta, ya validada. */
export type WonClosure = Readonly<{
  outcome: "won";
  salePrice: Money;
  paymentMethod: PaymentMethod;
  deliveryStatus: DeliveryStatus;
  /** Día de calendario, "AAAA-MM-DD". */
  deliveryDate: string;
}>;

/** Una pérdida, ya validada. */
export type LostClosure = Readonly<{
  outcome: "lost";
  lossReason: LossReason;
  /** Normalizadas; null si no hay. */
  lossNotes: string | null;
}>;

export type Closure = WonClosure | LostClosure;

/** Por qué un campo no es válido. */
export const CLOSURE_FIELD_ERRORS = [
  "required",
  "invalid_option",
  "invalid_amount",
  "not_positive",
  "pyg_decimals",
  "invalid_date",
  "delivered_in_future",
  "scheduled_in_past",
  "too_long",
] as const;

export type ClosureFieldError = (typeof CLOSURE_FIELD_ERRORS)[number];

export type ClosureErrors = Partial<Record<ClosureField, ClosureFieldError>>;

export type ParsedClosure =
  | Readonly<{ ok: true; closure: Closure }>
  | Readonly<{ ok: false; errors: ClosureErrors }>;

/* ── Validación (Zod, DEC-034 §7) ───────────────────────────────────────── */

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "AAAA-MM-DD" que existe en el calendario (sin 31 de abril ni 29/2 de 2026). */
export function isCalendarDate(value: string): boolean {
  const match = DATE.exec(value);
  if (!match) return false;
  const [year, month, day] = [match[1], match[2], match[3]].map(Number) as [
    number,
    number,
    number,
  ];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

const required = z.string().trim().min(1, "required");

function choice<const T extends readonly [string, ...string[]]>(values: T) {
  return required.pipe(z.enum(values, { error: "invalid_option" }));
}

/** Monto es-PY → decimal canónico ("32.990,5" → "32990.50"), mayor que cero. */
const amount = required.transform((raw, ctx) => {
  const parsed = parseAmount(raw);
  if (
    parsed === null ||
    parsed.split(".")[0]!.length > MAX_AMOUNT_INTEGER_DIGITS
  ) {
    ctx.addIssue({ code: "custom", message: "invalid_amount" });
    return z.NEVER;
  }
  if (parsed === "0.00") {
    ctx.addIssue({ code: "custom", message: "not_positive" });
    return z.NEVER;
  }
  return parsed;
});

const calendarDate = required
  .refine(isCalendarDate, "invalid_date")
  .refine(
    (value) =>
      value >= DELIVERY_DATE_RANGE.min && value <= DELIVERY_DATE_RANGE.max,
    "invalid_date",
  );

/** Las notas se normalizan como las de la bitácora (DEC-033 §1). */
const lossNotes = z
  .string()
  .transform(normalizeNoteBody)
  .refine((notes) => noteLength(notes) <= LOSS_NOTES_MAX_LENGTH, "too_long")
  .transform((notes) => (notes === "" ? null : notes));

/** Si ninguno de `fields` tiene ya un error: la regla cruzada se evalúa. */
function whenValid(fields: readonly WonField[]) {
  return {
    when: (payload: { issues: readonly { path?: PropertyKey[] }[] }) =>
      !payload.issues.some((issue) =>
        fields.includes(issue.path?.[0] as WonField),
      ),
  };
}

function wonSchema(today: string) {
  return z
    .object({
      salePrice: amount,
      saleCurrency: choice(CURRENCIES as readonly [Currency, ...Currency[]]),
      paymentMethod: choice(PAYMENT_METHODS),
      deliveryStatus: choice(DELIVERY_STATUSES),
      deliveryDate: calendarDate,
    })
    .superRefine(
      (value, ctx) => {
        // PYG no tiene unidad menor (DEC-025 §6).
        if (value.saleCurrency === "PYG" && !value.salePrice.endsWith(".00")) {
          ctx.addIssue({
            code: "custom",
            path: ["salePrice"],
            message: "pyg_decimals",
          });
        }
      },
      whenValid(["salePrice", "saleCurrency"]),
    )
    .superRefine(
      (value, ctx) => {
        if (
          value.deliveryStatus === "delivered" &&
          value.deliveryDate > today
        ) {
          ctx.addIssue({
            code: "custom",
            path: ["deliveryDate"],
            message: "delivered_in_future",
          });
        }
        if (
          value.deliveryStatus === "scheduled" &&
          value.deliveryDate < today
        ) {
          ctx.addIssue({
            code: "custom",
            path: ["deliveryDate"],
            message: "scheduled_in_past",
          });
        }
      },
      whenValid(["deliveryStatus", "deliveryDate"]),
    );
}

const lostSchema = z.object({
  lossReason: choice(LOSS_REASONS),
  lossNotes,
});

function isClosureFieldError(value: string): value is ClosureFieldError {
  return (CLOSURE_FIELD_ERRORS as readonly string[]).includes(value);
}

/** El primer error de cada campo, con el código de este módulo. */
function errorsOf(error: z.ZodError): ClosureErrors {
  const errors: ClosureErrors = {};
  for (const issue of error.issues) {
    const field = issue.path[0] as ClosureField;
    if (errors[field] !== undefined) continue;
    errors[field] = isClosureFieldError(issue.message)
      ? issue.message
      : "invalid_option";
  }
  return errors;
}

/**
 * Valida un pedido de cierre, que es input no confiable. Solo mira los
 * campos de `outcome`. `today` es el día de Asunción ("AAAA-MM-DD",
 * todayInAsuncion()): la fecha de una entrega hecha no puede ser posterior,
 * ni la de una programada anterior.
 */
export function parseClosure(
  outcome: ClosureOutcome,
  values: ClosureValues,
  today: string,
): ParsedClosure {
  if (outcome === "won") {
    const parsed = wonSchema(today).safeParse(values);
    if (!parsed.success) return { ok: false, errors: errorsOf(parsed.error) };
    const { salePrice, saleCurrency, ...rest } = parsed.data;
    return {
      ok: true,
      closure: {
        outcome,
        salePrice: { amount: salePrice, currency: saleCurrency },
        ...rest,
      },
    };
  }
  const parsed = lostSchema.safeParse(values);
  if (!parsed.success) return { ok: false, errors: errorsOf(parsed.error) };
  return { ok: true, closure: { outcome, ...parsed.data } };
}

/** Zona horaria de "hoy": P1 opera en Paraguay. */
export const CLOSURE_TIME_ZONE = "America/Asuncion";

const CALENDAR_DAY = new Intl.DateTimeFormat("en-US", {
  timeZone: CLOSURE_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** El día de Asunción de un instante, "AAAA-MM-DD". */
export function todayInAsuncion(now: Date): string {
  const parts = Object.fromEntries(
    CALENDAR_DAY.formatToParts(now).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/* ── Plan sobre la fila bloqueada ───────────────────────────────────────── */

/** Lo que el servidor lee de la oportunidad antes de cerrarla. */
export type ClosureTarget = Readonly<{
  stage: Stage;
  vehicleId: string | null;
}>;

/** Qué hacer con un cierre, dado el estado actual de la oportunidad. */
export type ClosurePlan =
  /** Escribir la etapa terminal y sus metadatos, juntos. */
  | Readonly<{ kind: "close"; from: Stage; closure: Closure }>
  /** Ya estaba cerrada así: los metadatos no se reescriben. */
  | Readonly<{ kind: "unchanged"; stage: ClosureOutcome }>
  /** El pase no existe (incluye una ya cerrada con el otro resultado). */
  | Readonly<{ kind: "invalid_transition"; from: Stage; to: ClosureOutcome }>
  /** Ganar exige la unidad vinculada: es la que se vende. */
  | Readonly<{ kind: "vehicle_required"; from: Stage }>;

/**
 * Decide, sin tocar nada, qué pasa con un cierre. Pedir el cierre que ya
 * tiene es idempotente (`unchanged`): los metadatos son inmutables y no se
 * comparan ni se reescriben.
 */
export function planOpportunityClosure(
  target: ClosureTarget,
  closure: Closure,
): ClosurePlan {
  const to = closure.outcome;
  if (target.stage === to) return { kind: "unchanged", stage: to };
  if (!canTransition(target.stage, to)) {
    return { kind: "invalid_transition", from: target.stage, to };
  }
  if (to === "won" && target.vehicleId === null) {
    return { kind: "vehicle_required", from: target.stage };
  }
  return { kind: "close", from: target.stage, closure };
}

/* ── Presentación ───────────────────────────────────────────────────────── */

/** Opciones de cada lista, en el orden en que se ofrecen. */
export const LOSS_REASON_OPTIONS: readonly { id: LossReason; label: string }[] =
  LOSS_REASONS.map((id) => ({ id, label: LOSS_REASON_LABELS[id] }));

export const PAYMENT_METHOD_OPTIONS: readonly {
  id: PaymentMethod;
  label: string;
}[] = PAYMENT_METHODS.map((id) => ({ id, label: PAYMENT_METHOD_LABELS[id] }));

export const DELIVERY_STATUS_OPTIONS: readonly {
  id: DeliveryStatus;
  label: string;
}[] = DELIVERY_STATUSES.map((id) => ({
  id,
  label: DELIVERY_STATUS_LABELS[id],
}));

/** Columnas de cierre tal como las lee la capa de datos. */
export type ClosureRow = Readonly<{
  stage: Stage;
  lossReason: LossReason | null;
  lossNotes: string | null;
  salePrice: string | null;
  saleCurrency: Currency | null;
  paymentMethod: PaymentMethod | null;
  deliveryStatus: DeliveryStatus | null;
  deliveryDate: string | null;
}>;

/**
 * El cierre de una fila, o null si no está cerrada. La base garantiza que
 * una fila cerrada tiene sus metadatos completos (CHECKs de DEC-034 §5); si
 * faltara alguno, no se inventa: es null.
 */
export function closureFromRow(row: ClosureRow): Closure | null {
  if (row.stage === "lost") {
    return row.lossReason === null
      ? null
      : {
          outcome: "lost",
          lossReason: row.lossReason,
          lossNotes: row.lossNotes,
        };
  }
  if (row.stage !== "won") return null;
  const { salePrice, saleCurrency, paymentMethod, deliveryStatus } = row;
  if (
    salePrice === null ||
    saleCurrency === null ||
    paymentMethod === null ||
    deliveryStatus === null ||
    row.deliveryDate === null
  ) {
    return null;
  }
  return {
    outcome: "won",
    salePrice: { amount: salePrice, currency: saleCurrency },
    paymentMethod,
    deliveryStatus,
    deliveryDate: row.deliveryDate,
  };
}

const CALENDAR_DATE = new Intl.DateTimeFormat("es-PY", {
  timeZone: "UTC",
  day: "numeric",
  month: "short",
  year: "numeric",
});

/** Día de calendario para mostrar: "2026-10-11" → "11 oct 2026". */
export function formatCalendarDate(value: string): string {
  const match = DATE.exec(value);
  if (!match) throw new Error(`invalid calendar date: ${value}`);
  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  );
  const parts = Object.fromEntries(
    CALENDAR_DATE.formatToParts(date).map((part) => [part.type, part.value]),
  );
  const month = (parts.month ?? "").replace(/\.$/, "");
  return `${parts.day} ${month} ${parts.year}`;
}

/** Lo que muestra la tarjeta "Cierre" de /opportunities/[id]. */
export type ClosureSummary =
  | Readonly<{
      outcome: "won";
      /** "USD 47.500". */
      salePrice: string;
      /** "Financiación". */
      paymentMethod: string;
      /** "Entregada el 11 oct 2026" o "Programada para el 15 oct 2026". */
      delivery: string;
    }>
  | Readonly<{
      outcome: "lost";
      /** "Compró en la competencia". */
      reason: string;
      notes: string | null;
    }>;

export function closureSummary(closure: Closure): ClosureSummary {
  if (closure.outcome === "lost") {
    return {
      outcome: "lost",
      reason: LOSS_REASON_LABELS[closure.lossReason],
      notes: closure.lossNotes,
    };
  }
  const date = formatCalendarDate(closure.deliveryDate);
  return {
    outcome: "won",
    salePrice: formatMoney(closure.salePrice),
    paymentMethod: PAYMENT_METHOD_LABELS[closure.paymentMethod],
    delivery:
      closure.deliveryStatus === "delivered"
        ? `Entregada el ${date}`
        : `Programada para el ${date}`,
  };
}

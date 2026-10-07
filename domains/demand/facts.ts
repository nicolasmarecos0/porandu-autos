import {
  CURRENCIES,
  MAX_AMOUNT_INTEGER_DIGITS,
  type Currency,
  type Money,
} from "@/domains/money";

/*
 * Demand Contract (H1.4, DEC-030 §1): la demanda tipada de una oportunidad.
 * Módulo puro y apto para el navegador: tipos, reglas de forma e igualdad.
 * No carga datos ni conoce la base, React o Next.
 *
 * La lista de facts es cerrada: agregar uno requiere migración y DEC. Todos
 * son opcionales: el que no se conoce es Unknown ("Sin dato", DEC-005) y no
 * se persiste como fact.
 *
 * Las mismas reglas las defiende la base (CHECKs de 0007): el dominio las
 * aplica antes, con un error por campo, para que nada inválido llegue a
 * PostgreSQL (en particular, decimales de más que `numeric` redondearía).
 */

/** Facts de la demanda v0, en el orden canónico (evaluación y escritura). */
export const DEMAND_FACTS = [
  "desired_vehicle",
  "year_range",
  "budget_max",
  "purchase_type",
  "trade_in_intent",
  "down_payment",
] as const;

export type DemandFact = (typeof DEMAND_FACTS)[number];

export function isDemandFact(value: unknown): value is DemandFact {
  return (DEMAND_FACTS as readonly unknown[]).includes(value);
}

/** Pregunta 1 (TB §7): Contado, Financiado, A definir. */
export const PURCHASE_TYPES = ["cash", "financed", "undecided"] as const;

export type PurchaseType = (typeof PURCHASE_TYPES)[number];

/**
 * Vehículo buscado: marca y/o modelo, al menos uno. Un solo vehículo en v0 y
 * sin versión (C-4). Sin catálogo ni normalización de mayúsculas.
 */
export type DesiredVehicle = Readonly<{ brand?: string; model?: string }>;

/** Año modelo aceptable: al menos un extremo; el ausente queda abierto. */
export type YearRange = Readonly<{ min?: number; max?: number }>;

/** Valor de cada fact. Los montos son decimales exactos en texto. */
export type DemandValues = {
  /** Qué vehículo busca. */
  desired_vehicle: DesiredVehicle;
  /** Rango de año modelo aceptable. */
  year_range: YearRange;
  /** Precio total máximo del vehículo. `amount > 0`. */
  budget_max: Money;
  purchase_type: PurchaseType;
  /** ¿Entrega un usado como parte de pago? `false` no es Unknown. */
  trade_in_intent: boolean;
  /** Efectivo inicial, sin el valor del usado. `amount ≥ 0` (C-6). */
  down_payment: Money;
};

export type DemandValue<F extends DemandFact = DemandFact> = DemandValues[F];

/** Largos máximos de los textos (C-12): los mismos CHECKs de la base. */
export const DEMAND_TEXT_MAX_LENGTH = {
  brand: 40,
  model: 80,
  evidenceText: 500,
} as const;

/** Año modelo: el rango del CHECK de la base (como `vehicles.year`). */
export const DEMAND_YEAR_RANGE = { min: 1900, max: 2100 } as const;

/** Campos de un fact, para ubicar un error. `value` es el fact entero. */
export type DemandField =
  "brand" | "model" | "min" | "max" | "amount" | "currency" | "value";

/** Error de validación de un campo. El copy (es-PY) lo pone la UI. */
export type DemandFieldError =
  /** Falta un dato obligatorio del fact (monto, moneda). */
  | "required"
  /** El fact no tiene ningún dato (`{}`): ausencia es Unknown, no un fact. */
  | "empty"
  /** Un campo que el contrato no tiene (p. ej. `version`). */
  | "unexpected_field"
  | "too_long"
  /** Texto vacío, con espacios en los bordes o con caracteres de control. */
  | "invalid_text"
  | "invalid_year"
  /** Desde mayor que hasta. */
  | "year_order"
  | "invalid_amount"
  /** Presupuesto en cero. */
  | "not_positive"
  /** Más de dos decimales. */
  | "too_many_decimals"
  /** Guaraníes con decimales. */
  | "pyg_decimals"
  | "invalid_currency"
  | "invalid_option"
  | "invalid_boolean";

export type DemandFieldErrors = Readonly<
  Partial<Record<DemandField, DemandFieldError>>
>;

export type FactValidation<F extends DemandFact> =
  | Readonly<{ ok: true; value: DemandValues[F] }>
  | Readonly<{ ok: false; errors: DemandFieldErrors }>;

/** Caracteres de control (`[[:cntrl:]]` en el CHECK de la base). */
const CONTROL = /\p{Cc}/u;

/** Largo en caracteres, como `char_length` de PostgreSQL (no UTF-16). */
function charLength(text: string): number {
  return Array.from(text).length;
}

/**
 * Texto de una línea ya normalizado: no vacío, sin espacios en los bordes,
 * sin caracteres de control y con hasta `max` caracteres. El formulario lo
 * normaliza antes (lib/forms/text.ts); acá solo se verifica.
 */
export function checkText(text: unknown, max: number): DemandFieldError | null {
  if (typeof text !== "string") return "invalid_text";
  if (text === "" || text !== text.trim() || CONTROL.test(text)) {
    return "invalid_text";
  }
  return charLength(text) > max ? "too_long" : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Campos presentes (ni `undefined` ni `null`): ausente es "sin dato". */
function presentKeys(value: Record<string, unknown>): string[] {
  return Object.keys(value).filter(
    (key) => value[key] !== undefined && value[key] !== null,
  );
}

function unexpected(
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  return presentKeys(value).some((key) => !allowed.includes(key));
}

function validateDesiredVehicle(
  value: unknown,
): FactValidation<"desired_vehicle"> {
  if (!isRecord(value)) return { ok: false, errors: { value: "invalid_text" } };
  if (unexpected(value, ["brand", "model"])) {
    return { ok: false, errors: { value: "unexpected_field" } };
  }
  const errors: Partial<Record<DemandField, DemandFieldError>> = {};
  const vehicle: { brand?: string; model?: string } = {};
  for (const field of ["brand", "model"] as const) {
    const text = value[field];
    if (text === undefined || text === null) continue;
    const error = checkText(text, DEMAND_TEXT_MAX_LENGTH[field]);
    if (error) errors[field] = error;
    else vehicle[field] = text as string;
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  if (vehicle.brand === undefined && vehicle.model === undefined) {
    return { ok: false, errors: { value: "empty" } };
  }
  return { ok: true, value: vehicle };
}

function validYear(year: unknown): year is number {
  return (
    typeof year === "number" &&
    Number.isInteger(year) &&
    year >= DEMAND_YEAR_RANGE.min &&
    year <= DEMAND_YEAR_RANGE.max
  );
}

function validateYearRange(value: unknown): FactValidation<"year_range"> {
  if (!isRecord(value)) return { ok: false, errors: { value: "invalid_year" } };
  if (unexpected(value, ["min", "max"])) {
    return { ok: false, errors: { value: "unexpected_field" } };
  }
  const errors: Partial<Record<DemandField, DemandFieldError>> = {};
  const range: { min?: number; max?: number } = {};
  for (const field of ["min", "max"] as const) {
    const year = value[field];
    if (year === undefined || year === null) continue;
    if (validYear(year)) range[field] = year;
    else errors[field] = "invalid_year";
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  if (range.min === undefined && range.max === undefined) {
    return { ok: false, errors: { value: "empty" } };
  }
  if (
    range.min !== undefined &&
    range.max !== undefined &&
    range.min > range.max
  ) {
    return { ok: false, errors: { max: "year_order" } };
  }
  return { ok: true, value: range };
}

/** Decimal en texto, sin signo ni separadores de miles ("29990.50"). */
const DECIMAL = /^(\d+)(?:\.(\d+))?$/;

/**
 * Forma canónica de un monto: sin ceros a la izquierda y con dos decimales
 * ("0250000000" → "250000000.00", "29990.5" → "29990.50"), la misma que
 * devuelve `numeric(14, 2)`. Null si no es un decimal sin signo o si tiene
 * más de dos decimales significativos.
 */
export function canonicalAmount(amount: string): string | null {
  const match = DECIMAL.exec(amount);
  if (!match) return null;
  const integer = match[1]!.replace(/^0+(?=\d)/, "");
  const fraction = (match[2] ?? "").replace(/0+$/, "");
  if (fraction.length > 2) return null;
  return `${integer}.${fraction.padEnd(2, "0")}`;
}

function validateMoney(
  value: unknown,
  minimum: "positive" | "non_negative",
): FactValidation<"budget_max" | "down_payment"> {
  if (!isRecord(value)) {
    return { ok: false, errors: { value: "invalid_amount" } };
  }
  if (unexpected(value, ["amount", "currency"])) {
    return { ok: false, errors: { value: "unexpected_field" } };
  }
  const errors: Partial<Record<DemandField, DemandFieldError>> = {};
  const { amount, currency } = value;

  let validCurrency: Currency | undefined;
  if (currency === undefined || currency === null) errors.currency = "required";
  else {
    validCurrency = CURRENCIES.find((candidate) => candidate === currency);
    if (!validCurrency) errors.currency = "invalid_currency";
  }

  let canonical: string | null = null;
  if (amount === undefined || amount === null) errors.amount = "required";
  else if (typeof amount !== "string" || !DECIMAL.test(amount)) {
    errors.amount = "invalid_amount";
  } else {
    const [, rawInteger, rawFraction = ""] = DECIMAL.exec(amount)!;
    const integer = rawInteger!.replace(/^0+(?=\d)/, "");
    const fraction = rawFraction.replace(/0+$/, "");
    if (integer.length > MAX_AMOUNT_INTEGER_DIGITS) {
      errors.amount = "invalid_amount";
    } else if (validCurrency === "PYG" && fraction !== "") {
      errors.amount = "pyg_decimals";
    } else if (fraction.length > 2) {
      errors.amount = "too_many_decimals";
    } else {
      canonical = `${integer}.${fraction.padEnd(2, "0")}`;
      if (minimum === "positive" && canonical === "0.00") {
        errors.amount = "not_positive";
      }
    }
  }

  if (Object.keys(errors).length > 0 || !validCurrency || canonical === null) {
    return { ok: false, errors };
  }
  return { ok: true, value: { amount: canonical, currency: validCurrency } };
}

/**
 * Valida la forma de un valor para un fact y lo devuelve en su forma
 * canónica, o los errores por campo. Recibe `unknown`: lo que llega del
 * formulario (o de una fuente futura) no se da por bueno.
 */
export function validateFactValue<F extends DemandFact>(
  fact: F,
  value: unknown,
): FactValidation<F> {
  // Cada rama devuelve la validación del fact F; TypeScript no estrecha F
  // por el switch, de ahí la conversión.
  switch (fact) {
    case "desired_vehicle":
      return validateDesiredVehicle(value) as FactValidation<F>;
    case "year_range":
      return validateYearRange(value) as FactValidation<F>;
    case "budget_max":
      return validateMoney(value, "positive") as FactValidation<F>;
    case "down_payment":
      return validateMoney(value, "non_negative") as FactValidation<F>;
    case "purchase_type":
      return (
        PURCHASE_TYPES.some((type) => type === value)
          ? { ok: true, value }
          : { ok: false, errors: { value: "invalid_option" } }
      ) as FactValidation<F>;
    case "trade_in_intent":
      return (
        typeof value === "boolean"
          ? { ok: true, value }
          : { ok: false, errors: { value: "invalid_boolean" } }
      ) as FactValidation<F>;
  }
  throw new Error(`unknown demand fact: ${String(fact)}`);
}

function sameMoney(a: Money, b: Money): boolean {
  if (a.currency !== b.currency) return false;
  const left = canonicalAmount(a.amount);
  return left !== null && left === canonicalAmount(b.amount);
}

/**
 * Igualdad de valores de un mismo fact (spec §5):
 * - montos: iguales numéricamente y en la misma moneda;
 * - textos: igualdad exacta sobre la forma canónica (sin mayúsculas);
 * - objetos: igualdad estructural, con ausente = null. Un valor que es
 *   subconjunto de otro no es igual (`{model:"Hilux"}` ≠
 *   `{brand:"Toyota", model:"Hilux"}`).
 */
export function demandValueEquals<F extends DemandFact>(
  fact: F,
  a: DemandValues[F],
  b: DemandValues[F],
): boolean {
  switch (fact) {
    case "desired_vehicle": {
      const [x, y] = [a, b] as [DesiredVehicle, DesiredVehicle];
      return (
        (x.brand ?? null) === (y.brand ?? null) &&
        (x.model ?? null) === (y.model ?? null)
      );
    }
    case "year_range": {
      const [x, y] = [a, b] as [YearRange, YearRange];
      return (
        (x.min ?? null) === (y.min ?? null) &&
        (x.max ?? null) === (y.max ?? null)
      );
    }
    case "budget_max":
    case "down_payment":
      return sameMoney(a as Money, b as Money);
    default:
      return a === b;
  }
}

/** Nota de un acto humano (`evidence_text`): opcional, de 1 a 500. */
export function checkEvidenceText(note: unknown): DemandFieldError | null {
  return checkText(note, DEMAND_TEXT_MAX_LENGTH.evidenceText);
}

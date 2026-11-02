import type { Money } from "@/domains/money";

/*
 * Precio de una cotización (Hito 10, DEC-042 §3). Módulo puro y apto para
 * el navegador: el formulario lo usa para mostrar el total mientras se
 * escribe, el servidor para calcular lo que guarda, y la base vuelve a
 * exigir el mismo resultado con el CHECK `quotes_total_price_check` de
 * 0016_quotes (un test cruza los dos cálculos).
 *
 * - El precio de lista es el precio publicado de la unidad al crear la
 *   cotización (lo copia el servidor, no sale del cliente).
 * - El descuento es uno solo: ninguno, un monto o un porcentaje.
 * - El total es lista − descuento. Precio publicado ≠ precio ofertado
 *   (DEC-003).
 *
 * Todo el cálculo es sobre enteros (centavos, BigInt), nunca float: el total
 * que se ve es exactamente el que guarda la base.
 */

export const DISCOUNT_KINDS = ["none", "amount", "percent"] as const;

export type DiscountKind = (typeof DISCOUNT_KINDS)[number];

export function isDiscountKind(value: unknown): value is DiscountKind {
  return (
    typeof value === "string" &&
    (DISCOUNT_KINDS as readonly string[]).includes(value)
  );
}

/** Copy visible (es-PY) de cada tipo de descuento. */
export const DISCOUNT_KIND_LABELS: Readonly<Record<DiscountKind, string>> = {
  none: "Sin descuento",
  amount: "Monto fijo",
  percent: "Porcentaje",
};

/**
 * Descuento máximo de una cotización, en puntos porcentuales efectivos
 * (también para un monto fijo). Tope de cordura comercial: la base lo
 * vuelve a exigir con `quotes_discount_check`.
 */
export const MAX_DISCOUNT_PERCENT = 30;

/**
 * Descuento efectivo hasta el que cualquier miembro aprueba la cotización.
 * Por encima, aprobarla exige el rol `admin` (el trigger
 * `quotes_status_transition` lo vuelve a exigir).
 */
export const SELLER_DISCOUNT_LIMIT_PERCENT = 10;

/** Un descuento ya validado. `value` es un decimal canónico ("7.50"). */
export type Discount =
  | Readonly<{ kind: "none" }>
  | Readonly<{ kind: "amount"; value: string }>
  | Readonly<{ kind: "percent"; value: string }>;

export const NO_DISCOUNT: Discount = { kind: "none" };

/**
 * El descuento de una fila guardada (`discount_kind` + `discount_value`).
 * El CHECK `quotes_discount_check` garantiza que `none` va sin valor y los
 * otros dos con uno; un valor ausente se lee como sin descuento.
 */
export function discountFrom(
  kind: DiscountKind,
  value: string | null,
): Discount {
  if (kind === "none" || value === null) return NO_DISCOUNT;
  return { kind, value };
}

const DECIMAL = /^(\d+)\.(\d{2})$/;

// Constantes BigInt sin literales `n`: el target de TypeScript es ES2017.
const ZERO = BigInt(0);
const TWO = BigInt(2);
const HUNDRED = BigInt(100);
const TEN_THOUSAND = BigInt(10_000);

/** Centavos de un decimal canónico de dos decimales ("32990.50" → 3.299.050 centavos). */
export function toCents(amount: string): bigint {
  const match = DECIMAL.exec(amount);
  if (!match) throw new Error(`invalid canonical amount: ${amount}`);
  return BigInt(match[1]!) * HUNDRED + BigInt(match[2]!);
}

/** Decimal canónico de dos decimales de unos centavos (3.299.050 centavos → "32990.50"). */
export function fromCents(cents: bigint): string {
  if (cents < ZERO) throw new Error(`negative amount: ${cents}`);
  const integer = cents / HUNDRED;
  const fraction = (cents % HUNDRED).toString().padStart(2, "0");
  return `${integer}.${fraction}`;
}

/**
 * División entera redondeando la mitad hacia arriba, para positivos: lo
 * mismo que `round()` de Postgres sobre `numeric` (la mitad se aleja del
 * cero).
 */
function divideRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (numerator * TWO + denominator) / (denominator * TWO);
}

/**
 * Total de una cotización: lista − descuento, en la moneda de la lista. PYG
 * no tiene unidad menor (DEC-025 §6): un porcentaje sobre guaraníes se
 * redondea al guaraní. USD se redondea al centavo.
 */
export function quoteTotal(listPrice: Money, discount: Discount): Money {
  const list = toCents(listPrice.amount);
  switch (discount.kind) {
    case "none":
      return listPrice;
    case "amount":
      return {
        amount: fromCents(list - toCents(discount.value)),
        currency: listPrice.currency,
      };
    case "percent": {
      // Puntos básicos: "7.50" % → 750 de 10.000.
      const remaining = TEN_THOUSAND - toCents(discount.value);
      const total =
        listPrice.currency === "PYG"
          ? divideRoundHalfUp((list / HUNDRED) * remaining, TEN_THOUSAND) *
            HUNDRED
          : divideRoundHalfUp(list * remaining, TEN_THOUSAND);
      return { amount: fromCents(total), currency: listPrice.currency };
    }
  }
}

/** Monto descontado (lista − total), siempre en la moneda de la lista. */
export function discountAmount(listPrice: Money, discount: Discount): Money {
  const total = quoteTotal(listPrice, discount);
  return {
    amount: fromCents(toCents(listPrice.amount) - toCents(total.amount)),
    currency: listPrice.currency,
  };
}

/**
 * ¿El descuento supera `percent` puntos efectivos? Comparación exacta, sin
 * dividir: para un monto, `valor × 100 > percent × lista`.
 */
export function discountExceeds(
  listPrice: Money,
  discount: Discount,
  percent: number,
): boolean {
  switch (discount.kind) {
    case "none":
      return false;
    case "amount":
      return (
        toCents(discount.value) * HUNDRED >
        BigInt(percent) * toCents(listPrice.amount)
      );
    case "percent":
      // El valor en centésimas de punto: "10.01" % → 1001.
      return toCents(discount.value) > BigInt(percent) * HUNDRED;
  }
}

/** ¿Aprobar la cotización exige el rol `admin`? */
export function requiresAdminApproval(
  listPrice: Money,
  discount: Discount,
): boolean {
  return discountExceeds(listPrice, discount, SELLER_DISCOUNT_LIMIT_PERCENT);
}

/**
 * Descuento efectivo para mostrar, en porcentaje con hasta dos decimales y
 * coma es-PY ("7,5 %"). Solo presentación: las reglas comparan con
 * discountExceeds(), que es exacta.
 */
export function formatEffectivePercent(
  listPrice: Money,
  discount: Discount,
): string {
  const list = toCents(listPrice.amount);
  const off = toCents(discountAmount(listPrice, discount).amount);
  // Centésimas de punto porcentual, redondeadas.
  const hundredths = divideRoundHalfUp(off * TEN_THOUSAND, list);
  const integer = hundredths / HUNDRED;
  const fraction = (hundredths % HUNDRED)
    .toString()
    .padStart(2, "0")
    .replace(/0+$/, "");
  return `${integer}${fraction === "" ? "" : `,${fraction}`} %`;
}

/** ¿Tiene `amount` centavos? PYG no los admite. */
export function hasCents(amount: string): boolean {
  return !amount.endsWith(".00");
}

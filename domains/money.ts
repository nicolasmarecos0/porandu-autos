/*
 * Dinero de Porandú (DEC-025 §5 y §6, DEC-030 §7): decimal exacto con moneda
 * explícita, nunca float. Lo comparten el precio de las unidades (Stock) y la
 * demanda de una oportunidad (presupuesto y entrega). Módulo puro y apto para
 * el navegador: no carga datos ni conoce la base.
 *
 * No hay conversión entre monedas: un monto en guaraníes y otro en dólares
 * no se comparan ni se suman.
 */

/** Monedas vigentes de P1 (las del CHECK de cada tabla con dinero). */
export type Currency = "PYG" | "USD";

export const CURRENCIES: readonly Currency[] = ["PYG", "USD"];

/** Copy de cada moneda en los formularios (es-PY). */
export const CURRENCY_LABELS: Readonly<Record<Currency, string>> = {
  PYG: "Gs. (guaraníes)",
  USD: "USD (dólares)",
};

/** Monto exacto: decimal en texto, nunca un `number` (float). */
export type Money = Readonly<{ amount: string; currency: Currency }>;

/** Dígitos enteros de un monto: `numeric(14, 2)` deja 12 antes de la coma. */
export const MAX_AMOUNT_INTEGER_DIGITS = 12;

/*
 * Números como se escriben en es-PY, igual que los muestra la UI
 * ("Gs. 150.000.000", "USD 32.990,50"): punto para los miles, en grupos de
 * tres, y coma para los decimales. También sin separadores. Nada se adivina:
 * un punto que no separa miles ("49900.50", "1.5") es ambiguo y se rechaza,
 * en vez de leerse como decimal.
 */
const AMOUNT = /^(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/;

/**
 * Monto exacto como decimal canónico con dos decimales ("32.990,5" →
 * "32990.50"), o null si el texto no es un monto escrito en es-PY. Trabaja
 * sobre el texto, sin pasar por float. No valida signo ni rango: un monto
 * nunca lleva signo, y el cero o el largo los decide quien lo usa.
 */
export function parseAmount(raw: string): string | null {
  const match = AMOUNT.exec(raw);
  if (!match) return null;
  const integer = match[1]!.replaceAll(".", "").replace(/^0+(?=\d)/, "");
  const fraction = (match[2] ?? "").padEnd(2, "0");
  return `${integer}.${fraction}`;
}

const CURRENCY_PREFIX: Readonly<Record<Currency, string>> = {
  USD: "USD",
  PYG: "Gs.",
};

/** Agrupa los miles con punto (es-PY): "49900" → "49.900". */
export function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

const DECIMAL = /^(\d+)(?:\.(\d+))?$/;

/**
 * Monto como se escribe en un formulario es-PY, sin moneda ("32990.50" →
 * "32.990,50", "150000000.00" → "150.000.000"). Es la inversa de
 * parseAmount(): lo que muestra un campo precargado se vuelve a leer igual.
 */
export function formatAmount(amount: string): string {
  const match = DECIMAL.exec(amount.trim());
  if (!match) throw new Error(`invalid decimal amount: ${amount}`);
  const integer = match[1]!.replace(/^0+(?=\d)/, "");
  const cents = (match[2] ?? "").replace(/0+$/, "");
  const fraction = cents === "" ? "" : `,${cents.padEnd(2, "0")}`;
  return `${groupThousands(integer)}${fraction}`;
}

/**
 * Monto para mostrar, con el formato del contrato visual de B1 ("USD 49.900",
 * "Gs. 150.000.000"). Trabaja sobre el texto decimal, sin pasar por float: el
 * valor que se ve es exactamente el guardado. Los centavos solo aparecen si
 * existen ("USD 49.900,50").
 */
export function formatMoney({ amount, currency }: Money): string {
  return `${CURRENCY_PREFIX[currency]} ${formatAmount(amount)}`;
}

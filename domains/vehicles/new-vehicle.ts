import {
  CURRENCIES,
  CURRENCY_LABELS,
  MAX_AMOUNT_INTEGER_DIGITS,
  parseAmount,
} from "@/domains/money";

/*
 * Alta rápida de una unidad (H1.3B): el contrato del formulario entre la UI y
 * la Server Action. Módulo puro y apto para el navegador: la UI lo usa para
 * los límites de cada campo, pero la validación definitiva ocurre siempre en
 * el servidor (lib/vehicles/new-vehicle.ts).
 *
 * El formulario solo trae datos de la unidad. Organización, estado, id,
 * timestamps, fotos, matches e interesados nunca salen del cliente: la unidad
 * nace siempre en preparación, en la organización activa.
 */

/** Únicos campos que el servidor lee del formulario. */
export const NEW_VEHICLE_FIELDS = [
  "brand",
  "model",
  "version",
  "year",
  "km",
  "price",
  "currency",
] as const;

export type NewVehicleField = (typeof NEW_VEHICLE_FIELDS)[number];

/**
 * Campos de texto libre, con su largo máximo después de normalizar espacios.
 * Límites defensivos de implementación, no reglas de producto: la base no
 * limita el largo de estos textos.
 */
export const NEW_VEHICLE_MAX_LENGTH: Readonly<
  Record<Extract<NewVehicleField, "brand" | "model" | "version">, number>
> = {
  brand: 40,
  model: 80,
  version: 80,
};

/** Año modelo: el rango del CHECK de la base (`vehicles_year_check`). */
export const VEHICLE_YEAR_RANGE = { min: 1900, max: 2100 } as const;

/** Mayor kilometraje que guarda la base (`integer` de PostgreSQL). */
export const MAX_KM = 2_147_483_647;

/** Dígitos enteros del precio: `numeric(14, 2)` deja 12 antes de la coma. */
export const MAX_PRICE_INTEGER_DIGITS = MAX_AMOUNT_INTEGER_DIGITS;

/*
 * Monedas del precio (DEC-025, las del CHECK de la base), su copy y el parseo
 * de montos es-PY: los de todo dinero de Porandú (domains/money.ts).
 */
export { CURRENCIES, CURRENCY_LABELS, parseAmount };

/** Error de validación de un campo. El copy (es-PY) lo pone la UI. */
export type NewVehicleFieldError =
  | "required"
  | "too_long"
  | "invalid_year"
  | "invalid_km"
  | "invalid_price"
  | "pyg_decimals"
  | "invalid_currency";

export type NewVehicleErrors = Readonly<
  Partial<Record<NewVehicleField, NewVehicleFieldError>>
>;

/** Lo que cargó el usuario, para no tener que reescribirlo tras un error. */
export type NewVehicleValues = Readonly<Record<NewVehicleField, string>>;

/*
 * Números como se escriben en es-PY, igual que los muestra Stock
 * ("142.000 km", "Gs. 150.000.000", "USD 32.990,50"): punto para los miles,
 * en grupos de tres, y coma para los decimales. También sin separadores.
 * Nada se adivina: un punto que no separa miles ("49900.50", "1.5") es
 * ambiguo y se rechaza, en vez de leerse como decimal.
 */
const WHOLE_NUMBER = /^(?:\d{1,3}(?:\.\d{3})+|\d+)$/;

/**
 * Entero no negativo ("142.000" → 142000), o null si el texto no es un
 * entero escrito en es-PY o no es exacto como `number`.
 */
export function parseWholeNumber(raw: string): number | null {
  if (!WHOLE_NUMBER.test(raw)) return null;
  const value = Number(raw.replaceAll(".", ""));
  return Number.isSafeInteger(value) ? value : null;
}

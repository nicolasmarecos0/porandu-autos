import type { NewVehicle } from "@/db/queries/create-vehicle";
import {
  CURRENCIES,
  MAX_KM,
  MAX_PRICE_INTEGER_DIGITS,
  NEW_VEHICLE_FIELDS,
  NEW_VEHICLE_MAX_LENGTH,
  parseAmount,
  parseWholeNumber,
  VEHICLE_YEAR_RANGE,
  type NewVehicleErrors,
  type NewVehicleField,
  type NewVehicleFieldError,
  type NewVehicleValues,
} from "@/domains/vehicles/new-vehicle";
import { singleLine } from "@/lib/forms/text";

/*
 * Validación definitiva del alta rápida de una unidad (H1.3B). Corre en el
 * servidor: la UI puede marcar campos obligatorios, pero nada de lo que
 * valide el navegador se da por bueno.
 *
 * - Solo lee los campos de NEW_VEHICLE_FIELDS. Cualquier otro campo del
 *   payload (organización, estado, id, timestamps, fotos) se ignora: no
 *   tiene adónde ir.
 * - Marca y modelo, obligatorios; versión, opcional (vacío = sin dato).
 *   Textos de una línea (NFC, sin caracteres de control, un solo espacio
 *   entre palabras) con largo máximo.
 * - Año, obligatorio: cuatro dígitos dentro del rango del CHECK de la base.
 * - Kilometraje, opcional (vacío = sin dato): entero ≥ 0, con o sin punto
 *   de miles. 0 es una unidad 0 km.
 * - Precio y moneda, opcionales pero juntos. Precio > 0, exacto (texto,
 *   nunca float), hasta dos decimales con coma y 12 dígitos enteros
 *   (numeric(14, 2)); en guaraníes, sin decimales. Moneda: PYG o USD.
 */

/** Estado del formulario que devuelve la Server Action createVehicle(). */
export type CreateVehicleState =
  | Readonly<{
      status: "invalid";
      errors: NewVehicleErrors;
      values: NewVehicleValues;
    }>
  /** Falla inesperada al guardar: nada quedó escrito y se puede reintentar. */
  | Readonly<{ status: "failed"; values: NewVehicleValues }>
  | Readonly<{
      status: "created";
      vehicleId: string;
      brand: string;
      model: string;
      year: number;
    }>
  | null;

export type ParsedNewVehicle =
  | Readonly<{ ok: true; input: NewVehicle; values: NewVehicleValues }>
  | Readonly<{
      ok: false;
      errors: NewVehicleErrors;
      values: NewVehicleValues;
    }>;

/** Cota de lo que vuelve al formulario tras un error (el eco del input). */
const MAX_ECHO_LENGTH = 256;

/** Año modelo: cuatro dígitos, sin separadores. */
const YEAR = /^\d{4}$/;

/** Un decimal canónico de parseAmount() es cero ("0.00"). */
function isZero(amount: string): boolean {
  return amount === "0.00";
}

/** Dígitos de la parte entera de un decimal canónico ("32990.50" → 5). */
function integerDigits(amount: string): number {
  return amount.indexOf(".");
}

export function parseNewVehicleForm(formData: FormData): ParsedNewVehicle {
  const values = Object.fromEntries(
    NEW_VEHICLE_FIELDS.map((field) => [field, singleLine(formData.get(field))]),
  ) as Record<NewVehicleField, string>;
  const errors: Partial<Record<NewVehicleField, NewVehicleFieldError>> = {};

  const text = (
    field: keyof typeof NEW_VEHICLE_MAX_LENGTH,
    required: boolean,
  ): string | null => {
    const value = values[field];
    if (value === "") {
      if (required) errors[field] = "required";
      return null;
    }
    if (value.length > NEW_VEHICLE_MAX_LENGTH[field]) {
      errors[field] = "too_long";
      return null;
    }
    return value;
  };

  const brand = text("brand", true);
  const model = text("model", true);
  const version = text("version", false);

  let year: number | null = null;
  if (values.year === "") {
    errors.year = "required";
  } else {
    const parsed = YEAR.test(values.year) ? Number(values.year) : NaN;
    if (parsed >= VEHICLE_YEAR_RANGE.min && parsed <= VEHICLE_YEAR_RANGE.max) {
      year = parsed;
    } else {
      errors.year = "invalid_year";
    }
  }

  let km: number | null = null;
  if (values.km !== "") {
    km = parseWholeNumber(values.km);
    if (km === null || km > MAX_KM) {
      errors.km = "invalid_km";
      km = null;
    }
  }

  // Precio y moneda van juntos: uno sin el otro es un dato incompleto.
  const currency = CURRENCIES.find(
    (candidate) => candidate === values.currency,
  );
  if (values.currency === "") {
    if (values.price !== "") errors.currency = "required";
  } else if (!currency) {
    errors.currency = "invalid_currency";
  }

  let amount: string | null = null;
  if (values.price === "") {
    if (values.currency !== "") errors.price = "required";
  } else {
    amount = parseAmount(values.price);
    if (
      amount === null ||
      isZero(amount) ||
      integerDigits(amount) > MAX_PRICE_INTEGER_DIGITS
    ) {
      errors.price = "invalid_price";
      amount = null;
    } else if (currency === "PYG" && !amount.endsWith(".00")) {
      errors.price = "pyg_decimals";
      amount = null;
    }
  }

  const echo = Object.fromEntries(
    NEW_VEHICLE_FIELDS.map((field) => [
      field,
      values[field].slice(0, MAX_ECHO_LENGTH),
    ]),
  ) as NewVehicleValues;

  if (
    brand === null ||
    model === null ||
    year === null ||
    Object.keys(errors).length > 0
  ) {
    return { ok: false, errors, values: echo };
  }
  return {
    ok: true,
    input: {
      brand,
      model,
      version,
      year,
      km,
      price: amount !== null && currency ? { amount, currency } : null,
    },
    values: echo,
  };
}

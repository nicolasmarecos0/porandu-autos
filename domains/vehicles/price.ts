import { z } from "zod";

import {
  CURRENCIES,
  MAX_AMOUNT_INTEGER_DIGITS,
  parseAmount,
  type Currency,
  type Money,
} from "@/domains/money";

import type { VehicleStatus } from "./stock";

/*
 * Precio publicado de una unidad (Hito 22, DEC-054 §3). Módulo puro y apto
 * para el navegador: la UI lo usa para validar antes de enviar y para saber
 * si la unidad admite un cambio de precio, pero la regla la imponen el
 * servidor (parseVehiclePrice() y planVehiclePriceChange() sobre la fila
 * bloqueada, con el rol de la membership) y la base (el trigger
 * vehicles_status_transition de 0023: solo un admin, nunca junto con el
 * estado, nunca de una vendida o entregada y sin borrarlo; y el CHECK
 * vehicles_price_check: positivo y en guaraníes sin decimales).
 *
 * Quién lo cambia (el admin) no lo decide este módulo: lo decide
 * lib/auth/roles.ts (`vehicle.edit_price`).
 */

/** Campos que el servidor lee del pedido. */
export const VEHICLE_PRICE_FIELDS = {
  vehicleId: "vehicleId",
  price: "price",
  currency: "currency",
} as const;

/** Estados en los que el precio publicado se puede cambiar. */
export const PRICE_EDITABLE_STATUSES = [
  "inPreparation",
  "available",
  "reserved",
] as const satisfies readonly VehicleStatus[];

export function isPriceEditable(status: VehicleStatus): boolean {
  return (PRICE_EDITABLE_STATUSES as readonly VehicleStatus[]).includes(status);
}

export type VehiclePriceField = "price" | "currency";

export type VehiclePriceValues = Readonly<Record<VehiclePriceField, string>>;

export const VEHICLE_PRICE_ERRORS = [
  "required",
  "invalid_price",
  "not_positive",
  "pyg_decimals",
  "invalid_currency",
] as const;

export type VehiclePriceError = (typeof VEHICLE_PRICE_ERRORS)[number];

export type VehiclePriceErrors = Partial<
  Record<VehiclePriceField, VehiclePriceError>
>;

export type ParsedVehiclePrice =
  | Readonly<{ ok: true; price: Money }>
  | Readonly<{ ok: false; errors: VehiclePriceErrors }>;

const schema = z
  .object({
    currency: z
      .string()
      .trim()
      .min(1, "required")
      .pipe(
        z.enum(CURRENCIES as readonly [Currency, ...Currency[]], {
          error: "invalid_currency",
        }),
      ),
    price: z.string().transform((raw, ctx) => {
      const value = raw.trim();
      if (value === "") {
        ctx.addIssue({ code: "custom", message: "required" });
        return z.NEVER;
      }
      const parsed = parseAmount(value);
      if (
        parsed === null ||
        parsed.split(".")[0]!.length > MAX_AMOUNT_INTEGER_DIGITS
      ) {
        ctx.addIssue({ code: "custom", message: "invalid_price" });
        return z.NEVER;
      }
      if (parsed === "0.00") {
        ctx.addIssue({ code: "custom", message: "not_positive" });
        return z.NEVER;
      }
      return parsed;
    }),
  })
  .superRefine((value, ctx) => {
    // PYG no tiene unidad menor (DEC-025 §6).
    if (value.currency === "PYG" && !value.price.endsWith(".00")) {
      ctx.addIssue({
        code: "custom",
        path: ["price"],
        message: "pyg_decimals",
      });
    }
  });

function isPriceError(value: string): value is VehiclePriceError {
  return (VEHICLE_PRICE_ERRORS as readonly string[]).includes(value);
}

/**
 * Valida un precio publicado (input no confiable, montos es-PY: "150.000.000",
 * "32.990,50"). El servidor lo repite siempre y el navegador también.
 */
export function parseVehiclePrice(
  values: VehiclePriceValues,
): ParsedVehiclePrice {
  const parsed = schema.safeParse(values);
  if (parsed.success) {
    return {
      ok: true,
      price: { amount: parsed.data.price, currency: parsed.data.currency },
    };
  }
  const errors: VehiclePriceErrors = {};
  for (const found of parsed.error.issues) {
    const field = found.path[0] as VehiclePriceField;
    if (errors[field] !== undefined) continue;
    errors[field] = isPriceError(found.message)
      ? found.message
      : field === "currency"
        ? "invalid_currency"
        : "invalid_price";
  }
  return { ok: false, errors };
}

/** La unidad, leída bloqueada. */
export type VehiclePriceTarget = Readonly<{
  status: VehicleStatus;
  price: Money | null;
}>;

export type VehiclePricePlan =
  | Readonly<{ kind: "change"; from: Money | null; to: Money }>
  /** Ya tenía exactamente ese precio: no se reescribe. */
  | Readonly<{ kind: "unchanged"; price: Money }>
  /** Vendida o entregada: el precio quedó en la venta y no cambia más. */
  | Readonly<{ kind: "locked"; status: VehicleStatus }>;

/** Decide, sin tocar nada, qué pasa con un cambio de precio. */
export function planVehiclePriceChange(
  target: VehiclePriceTarget,
  next: Money,
): VehiclePricePlan {
  if (!isPriceEditable(target.status)) {
    return { kind: "locked", status: target.status };
  }
  if (
    target.price !== null &&
    target.price.currency === next.currency &&
    target.price.amount === next.amount
  ) {
    return { kind: "unchanged", price: target.price };
  }
  return { kind: "change", from: target.price, to: next };
}

/* ── Copy (es-PY) ───────────────────────────────────────────────────────── */

export const VEHICLE_PRICE_ERROR_MESSAGES: Readonly<
  Record<VehiclePriceError, string>
> = {
  required: "Completá este campo.",
  invalid_price: "Escribí el precio en números, por ejemplo 150.000.000.",
  not_positive: "El precio tiene que ser mayor a cero.",
  pyg_decimals: "En guaraníes el precio va sin decimales.",
  invalid_currency: "Elegí Gs. o USD.",
};

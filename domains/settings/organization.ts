import { z } from "zod";

import { CURRENCIES, CURRENCY_LABELS, type Currency } from "@/domains/money";

/*
 * Configuración general del concesionario (Hito 6, DEC-038 §2): el nombre de
 * la organización y su moneda por defecto. Solo un `admin` la edita (DEC-038
 * §5).
 *
 * Módulo puro y apto para el navegador: el formulario usa los límites y la
 * validación para avisar antes de enviar, pero la regla la imponen el
 * servidor (parseOrganizationSettings() antes de escribir) y la base (CHECKs
 * de `organizations`, que espejan lo esencial).
 */

/** Largo máximo del nombre, en caracteres (como `char_length`). */
export const ORGANIZATION_NAME_MAX_LENGTH = 120;

/**
 * Moneda por defecto: las monedas vigentes de P1 (DEC-025 §6). Espeja el
 * CHECK `organizations_default_currency_check` (un test vigila que
 * coincidan).
 */
export const DEFAULT_CURRENCIES = CURRENCIES;

export { CURRENCY_LABELS };

/**
 * Campos que el servidor lee del pedido. La organización nunca sale del
 * cliente: es la activa del TenantContext.
 */
export const ORGANIZATION_FIELDS = {
  name: "name",
  defaultCurrency: "defaultCurrency",
} as const;

/** Lo que llega del formulario, tal como se tipeó. */
export type OrganizationValues = Readonly<{
  name: string;
  defaultCurrency: string;
}>;

export type OrganizationField = keyof OrganizationValues;

export const ORGANIZATION_FIELD_ERRORS = [
  "required",
  "too_long",
  "invalid_option",
] as const;

export type OrganizationFieldError = (typeof ORGANIZATION_FIELD_ERRORS)[number];

export type OrganizationErrors = Readonly<
  Partial<Record<OrganizationField, OrganizationFieldError>>
>;

/** Configuración válida, lista para escribir. */
export type OrganizationSettings = Readonly<{
  /** Ya normalizado: de 1 a ORGANIZATION_NAME_MAX_LENGTH caracteres. */
  name: string;
  defaultCurrency: Currency;
}>;

export type ParsedOrganizationSettings =
  | Readonly<{ ok: true; settings: OrganizationSettings }>
  | Readonly<{ ok: false; errors: OrganizationErrors }>;

/**
 * Nombre tal como se guarda: NFC, sin caracteres de control, espacios
 * colapsados a uno y recortado. Una sola línea.
 */
export function normalizeOrganizationName(raw: string): string {
  return raw
    .normalize("NFC")
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

/** Largo en caracteres (code points), igual que `char_length`. */
export function organizationNameLength(name: string): number {
  return [...name].length;
}

/* ── Validación (Zod, DEC-038 §7) ───────────────────────────────────────── */

const organizationSchema = z.object({
  name: z
    .string()
    .transform(normalizeOrganizationName)
    .refine((name) => name !== "", "required")
    .refine(
      (name) => organizationNameLength(name) <= ORGANIZATION_NAME_MAX_LENGTH,
      "too_long",
    ),
  defaultCurrency: z
    .string()
    .trim()
    .min(1, "required")
    .pipe(
      z.enum(DEFAULT_CURRENCIES as readonly [Currency, ...Currency[]], {
        error: "invalid_option",
      }),
    ),
});

function isOrganizationFieldError(
  value: string,
): value is OrganizationFieldError {
  return (ORGANIZATION_FIELD_ERRORS as readonly string[]).includes(value);
}

/**
 * Valida la configuración general, que es input no confiable: el nombre
 * normalizado, ni vacío ni demasiado largo, y una moneda de la lista.
 */
export function parseOrganizationSettings(
  values: OrganizationValues,
): ParsedOrganizationSettings {
  const parsed = organizationSchema.safeParse(values);
  if (parsed.success) return { ok: true, settings: parsed.data };
  const errors: Partial<Record<OrganizationField, OrganizationFieldError>> = {};
  for (const issue of parsed.error.issues) {
    const field = issue.path[0] as OrganizationField;
    if (errors[field] !== undefined) continue;
    errors[field] = isOrganizationFieldError(issue.message)
      ? issue.message
      : "invalid_option";
  }
  return { ok: false, errors };
}

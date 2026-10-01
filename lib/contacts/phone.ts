import "server-only";

import { parsePhoneNumberWithError } from "libphonenumber-js/max";

/*
 * Identidad telefónica de un contacto (H1.2): el teléfono tal como se cargó
 * se normaliza a E.164, la forma canónica con la que se deduplican contactos
 * dentro de una organización (`contacts.phone_normalized`).
 *
 * - Sin prefijo internacional, el número se interpreta como de Paraguay, donde
 *   opera Porandú (`0981 555 214` → `+595981555214`). Con `+<código>` (o el
 *   prefijo internacional `00`) conserva su país.
 * - Espacios, guiones, puntos y paréntesis no cambian el resultado: formatos
 *   equivalentes dan el mismo valor canónico.
 * - Solo se acepta un número válido según el plan de numeración de su país
 *   (metadata completa de libphonenumber: largo y rangos). Un dígito de más o
 *   de menos, letras, extensiones o texto alrededor se rechazan.
 *
 * Solo servidor: la validación definitiva ocurre en la Server Action y la
 * metadata de libphonenumber no viaja al navegador. ESLint solo permite
 * importar libphonenumber-js desde este módulo.
 */

/** Región con que se interpreta un número sin prefijo internacional. */
export const DEFAULT_PHONE_REGION = "PY";

/** Cota del texto de entrada (no del número): evita parsear entradas enormes. */
export const MAX_PHONE_INPUT_LENGTH = 32;

// Lo que se escribe en un teléfono: dígitos, `+` y separadores habituales.
const PHONE_CHARACTERS = /^\+?[0-9\s().-]+$/;

/**
 * E.164 del teléfono, o null si no es un número válido. `raw` es lo que cargó
 * el usuario; no se recorta ni se completa nada fuera de lo que hace el
 * parser.
 */
export function normalizePhone(raw: string): string | null {
  const value = raw.trim();
  if (
    value === "" ||
    value.length > MAX_PHONE_INPUT_LENGTH ||
    !PHONE_CHARACTERS.test(value)
  ) {
    return null;
  }
  try {
    const phone = parsePhoneNumberWithError(value, {
      defaultCountry: DEFAULT_PHONE_REGION,
    });
    if (phone.ext || !phone.isValid()) return null;
    return phone.number;
  } catch {
    return null;
  }
}

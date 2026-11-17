import type { Opportunity } from "./types";

/*
 * Derivaciones de presentación del prospecto. Puras: no guardan nada y se
 * recalculan desde el dato persistido.
 */

/**
 * Vehículo que busca: el de la demanda (H1.4) o, si nunca se cargó, el
 * legado; `null` es sin dato. Lo usan la cola, la tabla y el atajo al
 * catálogo (DEC-055).
 */
export function searchedVehicle(opportunity: Opportunity): string | null {
  if (opportunity.demand) return opportunity.demand.vehicle?.title ?? null;
  const { model, version } = opportunity.interest;
  const legacy = [model, version].filter(Boolean).join(" ");
  return legacy || null;
}

/** Primera letra en mayúscula y sin tilde ("Ó" → "O"); la "Ñ" se conserva. */
function initial(word: string | undefined): string {
  const letter = Array.from(word ?? "")[0] ?? "";
  return letter
    .normalize("NFD")
    .replace(/[\u0300-\u0302\u0304-\u036f]/g, "")
    .normalize("NFC")
    .toLocaleUpperCase("es-PY");
}

/**
 * Iniciales para el avatar: primera y última palabra del nombre, como en el
 * contrato visual de B1 ("María José Rolón" → "MR", "Óscar Brítez" → "OB").
 */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const last = words.length > 1 ? words.at(-1) : undefined;
  return initial(words[0]) + initial(last);
}

/**
 * Teléfono enmascarado: deja ver solo el prefijo y los últimos 3 dígitos
 * ("0981 ··· 214", "+595 ··· 214"). Sin dígitos → sin dato.
 */
export function maskPhone(phone: string): string | undefined {
  const digits = phone.replace(/\D/g, "");
  if (digits === "") return undefined;
  const last = digits.slice(-3);
  if (digits.length < 8) return `··· ${last}`;
  const prefix = phone.trimStart().startsWith("+")
    ? `+${digits.slice(0, 3)}`
    : digits.slice(0, 4);
  return `${prefix} ··· ${last}`;
}

/**
 * Avatares ilustrados del prospecto (DEC-058): retratos genéricos, no fotos
 * de la persona, en `/public/avatars/`. Se asignan por el id del contacto,
 * siempre el mismo para el mismo contacto, sin inferir nada del nombre. La
 * UI conserva las iniciales como respaldo si la imagen no carga.
 */
export const PROSPECT_AVATARS = [
  "/avatars/prospect-01.svg",
  "/avatars/prospect-02.svg",
  "/avatars/prospect-03.svg",
  "/avatars/prospect-04.svg",
  "/avatars/prospect-05.svg",
  "/avatars/prospect-06.svg",
  "/avatars/prospect-07.svg",
  "/avatars/prospect-08.svg",
] as const;

/** FNV-1a de 32 bits: el mismo texto, el mismo número, en cualquier runtime. */
function hash(text: string): number {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value;
}

/** El avatar ilustrado de un contacto, determinístico por su id. */
export function prospectAvatar(contactId: string): string {
  return PROSPECT_AVATARS[
    hash(contactId.toLowerCase()) % PROSPECT_AVATARS.length
  ]!;
}

/*
 * Derivaciones de presentación del prospecto. Puras: no guardan nada y se
 * recalculan desde el dato persistido.
 */

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

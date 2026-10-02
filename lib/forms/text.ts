/*
 * Normalización de los textos de una línea que llegan de un formulario
 * (altas de H1.2 y H1.3B). La usa la validación del servidor: lo que valide
 * el navegador no se da por bueno.
 */

/**
 * Texto de una línea: NFC, sin caracteres de control y con un solo espacio
 * entre palabras. Un campo ausente o un archivo es "".
 */
export function singleLine(raw: FormDataEntryValue | null): string {
  if (typeof raw !== "string") return "";
  return raw
    .normalize("NFC")
    .replace(/[\s\p{Cc}]+/gu, " ")
    .trim();
}

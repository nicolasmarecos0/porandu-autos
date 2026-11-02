/*
 * Texto para un PDF con las fuentes estándar (Hito 14, DEC-046 §4). Puro:
 * no conoce pdf-lib. El renderer (lib/quotes/pdf.ts) le pasa lo que su
 * fuente sabe codificar y cómo mide un texto.
 *
 * Las 14 fuentes estándar de PDF (Helvetica) no se embeben: el archivo pesa
 * unos pocos KB y se genera en milisegundos. A cambio, solo codifican
 * WinAnsi (Windows-1252), que cubre el español completo (á, é, í, ó, ú, ñ,
 * ü, ¿, ¡, º, «») pero no todo lo que puede traer un nombre o una nota:
 * emojis de un perfil de WhatsApp, las vocales nasales del guaraní (ẽ, ỹ),
 * el signo menos tipográfico o el símbolo del guaraní. toPdfText() lo
 * resuelve sin fallar:
 *
 *   1. equivalentes conocidos: "−" → "–", "₲" → "Gs.", espacios finos → " ";
 *   2. una letra con diacríticos que no existe en WinAnsi conserva su letra
 *      base ("ẽ" → "e", "g̃" → "g");
 *   3. lo que sigue sin codificarse (emojis, otros alfabetos) se omite.
 *
 * Nunca deja un carácter que la fuente no puede dibujar: pdf-lib fallaría al
 * escribirlo.
 */

/** ¿La fuente codifica este code point? */
export type CanEncode = (codePoint: number) => boolean;

/** Ancho de un texto en puntos, con la fuente y el tamaño del renderer. */
export type MeasureText = (text: string) => number;

const EQUIVALENTS: ReadonlyMap<string, string> = new Map([
  ["−", "–"], // signo menos → raya corta
  ["‐", "-"], // guion
  ["‑", "-"], // guion que no corta
  ["₲", "Gs."], // símbolo del guaraní
  [" ", " "], // espacio de cifra
  [" ", " "], // espacio fino
  [" ", " "], // espacio fino que no corta
  ["​", ""], // espacio de ancho cero
  ["\t", " "],
  ["\r", " "],
  ["\n", " "],
]);

const COMBINING_MARK = /\p{M}/u;

/**
 * El texto en lo que la fuente sabe dibujar, en una línea: equivalentes,
 * letras base y omisiones, con los espacios colapsados y recortado.
 */
export function toPdfText(text: string, canEncode: CanEncode): string {
  let result = "";
  for (const char of text.normalize("NFC")) {
    const equivalent = EQUIVALENTS.get(char);
    if (equivalent !== undefined) {
      result += equivalent;
      continue;
    }
    const codePoint = char.codePointAt(0)!;
    if (canEncode(codePoint)) {
      result += char;
      continue;
    }
    // La letra base, sin sus diacríticos, si la fuente la tiene.
    for (const part of char.normalize("NFD")) {
      if (COMBINING_MARK.test(part)) continue;
      const base = part.codePointAt(0)!;
      if (canEncode(base)) result += part;
    }
  }
  return result.replace(/ {2,}/g, " ").trim();
}

/** Corta una palabra más ancha que `maxWidth` en trozos que entran. */
function splitWord(
  word: string,
  maxWidth: number,
  measure: MeasureText,
): string[] {
  const chunks: string[] = [];
  let chunk = "";
  for (const char of word) {
    if (chunk !== "" && measure(chunk + char) > maxWidth) {
      chunks.push(chunk);
      chunk = char;
    } else {
      chunk += char;
    }
  }
  if (chunk !== "") chunks.push(chunk);
  return chunks;
}

/**
 * Renglones de a lo sumo `maxWidth` puntos, cortando entre palabras. Una
 * palabra que no entra sola en un renglón (un correo, un número largo) se
 * corta donde haga falta. Un texto vacío no tiene renglones.
 */
export function wrapText(
  text: string,
  maxWidth: number,
  measure: MeasureText,
): string[] {
  const words = text.split(" ").filter((word) => word !== "");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line === "" ? word : `${line} ${word}`;
    if (measure(candidate) <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line !== "") lines.push(line);
    if (measure(word) <= maxWidth) {
      line = word;
      continue;
    }
    const chunks = splitWord(word, maxWidth, measure);
    line = chunks.pop() ?? "";
    lines.push(...chunks);
  }
  if (line !== "") lines.push(line);
  return lines;
}

const ELLIPSIS = "…";

/**
 * El texto en un solo renglón de a lo sumo `maxWidth` puntos: entero si
 * entra y, si no, recortado con "…".
 */
export function truncateText(
  text: string,
  maxWidth: number,
  measure: MeasureText,
): string {
  if (measure(text) <= maxWidth) return text;
  const chars = Array.from(text);
  while (chars.length > 0) {
    chars.pop();
    const candidate = `${chars.join("").trimEnd()}${ELLIPSIS}`;
    if (measure(candidate) <= maxWidth) return candidate;
  }
  return "";
}

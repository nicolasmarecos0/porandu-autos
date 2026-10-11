import { authorLabel, formatDemandDate } from "@/domains/demand/presentation";

/*
 * Bitácora comercial de una oportunidad (Hito 2, DEC-033 §1): notas libres
 * del vendedor sobre la negociación, append-only. Módulo puro y apto para el
 * navegador: la UI usa el largo máximo y la normalización para el contador,
 * pero la regla la imponen el servidor (parseNoteBody() antes de escribir) y
 * la base (CHECK `opportunity_notes_body_check`, que espeja lo esencial:
 * largo, recorte y ningún carácter de control salvo el salto de línea).
 */

/** Largo máximo de una nota, en caracteres (como `char_length` de la base). */
export const NOTE_MAX_LENGTH = 1000;

/**
 * Campos que el servidor lee del pedido: la oportunidad y el texto. Autor,
 * organización y fecha nunca salen del cliente.
 */
export const NOTE_FIELDS = {
  opportunityId: "opportunityId",
  body: "body",
} as const;

/** Largo en caracteres (code points), igual que `char_length` de PostgreSQL. */
export function noteLength(text: string): number {
  return Array.from(text).length;
}

/**
 * Texto de una nota tal como se guarda: NFC, `\r\n` y `\r` como `\n`, los
 * demás caracteres de control y los espacios repetidos como un espacio, cada
 * línea recortada, a lo sumo una línea en blanco seguida y el conjunto
 * recortado. Determinista: normalizar dos veces da lo mismo.
 */
export function normalizeNoteBody(raw: string): string {
  return raw
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+|[^\P{Cc}\n]+/gu, " ")
    .split("\n")
    .map((line) => line.replace(/ {2,}/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export type NoteBodyError = "empty" | "too_long";

export type ParsedNoteBody =
  | Readonly<{ ok: true; body: string }>
  | Readonly<{ ok: false; error: NoteBodyError }>;

/** Valida el texto ya normalizado: de 1 a NOTE_MAX_LENGTH caracteres. */
export function parseNoteBody(raw: string): ParsedNoteBody {
  const body = normalizeNoteBody(raw);
  if (body === "") return { ok: false, error: "empty" };
  if (noteLength(body) > NOTE_MAX_LENGTH) {
    return { ok: false, error: "too_long" };
  }
  return { ok: true, body };
}

/** Una nota tal como la lee la capa de datos. */
export type NoteRow = Readonly<{
  id: string;
  body: string;
  recordedBy: string;
  recordedAt: Date;
}>;

/** Una nota en la bitácora de /opportunities/[id]: sin ids de usuario. */
export type NoteEntry = Readonly<{
  id: string;
  body: string;
  /** "Vos" u "Otro miembro", contra el usuario que mira. */
  author: string;
  /** Fecha y hora de Asunción: "11 oct 2026 14:32". */
  at: string;
}>;

/**
 * Bitácora para mostrar: de la nota más reciente a la más vieja (a igual
 * instante, por id, para que el orden sea determinista), con el autor
 * presentado contra el usuario que mira.
 */
export function noteTimeline(
  rows: readonly NoteRow[],
  viewerUserId: string,
): readonly NoteEntry[] {
  return rows
    .toSorted(
      (a, b) =>
        b.recordedAt.getTime() - a.recordedAt.getTime() ||
        b.id.localeCompare(a.id),
    )
    .map((row) => ({
      id: row.id,
      body: row.body,
      author: authorLabel(row.recordedBy, viewerUserId),
      at: formatDemandDate(row.recordedAt),
    }));
}

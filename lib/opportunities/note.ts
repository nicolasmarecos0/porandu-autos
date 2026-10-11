import {
  NOTE_FIELDS,
  parseNoteBody,
  type NoteBodyError,
} from "@/domains/opportunities/notes";

/*
 * Pedido y respuesta de la Server Action addOpportunityNote() (Hito 2,
 * DEC-033 §1). El pedido solo identifica la oportunidad y trae el texto:
 * cualquier otro campo (organización, autor, fecha) se ignora porque no
 * tiene adónde ir. Nada de esto expone la base: ni SQLSTATE, ni
 * constraints, ni datos de otra organización.
 */

/** Respuesta de addOpportunityNote(). */
export type AddNoteState =
  /** La nota quedó en la bitácora. */
  | Readonly<{ status: "recorded"; opportunityId: string }>
  /** El texto no es válido: vuelve lo tipeado para corregirlo. */
  | Readonly<{ status: "invalid"; error: NoteBodyError; body: string }>
  /** La oportunidad no existe o no es de la organización activa. */
  | Readonly<{ status: "not_found" }>
  /** Falla inesperada: nada se escribió y lo tipeado vuelve para reintentar. */
  | Readonly<{ status: "failed"; body: string }>
  | null;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ParsedNote =
  | Readonly<{ kind: "ok"; opportunityId: string; body: string }>
  /** El id no es un UUID: no llega a la base. */
  | Readonly<{ kind: "not_found" }>
  /** El texto, normalizado, está vacío o es demasiado largo. */
  | Readonly<{ kind: "invalid"; error: NoteBodyError; body: string }>;

/**
 * Lee el pedido, que es input no confiable. Que el id sea un UUID no
 * significa que la oportunidad sea de la organización activa: eso lo deciden
 * el filtro explícito y RLS. El texto se normaliza y valida en el servidor
 * (domains/opportunities/notes.ts); lo que validó el navegador no cuenta.
 */
export function parseNoteRequest(formData: FormData): ParsedNote {
  const rawId = formData.get(NOTE_FIELDS.opportunityId);
  const id = typeof rawId === "string" ? rawId.trim() : "";
  if (!UUID.test(id)) return { kind: "not_found" };

  const raw = formData.get(NOTE_FIELDS.body);
  const typed = typeof raw === "string" ? raw : "";
  const parsed = parseNoteBody(typed);
  if (!parsed.ok) return { kind: "invalid", error: parsed.error, body: typed };
  return { kind: "ok", opportunityId: id.toLowerCase(), body: parsed.body };
}

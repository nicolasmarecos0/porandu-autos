import {
  CLOSURE_FIELDS,
  isClosureOutcome,
  LOSS_NOTES_MAX_LENGTH,
  OUTCOME_FIELDS,
  parseClosure,
  type Closure,
  type ClosureErrors,
  type ClosureField,
  type ClosureOutcome,
  type ClosureValues,
} from "@/domains/opportunities/closure";
import type { Stage } from "@/domains/opportunities/stages";

/*
 * Pedido y respuesta de la Server Action closeOpportunity() (DEC-034). El
 * pedido solo identifica la oportunidad, el resultado (`won` o `lost`) y los
 * campos de ese resultado: cualquier otro campo (organización, usuario,
 * etapa de origen, unidad, reloj) se ignora porque no tiene adónde ir, y los
 * del otro resultado también. Nada de esto expone la base: ni SQLSTATE, ni
 * constraints, ni datos de otra organización.
 */

/** Respuesta de closeOpportunity(). */
export type CloseOpportunityState =
  /** La oportunidad quedó cerrada con sus metadatos. */
  | Readonly<{
      status: "closed";
      opportunityId: string;
      from: Stage;
      to: ClosureOutcome;
    }>
  /** Ya estaba cerrada así: los metadatos no se reescribieron. */
  | Readonly<{
      status: "unchanged";
      opportunityId: string;
      stage: ClosureOutcome;
    }>
  /** La máquina de estados no permite ese cierre. `current` es la real. */
  | Readonly<{
      status: "invalid_transition";
      opportunityId: string;
      current: Stage;
    }>
  /** Ganar exige la unidad vinculada. Nada cambió. */
  | Readonly<{ status: "vehicle_required"; opportunityId: string }>
  /** Algún campo no es válido: vuelve lo cargado para corregirlo. */
  | Readonly<{
      status: "invalid";
      outcome: ClosureOutcome;
      errors: ClosureErrors;
      values: ClosureValues;
    }>
  /** El pedido no es un cierre reconocido. Nada cambió. */
  | Readonly<{ status: "invalid_outcome" }>
  /** La oportunidad no existe o no es de la organización activa. */
  | Readonly<{ status: "not_found" }>
  /** Falla inesperada: nada cambió y lo cargado vuelve para reintentar. */
  | Readonly<{
      status: "failed";
      outcome: ClosureOutcome;
      values: ClosureValues;
    }>
  | null;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/*
 * Lo que vuelve al formulario: lo tipeado, acotado. Las notas pueden ser
 * más largas que el máximo (para que se vea qué sobra), las demás son de
 * una línea.
 */
const MAX_ECHO_LENGTH = 256;
const MAX_NOTES_ECHO_LENGTH = LOSS_NOTES_MAX_LENGTH * 4;

export type ParsedCloseRequest =
  | Readonly<{
      kind: "ok";
      opportunityId: string;
      closure: Closure;
      values: ClosureValues;
    }>
  /** El id no es un UUID: no llega a la base. */
  | Readonly<{ kind: "not_found" }>
  /** El resultado no es `won` ni `lost`. */
  | Readonly<{ kind: "invalid_outcome" }>
  /** Algún campo del resultado no es válido. */
  | Readonly<{
      kind: "invalid";
      outcome: ClosureOutcome;
      errors: ClosureErrors;
      values: ClosureValues;
    }>;

function text(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value : "";
}

const ALL_FIELDS: readonly ClosureField[] = [
  ...OUTCOME_FIELDS.won,
  ...OUTCOME_FIELDS.lost,
];

/** Lo tipeado en los campos del resultado pedido; los demás, vacíos. */
function typedValues(
  formData: FormData,
  outcome: ClosureOutcome,
): Record<ClosureField, string> {
  const own: readonly ClosureField[] = OUTCOME_FIELDS[outcome];
  return Object.fromEntries(
    ALL_FIELDS.map((field) => [
      field,
      own.includes(field) ? text(formData.get(CLOSURE_FIELDS[field])) : "",
    ]),
  ) as Record<ClosureField, string>;
}

/** El eco para el formulario: lo tipeado, acotado. */
function echoOf(typed: ClosureValues): ClosureValues {
  return Object.fromEntries(
    ALL_FIELDS.map((field) => [
      field,
      typed[field].slice(
        0,
        field === "lossNotes" ? MAX_NOTES_ECHO_LENGTH : MAX_ECHO_LENGTH,
      ),
    ]),
  ) as Record<ClosureField, string>;
}

/**
 * Lee el pedido, que es input no confiable, y lo valida en el servidor
 * (domains/opportunities/closure.ts, Zod): lo que validó el navegador no
 * cuenta. Que el id sea un UUID no significa que la oportunidad sea de la
 * organización activa: eso lo deciden el filtro explícito y RLS. `today` es
 * el día de Asunción en que corre el pedido.
 */
export function parseCloseRequest(
  formData: FormData,
  today: string,
): ParsedCloseRequest {
  const id = text(formData.get(CLOSURE_FIELDS.opportunityId)).trim();
  if (!UUID.test(id)) return { kind: "not_found" };

  const outcome = text(formData.get(CLOSURE_FIELDS.outcome)).trim();
  if (!isClosureOutcome(outcome)) return { kind: "invalid_outcome" };

  // Se valida lo que llegó completo; al formulario vuelve el eco acotado.
  const typed = typedValues(formData, outcome);
  const values = echoOf(typed);
  const parsed = parseClosure(outcome, typed, today);
  if (!parsed.ok) {
    return { kind: "invalid", outcome, errors: parsed.errors, values };
  }
  return {
    kind: "ok",
    opportunityId: id.toLowerCase(),
    closure: parsed.closure,
    values,
  };
}

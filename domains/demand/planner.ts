import {
  checkEvidenceText,
  DEMAND_FACTS,
  demandValueEquals,
  isDemandFact,
  validateFactValue,
  type DemandFact,
  type DemandField,
  type DemandFieldError,
  type DemandValues,
} from "./facts";
import { resolveDemand, type DemandRow, type FactTruth } from "./resolver";

/*
 * Ingestion Contract (H1.4, DEC-030 §4 y §5; spec §7): la única operación de
 * escritura de la demanda, agnóstica de la fuente. Un escritor describe lo
 * que quiere afirmar (`DemandCapture`) y el planner decide, contra el ledger
 * actual, qué filas agregar. Puro: no escribe nada. La escritura y la
 * transacción son de db/queries/demand-facts.ts, el único módulo de
 * escritura (C-8).
 *
 * El escritor nunca envía `status`, `source_kind`, `recorded_by`,
 * `recorded_at`, `organization_id` ni `id`: el planner deriva el estado, el
 * autor y los enlaces, y la base fija id y reloj.
 *
 * En H1.4 la única fuente es el vendedor (`member`). Las fuentes de máquina
 * (H2a+) solo podrán proponer (`set` → `detected`); no son parte de H1.4.
 */

/** Fuente de la captura. Única implementada en H1.4: un miembro. */
export type DemandSource = Readonly<{ kind: "member"; userId: string }>;

/**
 * Por qué cambia un valor que ya tenía dato:
 * - `customer_changed`: el cliente cambió de opinión → nuevo `confirmed`;
 * - `load_error`: el valor anterior era un error → `corrected` (C-2).
 */
export type ChangeReason = "customer_changed" | "load_error";

export type DemandItem =
  /** Afirmar un valor. */
  | Readonly<{
      op: "set";
      fact: DemandFact;
      /** Se valida acá: lo que llega del cliente no se da por bueno. */
      value: unknown;
      /** Head humano que vio el usuario (compare-and-set). */
      basedOnHead: string | null;
      /** Obligatorio si reemplaza una detección con otro valor. */
      reason?: ChangeReason;
      /** Solo `pending.factId` o la detección vigente (H2a+). */
      target?: string;
      /** Nota de la edición (`evidence_text`), hasta 500 caracteres. */
      note?: string;
    }>
  /** Quitar el valor humano vigente: fue un error de carga (C-3). */
  | Readonly<{
      op: "remove";
      fact: DemandFact;
      target: string;
      basedOnHead: string | null;
      note?: string;
    }>
  /** Aceptar el pendiente o la detección vigente (H2a+). */
  | Readonly<{
      op: "accept";
      fact: DemandFact;
      target: string;
      basedOnHead: string | null;
    }>
  /** Descartar el pendiente o la detección vigente (H2a+). */
  | Readonly<{
      op: "reject";
      fact: DemandFact;
      target: string;
      basedOnHead: string | null;
      note?: string;
    }>;

/** Lo que un escritor quiere afirmar. Como máximo un ítem por fact. */
export type DemandCapture = Readonly<{
  opportunityId: string;
  source: DemandSource;
  items: readonly DemandItem[];
}>;

/** Fila a insertar. `id` y `recorded_at` los pone la base. */
export type NewDemandRow = {
  [F in DemandFact]: Readonly<{
    fact: F;
    status: "confirmed" | "corrected" | "rejected";
    sourceKind: "member";
    recordedBy: string;
    targetFactId: string | null;
    previousMemberFactId: string | null;
    value: DemandValues[F] | null;
    evidenceText: string | null;
  }>;
}[DemandFact];

/** Error de un ítem de la captura. */
export type DemandItemError =
  | Readonly<{ fact: DemandFact; field: DemandField; error: DemandFieldError }>
  | Readonly<{
      fact: DemandFact | null;
      field: "item";
      error:
        | "unknown_fact"
        | "duplicate_fact"
        | "unknown_op"
        /** Reemplazar una detección con otro valor exige decir por qué. */
        | "reason_required"
        /** El `target` no es el que corresponde a la operación. */
        | "invalid_target"
        /** Quitar solo aplica a un valor humano (C-3). */
        | "not_removable";
    }>
  | Readonly<{ fact: DemandFact; field: "note"; error: DemandFieldError }>;

export type DemandPlan =
  | Readonly<{ kind: "write"; rows: readonly NewDemandRow[] }>
  /** Nada que escribir: lo pedido ya es lo vigente. */
  | Readonly<{ kind: "unchanged" }>
  /** Otro acto humano cambió estos facts mientras el usuario editaba. */
  | Readonly<{ kind: "stale"; facts: readonly DemandFact[] }>
  /** Hay una detección pendiente que el pedido no resuelve. */
  | Readonly<{ kind: "pending_unresolved"; facts: readonly DemandFact[] }>
  | Readonly<{ kind: "invalid"; errors: readonly DemandItemError[] }>
  /** La oportunidad no existe o no es de la organización activa. */
  | Readonly<{ kind: "not_found" }>
  /** El ledger de estos facts no forma una cadena válida (fail-closed). */
  | Readonly<{ kind: "inconsistent"; facts: readonly DemandFact[] }>
  /** La fuente no puede hacer esta operación. */
  | Readonly<{ kind: "forbidden" }>;

type ItemOutcome =
  | Readonly<{ kind: "write"; row: NewDemandRow }>
  | Readonly<{ kind: "skip" }>
  | Readonly<{ kind: "stale" }>
  | Readonly<{ kind: "pending_unresolved" }>
  | Readonly<{ kind: "inconsistent" }>
  | Readonly<{ kind: "invalid"; errors: DemandItemError[] }>;

const OPS = ["set", "remove", "accept", "reject"] as const;

function isMemberSource(source: unknown): source is DemandSource {
  return (
    typeof source === "object" &&
    source !== null &&
    (source as { kind?: unknown }).kind === "member" &&
    typeof (source as { userId?: unknown }).userId === "string" &&
    (source as { userId: string }).userId !== ""
  );
}

/** Valor vigente humano: el del ancla, o Unknown (null) si se quitó. */
function humanValue<F extends DemandFact>(
  truth: FactTruth<F>,
): DemandValues[F] | null {
  return truth.status === "confirmed" || truth.status === "corrected"
    ? truth.value
    : null;
}

/** ¿El valor pedido (null = Unknown) es el vigente humano? */
function equalsHuman<F extends DemandFact>(
  fact: F,
  truth: FactTruth<F>,
  requested: DemandValues[F] | null,
): boolean {
  if (truth.headId === null) return false;
  const current = humanValue(truth);
  if (requested === null || current === null) return requested === current;
  return demandValueEquals(fact, requested, current);
}

/** La detección que el ítem puede tomar como target: pendiente o vigente. */
function detectionTarget<F extends DemandFact>(
  truth: FactTruth<F>,
  target: string,
): Readonly<{ factId: string; value: DemandValues[F] }> | null {
  if (truth.pending && truth.pending.factId === target) return truth.pending;
  if (truth.status === "detected" && truth.factId === target) {
    return { factId: target, value: truth.value as DemandValues[F] };
  }
  return null;
}

function planItem<F extends DemandFact>(
  fact: F,
  item: DemandItem,
  truth: FactTruth<F>,
  userId: string,
): ItemOutcome {
  const invalid = (
    error: Extract<DemandItemError, { field: "item" }>["error"],
  ): ItemOutcome => ({
    kind: "invalid",
    errors: [{ fact, field: "item", error }],
  });

  // 1. Forma y decimales.
  let requested: DemandValues[F] | null = null;
  const errors: DemandItemError[] = [];
  if (item.op === "set") {
    const validation = validateFactValue(fact, item.value);
    if (validation.ok) requested = validation.value;
    else {
      for (const [field, error] of Object.entries(validation.errors)) {
        errors.push({ fact, field: field as DemandField, error: error! });
      }
    }
  }
  const note = "note" in item ? item.note : undefined;
  if (note !== undefined) {
    const error = checkEvidenceText(note);
    if (error) errors.push({ fact, field: "note", error });
  }
  if (errors.length > 0) return { kind: "invalid", errors };

  if (truth.unknownReason === "inconsistent") return { kind: "inconsistent" };

  // Un ítem que actúa sobre una detección (aceptarla, descartarla o
  // reemplazarla) la resuelve: no es un no-op aunque lo pedido coincida con
  // lo vigente, así que los pasos 2 y 3 no lo omiten. Si el head cambió, el
  // usuario decidió sobre otro estado: `stale`.
  const target =
    item.op === "set"
      ? item.target
      : item.op === "remove"
        ? undefined
        : item.target;
  let detection: Readonly<{ factId: string; value: DemandValues[F] }> | null =
    null;
  if (target !== undefined) {
    if (item.basedOnHead !== truth.headId) return { kind: "stale" };
    detection = detectionTarget(truth, target);
    if (!detection) return invalid("invalid_target");
  } else {
    // 2. Compare-and-set contra el head humano que vio el usuario.
    if (item.basedOnHead !== truth.headId) {
      return equalsHuman(fact, truth, requested)
        ? { kind: "skip" }
        : { kind: "stale" };
    }
    // 3. Lo pedido ya es lo vigente humano.
    if (equalsHuman(fact, truth, requested)) return { kind: "skip" };
  }

  // 4. Un pendiente distinto sin resolver bloquea los actos humanos sobre
  // el fact: el humano lo acepta o lo descarta explícitamente.
  if (truth.pending && detection?.factId !== truth.pending.factId) {
    return { kind: "pending_unresolved" };
  }

  // 5. Derivar el acto.
  const base = {
    fact,
    sourceKind: "member" as const,
    recordedBy: userId,
    previousMemberFactId: truth.headId,
    evidenceText: note ?? null,
  };
  const write = (
    status: "confirmed" | "corrected" | "rejected",
    targetFactId: string | null,
    value: DemandValues[F] | null,
  ): ItemOutcome => ({
    kind: "write",
    row: { ...base, status, targetFactId, value } as NewDemandRow,
  });

  switch (item.op) {
    case "accept":
      return write("confirmed", detection!.factId, detection!.value);
    case "reject":
      return write("rejected", detection!.factId, null);
    case "remove": {
      if (truth.status === "detected") return invalid("not_removable");
      if (truth.headId === null || truth.factId === null) {
        // Nunca se cargó: no hay nada que quitar.
        return { kind: "skip" };
      }
      if (item.target !== truth.factId) return invalid("invalid_target");
      return write("rejected", truth.factId, null);
    }
    case "set": {
      const value = requested!;
      // Sobre una detección (la vigente sin humano, o el pendiente): mismo
      // valor es aceptarla; otro valor exige el motivo, sin default.
      const over =
        detection ??
        (truth.status === "detected"
          ? { factId: truth.factId!, value: truth.value! }
          : null);
      if (over) {
        if (demandValueEquals(fact, value, over.value)) {
          return write("confirmed", over.factId, value);
        }
        if (!item.reason) return invalid("reason_required");
        return write(
          item.reason === "load_error" ? "corrected" : "confirmed",
          over.factId,
          value,
        );
      }
      // Sobre un valor humano distinto: por defecto, el cliente cambió.
      const current = humanValue(truth);
      if (current !== null && truth.factId !== null) {
        return write(
          item.reason === "load_error" ? "corrected" : "confirmed",
          truth.factId,
          value,
        );
      }
      // Sobre Unknown: un valor nuevo. El motivo no aplica.
      return write("confirmed", null, value);
    }
  }
}

/**
 * Plan de una captura contra el ledger de la oportunidad (`rows`, o null si
 * la oportunidad no existe o no es de la organización activa).
 *
 * Los ítems se evalúan en el orden canónico de los facts:
 * 1. forma y decimales;
 * 2. si `basedOnHead` no es el head actual: se omite si lo pedido ya es lo
 *    vigente humano, si no es `stale`;
 * 3. si lo pedido ya es lo vigente humano, se omite;
 * 4. si hay un pendiente que el ítem no resuelve, `pending_unresolved`;
 * 5. si no, se escribe.
 *
 * Todo o nada: con un ítem inválido, inconsistente, stale o con un pendiente
 * sin resolver, la captura entera se aborta y no se escribe ninguna fila.
 */
export function planDemandCapture(
  rows: readonly DemandRow[] | null,
  capture: DemandCapture,
): DemandPlan {
  if (!isMemberSource(capture.source)) return { kind: "forbidden" };
  if (rows === null) return { kind: "not_found" };

  const errors: DemandItemError[] = [];
  const byFact = new Map<DemandFact, DemandItem>();
  for (const item of capture.items) {
    if (!isDemandFact(item.fact)) {
      errors.push({ fact: null, field: "item", error: "unknown_fact" });
    } else if (byFact.has(item.fact)) {
      errors.push({ fact: item.fact, field: "item", error: "duplicate_fact" });
    } else if (!OPS.includes(item.op)) {
      errors.push({ fact: item.fact, field: "item", error: "unknown_op" });
    } else {
      byFact.set(item.fact, item);
    }
  }

  const truth = resolveDemand(rows);
  const writes: NewDemandRow[] = [];
  const stale: DemandFact[] = [];
  const pending: DemandFact[] = [];
  const inconsistent: DemandFact[] = [];
  for (const fact of DEMAND_FACTS) {
    const item = byFact.get(fact);
    if (!item) continue;
    const outcome = planItem(
      fact,
      item,
      truth[fact] as FactTruth<typeof fact>,
      capture.source.userId,
    );
    switch (outcome.kind) {
      case "write":
        writes.push(outcome.row);
        break;
      case "invalid":
        errors.push(...outcome.errors);
        break;
      case "stale":
        stale.push(fact);
        break;
      case "pending_unresolved":
        pending.push(fact);
        break;
      case "inconsistent":
        inconsistent.push(fact);
        break;
      case "skip":
        break;
    }
  }

  if (errors.length > 0) return { kind: "invalid", errors };
  if (inconsistent.length > 0) {
    return { kind: "inconsistent", facts: inconsistent };
  }
  if (stale.length > 0) return { kind: "stale", facts: stale };
  if (pending.length > 0) return { kind: "pending_unresolved", facts: pending };
  if (writes.length === 0) return { kind: "unchanged" };
  return { kind: "write", rows: writes };
}

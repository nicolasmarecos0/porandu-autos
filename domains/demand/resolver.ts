import {
  DEMAND_FACTS,
  demandValueEquals,
  type DemandFact,
  type DemandValues,
} from "./facts";

/*
 * Current Truth de la demanda (H1.4, DEC-030 §2 a §4; spec §5): un resolver
 * puro y determinista que, por cada fact, deriva el valor vigente, su estado,
 * la fila que lo sustenta, un pendiente opcional y el motivo de Unknown a
 * partir del ledger append-only `opportunity_demand_facts`. Nada de esto se
 * persiste.
 *
 * Principio: la máquina propone, el humano decide y Current Truth respeta la
 * decisión humana.
 * - Sin ningún acto humano sobre un fact, la detección más reciente es el
 *   valor vigente provisorio, con estado `detected` (C-1).
 * - Con un acto humano, manda solo la cadena humana: una detección nunca es
 *   el valor vigente; a lo sumo queda pendiente.
 * - Ninguna transición de máquina produce `confirmed` ni `corrected`.
 *
 * En H1.4 la base solo admite filas humanas (`source_kind = 'member'`): las
 * filas `detected` de los tests unitarios son sintéticas y preparan H2a/H2b.
 */

/** Estados persistidos de una fila (DEC-030 §3). */
export const DEMAND_FACT_STATUSES = [
  "detected",
  "confirmed",
  "corrected",
  "rejected",
] as const;

export type DemandFactStatus = (typeof DEMAND_FACT_STATUSES)[number];

/**
 * Quién escribió el fact en Porandú. H1.4 solo implementa `member` (el CHECK
 * de la base solo admite esa); las demás son las fuentes futuras, que
 * producen detecciones.
 */
export const DEMAND_SOURCE_KINDS = [
  "member",
  "assisted_extraction",
  "extractor",
  "import",
  "customer_form",
  "integration",
] as const;

export type DemandSourceKind = (typeof DEMAND_SOURCE_KINDS)[number];

/** Fuentes que la base de H1.4 admite (`source_kind` CHECK de 0007). */
export const IMPLEMENTED_SOURCE_KINDS = ["member"] as const;

type RowBase = Readonly<{
  id: string;
  status: DemandFactStatus;
  sourceKind: DemandSourceKind;
  /** Usuario que registró la fila (obligatorio para `member`). */
  recordedBy: string | null;
  /** Reloj de la base al insertar. */
  recordedAt: Date;
  /** Cuándo se dijo. No existe en H1.4: siempre null (H2+). */
  observedAt: Date | null;
  /** Fact sobre el que actúa un acto humano (mismo fact y oportunidad). */
  targetFactId: string | null;
  /** Acto humano anterior del mismo fact: la cadena humana lineal. */
  previousMemberFactId: string | null;
  /** Nota corta (evidencia). Nunca una conversación. */
  evidenceText: string | null;
}>;

/** Fila del ledger de un fact. `value` es null solo en `rejected`. */
export type DemandRowOf<F extends DemandFact> = RowBase &
  Readonly<{ fact: F; value: DemandValues[F] | null }>;

export type DemandRow = { [F in DemandFact]: DemandRowOf<F> }[DemandFact];

/** Estado vigente: los persistidos con valor, o el Unknown derivado. */
export type CurrentStatus = "confirmed" | "corrected" | "detected" | "unknown";

/**
 * Por qué un fact es Unknown:
 * - `never_captured`: nunca se cargó (ni hay detección);
 * - `withdrawn`: un humano quitó el valor ("error de carga", C-3);
 * - `dismissed`: un humano descartó la detección sin valor humano previo;
 * - `inconsistent`: el ledger no forma una cadena humana válida. Falla
 *   cerrado: Match lo trata como sin dato.
 */
export type UnknownReason =
  "never_captured" | "withdrawn" | "dismissed" | "inconsistent";

/**
 * Etiqueta determinista de cada fila en el historial:
 * - `current`: sustenta el valor vigente;
 * - `superseded`: reemplazada (cambio del cliente, o una detección más nueva);
 * - `erroneous`: reemplazada por una corrección (`corrected`);
 * - `withdrawn`: valor humano quitado;
 * - `discarded`: detección rechazada;
 * - `rejection`: el acto humano que quitó o descartó;
 * - `pending`: detección posterior distinta, a la espera de un humano;
 * - `corroboration`: detección posterior que coincide con el valor vigente;
 * - `covered`: detección anterior al último acto humano, que ese acto ya
 *   cubrió.
 */
export type HistoryLabel =
  | "current"
  | "superseded"
  | "erroneous"
  | "withdrawn"
  | "discarded"
  | "rejection"
  | "pending"
  | "corroboration"
  | "covered";

export type HistoryEntry<F extends DemandFact = DemandFact> = Readonly<{
  factId: string;
  status: DemandFactStatus;
  sourceKind: DemandSourceKind;
  recordedBy: string | null;
  recordedAt: Date;
  value: DemandValues[F] | null;
  evidenceText: string | null;
  targetFactId: string | null;
  label: HistoryLabel;
}>;

/** Acto humano que dejó el fact en Unknown (quitado o descartado). */
export type ClosingAct = Readonly<{
  factId: string;
  recordedBy: string | null;
  recordedAt: Date;
  evidenceText: string | null;
}>;

export type PendingDetection<F extends DemandFact> = Readonly<{
  factId: string;
  value: DemandValues[F];
  /**
   * Se dijo antes del último acto humano (`observedAt ?? recordedAt` <
   * `head.recordedAt`). Solo informativo: nunca oculta, reordena ni descarta.
   */
  predatesAnchor: boolean;
}>;

export type FactTruth<F extends DemandFact = DemandFact> = Readonly<{
  fact: F;
  status: CurrentStatus;
  /** Valor vigente, o null si es Unknown. */
  value: DemandValues[F] | null;
  /** Fila que sustenta el valor vigente. */
  factId: string | null;
  recordedAt: Date | null;
  recordedBy: string | null;
  /**
   * Evidencia mostrada: la del ancla o, si el ancla no tiene y aceptó una
   * detección, la de esa detección.
   */
  evidenceText: string | null;
  /** "Antes": el valor del `target` que el valor vigente reemplazó. */
  replaced: DemandValues[F] | null;
  unknownReason: UnknownReason | null;
  closedBy: ClosingAct | null;
  /** Último acto humano de la cadena (compare-and-set), o null. */
  headId: string | null;
  pending: PendingDetection<F> | null;
  /** Todas las filas: `recordedAt` desc, posición en la cadena, `id` desc. */
  history: readonly HistoryEntry<F>[];
}>;

export type DemandTruth = Readonly<{ [F in DemandFact]: FactTruth<F> }>;

/** Una fila humana: la escribió un miembro (DEC-030 §3). */
export function isHumanRow(row: Pick<RowBase, "sourceKind">): boolean {
  return row.sourceKind === "member";
}

/** Orden de máquina: `(observedAt ?? recordedAt)` desc, `recordedAt` desc, `id` desc. */
function byMachineOrder(a: RowBase, b: RowBase): number {
  const said = (row: RowBase) => (row.observedAt ?? row.recordedAt).getTime();
  return (
    said(b) - said(a) ||
    b.recordedAt.getTime() - a.recordedAt.getTime() ||
    compareIds(b.id, a.id)
  );
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Forma mínima de una fila: estado coherente con su fuente y su valor. */
function wellFormed(row: RowBase & { value: unknown }): boolean {
  const human = isHumanRow(row);
  if ((row.status === "detected") === human) return false;
  if (human && row.recordedBy === null) return false;
  if (
    !human &&
    (row.targetFactId !== null || row.previousMemberFactId !== null)
  ) {
    return false;
  }
  if (row.status === "rejected") return row.value === null;
  if (row.status === "corrected" && row.targetFactId === null) return false;
  return row.value !== null;
}

/**
 * Cadena humana lineal: un único root y a lo sumo un sucesor por fila, todas
 * alcanzables desde el root. Devuelve las filas en orden de cadena, o null.
 */
function humanChain<R extends RowBase>(human: readonly R[]): R[] | null {
  const roots = human.filter((row) => row.previousMemberFactId === null);
  if (roots.length !== 1) return null;
  const next = new Map<string, R>();
  for (const row of human) {
    if (row.previousMemberFactId === null) continue;
    if (next.has(row.previousMemberFactId)) return null;
    next.set(row.previousMemberFactId, row);
  }
  const chain: R[] = [];
  let cursor: R | undefined = roots[0];
  while (cursor && chain.length <= human.length) {
    chain.push(cursor);
    cursor = next.get(cursor.id);
  }
  return chain.length === human.length ? chain : null;
}

type FoldState<R> =
  | Readonly<{ kind: "none" }>
  | Readonly<{ kind: "value"; anchor: R }>
  | Readonly<{ kind: "withdrawn"; act: R }>
  | Readonly<{ kind: "dismissed"; act: R }>;

function inconsistent<F extends DemandFact>(fact: F): FactTruth<F> {
  return {
    fact,
    status: "unknown",
    value: null,
    factId: null,
    recordedAt: null,
    recordedBy: null,
    evidenceText: null,
    replaced: null,
    unknownReason: "inconsistent",
    closedBy: null,
    headId: null,
    pending: null,
    // Sin cadena válida no hay etiquetas confiables: nada se muestra.
    history: [],
  };
}

function closingAct(row: RowBase): ClosingAct {
  return {
    factId: row.id,
    recordedBy: row.recordedBy,
    recordedAt: row.recordedAt,
    evidenceText: row.evidenceText,
  };
}

/** Current Truth de un fact a partir de sus filas (de una oportunidad). */
export function resolveFact<F extends DemandFact>(
  fact: F,
  rows: readonly DemandRowOf<F>[],
): FactTruth<F> {
  const own = rows.filter((row) => row.fact === fact);
  if (!own.every(wellFormed)) return inconsistent(fact);
  const byId = new Map(own.map((row) => [row.id, row]));
  if (byId.size !== own.length) return inconsistent(fact);

  const human = own.filter(isHumanRow);
  const machine = own.filter((row) => !isHumanRow(row)).sort(byMachineOrder);
  const labels = new Map<string, HistoryLabel>();
  const position = new Map<string, number>();

  const history = (): HistoryEntry<F>[] =>
    own
      .map((row) => ({
        factId: row.id,
        status: row.status,
        sourceKind: row.sourceKind,
        recordedBy: row.recordedBy,
        recordedAt: row.recordedAt,
        value: row.value,
        evidenceText: row.evidenceText,
        targetFactId: row.targetFactId,
        label: labels.get(row.id) ?? "covered",
      }))
      .sort(
        (a, b) =>
          b.recordedAt.getTime() - a.recordedAt.getTime() ||
          (position.get(b.factId) ?? -1) - (position.get(a.factId) ?? -1) ||
          compareIds(b.factId, a.factId),
      );

  // Paso 3, sin intervención humana (C-1): rige la detección más reciente
  // en orden de máquina, como "Detectado". Las anteriores quedan
  // reemplazadas.
  if (human.length === 0) {
    const [latest, ...older] = machine;
    for (const row of older) labels.set(row.id, "superseded");
    if (!latest) {
      return {
        fact,
        status: "unknown",
        value: null,
        factId: null,
        recordedAt: null,
        recordedBy: null,
        evidenceText: null,
        replaced: null,
        unknownReason: "never_captured",
        closedBy: null,
        headId: null,
        pending: null,
        history: [],
      };
    }
    labels.set(latest.id, "current");
    return {
      fact,
      status: "detected",
      value: latest.value,
      factId: latest.id,
      recordedAt: latest.recordedAt,
      recordedBy: latest.recordedBy,
      evidenceText: latest.evidenceText,
      replaced: null,
      unknownReason: null,
      closedBy: null,
      headId: null,
      pending: null,
      history: history(),
    };
  }

  // Paso 1: la cadena humana tiene que ser lineal (fail-closed).
  const chain = humanChain(human);
  if (!chain) return inconsistent(fact);
  chain.forEach((row, index) => position.set(row.id, index));

  // Paso 2: fold desde el root.
  const isMachine = (id: string | null) =>
    id !== null && byId.has(id) && !isHumanRow(byId.get(id)!);
  const resolved = new Set<string>();
  let state: FoldState<DemandRowOf<F>> = { kind: "none" };

  for (const act of chain) {
    const target = act.targetFactId;
    const anchor = state.kind === "value" ? state.anchor : null;
    if (act.status === "confirmed" || act.status === "corrected") {
      if (target === null) {
        // Un valor sobre Unknown. Sobre un valor vigente, el acto tiene que
        // apuntarlo.
        if (anchor) return inconsistent(fact);
      } else if (anchor && target === anchor.id) {
        labels.set(
          anchor.id,
          act.status === "corrected" ? "erroneous" : "superseded",
        );
      } else if (isMachine(target) && !resolved.has(target)) {
        resolved.add(target);
        labels.set(
          target,
          act.status === "corrected" ? "erroneous" : "superseded",
        );
        if (anchor) labels.set(anchor.id, "superseded");
      } else {
        return inconsistent(fact);
      }
      state = { kind: "value", anchor: act };
    } else if (act.status === "rejected") {
      labels.set(act.id, "rejection");
      if (target === null) return inconsistent(fact);
      if (anchor && target === anchor.id) {
        labels.set(anchor.id, "withdrawn");
        state = { kind: "withdrawn", act };
      } else if (isMachine(target) && !resolved.has(target)) {
        resolved.add(target);
        labels.set(target, "discarded");
        if (state.kind === "none") state = { kind: "dismissed", act };
      } else {
        return inconsistent(fact);
      }
    } else {
      return inconsistent(fact);
    }
  }

  const head = chain[chain.length - 1]!;
  const anchor = state.kind === "value" ? state.anchor : null;
  if (anchor) labels.set(anchor.id, "current");

  // Paso 4: pendiente. Candidatas: detecciones sin resolver registradas
  // desde el último acto humano. Las anteriores ya las cubrió ese acto (el
  // planner impide escribir un acto humano con un pendiente distinto sin
  // resolver).
  const unresolved = machine.filter((row) => !resolved.has(row.id));
  const candidates = unresolved.filter(
    (row) => row.recordedAt.getTime() >= head.recordedAt.getTime(),
  );
  const agrees = (row: DemandRowOf<F>) =>
    anchor !== null &&
    row.value !== null &&
    anchor.value !== null &&
    demandValueEquals(fact, row.value, anchor.value);
  for (const row of unresolved) labels.set(row.id, "covered");
  for (const row of candidates) {
    labels.set(row.id, agrees(row) ? "corroboration" : "superseded");
  }
  const [first] = candidates;
  let pending: PendingDetection<F> | null = null;
  if (first && first.value !== null && !agrees(first)) {
    labels.set(first.id, "pending");
    pending = {
      factId: first.id,
      value: first.value,
      predatesAnchor:
        (first.observedAt ?? first.recordedAt).getTime() <
        head.recordedAt.getTime(),
    };
  }

  // Paso 3, con intervención humana: manda solo la cadena humana.
  if (anchor) {
    const target =
      anchor.targetFactId === null ? undefined : byId.get(anchor.targetFactId);
    return {
      fact,
      status: anchor.status === "corrected" ? "corrected" : "confirmed",
      value: anchor.value,
      factId: anchor.id,
      recordedAt: anchor.recordedAt,
      recordedBy: anchor.recordedBy,
      evidenceText:
        anchor.evidenceText ??
        (target && !isHumanRow(target) ? target.evidenceText : null),
      replaced: target?.value ?? null,
      unknownReason: null,
      closedBy: null,
      headId: head.id,
      pending,
      history: history(),
    };
  }
  const closing =
    state.kind === "withdrawn" || state.kind === "dismissed" ? state.act : null;
  return {
    fact,
    status: "unknown",
    value: null,
    factId: null,
    recordedAt: null,
    recordedBy: null,
    evidenceText: null,
    replaced: null,
    unknownReason: state.kind === "withdrawn" ? "withdrawn" : "dismissed",
    closedBy: closing ? closingAct(closing) : null,
    headId: head.id,
    pending,
    history: history(),
  };
}

function rowsOf<F extends DemandFact>(
  rows: readonly DemandRow[],
  fact: F,
): DemandRowOf<F>[] {
  // DemandRow es la unión de DemandRowOf<F> por fact: filtrar por `fact`
  // deja exactamente las de F, pero TypeScript no lo estrecha sobre un F
  // genérico.
  return rows.filter((row) => row.fact === fact) as DemandRowOf<F>[];
}

/**
 * Current Truth de la demanda de una oportunidad: un FactTruth por cada fact
 * de la lista cerrada. Determinista: el orden de las filas no cambia el
 * resultado.
 */
export function resolveDemand(rows: readonly DemandRow[]): DemandTruth {
  return {
    desired_vehicle: resolveFact(
      "desired_vehicle",
      rowsOf(rows, "desired_vehicle"),
    ),
    year_range: resolveFact("year_range", rowsOf(rows, "year_range")),
    budget_max: resolveFact("budget_max", rowsOf(rows, "budget_max")),
    purchase_type: resolveFact("purchase_type", rowsOf(rows, "purchase_type")),
    trade_in_intent: resolveFact(
      "trade_in_intent",
      rowsOf(rows, "trade_in_intent"),
    ),
    down_payment: resolveFact("down_payment", rowsOf(rows, "down_payment")),
  };
}

/** Los facts de la demanda en su orden canónico (para iterar el resultado). */
export function factTruths(truth: DemandTruth): readonly FactTruth[] {
  return DEMAND_FACTS.map((fact) => truth[fact] as FactTruth);
}

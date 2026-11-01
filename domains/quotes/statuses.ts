import type { Stage } from "@/domains/opportunities/stages";

/*
 * Estados de una cotización y su máquina de estados (Hito 10, DEC-042 §2).
 * Módulo puro y apto para el navegador: la UI lo usa para mostrar estados y
 * ofrecer acciones, pero la regla la imponen el servidor
 * (planQuoteTransition() sobre la fila bloqueada) y la base (el trigger
 * `quotes_status_transition` de 0016_quotes, que espeja esta matriz; un
 * test cruza las dos).
 *
 *   draft ──► approved ──► sent ──► accepted
 *     │          │          ├─────► rejected
 *     └──────────┴──────────┴─────► withdrawn
 *
 * - `approved` es el paso de aprobación humana obligatorio (DEC-003,
 *   CLAUDE.md §2): ninguna cotización se marca enviada sin pasar por él.
 * - `sent` lo marca el vendedor cuando se la entregó al cliente. Porandú no
 *   envía nada (DEC-042 §6).
 * - `accepted` y `rejected` registran la respuesta del cliente.
 * - `withdrawn` (anulada) la retira el equipo. Corregir una cotización es
 *   anularla y crear otra: sus condiciones son inmutables.
 * - "Vencida" no es un estado guardado: se deriva de `valid_until` y el día
 *   de Asunción (sin jobs, B1 §4).
 */

export const QUOTE_STATUSES = [
  "draft",
  "approved",
  "sent",
  "accepted",
  "rejected",
  "withdrawn",
] as const;

export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

/** Estado con el que nace toda cotización. */
export const INITIAL_QUOTE_STATUS = "draft" as const satisfies QuoteStatus;

/** Estados abiertos: la cotización todavía puede cambiar. */
export const OPEN_QUOTE_STATUSES = [
  "draft",
  "approved",
  "sent",
] as const satisfies readonly QuoteStatus[];

/** Estados terminales: registran una decisión y no se reabren. */
export const TERMINAL_QUOTE_STATUSES = [
  "accepted",
  "rejected",
  "withdrawn",
] as const satisfies readonly QuoteStatus[];

/** Copy visible (es-PY) de cada estado. */
export const QUOTE_STATUS_LABELS: Readonly<Record<QuoteStatus, string>> = {
  draft: "Borrador",
  approved: "Aprobada",
  sent: "Enviada",
  accepted: "Aceptada",
  rejected: "Rechazada",
  withdrawn: "Anulada",
};

/** Copy del estado derivado de una cotización abierta con la validez vencida. */
export const EXPIRED_QUOTE_LABEL = "Vencida";

/** Verbo de la acción que lleva a cada estado (menú de la cotización). */
export const QUOTE_ACTION_LABELS: Readonly<
  Record<Exclude<QuoteStatus, "draft">, string>
> = {
  approved: "Aprobar cotización",
  sent: "Marcar como enviada",
  accepted: "Cliente aceptó",
  rejected: "Cliente rechazó",
  withdrawn: "Anular cotización",
};

/**
 * Matriz de transiciones. No hay saltos (nada se envía sin aprobar), ni
 * vuelta atrás, ni salida de un estado terminal.
 */
export const QUOTE_TRANSITIONS: Readonly<
  Record<QuoteStatus, readonly QuoteStatus[]>
> = {
  draft: ["approved", "withdrawn"],
  approved: ["sent", "withdrawn"],
  sent: ["accepted", "rejected", "withdrawn"],
  accepted: [],
  rejected: [],
  withdrawn: [],
};

/**
 * Destinos que exigen una cotización vigente (no vencida), una oportunidad
 * abierta y, para aceptarla, una unidad todavía en stock. Rechazar o anular
 * siempre se puede: limpian, no comprometen nada.
 */
export const COMMITTING_QUOTE_STATUSES = [
  "approved",
  "sent",
  "accepted",
] as const satisfies readonly QuoteStatus[];

/**
 * Etapas de la oportunidad en las que se crea una cotización y en las que
 * se aprueba, envía o acepta: después de calificar al cliente y antes del
 * cierre (DEC-032).
 */
export const QUOTABLE_STAGES = [
  "qualifying",
  "negotiating",
] as const satisfies readonly Stage[];

/** Estados de la unidad que admiten cotizarla o aceptar su cotización. */
export const QUOTABLE_VEHICLE_STATUSES = ["available", "reserved"] as const;

export type QuotableVehicleStatus = (typeof QUOTABLE_VEHICLE_STATUSES)[number];

export function isQuoteStatus(value: unknown): value is QuoteStatus {
  return (
    typeof value === "string" &&
    (QUOTE_STATUSES as readonly string[]).includes(value)
  );
}

export function isOpenQuoteStatus(status: QuoteStatus): boolean {
  return (OPEN_QUOTE_STATUSES as readonly QuoteStatus[]).includes(status);
}

export function isQuotableStage(stage: Stage): boolean {
  return (QUOTABLE_STAGES as readonly Stage[]).includes(stage);
}

export function isQuotableVehicleStatus(status: string): boolean {
  return (QUOTABLE_VEHICLE_STATUSES as readonly string[]).includes(status);
}

function isCommitting(status: QuoteStatus): boolean {
  return (COMMITTING_QUOTE_STATUSES as readonly QuoteStatus[]).includes(status);
}

/**
 * ¿Está vencida? `validUntil` es el último día de validez, inclusive, y
 * `today` el día de Asunción; los dos "AAAA-MM-DD" (se comparan como texto).
 */
export function isQuoteExpired(validUntil: string, today: string): boolean {
  return today > validUntil;
}

/**
 * Estado para mostrar: el guardado, o "vencida" si sigue abierta y pasó su
 * validez. Una cotización terminal conserva su estado aunque haya vencido.
 */
export type QuoteDisplayStatus = QuoteStatus | "expired";

export function quoteDisplayStatus(
  status: QuoteStatus,
  validUntil: string,
  today: string,
): QuoteDisplayStatus {
  return isOpenQuoteStatus(status) && isQuoteExpired(validUntil, today)
    ? "expired"
    : status;
}

export function quoteDisplayLabel(status: QuoteDisplayStatus): string {
  return status === "expired"
    ? EXPIRED_QUOTE_LABEL
    : QUOTE_STATUS_LABELS[status];
}

/** Lo que el servidor lee, con la cotización bloqueada, antes de moverla. */
export type QuoteTransitionTarget = Readonly<{
  status: QuoteStatus;
  /** Último día de validez, "AAAA-MM-DD". */
  validUntil: string;
  /** Etapa actual de su oportunidad. */
  opportunityStage: Stage;
  /** Estado actual de la unidad cotizada. */
  vehicleStatus: string;
  /** ¿Aprobarla exige `admin`? (requiresAdminApproval() de ./pricing). */
  requiresAdmin: boolean;
}>;

/** Quién pide el cambio: solo importa su rol en la organización activa. */
export type QuoteActor = Readonly<{ isAdmin: boolean }>;

export type QuoteTransitionError =
  /** El pase no existe en la matriz (incluye quedarse en el mismo estado). */
  | "invalid_transition"
  /** Aprobar, enviar o aceptar una cotización vencida. */
  | "expired"
  /** Aprobar, enviar o aceptar con la oportunidad fuera de QUOTABLE_STAGES. */
  | "opportunity_closed"
  /** Aceptar una cotización de una unidad que ya no está en stock. */
  | "vehicle_unavailable"
  /** Aprobar un descuento por encima del límite sin ser `admin`. */
  | "requires_admin";

export type QuoteTransitionPlan =
  | Readonly<{ ok: true; from: QuoteStatus; to: QuoteStatus }>
  | Readonly<{ ok: false; error: QuoteTransitionError }>;

/**
 * Decide, sin tocar nada, si la cotización pasa de su estado a `to` en el
 * día `today` (Asunción). Mismo orden de reglas que el trigger de la base.
 */
export function planQuoteTransition(
  target: QuoteTransitionTarget,
  to: QuoteStatus,
  actor: QuoteActor,
  today: string,
): QuoteTransitionPlan {
  const from = target.status;
  if (!QUOTE_TRANSITIONS[from].includes(to)) {
    return { ok: false, error: "invalid_transition" };
  }
  if (isCommitting(to)) {
    if (isQuoteExpired(target.validUntil, today)) {
      return { ok: false, error: "expired" };
    }
    if (!isQuotableStage(target.opportunityStage)) {
      return { ok: false, error: "opportunity_closed" };
    }
  }
  if (to === "accepted" && !isQuotableVehicleStatus(target.vehicleStatus)) {
    return { ok: false, error: "vehicle_unavailable" };
  }
  if (to === "approved" && target.requiresAdmin && !actor.isAdmin) {
    return { ok: false, error: "requires_admin" };
  }
  return { ok: true, from, to };
}

/** Destinos que la cotización ofrece hoy a `actor`, en el orden de la matriz. */
export function availableQuoteTransitions(
  target: QuoteTransitionTarget,
  actor: QuoteActor,
  today: string,
): QuoteStatus[] {
  return QUOTE_TRANSITIONS[target.status].filter(
    (to) => planQuoteTransition(target, to, actor, today).ok,
  );
}

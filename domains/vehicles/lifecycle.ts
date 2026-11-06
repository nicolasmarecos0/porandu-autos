import { vehicleStatusLabel, type VehicleStatus } from "./stock";

/*
 * Ciclo de vida de una unidad del stock (Hito 19, DEC-051): la
 * máquina de estados formal de `vehicles.status`.
 *
 *   inPreparation ──► available ◄──► reserved
 *    (preparación)        │   (salón)    │
 *                         └──────┬───────┘
 *                                ▼
 *                              sold   (terminal)
 *
 * - "Poner en salón" (in_preparation → available) es la transición de
 *   H1.3C (DEC-028), ahora una más de la máquina.
 * - "Reservar unidad" (available → reserved) y "Liberar reserva"
 *   (reserved → available) las pide un miembro desde Stock o el catálogo.
 * - Vender (available | reserved → sold) no es una acción de Stock: ocurre
 *   solo al cerrar como Ganada la oportunidad que tiene la unidad
 *   vinculada, en la misma transacción del cierre (DEC-034 §3: la unidad
 *   vinculada es la vendida). La venta nace de la oportunidad y sus
 *   metadatos; no se vuelve a cargar en Stock.
 * - `sold` es terminal: no se vuelve a vender, reservar ni preparar. Sin
 *   saltos (de preparación no se reserva ni se vende) y sin vuelta a
 *   preparación.
 *
 * Módulo puro y apto para el navegador: la UI lo usa para ofrecer las
 * acciones y avisar antes de enviar, pero la regla la imponen el servidor
 * (planVehicleStatusChange() y planVehicleSale() sobre la fila bloqueada) y
 * la base (el trigger `vehicles_status_transition`, que espeja esta matriz;
 * un test cruza los 16 pares).
 */

/** Destinos posibles desde cada estado, en el orden en que se ofrecen. */
export const VEHICLE_LIFECYCLE: Readonly<
  Record<VehicleStatus, readonly VehicleStatus[]>
> = {
  inPreparation: ["available"],
  available: ["reserved", "sold"],
  reserved: ["available", "sold"],
  sold: [],
};

/** ¿Existe el pase `from → to` en la máquina? Pedir el mismo estado, no. */
export function canTransitionVehicle(
  from: VehicleStatus,
  to: VehicleStatus,
): boolean {
  return VEHICLE_LIFECYCLE[from].includes(to);
}

/** De una unidad vendida no se sale. */
export function isTerminalVehicleStatus(status: VehicleStatus): boolean {
  return VEHICLE_LIFECYCLE[status].length === 0;
}

/* ── Transiciones con nombre ────────────────────────────────────────────── */

export const VEHICLE_TRANSITION_IDS = [
  "put_on_floor",
  "reserve",
  "release",
  "sell",
] as const;

export type VehicleTransitionId = (typeof VEHICLE_TRANSITION_IDS)[number];

/**
 * Por dónde se pide cada transición: `stock` es la Server Action
 * changeVehicleStatus() (Inventario y catálogo); `closure`, el cierre Ganada
 * de closeOpportunity() (DEC-034), nunca una acción de Stock.
 */
export type VehicleTransitionChannel = "stock" | "closure";

export type VehicleTransition = Readonly<{
  id: VehicleTransitionId;
  from: readonly VehicleStatus[];
  to: VehicleStatus;
  channel: VehicleTransitionChannel;
}>;

export const VEHICLE_TRANSITIONS: Readonly<
  Record<VehicleTransitionId, VehicleTransition>
> = {
  put_on_floor: {
    id: "put_on_floor",
    from: ["inPreparation"],
    to: "available",
    channel: "stock",
  },
  reserve: {
    id: "reserve",
    from: ["available"],
    to: "reserved",
    channel: "stock",
  },
  release: {
    id: "release",
    from: ["reserved"],
    to: "available",
    channel: "stock",
  },
  sell: {
    id: "sell",
    from: ["available", "reserved"],
    to: "sold",
    channel: "closure",
  },
};

/** Las que pide un miembro desde Stock: todas menos vender. */
export const STOCK_TRANSITION_IDS = [
  "put_on_floor",
  "reserve",
  "release",
] as const satisfies readonly VehicleTransitionId[];

export type StockTransitionId = (typeof STOCK_TRANSITION_IDS)[number];

export function isVehicleTransitionId(
  value: unknown,
): value is VehicleTransitionId {
  return (
    typeof value === "string" &&
    (VEHICLE_TRANSITION_IDS as readonly string[]).includes(value)
  );
}

export function isStockTransitionId(
  value: unknown,
): value is StockTransitionId {
  return (
    typeof value === "string" &&
    (STOCK_TRANSITION_IDS as readonly string[]).includes(value)
  );
}

/** La transición con nombre de un pase, o null si el pase no existe. */
export function transitionBetween(
  from: VehicleStatus,
  to: VehicleStatus,
): VehicleTransitionId | null {
  return (
    VEHICLE_TRANSITION_IDS.find((id) => {
      const transition = VEHICLE_TRANSITIONS[id];
      return transition.to === to && transition.from.includes(from);
    }) ?? null
  );
}

/* ── Pedido de Stock y su plan sobre la fila bloqueada ─────────────────── */

/**
 * Campos que el servidor lee del pedido: la unidad y la transición. Con la
 * transición, el cliente dice qué vio (el origen) y qué pide (el destino):
 * el servidor compara el origen con la fila bloqueada, así un pedido viejo
 * nunca deshace lo que otra persona hizo entretanto (p. ej. poner en el
 * salón una unidad que alguien ya reservó). Organización, estado de destino
 * escrito a mano, usuario y reloj nunca salen del cliente.
 */
export const VEHICLE_STATUS_CHANGE_FIELDS = {
  vehicleId: "vehicleId",
  transition: "transition",
} as const;

/** Qué hacer con un pedido de Stock, dado el estado actual de la unidad. */
export type VehicleStatusChangePlan =
  /** Escribir el pase. */
  | Readonly<{
      kind: "change";
      transition: StockTransitionId;
      from: VehicleStatus;
      to: VehicleStatus;
    }>
  /** Ya está en el destino (p. ej. otra persona la reservó antes). */
  | Readonly<{
      kind: "unchanged";
      transition: StockTransitionId;
      status: VehicleStatus;
    }>
  /**
   * La unidad ya no está en el origen de la transición (otra persona la
   * cambió, o se vendió): no se escribe nada. `current` es el estado real.
   */
  | Readonly<{
      kind: "conflict";
      transition: StockTransitionId;
      current: VehicleStatus;
    }>
  /** Vender no es una acción de Stock: se registra al cerrar Ganada. */
  | Readonly<{ kind: "sale_requires_closure"; current: VehicleStatus }>;

/**
 * Decide, sin tocar nada, qué pasa con un pedido de Stock. Pedir lo que ya
 * está es idempotente (`unchanged`); una unidad vendida no cambia nunca.
 */
export function planVehicleStatusChange(
  current: VehicleStatus,
  transition: VehicleTransitionId,
): VehicleStatusChangePlan {
  if (transition === "sell") {
    return { kind: "sale_requires_closure", current };
  }
  const { from, to } = VEHICLE_TRANSITIONS[transition];
  if (current === to) return { kind: "unchanged", transition, status: current };
  if (!from.includes(current)) return { kind: "conflict", transition, current };
  return { kind: "change", transition, from: current, to };
}

/* ── Venta al cerrar Ganada ─────────────────────────────────────────────── */

/** Estados desde los que una unidad se vende. */
export const SELLABLE_VEHICLE_STATUSES = VEHICLE_TRANSITIONS.sell.from;

export type SaleConflictReason = "already_sold" | "in_preparation";

/** Qué pasa con la unidad vinculada al cerrar la oportunidad como Ganada. */
export type VehicleSalePlan =
  /** Pasa a vendida en la misma transacción del cierre. */
  | Readonly<{ kind: "sell"; from: VehicleStatus }>
  /** No se puede vender: el cierre se rechaza entero, sin escribir nada. */
  | Readonly<{
      kind: "conflict";
      current: VehicleStatus;
      reason: SaleConflictReason;
    }>;

/**
 * Decide, sin tocar nada, si la unidad vinculada se puede vender. Una
 * unidad ya vendida (p. ej. por otra oportunidad que la tenía vinculada) o
 * en preparación es un conflicto: ganar no la toma.
 */
export function planVehicleSale(current: VehicleStatus): VehicleSalePlan {
  if (SELLABLE_VEHICLE_STATUSES.includes(current)) {
    return { kind: "sell", from: current };
  }
  return {
    kind: "conflict",
    current,
    reason: current === "sold" ? "already_sold" : "in_preparation",
  };
}

/* ── Acciones de cada vista ─────────────────────────────────────────────── */

/**
 * La acción rápida del Inventario (/stock) para una unidad en `status`:
 * poner en el salón, reservar o liberar. Una vendida no ofrece ninguna.
 */
export function stockTransitionFor(
  status: VehicleStatus,
): StockTransitionId | null {
  return (
    STOCK_TRANSITION_IDS.find((id) =>
      VEHICLE_TRANSITIONS[id].from.includes(status),
    ) ?? null
  );
}

/**
 * La acción de la hoja del catálogo (/stock/catalog): reservar o liberar.
 * El catálogo no muestra unidades en preparación (DEC-049 §2) y una
 * vendida no ofrece acciones.
 */
export function catalogTransitionFor(
  status: VehicleStatus,
): Extract<StockTransitionId, "reserve" | "release"> | null {
  if (status === "available") return "reserve";
  if (status === "reserved") return "release";
  return null;
}

/** El estado que se muestra mientras guarda: el destino de la transición. */
export function optimisticStatusOf(
  transition: StockTransitionId,
): VehicleStatus {
  return VEHICLE_TRANSITIONS[transition].to;
}

/* ── Copy (es-PY) ───────────────────────────────────────────────────────── */

export type VehicleTransitionCopy = Readonly<{
  /** El botón: "Poner en salón", "Reservar unidad", "Liberar reserva". */
  label: string;
  /** El botón compacto de una fila del Inventario. */
  short: string;
  /** El título de la confirmación. */
  title: string;
  /** La consecuencia, en una oración. */
  description: string;
  /** El botón que confirma. */
  confirm: string;
}>;

export const VEHICLE_TRANSITION_COPY: Readonly<
  Record<StockTransitionId, VehicleTransitionCopy>
> = {
  put_on_floor: {
    label: "Poner en salón",
    short: "Poner en salón",
    title: "Poner la unidad en el salón",
    description:
      "Queda disponible para vender, en el catálogo y en los matches. No vuelve a preparación.",
    confirm: "Poner en salón",
  },
  reserve: {
    label: "Reservar unidad",
    short: "Reservar",
    title: "Reservar la unidad",
    description:
      "Queda apartada para un comprador: deja de figurar como disponible y sale de los matches hasta que se libere.",
    confirm: "Reservar unidad",
  },
  release: {
    label: "Liberar reserva",
    short: "Liberar",
    title: "Liberar la reserva",
    description:
      "Vuelve a estar disponible para vender, en el catálogo y en los matches.",
    confirm: "Liberar reserva",
  },
};

/** Lo que dice la UI mientras guarda. */
export const VEHICLE_TRANSITION_PENDING = "Guardando…";

/** El estado como parte de una oración: "reservada", "en preparación". */
export function statusPhrase(status: VehicleStatus): string {
  return vehicleStatusLabel(status).toLowerCase();
}

/** Qué se intentó, para decir por qué no se pudo. */
const ATTEMPT: Readonly<Record<StockTransitionId, string>> = {
  put_on_floor: "poner en el salón",
  reserve: "reservar",
  release: "liberar la reserva",
};

/** Aviso de un pase hecho por este pedido. `unit`: "Toyota Hilux 2025". */
export function transitionSuccessMessage(
  transition: StockTransitionId,
  unit: string,
): string {
  switch (transition) {
    case "put_on_floor":
      return `${unit} ya está en el salón: disponible para vender.`;
    case "reserve":
      return `${unit} quedó reservada. Para volver a ofrecerla, liberá la reserva.`;
    case "release":
      return `Se liberó la reserva de ${unit}: está disponible para vender.`;
  }
}

/** La unidad ya estaba en el destino: nada cambió. */
export function transitionUnchangedMessage(
  status: VehicleStatus,
  unit: string,
): string {
  return `${unit} ya estaba ${statusPhrase(status)}. No se hizo ningún cambio.`;
}

/** La unidad cambió entretanto (o se vendió): nada cambió. */
export function transitionConflictMessage(
  transition: StockTransitionId,
  current: VehicleStatus,
  unit: string,
): string {
  const reason =
    current === "sold"
      ? `${unit} ya está vendida y una venta no se deshace`
      : `${unit} está ${statusPhrase(current)}`;
  return `No se pudo ${ATTEMPT[transition]}: ${reason}. No se hizo ningún cambio.`;
}

export const SALE_REQUIRES_CLOSURE_MESSAGE =
  "La venta de una unidad se registra al cerrar como Ganada la oportunidad que la tiene vinculada. No se hizo ningún cambio.";

export const VEHICLE_NOT_FOUND_MESSAGE =
  "No encontramos esa unidad en el stock. No se hizo ningún cambio.";

export const VEHICLE_CHANGE_FAILED_MESSAGE =
  "No pudimos guardar el cambio. No se hizo ningún cambio: intentá de nuevo en unos minutos.";

/** Por qué no se puede ganar con la unidad vinculada (aviso de conflicto). */
export function saleConflictMessage(reason: SaleConflictReason): string {
  return reason === "already_sold"
    ? "La unidad vinculada ya figura como Vendida en el stock: no se puede vender dos veces. Vinculá otra unidad a la negociación."
    : "La unidad vinculada todavía está En preparación en el stock: ponela en el salón antes de cerrar la venta.";
}

/**
 * Lo que la confirmación "Marcar como ganada" avisa sobre el stock: la
 * unidad vinculada pasa a vendida al confirmar, o por qué no puede.
 */
export type SaleNotice =
  | Readonly<{ kind: "will_sell"; from: VehicleStatus; to: "sold" }>
  | Readonly<{
      kind: "conflict";
      current: VehicleStatus;
      reason: SaleConflictReason;
      message: string;
    }>;

export function saleNoticeFor(status: VehicleStatus): SaleNotice {
  const plan = planVehicleSale(status);
  return plan.kind === "sell"
    ? { kind: "will_sell", from: plan.from, to: "sold" }
    : {
        kind: "conflict",
        current: plan.current,
        reason: plan.reason,
        message: saleConflictMessage(plan.reason),
      };
}

/** "Al confirmar, la unidad pasa a Vendida en el stock." */
export const SALE_NOTICE_TEXT =
  "Al confirmar, la unidad vinculada pasa a «Vendida» en el stock: deja de ofrecerse y no se puede reservar ni vender otra vez.";

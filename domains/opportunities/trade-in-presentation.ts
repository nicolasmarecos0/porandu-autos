import { authorLabel, formatDemandDate } from "@/domains/demand/presentation";
import { formatAmount, formatMoney, type Currency } from "@/domains/money";
import { formatKm, vehicleDetail, vehicleName } from "@/domains/vehicles/stock";

import type { Stage } from "./stages";
import {
  decisionsFor,
  isActiveTradeInStatus,
  isTradeInOpenStage,
  TRADE_IN_STATUS_LABELS,
  tradeInIntakeCost,
  type TradeInAppraisal,
  type TradeInAppraisalValues,
  type TradeInDecisionId,
  type TradeInStatus,
} from "./trade-ins";

/*
 * Presentación de la toma de usados en /opportunities/[id] (Hito 20,
 * DEC-052 §4). Pura y determinista: arma, desde las filas que lee el
 * servidor, lo que muestra el panel "Vehículo en parte de pago / Toma", lo
 * que ofrece a quien mira y lo que avisa la confirmación del cierre Ganada.
 *
 * - Los autores llegan como "Vos" u "Otro miembro": ningún id de usuario
 *   sale del servidor.
 * - La sección financiera (costo de reacondicionamiento y costo total de
 *   ingreso) es exclusiva del admin, el tasador o gerente: para un seller,
 *   el servidor ni la manda. El valor de toma sí lo ven todos: es lo que el
 *   vendedor le comunica al cliente para registrar su respuesta.
 * - Las acciones son las que el dominio permite hoy al que mira; el
 *   servidor y la base las vuelven a exigir.
 */

/** Lo que el loader lee de cada toma de la oportunidad. */
export type TradeInRow = Readonly<{
  id: string;
  status: TradeInStatus;
  brand: string;
  model: string;
  version: string | null;
  year: number;
  km: number | null;
  plate: string | null;
  currency: Currency | null;
  estimatedRepairCost: string | null;
  offerPrice: string | null;
  createdBy: string;
  createdAt: Date;
  appraisedBy: string | null;
  appraisedAt: Date | null;
  convertedVehicleId: string | null;
  updatedAt: Date;
}>;

/** La tasación de una fila, o null si todavía no se tasó. */
export function appraisalOf(row: TradeInRow): TradeInAppraisal | null {
  const { currency, estimatedRepairCost, offerPrice } = row;
  if (currency === null || estimatedRepairCost === null || offerPrice === null)
    return null;
  return { currency, estimatedRepairCost, offerPrice };
}

/** El recorrido de la toma hasta el stock (el stepper del panel). */
export const TRADE_IN_STEPS = [
  "registered",
  "appraised",
  "accepted",
  "stocked",
] as const;

export type TradeInStep = (typeof TRADE_IN_STEPS)[number];

export const TRADE_IN_STEP_LABELS: Readonly<Record<TradeInStep, string>> = {
  registered: "Registrado",
  appraised: TRADE_IN_STATUS_LABELS.appraised,
  accepted: TRADE_IN_STATUS_LABELS.accepted,
  stocked: "En stock",
};

export type TradeInAppraisalView = Readonly<{
  /** "USD 8.000": el valor de toma que se le ofrece al cliente. */
  offerPriceLabel: string;
  /**
   * Solo para el admin (la sección financiera exclusiva): el costo de
   * reacondicionamiento y el costo total de ingreso. Null para un seller.
   */
  financial: Readonly<{
    repairCostLabel: string;
    intakeCostLabel: string;
  }> | null;
  /** "Tasó: Vos · 9 nov 2026 10:30". */
  appraisedLabel: string | null;
}>;

export type TradeInNoteTone = "neutral" | "info" | "success" | "warning";

export type TradeInCardView = Readonly<{
  id: string;
  status: TradeInStatus;
  statusLabel: string;
  /** "Toyota Vitz". */
  name: string;
  /** "1.3 F · 2015". */
  detail: string;
  /** "98.000 km", o null sin dato. */
  kmLabel: string | null;
  /** "ABC 123", o null sin chapa cargada. */
  plateLabel: string | null;
  /** "Registró: Otro miembro · 9 nov 2026 09:12". */
  registeredLabel: string;
  appraisal: TradeInAppraisalView | null;
  /** Lo que el que mira puede decidir hoy (cualquier miembro). */
  decisions: readonly TradeInDecisionId[];
  /** Tasar (pendiente) o retasar (tasado): solo un admin. */
  appraise: "appraise" | "reappraise" | null;
  /**
   * La tasación vigente en es-PY, para precargar la retasación. Solo para
   * el admin.
   */
  appraisalValues: TradeInAppraisalValues | null;
  /** Qué pasa ahora con la toma, en una oración. */
  note: Readonly<{ tone: TradeInNoteTone; text: string }> | null;
  /** Paso del recorrido. */
  step: TradeInStep;
  /** Se convirtió en una unidad del stock (con el cierre Ganada). */
  stocked: boolean;
}>;

export type TradeInHistoryItem = Readonly<{
  id: string;
  /** "Toyota Vitz 2015". */
  label: string;
  statusLabel: string;
  /** "USD 7.500" si se había tasado. */
  offerPriceLabel: string | null;
  /** "9 nov 2026 10:30": cuándo se decidió. */
  at: string;
}>;

/**
 * Lo que avisa la confirmación "Marcar como ganada" sobre la toma vigente
 * (DEC-052 §5): una aceptada entra al stock al confirmar; una sin decidir,
 * no (es un aviso, no un bloqueo).
 */
export type TradeInClosureNotice =
  | Readonly<{ kind: "will_stock"; name: string; detail: string }>
  | Readonly<{
      kind: "undecided";
      name: string;
      detail: string;
      status: TradeInStatus;
      message: string;
    }>;

export type TradeInPanelData = Readonly<{
  /** La toma vigente (pendiente, tasada o aceptada), o null. */
  current: TradeInCardView | null;
  /** Las rechazadas, de la más reciente a la más vieja. */
  history: readonly TradeInHistoryItem[];
  /** Se puede registrar una toma: oportunidad abierta y ninguna vigente. */
  canRegister: boolean;
  /** Por qué no se registra, o qué dijo el cliente sobre su usado. */
  hint: string | null;
  /** El que mira es admin: ve y carga la sección financiera. */
  viewerIsAdmin: boolean;
  /** El aviso de la confirmación del cierre Ganada. */
  closure: TradeInClosureNotice | null;
}>;

/* ── Copy (es-PY) ───────────────────────────────────────────────────────── */

/** El botón de cada decisión. */
export const TRADE_IN_DECISION_LABELS: Readonly<
  Record<TradeInDecisionId, string>
> = {
  accept: "Cliente aprobó",
  reject: "Cliente rechazó",
  discard: "Descartar toma",
  withdraw: "Cliente desistió",
};

export type TradeInDecisionCopy = Readonly<{
  title: string;
  description: string;
  confirm: string;
  tone: "primary" | "danger";
}>;

/** La confirmación de cada decisión (alertdialog de Radix). */
export const TRADE_IN_DECISION_COPY: Readonly<
  Record<TradeInDecisionId, TradeInDecisionCopy>
> = {
  accept: {
    title: "Registrar que el cliente aprobó la toma",
    description:
      "El cliente aceptó el valor de toma. Al marcar la oportunidad como ganada, el usado ingresa al stock como unidad En preparación.",
    confirm: "Aprobado por el cliente",
    tone: "primary",
  },
  reject: {
    title: "Registrar que el cliente rechazó la toma",
    description:
      "La toma queda rechazada y no se puede deshacer. Si se vuelve a negociar el usado, registralo de nuevo y tasalo.",
    confirm: "Cliente rechazó",
    tone: "danger",
  },
  discard: {
    title: "Descartar la toma",
    description:
      "El usado no se tasa: queda rechazado y no se puede deshacer. Podés registrar otro después.",
    confirm: "Descartar toma",
    tone: "danger",
  },
  withdraw: {
    title: "Registrar que el cliente desistió",
    description:
      "El cliente ya no entrega el usado: la toma queda rechazada y no ingresa al stock al cerrar la venta.",
    confirm: "Cliente desistió",
    tone: "danger",
  },
};

export const TRADE_IN_APPRAISE_LABELS = {
  appraise: "Tasar",
  reappraise: "Retasar",
} as const;

/** Lo que dice la UI mientras guarda. */
export const TRADE_IN_PENDING = "Guardando…";

/** "Toyota Vitz 2015": el usado como lo nombran los avisos. */
export function tradeInLabel(
  row: Pick<TradeInRow, "brand" | "model" | "year">,
): string {
  return `${row.brand} ${row.model} ${row.year}`;
}

function noteFor(
  row: TradeInRow,
  stage: Stage,
  viewerIsAdmin: boolean,
): TradeInCardView["note"] {
  const open = isTradeInOpenStage(stage);
  switch (row.status) {
    case "pending":
      if (!open) {
        return stage === "won"
          ? {
              tone: "warning",
              text: "La venta se cerró sin tasar el usado: no ingresó al stock.",
            }
          : {
              tone: "neutral",
              text: "La oportunidad se perdió: la toma quedó sin tasar.",
            };
      }
      return viewerIsAdmin
        ? {
            tone: "info",
            text: "Cargá el costo de reacondicionamiento y el valor de toma para tasarlo.",
          }
        : {
            tone: "info",
            text: "Pendiente de tasación: la carga un admin (tasador o gerente).",
          };
    case "appraised":
      if (!open) {
        return stage === "won"
          ? {
              tone: "warning",
              text: "La venta se cerró sin la aprobación del cliente: el usado no ingresó al stock.",
            }
          : {
              tone: "neutral",
              text: "La oportunidad se perdió: la toma quedó sin la respuesta del cliente.",
            };
      }
      return {
        tone: "info",
        text: "Comunicale al cliente el valor de toma y registrá su respuesta.",
      };
    case "accepted":
      if (row.convertedVehicleId !== null) {
        return {
          tone: "success",
          text: "Ingresó al stock como unidad En preparación con el cierre de la venta.",
        };
      }
      if (stage === "lost") {
        return {
          tone: "neutral",
          text: "La oportunidad se perdió: el usado no ingresó al stock.",
        };
      }
      return {
        tone: "info",
        text: "Al marcar la oportunidad como ganada, ingresa al stock como unidad En preparación.",
      };
    case "rejected":
      return null;
  }
}

function stepOf(row: TradeInRow): TradeInStep {
  if (row.convertedVehicleId !== null) return "stocked";
  switch (row.status) {
    case "pending":
    case "rejected":
      return "registered";
    case "appraised":
      return "appraised";
    case "accepted":
      return "accepted";
  }
}

/** La tasación en es-PY, para precargar el formulario ("8.000", "800"). */
export function appraisalValuesOf(
  appraisal: TradeInAppraisal,
): TradeInAppraisalValues {
  return {
    currency: appraisal.currency,
    estimatedRepairCost: formatAmount(appraisal.estimatedRepairCost),
    offerPrice: formatAmount(appraisal.offerPrice),
  };
}

export function tradeInCardView(
  row: TradeInRow,
  context: Readonly<{
    viewerUserId: string;
    viewerIsAdmin: boolean;
    opportunityStage: Stage;
  }>,
): TradeInCardView {
  const open = isTradeInOpenStage(context.opportunityStage);
  const appraisal = appraisalOf(row);
  const admin = context.viewerIsAdmin;
  return {
    id: row.id,
    status: row.status,
    statusLabel: TRADE_IN_STATUS_LABELS[row.status],
    name: vehicleName(row),
    detail: vehicleDetail({
      year: row.year,
      ...(row.version ? { version: row.version } : {}),
    }),
    kmLabel: row.km === null ? null : formatKm(row.km),
    plateLabel: row.plate,
    registeredLabel: `Registró: ${authorLabel(row.createdBy, context.viewerUserId)} · ${formatDemandDate(row.createdAt)}`,
    appraisal: appraisal
      ? {
          offerPriceLabel: formatMoney({
            amount: appraisal.offerPrice,
            currency: appraisal.currency,
          }),
          financial: admin
            ? {
                repairCostLabel: formatMoney({
                  amount: appraisal.estimatedRepairCost,
                  currency: appraisal.currency,
                }),
                intakeCostLabel: formatMoney(tradeInIntakeCost(appraisal)),
              }
            : null,
          appraisedLabel:
            row.appraisedBy && row.appraisedAt
              ? `Tasó: ${authorLabel(row.appraisedBy, context.viewerUserId)} · ${formatDemandDate(row.appraisedAt)}`
              : null,
        }
      : null,
    decisions: open ? decisionsFor(row.status) : [],
    appraise:
      open && admin
        ? row.status === "pending"
          ? "appraise"
          : row.status === "appraised"
            ? "reappraise"
            : null
        : null,
    appraisalValues: admin && appraisal ? appraisalValuesOf(appraisal) : null,
    note: noteFor(row, context.opportunityStage, admin),
    step: stepOf(row),
    stocked: row.convertedVehicleId !== null,
  };
}

/** Por qué no se registra una toma, o qué dijo el cliente de su usado. */
export function tradeInHint(
  stage: Stage,
  tradeInIntent: boolean | null,
): string | null {
  if (!isTradeInOpenStage(stage)) {
    return "La oportunidad está cerrada: ya no se registran ni se deciden tomas.";
  }
  if (tradeInIntent === true) {
    return "El cliente dijo que entrega su usado: registralo para tasarlo.";
  }
  if (tradeInIntent === false) {
    return "Según lo que busca, el cliente no entrega usado. Si cambia, registralo acá.";
  }
  return null;
}

/** El aviso de la confirmación "Marcar como ganada" para la toma vigente. */
export function tradeInClosureNotice(
  row: TradeInRow | null,
): TradeInClosureNotice | null {
  if (row === null || row.convertedVehicleId !== null) return null;
  const name = vehicleName(row);
  const detail = vehicleDetail({
    year: row.year,
    ...(row.version ? { version: row.version } : {}),
  });
  switch (row.status) {
    case "accepted":
      return { kind: "will_stock", name, detail };
    case "pending":
    case "appraised":
      return {
        kind: "undecided",
        name,
        detail,
        status: row.status,
        message: `La toma está «${TRADE_IN_STATUS_LABELS[row.status]}», sin la aprobación del cliente: al confirmar, el usado no ingresa al stock. Si el cliente la aprobó, registralo en «Vehículo en parte de pago» antes de cerrar.`,
      };
    case "rejected":
      return null;
  }
}

/** "Al confirmar, el usado entra al stock En preparación." */
export const TRADE_IN_STOCK_NOTICE_TEXT =
  "Al confirmar, el usado en parte de pago ingresa al stock como unidad «En preparación», con sus datos y sin precio publicado.";

/**
 * Datos del panel. Las filas llegan de la más reciente a la más vieja; la
 * vigente es la única pendiente, tasada o aceptada (índice único parcial).
 */
export function tradeInPanelData(
  rows: readonly TradeInRow[],
  context: Readonly<{
    viewerUserId: string;
    viewerIsAdmin: boolean;
    opportunityStage: Stage;
    /** El `trade_in_intent` vigente de la demanda (DEC-030), si se sabe. */
    tradeInIntent: boolean | null;
  }>,
): TradeInPanelData {
  const sorted = [...rows].sort(
    (a, b) =>
      b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id),
  );
  const active = sorted.find((row) => isActiveTradeInStatus(row.status));
  const open = isTradeInOpenStage(context.opportunityStage);
  return {
    current: active ? tradeInCardView(active, context) : null,
    history: sorted
      .filter((row) => row.status === "rejected")
      .map((row) => {
        const appraisal = appraisalOf(row);
        return {
          id: row.id,
          label: tradeInLabel(row),
          statusLabel: TRADE_IN_STATUS_LABELS[row.status],
          offerPriceLabel: appraisal
            ? formatMoney({
                amount: appraisal.offerPrice,
                currency: appraisal.currency,
              })
            : null,
          at: formatDemandDate(row.updatedAt),
        };
      }),
    canRegister: open && active === undefined,
    hint:
      active === undefined || !open
        ? tradeInHint(context.opportunityStage, context.tradeInIntent)
        : null,
    viewerIsAdmin: context.viewerIsAdmin,
    closure: open ? tradeInClosureNotice(active ?? null) : null,
  };
}

/* ── Avisos de las respuestas ───────────────────────────────────────────── */

/** Por qué no se pudo pedir una decisión (aviso de conflicto). */
export function tradeInConflictMessage(current: TradeInStatus): string {
  return `Otra persona ya cambió la toma: está «${TRADE_IN_STATUS_LABELS[current]}». No se hizo ningún cambio.`;
}

export const TRADE_IN_MESSAGES = {
  offer_price_required:
    "Para aprobarla hace falta el valor de toma: primero la tasa un admin. No se hizo ningún cambio.",
  opportunity_closed:
    "La oportunidad ya está cerrada: la toma no cambia más. No se hizo ningún cambio.",
  requires_admin:
    "Solo un admin (tasador o gerente) carga la tasación. No se hizo ningún cambio.",
  already_registered:
    "La oportunidad ya tiene una toma vigente: decidí esa antes de registrar otra. No se registró nada.",
  not_found: "No encontramos la toma. Puede que ya no exista.",
  failed:
    "No pudimos guardar el cambio. No se hizo ningún cambio: intentá de nuevo en unos minutos.",
} as const;

/** Aviso de una decisión hecha por este pedido. */
export function tradeInDecisionMessage(
  decision: TradeInDecisionId,
  label: string,
): string {
  switch (decision) {
    case "accept":
      return `${label}: aprobado por el cliente. Al ganar la oportunidad, ingresa al stock En preparación.`;
    case "reject":
      return `${label}: el cliente rechazó la toma.`;
    case "discard":
      return `Se descartó la toma de ${label}.`;
    case "withdraw":
      return `${label}: el cliente desistió. No ingresa al stock al cerrar.`;
  }
}

/** Aviso de la tasación hecha por este pedido. */
export function tradeInAppraisedMessage(
  label: string,
  offerPriceLabel: string,
): string {
  return `${label} quedó tasado: valor de toma ${offerPriceLabel}.`;
}

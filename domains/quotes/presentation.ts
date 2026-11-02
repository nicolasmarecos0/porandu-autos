import { vehicleLabel } from "@/domains/calendar/agenda";
import { authorLabel, formatDemandDate } from "@/domains/demand/presentation";
import { formatMoney, type Money } from "@/domains/money";
import { formatCalendarDate } from "@/domains/opportunities/closure";
import type { Stage } from "@/domains/opportunities/stages";

import { quoteExportability, type QuoteExportability } from "./exportability";
import {
  discountAmount,
  discountFrom,
  formatEffectivePercent,
  requiresAdminApproval,
  type Discount,
} from "./pricing";
import {
  availableQuoteTransitions,
  isQuotableStage,
  quoteDisplayLabel,
  quoteDisplayStatus,
  type QuoteDisplayStatus,
  type QuoteStatus,
} from "./statuses";

/*
 * Presentación de las cotizaciones en /opportunities/[id] (Hito 10,
 * DEC-042 §9). Pura y determinista: arma, desde las filas que lee el
 * servidor, lo que muestra el panel "Cotizaciones" y lo que necesita el
 * drawer de alta. Los autores llegan como "Vos" u "Otro miembro": ningún id
 * de usuario sale del servidor. Las acciones ofrecidas son las que la
 * máquina de estados permite hoy al que mira (availableQuoteTransitions());
 * el servidor y la base las vuelven a exigir.
 */

/** Lo que el loader lee de cada cotización (más la unidad cotizada). */
export type QuoteRow = Readonly<{
  id: string;
  number: number;
  status: QuoteStatus;
  currency: Money["currency"];
  listPrice: string;
  discountKind: Discount["kind"];
  discountValue: string | null;
  totalPrice: string;
  /** "AAAA-MM-DD". */
  validUntil: string;
  notes: string | null;
  createdBy: string;
  createdAt: Date;
  approvedBy: string | null;
  approvedAt: Date | null;
  sentAt: Date | null;
  decidedAt: Date | null;
  vehicleId: string;
  vehicleBrand: string;
  vehicleModel: string;
  vehicleYear: number;
  vehicleStatus: string;
}>;

/** Una unidad que se puede cotizar: en stock y con precio publicado. */
export type QuotableVehicleRow = Readonly<{
  id: string;
  brand: string;
  model: string;
  year: number;
  price: string;
  currency: Money["currency"];
}>;

/** Opción del select de unidades del drawer. */
export type QuoteVehicleOption = Readonly<{
  id: string;
  label: string;
  /** Precio publicado: la lista de la cotización. */
  listPrice: Money;
  /** "USD 49.900": para mostrar junto al nombre. */
  listPriceLabel: string;
}>;

/** Una línea del desglose de precio. */
export type QuoteDiscountView = Readonly<{
  /** "Monto fijo" | "7,5 %": cómo se cargó. */
  label: string;
  /** "− USD 3.742,50". */
  amountLabel: string;
  /** "7,5 %": el porcentaje efectivo sobre la lista. */
  effectiveLabel: string;
}>;

export type QuoteCardView = Readonly<{
  id: string;
  number: number;
  /** "N.º 0007". */
  numberLabel: string;
  status: QuoteStatus;
  displayStatus: QuoteDisplayStatus;
  displayLabel: string;
  vehicleLabel: string;
  listPriceLabel: string;
  discount: QuoteDiscountView | null;
  totalLabel: string;
  total: Money;
  validUntil: string;
  /** "8 nov 2026". */
  validUntilLabel: string;
  notes: string | null;
  /** "Vos · 1 nov 2026 10:02". */
  createdLabel: string;
  /** "Aprobó: Otro miembro · 1 nov 2026 11:15", si ya se aprobó. */
  approvedLabel: string | null;
  /** Destinos que el que mira puede pedir hoy, en el orden de la matriz. */
  transitions: readonly QuoteStatus[];
  /** Descuento sobre el límite del vendedor: aprobarla exige `admin`. */
  requiresAdmin: boolean;
  /** Aviso cuando el que mira no puede aprobarla por el descuento. */
  approvalHint: string | null;
  /** ¿Se descarga hoy su presupuesto en PDF? Y si no, por qué (DEC-046 §2). */
  exportability: QuoteExportability;
}>;

/** Lo que recibe el panel "Cotizaciones". */
export type QuotesPanelData = Readonly<{
  quotes: readonly QuoteCardView[];
  /** La etapa admite crear cotizaciones. */
  canCreate: boolean;
  /** Por qué no se puede crear, si no se puede. */
  createHint: string | null;
  vehicleOptions: readonly QuoteVehicleOption[];
  /** Unidad que el drawer propone: la vinculada, si se puede cotizar. */
  suggestedVehicleId: string | null;
  /** Día de Asunción del request, "AAAA-MM-DD": ancla la validez. */
  today: string;
  /** Total de la cotización aceptada, para precargar "Marcar como ganada". */
  acceptedTotal: Money | null;
}>;

/** "N.º 0007": correlativo por organización, con cuatro dígitos. */
export function quoteNumberLabel(number: number): string {
  return `N.º ${String(number).padStart(4, "0")}`;
}

/** Porcentaje es-PY sin ceros de más: "7.50" → "7,5", "10.00" → "10". */
function percentLabel(value: string): string {
  const [integer = "0", fraction = ""] = value.split(".");
  const cents = fraction.replace(/0+$/, "");
  return cents === "" ? integer : `${integer},${cents}`;
}

/** Desglose del descuento, o null si no tiene. */
export function quoteDiscountView(
  listPrice: Money,
  discount: Discount,
): QuoteDiscountView | null {
  if (discount.kind === "none") return null;
  const off = discountAmount(listPrice, discount);
  const effective = formatEffectivePercent(listPrice, discount);
  return {
    label:
      discount.kind === "percent"
        ? `${percentLabel(discount.value)} %`
        : "Monto fijo",
    amountLabel: `− ${formatMoney(off)}`,
    effectiveLabel: effective,
  };
}

/** Copy del aviso de aprobación cuando el que mira no es admin. */
export const ADMIN_APPROVAL_HINT =
  "El descuento supera el 10 %: la aprueba un admin.";

export function quoteCardView(
  row: QuoteRow,
  context: Readonly<{
    viewerUserId: string;
    viewerIsAdmin: boolean;
    opportunityStage: Stage;
    today: string;
  }>,
): QuoteCardView {
  const listPrice: Money = { amount: row.listPrice, currency: row.currency };
  const total: Money = { amount: row.totalPrice, currency: row.currency };
  const discount = discountFrom(row.discountKind, row.discountValue);
  const requiresAdmin = requiresAdminApproval(listPrice, discount);
  const target = {
    status: row.status,
    validUntil: row.validUntil,
    opportunityStage: context.opportunityStage,
    vehicleStatus: row.vehicleStatus,
    requiresAdmin,
  };
  const transitions = availableQuoteTransitions(
    target,
    { isAdmin: context.viewerIsAdmin },
    context.today,
  );
  const displayStatus = quoteDisplayStatus(
    row.status,
    row.validUntil,
    context.today,
  );
  const blockedApproval =
    row.status === "draft" && requiresAdmin && !context.viewerIsAdmin;
  return {
    id: row.id,
    number: row.number,
    numberLabel: quoteNumberLabel(row.number),
    status: row.status,
    displayStatus,
    displayLabel: quoteDisplayLabel(displayStatus),
    vehicleLabel: vehicleLabel(
      row.vehicleBrand,
      row.vehicleModel,
      row.vehicleYear,
    ),
    listPriceLabel: formatMoney(listPrice),
    discount: quoteDiscountView(listPrice, discount),
    totalLabel: formatMoney(total),
    total,
    validUntil: row.validUntil,
    validUntilLabel: formatCalendarDate(row.validUntil),
    notes: row.notes,
    createdLabel: `${authorLabel(row.createdBy, context.viewerUserId)} · ${formatDemandDate(row.createdAt)}`,
    approvedLabel:
      row.approvedAt && row.approvedBy
        ? `Aprobó: ${authorLabel(row.approvedBy, context.viewerUserId)} · ${formatDemandDate(row.approvedAt)}`
        : null,
    transitions,
    requiresAdmin,
    approvalHint: blockedApproval ? ADMIN_APPROVAL_HINT : null,
    exportability: quoteExportability(
      {
        status: row.status,
        validUntil: row.validUntil,
        opportunityStage: context.opportunityStage,
      },
      context.today,
    ),
  };
}

export function quoteVehicleOption(
  row: QuotableVehicleRow,
): QuoteVehicleOption {
  const listPrice: Money = { amount: row.price, currency: row.currency };
  return {
    id: row.id,
    label: vehicleLabel(row.brand, row.model, row.year),
    listPrice,
    listPriceLabel: formatMoney(listPrice),
  };
}

/** Por qué la etapa no admite cotizar, o null si la admite. */
export function quoteCreateHint(stage: Stage): string | null {
  switch (stage) {
    case "new":
      return "Vas a poder cotizar cuando la oportunidad esté En calificación.";
    case "won":
    case "lost":
      return "La oportunidad está cerrada: ya no se crean cotizaciones.";
    case "qualifying":
    case "negotiating":
      return null;
  }
}

/**
 * Datos del panel. Las cotizaciones llegan de la más reciente a la más
 * vieja (el número es correlativo).
 */
export function quotesPanelData(
  rows: readonly QuoteRow[],
  vehicles: readonly QuotableVehicleRow[],
  context: Readonly<{
    viewerUserId: string;
    viewerIsAdmin: boolean;
    opportunityStage: Stage;
    linkedVehicleId: string | null;
    today: string;
  }>,
): QuotesPanelData {
  const quotes = [...rows]
    .sort((a, b) => b.number - a.number)
    .map((row) => quoteCardView(row, context));
  const vehicleOptions = vehicles.map(quoteVehicleOption);
  const accepted = quotes.find((quote) => quote.status === "accepted");
  const canCreate = isQuotableStage(context.opportunityStage);
  return {
    quotes,
    canCreate,
    createHint: quoteCreateHint(context.opportunityStage),
    vehicleOptions,
    suggestedVehicleId:
      vehicleOptions.find((option) => option.id === context.linkedVehicleId)
        ?.id ?? null,
    today: context.today,
    acceptedTotal: accepted ? accepted.total : null,
  };
}

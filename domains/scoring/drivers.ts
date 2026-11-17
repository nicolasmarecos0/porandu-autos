import { isoWeekday, wallClock } from "@/domains/calendar/zoned-time";
import type { DemandSnapshot } from "@/domains/demand/snapshot";
import type { MatchCard, MatchRail } from "@/domains/match/presentation";
import { formatMoney, moneyPercent } from "@/domains/money";
import {
  formatElapsedLong,
  minuteOfDay,
} from "@/domains/opportunities/recency";
import { isTerminalStage, type Stage } from "@/domains/opportunities/stages";
import { quoteNumberLabel } from "@/domains/quotes/presentation";

import type { IntentSignals, TradeInRecord } from "./signals";
import type { Driver, Recency } from "./types";

/*
 * "¿Por qué ahora?" (DEC-058): derivador puro y determinista de las señales
 * de una oportunidad abierta, a partir de lo que ya está persistido: lo que
 * busca (presupuesto, entrega inicial, forma de pago y usado), el Top Match
 * del stock o la unidad vinculada, la prueba de manejo, la cotización, la
 * toma del usado, los mensajes del cliente y la recencia. No carga datos ni
 * conoce la base, React o Next, y nada se persiste.
 *
 * - Cada regla tiene un peso fijo (DRIVER_STRENGTH): desde 75 es una señal
 *   fuerte ("Señales fuertes"); por debajo, un punto a validar ("A
 *   validar"). Los pesos son provisorios y se recalibran con el piloto.
 * - Un dato que falta no genera señal: no se inventa ni penaliza (DEC-005).
 * - Los textos usan solo cifras reales; las cifras van en `emphasis`.
 * - Una oportunidad cerrada no tiene señales: ya no hay "ahora".
 */

/** Desde este peso, una señal es fuerte; por debajo, a validar. */
export const STRONG_DRIVER_MIN_STRENGTH = 75;

/** Cuántas señales muestra cada grupo, de la de mayor peso a la menor. */
export const MAX_DRIVERS_PER_GROUP = { strong: 6, validate: 3 } as const;

/** Entrega inicial sobre el presupuesto, en %, que la vuelve fuerte. */
export const DOWN_PAYMENT_RATIO = { high: 30, solid: 15 } as const;

/** Top Match desde el que el stock es una señal fuerte (0–100). */
export const STRONG_MATCH_MIN_SCORE = 70;

/** Horas desde el último mensaje del cliente que cuentan como reciente. */
export const RECENT_INBOUND_HOURS = { day: 24, threeDays: 72 } as const;

/** Peso de cada regla (0–100). */
export const DRIVER_STRENGTH = {
  quoteAccepted: 100,
  linkedVehicle: 95,
  testDriveCompleted: 95,
  tradeInAccepted: 95,
  testDriveConfirmed: 92,
  cashPayment: 92,
  testDriveScheduled: 90,
  quoteSent: 90,
  inboundDay: 90,
  downPaymentHigh: 90,
  tradeInAppraised: 88,
  tradeInDeclared: 85,
  downPaymentSolid: 80,
  inboundThreeDays: 80,
  downPaymentDeclared: 78,
  financing: 70,
  appraisalPending: 70,
  quotePending: 65,
  downPaymentLow: 65,
  coolingDown: 65,
  zeroDownPayment: 60,
  undecidedPayment: 60,
  testDriveOverdue: 60,
  quoteExpired: 60,
  testDriveNoShow: 55,
  quoteRejected: 50,
  inactive: 50,
} as const;

/** Lo que el derivador necesita de una oportunidad. */
export type DriverInput = Readonly<{
  stage: Stage;
  demand: DemandSnapshot;
  /** Top Match y alternativa del stock disponible, o por qué no hay. */
  rail: MatchRail;
  hasLinkedVehicle: boolean;
  recency: Recency;
  signals: IntentSignals;
  /** La toma vigente del usado (DEC-052), o null. */
  tradeIn: TradeInRecord | null;
}>;

/** Zona de presentación de las fechas: P1 opera en Paraguay. */
export const DRIVERS_TIME_ZONE = "America/Asuncion";

const WEEKDAYS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"] as const;
const MONTHS = [
  "ene",
  "feb",
  "mar",
  "abr",
  "may",
  "jun",
  "jul",
  "ago",
  "sep",
  "oct",
  "nov",
  "dic",
] as const;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** "jue 19 nov" en Asunción. */
export function formatDriverDay(date: Date): string {
  const { year, month, day } = wallClock(date.getTime(), DRIVERS_TIME_ZONE);
  const weekday = WEEKDAYS[isoWeekday({ year, month, day }) - 1];
  return `${weekday} ${day} ${MONTHS[month - 1]}`;
}

/** "jue 19 nov, 10:00" en Asunción. */
export function formatDriverDateTime(date: Date): string {
  const { hour, minute } = wallClock(date.getTime(), DRIVERS_TIME_ZONE);
  return `${formatDriverDay(date)}, ${pad(hour)}:${pad(minute)}`;
}

/** "AAAA-MM-DD" → "25 nov". */
function formatValidUntil(value: string): string {
  const [, month, day] = value.split("-").map(Number);
  return `${day} ${MONTHS[(month ?? 1) - 1]}`;
}

function elapsed(at: Date, now: Date): string {
  const minutes = Math.max(
    0,
    Math.floor((now.getTime() - at.getTime()) / 60_000),
  );
  return formatElapsedLong(minutes, minuteOfDay(now, DRIVERS_TIME_ZONE));
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/* ── Reglas ──────────────────────────────────────────────────────────── */

function downPaymentDrivers(demand: DemandSnapshot): Driver[] {
  const downPayment = demand.down_payment.value;
  const financed = demand.purchase_type.value === "financed";
  if (downPayment === null) return [];
  if (/^0+(\.0+)?$/.test(downPayment.amount)) {
    return financed
      ? [
          {
            kind: "downPayment",
            label: "Sin entrega inicial",
            detail:
              "Financiaría el 100 % del precio: validar la aprobación del crédito.",
            source: "Lo que busca",
            strength: DRIVER_STRENGTH.zeroDownPayment,
            emphasis: ["100 %"],
          },
        ]
      : [];
  }
  const amount = formatMoney(downPayment);
  const budget = demand.budget_max.value;
  const percent = budget ? moneyPercent(downPayment, budget) : null;
  if (budget === null || percent === null) {
    return [
      {
        kind: "downPayment",
        label: "Entrega inicial",
        detail: `Declaró una entrega inicial de ${amount}.`,
        source: "Lo que busca",
        strength: DRIVER_STRENGTH.downPaymentDeclared,
        emphasis: [amount],
      },
    ];
  }
  const budgetLabel = formatMoney(budget);
  const share = `${Math.min(percent, 100)} %`;
  if (percent >= DOWN_PAYMENT_RATIO.solid) {
    return [
      {
        kind: "downPayment",
        label: "Entrega inicial",
        detail: `Entrega ${amount}: el ${share} del presupuesto de ${budgetLabel}.`,
        source: "Lo que busca",
        strength:
          percent >= DOWN_PAYMENT_RATIO.high
            ? DRIVER_STRENGTH.downPaymentHigh
            : DRIVER_STRENGTH.downPaymentSolid,
        emphasis: [amount, share, budgetLabel],
      },
    ];
  }
  return [
    {
      kind: "downPayment",
      label: "Entrega inicial baja",
      detail: `Entrega ${amount}, el ${share} del presupuesto: validar el saldo a financiar.`,
      source: "Lo que busca",
      strength: DRIVER_STRENGTH.downPaymentLow,
      emphasis: [amount, share],
    },
  ];
}

function paymentDrivers(demand: DemandSnapshot): Driver[] {
  switch (demand.purchase_type.value) {
    case "cash":
      return [
        {
          kind: "financing",
          label: "Pago contado",
          detail:
            "Declaró pago contado: no depende de la aprobación de un crédito.",
          source: "Lo que busca",
          strength: DRIVER_STRENGTH.cashPayment,
          emphasis: ["contado"],
        },
      ];
    case "financed":
      return [
        {
          kind: "financing",
          label: "Financiación",
          detail:
            "Compra financiada: validar las condiciones del crédito (tasa, plazo y aprobación) antes de cerrar números.",
          source: "Lo que busca",
          strength: DRIVER_STRENGTH.financing,
          emphasis: ["financiada"],
        },
      ];
    case "undecided":
      return [
        {
          kind: "financing",
          label: "Forma de pago a definir",
          detail: "Todavía no definió si paga contado o financiado.",
          source: "Lo que busca",
          strength: DRIVER_STRENGTH.undecidedPayment,
        },
      ];
    case null:
      return [];
  }
}

function tradeInDrivers(
  demand: DemandSnapshot,
  tradeIn: TradeInRecord | null,
): Driver[] {
  if (tradeIn?.status === "accepted") {
    return [
      {
        kind: "tradeIn",
        label: "Usado en parte de pago",
        detail: `Aceptó el valor de toma de su ${tradeIn.label}.`,
        source: "Toma de usados",
        strength: DRIVER_STRENGTH.tradeInAccepted,
        emphasis: [tradeIn.label],
      },
    ];
  }
  if (tradeIn?.status === "appraised") {
    return [
      {
        kind: "tradeIn",
        label: "Usado tasado",
        detail: `Su ${tradeIn.label} ya está tasado: falta su respuesta al valor de toma.`,
        source: "Toma de usados",
        strength: DRIVER_STRENGTH.tradeInAppraised,
        emphasis: [tradeIn.label],
      },
    ];
  }
  const declared = demand.trade_in_intent.value === true;
  if (!declared && tradeIn === null) return [];
  return [
    {
      kind: "tradeIn",
      label: "Entrega un usado",
      detail: tradeIn
        ? `Ofrece su ${tradeIn.label} en parte de pago: reduce el saldo a pagar.`
        : "Ofrece un usado en parte de pago: reduce el saldo a pagar.",
      source: tradeIn ? "Toma de usados" : "Lo que busca",
      strength: DRIVER_STRENGTH.tradeInDeclared,
      emphasis: tradeIn ? [tradeIn.label] : ["en parte de pago"],
    },
    {
      kind: "appraisal",
      label: "Tasación pendiente",
      detail: "Coordiná la tasación del usado antes de presentar números.",
      source: tradeIn ? "Toma de usados" : "Lo que busca",
      strength: DRIVER_STRENGTH.appraisalPending,
    },
  ];
}

/** "USD 8.100 debajo del presupuesto" o "USD 2.000 sobre el presupuesto". */
function budgetPhrase(card: MatchCard): string | null {
  const delta = card.budgetDelta;
  if (delta === null) return null;
  switch (delta.kind) {
    case "under":
      return `${delta.amount} debajo del presupuesto`;
    case "over":
      return `${delta.amount} sobre el presupuesto`;
    case "equal":
      return "justo en el presupuesto";
  }
}

function stockDrivers(rail: MatchRail, hasLinkedVehicle: boolean): Driver[] {
  if (hasLinkedVehicle) {
    return [
      {
        kind: "stock",
        label: "Unidad vinculada",
        detail: "La negociación ya tiene una unidad del stock vinculada.",
        source: "Stock",
        strength: DRIVER_STRENGTH.linkedVehicle,
      },
    ];
  }
  if (rail.kind !== "matches") return [];
  const { top } = rail;
  const unit = `${top.name} ${top.detail}`;
  const score = `${top.score.total} pts`;
  if (top.score.total >= STRONG_MATCH_MIN_SCORE) {
    const budget = budgetPhrase(top);
    const price = top.price ? ` por ${top.price}` : "";
    return [
      {
        kind: "stock",
        label: "Match en stock",
        detail: `${unit} disponible${price}${budget ? `: ${budget}` : ""}.`,
        source: `Stock · Top Match ${score}`,
        strength: top.score.total,
        emphasis: [
          unit,
          ...(top.price ? [top.price] : []),
          ...(top.budgetDelta ? [top.budgetDelta.amount] : []),
        ],
      },
    ];
  }
  return [
    {
      kind: "stock",
      label: "Match parcial en stock",
      detail: `El mejor match del stock (${unit}) suma ${score}: validar si le sirve.`,
      source: "Stock",
      strength: top.score.total,
      emphasis: [unit, score],
    },
  ];
}

function testDriveDrivers(signals: IntentSignals): Driver[] {
  const drive = signals.testDrive;
  if (drive === null) return [];
  switch (drive.state) {
    case "upcoming": {
      const when = formatDriverDateTime(drive.at);
      return [
        {
          kind: "testDrive",
          label: "Prueba de manejo agendada",
          detail: `Agendada para el ${when}${drive.confirmed ? ", confirmada por el cliente" : ""}.`,
          source: "Agenda",
          at: when,
          strength: drive.confirmed
            ? DRIVER_STRENGTH.testDriveConfirmed
            : DRIVER_STRENGTH.testDriveScheduled,
          emphasis: [when],
        },
      ];
    }
    case "completed": {
      const day = formatDriverDay(drive.at);
      return [
        {
          kind: "testDrive",
          label: "Prueba de manejo realizada",
          detail: `Probó la unidad el ${day}: ya conoce el vehículo.`,
          source: "Agenda",
          at: day,
          strength: DRIVER_STRENGTH.testDriveCompleted,
          emphasis: [day],
        },
      ];
    }
    case "overdue": {
      const day = formatDriverDay(drive.at);
      return [
        {
          kind: "testDrive",
          label: "Prueba sin resultado",
          detail: `La prueba de manejo del ${day} no tiene resultado registrado.`,
          source: "Agenda",
          at: day,
          strength: DRIVER_STRENGTH.testDriveOverdue,
          emphasis: [day],
        },
      ];
    }
    case "no_show": {
      const day = formatDriverDay(drive.at);
      return [
        {
          kind: "testDrive",
          label: "No asistió a la prueba",
          detail: `No se presentó a la prueba de manejo del ${day}: reagendarla.`,
          source: "Agenda",
          at: day,
          strength: DRIVER_STRENGTH.testDriveNoShow,
          emphasis: [day],
        },
      ];
    }
  }
}

function quoteDrivers(signals: IntentSignals): Driver[] {
  const quote = signals.quote;
  if (quote === null) return [];
  const number = quoteNumberLabel(quote.number);
  const total = formatMoney(quote.total);
  const until = formatValidUntil(quote.validUntil);
  switch (quote.state) {
    case "accepted":
      return [
        {
          kind: "quote",
          label: "Cotización aceptada",
          detail: `Aceptó la cotización ${number} por ${total}.`,
          source: "Cotizaciones",
          strength: DRIVER_STRENGTH.quoteAccepted,
          emphasis: [number, total],
        },
      ];
    case "sent":
      return [
        {
          kind: "quote",
          label: "Cotización enviada",
          detail: `Tiene la cotización ${number} por ${total}, vigente hasta el ${until}.`,
          source: "Cotizaciones",
          at: `vence el ${until}`,
          strength: DRIVER_STRENGTH.quoteSent,
          emphasis: [number, total, until],
        },
      ];
    case "pending":
      return [
        {
          kind: "quote",
          label: "Cotización sin enviar",
          detail: `La cotización ${number} por ${total} todavía no se le envió.`,
          source: "Cotizaciones",
          strength: DRIVER_STRENGTH.quotePending,
          emphasis: [number, total],
        },
      ];
    case "expired":
      return [
        {
          kind: "quote",
          label: "Cotización vencida",
          detail: `La cotización ${number} venció el ${until}: renovarla si sigue interesado.`,
          source: "Cotizaciones",
          at: `venció el ${until}`,
          strength: DRIVER_STRENGTH.quoteExpired,
          emphasis: [number, until],
        },
      ];
    case "rejected":
      return [
        {
          kind: "quote",
          label: "Cotización rechazada",
          detail: `Rechazó la cotización ${number} por ${total}: revisar condiciones.`,
          source: "Cotizaciones",
          strength: DRIVER_STRENGTH.quoteRejected,
          emphasis: [number, total],
        },
      ];
  }
}

function engagementDrivers(
  signals: IntentSignals,
  recency: Recency,
  now: Date,
): Driver[] {
  const drivers: Driver[] = [];
  const inbound = signals.lastInboundAt;
  if (inbound !== null) {
    const hours = (now.getTime() - inbound.getTime()) / 3_600_000;
    if (hours < RECENT_INBOUND_HOURS.threeDays) {
      const when = elapsed(inbound, now);
      drivers.push({
        kind: "engagement",
        label: "Interacción reciente",
        detail: `El cliente escribió ${when}.`,
        source: "Mensajes",
        at: when,
        strength:
          hours < RECENT_INBOUND_HOURS.day
            ? DRIVER_STRENGTH.inboundDay
            : DRIVER_STRENGTH.inboundThreeDays,
        emphasis: [when],
      });
    }
  }
  if (recency.state !== "active") {
    const days = plural(recency.days, "día", "días");
    drivers.push(
      recency.state === "warning"
        ? {
            kind: "timing",
            label: "Interés a confirmar",
            detail: `Sin actividad hace ${days}: confirmar que sigue buscando.`,
            source: "Actividad",
            strength: DRIVER_STRENGTH.coolingDown,
            emphasis: [days],
          }
        : {
            kind: "timing",
            label: "Riesgo de pérdida",
            detail: `Sin actividad hace ${days}: retomar el contacto.`,
            source: "Actividad",
            strength: DRIVER_STRENGTH.inactive,
            emphasis: [days],
          },
    );
  }
  return drivers;
}

/** Del mayor peso al menor; un empate conserva el orden de las reglas. */
function byStrength(drivers: readonly Driver[]): Driver[] {
  return drivers
    .map((driver, index) => ({ driver, index }))
    .sort((a, b) => b.driver.strength - a.driver.strength || a.index - b.index)
    .map(({ driver }) => driver);
}

/**
 * Señales de "¿Por qué ahora?" de una oportunidad: las fuertes primero y
 * después las que hay que validar, cada grupo del mayor peso al menor y con
 * MAX_DRIVERS_PER_GROUP como tope. Una oportunidad cerrada no tiene señales.
 */
export function deriveOpportunityDrivers(
  input: DriverInput,
  now: Date,
): Driver[] {
  if (isTerminalStage(input.stage)) return [];
  const all = [
    ...quoteDrivers(input.signals),
    ...testDriveDrivers(input.signals),
    ...tradeInDrivers(input.demand, input.tradeIn),
    ...stockDrivers(input.rail, input.hasLinkedVehicle),
    ...downPaymentDrivers(input.demand),
    ...paymentDrivers(input.demand),
    ...engagementDrivers(input.signals, input.recency, now),
  ];
  const strong = byStrength(
    all.filter((driver) => driver.strength >= STRONG_DRIVER_MIN_STRENGTH),
  ).slice(0, MAX_DRIVERS_PER_GROUP.strong);
  const validate = byStrength(
    all.filter((driver) => driver.strength < STRONG_DRIVER_MIN_STRENGTH),
  ).slice(0, MAX_DRIVERS_PER_GROUP.validate);
  return [...strong, ...validate];
}

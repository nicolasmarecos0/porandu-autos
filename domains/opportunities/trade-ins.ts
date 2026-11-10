import { z } from "zod";

import {
  CURRENCIES,
  MAX_AMOUNT_INTEGER_DIGITS,
  parseAmount,
  type Currency,
  type Money,
} from "@/domains/money";
import { fromCents, toCents } from "@/domains/quotes/pricing";
import { parseWholeNumber } from "@/domains/vehicles/new-vehicle";

import type { Stage } from "./stages";

/*
 * Toma de usados y tasaciones (Hito 20, DEC-052): el vehículo que el
 * cliente entrega en parte de pago de una oportunidad, su tasación y la
 * decisión del cliente. Módulo puro y apto para el navegador: la UI lo usa
 * para ofrecer las acciones, calcular el costo total de ingreso y avisar
 * antes de enviar, pero la regla la imponen el servidor (los planners de
 * abajo, sobre la fila bloqueada) y la base (el trigger
 * `trade_ins_change_guard` de 0021_trade_ins, que espeja esta matriz; un
 * test cruza los 16 pares, y los CHECKs de la tabla).
 *
 *   pending ──(tasar, admin)──► appraised ──(el cliente aprobó)──► accepted
 *      │                       │   ▲  (retasar, admin)               │
 *      │                       └───┘                                 │
 *      └──(descartar)──► rejected ◄──(el cliente rechazó)  ◄──(desistió)
 *
 * - Registrar el usado (marca, modelo, versión, año, km y chapa) lo hace
 *   cualquier miembro mientras la oportunidad está abierta. Nace pendiente
 *   de tasación. A lo sumo una toma vigente por oportunidad.
 * - Tasar es de un admin (el tasador o gerente: `membership_role` es admin |
 *   seller, DEC-018): el costo de reacondicionamiento y el valor de toma, en
 *   una moneda. Hasta que el cliente decide, se puede retasar.
 * - Las dos reglas del fundador: no se acepta una toma sin precio de oferta
 *   (canAcceptTradeIn()), y el costo total de ingreso es el valor de toma
 *   más el costo de reacondicionamiento (tradeInIntakeCost()).
 * - Aceptada, al cerrar la oportunidad como Ganada el usado entra al stock
 *   como unidad En preparación, en la misma transacción del cierre
 *   (planTradeInIntake()). Perder no la convierte.
 * - Con la oportunidad cerrada, la toma no cambia más.
 */

/* ── Estados y matriz ───────────────────────────────────────────────────── */

export const TRADE_IN_STATUSES = [
  "pending",
  "appraised",
  "accepted",
  "rejected",
] as const;

export type TradeInStatus = (typeof TRADE_IN_STATUSES)[number];

/** Estado con el que nace toda toma. */
export const INITIAL_TRADE_IN_STATUS =
  "pending" as const satisfies TradeInStatus;

/**
 * Tomas vigentes: a lo sumo una por oportunidad (índice único parcial
 * `trade_ins_active_opportunity_key`). Una rechazada queda como historial y
 * deja registrar otra.
 */
export const ACTIVE_TRADE_IN_STATUSES = [
  "pending",
  "appraised",
  "accepted",
] as const satisfies readonly TradeInStatus[];

/** Etapas en las que una toma se registra, se tasa y se decide. */
export const TRADE_IN_OPEN_STAGES = [
  "new",
  "qualifying",
  "negotiating",
] as const satisfies readonly Stage[];

/**
 * Copy visible (es-PY) de cada estado. Se nombran en masculino, como el
 * usado y como el pedido del fundador ("Tasado → Aprobado por el cliente").
 */
export const TRADE_IN_STATUS_LABELS: Readonly<Record<TradeInStatus, string>> = {
  pending: "Pendiente de tasación",
  appraised: "Tasado",
  accepted: "Aprobado por el cliente",
  rejected: "Rechazado",
};

/**
 * Matriz de cambios. `appraised → appraised` es retasar (con otra
 * tasación). Sin saltos (no se acepta sin tasar), sin vuelta atrás y sin
 * salida de `rejected`.
 */
export const TRADE_IN_TRANSITIONS: Readonly<
  Record<TradeInStatus, readonly TradeInStatus[]>
> = {
  pending: ["appraised", "rejected"],
  appraised: ["appraised", "accepted", "rejected"],
  accepted: ["rejected"],
  rejected: [],
};

export function isTradeInStatus(value: unknown): value is TradeInStatus {
  return (
    typeof value === "string" &&
    (TRADE_IN_STATUSES as readonly string[]).includes(value)
  );
}

export function isActiveTradeInStatus(status: TradeInStatus): boolean {
  return (ACTIVE_TRADE_IN_STATUSES as readonly TradeInStatus[]).includes(
    status,
  );
}

export function isTradeInOpenStage(stage: Stage): boolean {
  return (TRADE_IN_OPEN_STAGES as readonly Stage[]).includes(stage);
}

/** ¿Existe el cambio `from → to` en la matriz? */
export function canTransitionTradeIn(
  from: TradeInStatus,
  to: TradeInStatus,
): boolean {
  return TRADE_IN_TRANSITIONS[from].includes(to);
}

/* ── Las reglas del fundador ────────────────────────────────────────────── */

/** Una tasación: el costo de reacondicionamiento y el valor de toma. */
export type TradeInAppraisal = Readonly<{
  currency: Currency;
  /** Costo estimado de reacondicionamiento, decimal canónico, ≥ 0. */
  estimatedRepairCost: string;
  /** Valor de toma (precio de oferta), decimal canónico, > 0. */
  offerPrice: string;
}>;

export type TradeInAcceptance =
  | Readonly<{ ok: true; offerPrice: Money }>
  | Readonly<{ ok: false; error: "offer_price_required" }>;

/**
 * Regla 1 (DEC-052 §2): no se puede aceptar una toma sin precio de oferta.
 * Una toma pendiente todavía no se tasó; la base lo vuelve a exigir
 * (`trade_ins_offer_required` y el CHECK `trade_ins_accepted_offer_check`).
 */
export function canAcceptTradeIn(
  appraisal: TradeInAppraisal | null,
): TradeInAcceptance {
  if (appraisal === null || toCents(appraisal.offerPrice) <= ZERO) {
    return { ok: false, error: "offer_price_required" };
  }
  return {
    ok: true,
    offerPrice: { amount: appraisal.offerPrice, currency: appraisal.currency },
  };
}

// Constantes BigInt sin literales `n`: el target de TypeScript es ES2017.
const ZERO = BigInt(0);

/**
 * Regla 2 (DEC-052 §2): el costo total de ingreso del usado es el valor de
 * toma más el costo de reacondicionamiento, en la moneda de la tasación.
 * Exacto, en centavos: nunca pasa por float.
 */
export function tradeInIntakeCost(appraisal: TradeInAppraisal): Money {
  const total =
    toCents(appraisal.offerPrice) + toCents(appraisal.estimatedRepairCost);
  return { amount: fromCents(total), currency: appraisal.currency };
}

/* ── El usado: validación del alta (Zod) ────────────────────────────────── */

/** Campos que el servidor lee del alta. */
export const TRADE_IN_FIELDS = {
  opportunityId: "opportunityId",
  brand: "brand",
  model: "model",
  version: "version",
  year: "year",
  km: "km",
  plate: "plate",
} as const;

export type TradeInVehicleField = Exclude<
  keyof typeof TRADE_IN_FIELDS,
  "opportunityId"
>;

/** Lo que tipeó el usuario en cada campo del usado, tal cual llegó. */
export type TradeInVehicleValues = Readonly<
  Record<TradeInVehicleField, string>
>;

/**
 * Largos máximos, en caracteres. Los de la unidad del stock (H1.3B) y los
 * CHECKs de la base (`trade_ins_*_check`).
 */
export const TRADE_IN_MAX_LENGTH = {
  brand: 40,
  model: 80,
  version: 80,
  plate: 12,
} as const;

/** Año modelo: el rango del CHECK de la base (como `vehicles_year_check`). */
export const TRADE_IN_YEAR_RANGE = { min: 1900, max: 2100 } as const;

/** Mayor kilometraje que guarda la base (`integer` de PostgreSQL). */
export const TRADE_IN_MAX_KM = 2_147_483_647;

/** El usado, ya validado y normalizado. */
export type TradeInVehicle = Readonly<{
  brand: string;
  model: string;
  version: string | null;
  year: number;
  /** `0` es 0 km; null es sin dato. */
  km: number | null;
  /** "ABC 123"; null si no se cargó. */
  plate: string | null;
}>;

export const TRADE_IN_FIELD_ERRORS = [
  "required",
  "too_long",
  "invalid_year",
  "invalid_km",
  "invalid_plate",
  "invalid_option",
  "invalid_amount",
  "not_positive",
  "pyg_decimals",
] as const;

export type TradeInFieldError = (typeof TRADE_IN_FIELD_ERRORS)[number];

export type TradeInVehicleErrors = Partial<
  Record<TradeInVehicleField, TradeInFieldError>
>;

export type ParsedTradeInVehicle =
  | Readonly<{ ok: true; vehicle: TradeInVehicle }>
  | Readonly<{ ok: false; errors: TradeInVehicleErrors }>;

/**
 * Texto de una línea: NFC, sin caracteres de control y con un solo espacio
 * entre palabras (como las altas de H1.2 y H1.3B).
 */
export function normalizeSingleLine(raw: string): string {
  return raw
    .normalize("NFC")
    .replace(/[\s\p{Cc}]+/gu, " ")
    .trim();
}

/**
 * La chapa como la guarda la base: en mayúsculas, con un solo espacio entre
 * grupos ("abc-123" → "ABC 123"). Guiones, puntos y barras cuentan como
 * separadores; cualquier otro carácter queda y la validación lo rechaza, en
 * vez de borrarse en silencio.
 */
export function normalizePlate(raw: string): string {
  return normalizeSingleLine(raw)
    .toUpperCase()
    .replace(/[\s\-./_]+/g, " ")
    .trim();
}

const PLATE = /^[A-Z0-9]+( [A-Z0-9]+)*$/;

/** Año modelo: cuatro dígitos, sin separadores. */
const YEAR = /^\d{4}$/;

function issue(
  ctx: z.RefinementCtx,
  field: TradeInVehicleField | TradeInAppraisalField,
  message: TradeInFieldError,
) {
  ctx.addIssue({ code: "custom", path: [field], message });
}

/** Texto de una línea obligatorio, con su largo máximo. */
function requiredLine(max: number) {
  return z.string().transform((raw, ctx) => {
    const value = normalizeSingleLine(raw);
    if (value === "") {
      ctx.addIssue({ code: "custom", message: "required" });
      return z.NEVER;
    }
    if (value.length > max) {
      ctx.addIssue({ code: "custom", message: "too_long" });
      return z.NEVER;
    }
    return value;
  });
}

/** Texto de una línea opcional: vacío es sin dato (null). */
function optionalLine(max: number) {
  return z.string().transform((raw, ctx) => {
    const value = normalizeSingleLine(raw);
    if (value === "") return null;
    if (value.length > max) {
      ctx.addIssue({ code: "custom", message: "too_long" });
      return z.NEVER;
    }
    return value;
  });
}

const vehicleSchema = z.object({
  brand: requiredLine(TRADE_IN_MAX_LENGTH.brand),
  model: requiredLine(TRADE_IN_MAX_LENGTH.model),
  version: optionalLine(TRADE_IN_MAX_LENGTH.version),
  year: z.string().transform((raw, ctx) => {
    const value = raw.trim();
    if (value === "") {
      ctx.addIssue({ code: "custom", message: "required" });
      return z.NEVER;
    }
    const year = YEAR.test(value) ? Number(value) : NaN;
    if (!(year >= TRADE_IN_YEAR_RANGE.min && year <= TRADE_IN_YEAR_RANGE.max)) {
      ctx.addIssue({ code: "custom", message: "invalid_year" });
      return z.NEVER;
    }
    return year;
  }),
  km: z.string().transform((raw, ctx) => {
    const value = raw.trim();
    if (value === "") return null;
    const km = parseWholeNumber(value);
    if (km === null || km > TRADE_IN_MAX_KM) {
      ctx.addIssue({ code: "custom", message: "invalid_km" });
      return z.NEVER;
    }
    return km;
  }),
  plate: z.string().transform((raw, ctx) => {
    const value = normalizePlate(raw);
    if (value === "") return null;
    if (
      value.length < 2 ||
      value.length > TRADE_IN_MAX_LENGTH.plate ||
      !PLATE.test(value)
    ) {
      ctx.addIssue({ code: "custom", message: "invalid_plate" });
      return z.NEVER;
    }
    return value;
  }),
});

function isFieldError(value: string): value is TradeInFieldError {
  return (TRADE_IN_FIELD_ERRORS as readonly string[]).includes(value);
}

/** El primer error de cada campo, con el código de este módulo. */
function errorsOf<F extends string>(
  error: z.ZodError,
): Partial<Record<F, TradeInFieldError>> {
  const errors: Partial<Record<F, TradeInFieldError>> = {};
  for (const found of error.issues) {
    const field = found.path[0] as F;
    if (errors[field] !== undefined) continue;
    errors[field] = isFieldError(found.message)
      ? found.message
      : "invalid_option";
  }
  return errors;
}

/**
 * Valida el usado de un alta, que es input no confiable: el servidor la
 * repite siempre y el navegador también, para avisar antes de enviar.
 */
export function parseTradeInVehicle(
  values: TradeInVehicleValues,
): ParsedTradeInVehicle {
  const parsed = vehicleSchema.safeParse(values);
  if (!parsed.success) return { ok: false, errors: errorsOf(parsed.error) };
  return { ok: true, vehicle: parsed.data };
}

/* ── La tasación: validación (Zod) ──────────────────────────────────────── */

/** Campos que el servidor lee de una tasación. */
export const TRADE_IN_APPRAISAL_FIELDS = {
  tradeInId: "tradeInId",
  /** El estado que vio quien tasa: compare-and-set sobre la fila. */
  from: "from",
  currency: "currency",
  estimatedRepairCost: "estimatedRepairCost",
  offerPrice: "offerPrice",
} as const;

export type TradeInAppraisalField =
  "currency" | "estimatedRepairCost" | "offerPrice";

export type TradeInAppraisalValues = Readonly<
  Record<TradeInAppraisalField, string>
>;

export type TradeInAppraisalErrors = Partial<
  Record<TradeInAppraisalField, TradeInFieldError>
>;

export type ParsedTradeInAppraisal =
  | Readonly<{ ok: true; appraisal: TradeInAppraisal }>
  | Readonly<{ ok: false; errors: TradeInAppraisalErrors }>;

/** Monto es-PY → decimal canónico ("8.000" → "8000.00"), con su cota. */
function amount(allowZero: boolean) {
  return z.string().transform((raw, ctx) => {
    const value = raw.trim();
    if (value === "") {
      ctx.addIssue({ code: "custom", message: "required" });
      return z.NEVER;
    }
    const parsed = parseAmount(value);
    if (
      parsed === null ||
      parsed.split(".")[0]!.length > MAX_AMOUNT_INTEGER_DIGITS
    ) {
      ctx.addIssue({ code: "custom", message: "invalid_amount" });
      return z.NEVER;
    }
    if (!allowZero && parsed === "0.00") {
      ctx.addIssue({ code: "custom", message: "not_positive" });
      return z.NEVER;
    }
    return parsed;
  });
}

const appraisalSchema = z
  .object({
    currency: z
      .string()
      .trim()
      .min(1, "required")
      .pipe(
        z.enum(CURRENCIES as readonly [Currency, ...Currency[]], {
          error: "invalid_option",
        }),
      ),
    // Una toma que no necesita arreglos cuesta 0.
    estimatedRepairCost: amount(true),
    offerPrice: amount(false),
  })
  .superRefine((value, ctx) => {
    // PYG no tiene unidad menor (DEC-025 §6).
    if (value.currency !== "PYG") return;
    if (!value.offerPrice.endsWith(".00")) {
      issue(ctx, "offerPrice", "pyg_decimals");
    }
    if (!value.estimatedRepairCost.endsWith(".00")) {
      issue(ctx, "estimatedRepairCost", "pyg_decimals");
    }
  });

/** Valida una tasación (input no confiable): moneda y los dos montos. */
export function parseTradeInAppraisal(
  values: TradeInAppraisalValues,
): ParsedTradeInAppraisal {
  const parsed = appraisalSchema.safeParse(values);
  if (!parsed.success) return { ok: false, errors: errorsOf(parsed.error) };
  return { ok: true, appraisal: parsed.data };
}

/** ¿Son la misma tasación? Los montos son decimales canónicos. */
export function sameAppraisal(
  a: TradeInAppraisal,
  b: TradeInAppraisal,
): boolean {
  return (
    a.currency === b.currency &&
    a.offerPrice === b.offerPrice &&
    a.estimatedRepairCost === b.estimatedRepairCost
  );
}

/* ── Decisiones con nombre ──────────────────────────────────────────────── */

export const TRADE_IN_DECISION_IDS = [
  "accept",
  "reject",
  "discard",
  "withdraw",
] as const;

export type TradeInDecisionId = (typeof TRADE_IN_DECISION_IDS)[number];

/**
 * Cada decisión dice de qué estado parte (lo que vio quien la pide) y a
 * cuál lleva. Las cuatro las pide cualquier miembro: registran lo que dijo
 * el cliente o que la toma no sigue.
 */
export const TRADE_IN_DECISIONS: Readonly<
  Record<
    TradeInDecisionId,
    Readonly<{ from: TradeInStatus; to: TradeInStatus }>
  >
> = {
  /** El cliente aprobó el valor de toma. */
  accept: { from: "appraised", to: "accepted" },
  /** El cliente rechazó el valor de toma. */
  reject: { from: "appraised", to: "rejected" },
  /** No se tasa: el cliente ya no la entrega o no se toma. */
  discard: { from: "pending", to: "rejected" },
  /** El cliente la había aprobado y desistió antes del cierre. */
  withdraw: { from: "accepted", to: "rejected" },
};

export function isTradeInDecisionId(
  value: unknown,
): value is TradeInDecisionId {
  return (
    typeof value === "string" &&
    (TRADE_IN_DECISION_IDS as readonly string[]).includes(value)
  );
}

/** Campos que el servidor lee de una decisión. */
export const TRADE_IN_DECISION_FIELDS = {
  tradeInId: "tradeInId",
  decision: "decision",
} as const;

/** La decisión que ofrece una toma en `status`, en el orden de la UI. */
export function decisionsFor(
  status: TradeInStatus,
): readonly TradeInDecisionId[] {
  return TRADE_IN_DECISION_IDS.filter(
    (id) => TRADE_IN_DECISIONS[id].from === status,
  );
}

/** El estado que se muestra mientras guarda: el destino de la decisión. */
export function optimisticTradeInStatus(
  decision: TradeInDecisionId,
): TradeInStatus {
  return TRADE_IN_DECISIONS[decision].to;
}

/* ── Planes sobre la fila bloqueada ─────────────────────────────────────── */

/** Lo que el servidor lee, con la oportunidad y la toma bloqueadas. */
export type TradeInTarget = Readonly<{
  status: TradeInStatus;
  opportunityStage: Stage;
  appraisal: TradeInAppraisal | null;
}>;

export type TradeInRegistrationPlan =
  | Readonly<{ kind: "register" }>
  /** La oportunidad está cerrada: no admite una toma. */
  | Readonly<{ kind: "opportunity_closed"; stage: Stage }>
  /** Ya hay una toma vigente: se decide esa antes de registrar otra. */
  | Readonly<{ kind: "already_registered"; status: TradeInStatus }>;

/** ¿Se puede registrar una toma? `active`: la vigente, si hay. */
export function planTradeInRegistration(
  stage: Stage,
  active: TradeInStatus | null,
): TradeInRegistrationPlan {
  if (!isTradeInOpenStage(stage)) return { kind: "opportunity_closed", stage };
  if (active !== null) return { kind: "already_registered", status: active };
  return { kind: "register" };
}

/** Quién pide el cambio: solo importa su rol en la organización activa. */
export type TradeInActor = Readonly<{ isAdmin: boolean }>;

export type TradeInAppraisalPlan =
  /** Escribir la tasación (tasar o retasar). */
  | Readonly<{
      kind: "appraise";
      from: TradeInStatus;
      appraisal: TradeInAppraisal;
    }>
  /** Ya tenía exactamente esa tasación: no se reescribe. */
  | Readonly<{ kind: "unchanged" }>
  /**
   * La toma ya no está donde la vio quien tasa (otra persona la tasó, la
   * decidió o la descartó). `current` es su estado real. Nada cambia.
   */
  | Readonly<{ kind: "conflict"; current: TradeInStatus }>
  | Readonly<{ kind: "opportunity_closed"; stage: Stage }>
  /** Tasar es de un admin (el tasador o gerente). */
  | Readonly<{ kind: "requires_admin" }>;

/**
 * Decide, sin tocar nada, qué pasa con una tasación. `seen` es el estado
 * que vio quien tasa (pendiente: tasar; tasado: retasar): si la toma ya no
 * está ahí, es un conflicto y no se pisa lo que hizo otro. Tasar es de un
 * admin; la base lo vuelve a exigir (`trade_ins_appraisal_requires_admin`).
 */
export function planTradeInAppraisal(
  target: TradeInTarget,
  seen: TradeInStatus,
  appraisal: TradeInAppraisal,
  actor: TradeInActor,
): TradeInAppraisalPlan {
  if (!isTradeInOpenStage(target.opportunityStage)) {
    return { kind: "opportunity_closed", stage: target.opportunityStage };
  }
  if (!actor.isAdmin) return { kind: "requires_admin" };
  if (target.status !== seen || !canTransitionTradeIn(seen, "appraised")) {
    return { kind: "conflict", current: target.status };
  }
  if (
    target.status === "appraised" &&
    target.appraisal !== null &&
    sameAppraisal(target.appraisal, appraisal)
  ) {
    return { kind: "unchanged" };
  }
  return { kind: "appraise", from: target.status, appraisal };
}

export type TradeInDecisionPlan =
  | Readonly<{
      kind: "change";
      decision: TradeInDecisionId;
      from: TradeInStatus;
      to: TradeInStatus;
    }>
  /** Ya está en el destino (otra persona registró lo mismo). */
  | Readonly<{ kind: "unchanged"; status: TradeInStatus }>
  /** Ya no está en el origen de la decisión. `current` es su estado real. */
  | Readonly<{ kind: "conflict"; current: TradeInStatus }>
  /** Aceptar sin una tasación: la regla del fundador. */
  | Readonly<{ kind: "offer_price_required" }>
  | Readonly<{ kind: "opportunity_closed"; stage: Stage }>;

/**
 * Decide, sin tocar nada, qué pasa con una decisión: la oportunidad
 * abierta, lo que ya está (idempotente), el valor de toma para aceptar (la
 * regla del fundador: una pendiente todavía no se tasó) y el origen de la
 * decisión (compare-and-set: un pedido viejo no deshace lo que hizo otro).
 * La base vuelve a exigir las mismas reglas con su trigger.
 */
export function planTradeInDecision(
  target: TradeInTarget,
  decision: TradeInDecisionId,
): TradeInDecisionPlan {
  if (!isTradeInOpenStage(target.opportunityStage)) {
    return { kind: "opportunity_closed", stage: target.opportunityStage };
  }
  const { from, to } = TRADE_IN_DECISIONS[decision];
  if (target.status === to) return { kind: "unchanged", status: to };
  if (to === "accepted" && target.status === "pending") {
    return { kind: "offer_price_required" };
  }
  if (target.status !== from) {
    return { kind: "conflict", current: target.status };
  }
  if (to === "accepted" && !canAcceptTradeIn(target.appraisal).ok) {
    return { kind: "offer_price_required" };
  }
  return { kind: "change", decision, from, to };
}

/* ── Ingreso al stock con el cierre Ganada ──────────────────────────────── */

/** La toma vigente de la oportunidad, leída con el cierre (bloqueada). */
export type TradeInIntakeTarget = Readonly<{
  id: string;
  status: TradeInStatus;
  convertedVehicleId: string | null;
  brand: string;
  model: string;
  version: string | null;
  year: number;
  km: number | null;
}>;

/** La unidad que nace de la toma: los datos del usado, sin recapturarlos. */
export type TradeInStockUnit = Readonly<{
  brand: string;
  model: string;
  version: string | null;
  year: number;
  km: number | null;
}>;

export type TradeInIntakePlan =
  /** Crear la unidad En preparación y vincularla a la toma. */
  | Readonly<{ kind: "intake"; tradeInId: string; unit: TradeInStockUnit }>
  /** No hay toma aceptada sin convertir: el cierre no crea ninguna unidad. */
  | Readonly<{ kind: "none" }>;

/**
 * Decide, sin tocar nada, qué hace el cierre Ganada con la toma vigente
 * (DEC-052 §5, la regla de oro): una toma aceptada entra al stock como una
 * unidad En preparación con los datos del usado. Pendiente o tasada sin la
 * aprobación del cliente, no entra; la chapa queda en la toma (la unidad no
 * tiene chapa) y la unidad nace sin precio publicado: el valor de toma es
 * lo que costó, no lo que se va a pedir.
 */
export function planTradeInIntake(
  tradeIn: TradeInIntakeTarget | null,
): TradeInIntakePlan {
  if (
    tradeIn === null ||
    tradeIn.status !== "accepted" ||
    tradeIn.convertedVehicleId !== null
  ) {
    return { kind: "none" };
  }
  return {
    kind: "intake",
    tradeInId: tradeIn.id,
    unit: {
      brand: tradeIn.brand,
      model: tradeIn.model,
      version: tradeIn.version,
      year: tradeIn.year,
      km: tradeIn.km,
    },
  };
}

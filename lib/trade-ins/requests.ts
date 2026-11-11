import {
  isTradeInDecisionId,
  isTradeInStatus,
  parseTradeInAppraisal,
  parseTradeInVehicle,
  TRADE_IN_APPRAISAL_FIELDS,
  TRADE_IN_DECISION_FIELDS,
  TRADE_IN_FIELDS,
  type TradeInAppraisal,
  type TradeInAppraisalField,
  type TradeInDecisionId,
  type TradeInFieldError,
  type TradeInStatus,
  type TradeInVehicle,
  type TradeInVehicleField,
} from "@/domains/opportunities/trade-ins";
import type { UnauthorizedRoleState } from "@/lib/auth/roles";

/*
 * Pedidos y respuestas de las Server Actions de la toma de usados (Hito 20,
 * DEC-052): registrar el usado (con la tasación, si la carga un admin),
 * tasar o retasar y decidir. Cada pedido solo identifica la oportunidad o
 * la toma y trae sus campos: cualquier otro (organización, autor, estado,
 * sellos, la unidad del stock, reloj) se ignora porque no tiene adónde ir.
 * Nada de esto expone la base: ni SQLSTATE, ni constraints, ni datos de
 * otra organización.
 */

export type TradeInFormField = TradeInVehicleField | TradeInAppraisalField;

/** Lo que tipeó el usuario, para no reescribirlo tras un error. */
export type TradeInFormValues = Readonly<Record<TradeInFormField, string>>;

export type TradeInFormErrors = Readonly<
  Partial<Record<TradeInFormField, TradeInFieldError>>
>;

const VEHICLE_FIELDS: readonly TradeInVehicleField[] = [
  "brand",
  "model",
  "version",
  "year",
  "km",
  "plate",
];

const APPRAISAL_FIELDS: readonly TradeInAppraisalField[] = [
  "currency",
  "estimatedRepairCost",
  "offerPrice",
];

/** Orden de los campos en el formulario (el foco va al primer error). */
export const TRADE_IN_FORM_FIELDS: readonly TradeInFormField[] = [
  ...VEHICLE_FIELDS,
  ...APPRAISAL_FIELDS,
];

/** Respuesta de registerTradeIn(). */
export type RegisterTradeInState =
  | Readonly<{
      status: "registered";
      tradeInId: string;
      /** Quedó tasada en el mismo acto (lo cargó un admin). */
      appraised: boolean;
      /** "Toyota Vitz 2015". */
      label: string;
    }>
  | Readonly<{
      status: "invalid";
      errors: TradeInFormErrors;
      values: TradeInFormValues;
    }>
  | Readonly<{ status: "opportunity_closed"; values: TradeInFormValues }>
  | Readonly<{ status: "already_registered"; values: TradeInFormValues }>
  /** Un seller mandó la tasación con el alta (UNAUTHORIZED_ROLE). */
  | (UnauthorizedRoleState & Readonly<{ values: TradeInFormValues }>)
  | Readonly<{ status: "not_found" }>
  | Readonly<{ status: "failed"; values: TradeInFormValues }>
  | null;

/** Respuesta de appraiseTradeIn(). */
export type AppraiseTradeInState =
  | Readonly<{ status: "appraised"; label: string; offerPriceLabel: string }>
  | Readonly<{ status: "unchanged"; label: string }>
  | Readonly<{ status: "conflict"; current: TradeInStatus; label: string }>
  | Readonly<{
      status: "invalid";
      errors: TradeInFormErrors;
      values: TradeInFormValues;
    }>
  | Readonly<{ status: "opportunity_closed" }>
  /** Tasar es de un admin (UNAUTHORIZED_ROLE). */
  | UnauthorizedRoleState
  | Readonly<{ status: "not_found" }>
  | Readonly<{ status: "failed"; values: TradeInFormValues }>
  | null;

/** Respuesta de changeTradeInStatus(). */
export type ChangeTradeInStatusState =
  | Readonly<{
      status: "changed";
      decision: TradeInDecisionId;
      to: TradeInStatus;
      label: string;
    }>
  | Readonly<{ status: "unchanged"; current: TradeInStatus; label: string }>
  | Readonly<{ status: "conflict"; current: TradeInStatus; label: string }>
  | Readonly<{ status: "offer_price_required" }>
  | Readonly<{ status: "opportunity_closed" }>
  /** Aprobar la toma es de un admin (UNAUTHORIZED_ROLE, DEC-054 §2). */
  | UnauthorizedRoleState
  | Readonly<{ status: "not_found" }>
  | Readonly<{ status: "failed" }>
  | null;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Cota de lo que vuelve al formulario tras un error (el eco del input). */
const MAX_ECHO_LENGTH = 256;

function text(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value : "";
}

/** Lo tipeado en cada campo del formulario, tal cual llegó. */
function typedValues(formData: FormData): Record<TradeInFormField, string> {
  const name = (field: TradeInFormField): string =>
    field in TRADE_IN_FIELDS
      ? TRADE_IN_FIELDS[field as TradeInVehicleField]
      : TRADE_IN_APPRAISAL_FIELDS[field as TradeInAppraisalField];
  return Object.fromEntries(
    TRADE_IN_FORM_FIELDS.map((field) => [
      field,
      text(formData.get(name(field))),
    ]),
  ) as Record<TradeInFormField, string>;
}

/** El eco para el formulario: lo tipeado, acotado. */
function echoOf(typed: Record<TradeInFormField, string>): TradeInFormValues {
  return Object.fromEntries(
    TRADE_IN_FORM_FIELDS.map((field) => [
      field,
      typed[field].slice(0, MAX_ECHO_LENGTH),
    ]),
  ) as Record<TradeInFormField, string>;
}

/**
 * Lo cargado en el formulario de la toma, acotado: lo que vuelve a los
 * campos tras un error o una falla (también la de la red, en el navegador).
 */
export function tradeInFormValues(formData: FormData): TradeInFormValues {
  return echoOf(typedValues(formData));
}

function idOf(formData: FormData, field: string): string | null {
  const value = text(formData.get(field)).trim();
  return UUID.test(value) ? value.toLowerCase() : null;
}

/** ¿Se cargó algo de la tasación? Sin nada, el alta queda pendiente. */
function hasAppraisal(typed: Record<TradeInFormField, string>): boolean {
  return APPRAISAL_FIELDS.some((field) => typed[field].trim() !== "");
}

export type ParsedRegisterTradeIn =
  | Readonly<{
      kind: "ok";
      opportunityId: string;
      vehicle: TradeInVehicle;
      appraisal: TradeInAppraisal | null;
      values: TradeInFormValues;
    }>
  /** El id no es un UUID: no llega a la base. */
  | Readonly<{ kind: "not_found" }>
  | Readonly<{
      kind: "invalid";
      errors: TradeInFormErrors;
      values: TradeInFormValues;
    }>;

/**
 * Lee el alta, que es input no confiable, y la valida en el servidor
 * (domains/opportunities/trade-ins.ts, Zod): lo que validó el navegador no
 * cuenta. La tasación es opcional en el alta: si se cargó algún campo, se
 * valida entera (y solo un admin la puede escribir).
 */
export function parseRegisterTradeInRequest(
  formData: FormData,
): ParsedRegisterTradeIn {
  const opportunityId = idOf(formData, TRADE_IN_FIELDS.opportunityId);
  if (opportunityId === null) return { kind: "not_found" };
  const typed = typedValues(formData);
  const values = echoOf(typed);
  const vehicle = parseTradeInVehicle(typed);
  const appraisal = hasAppraisal(typed) ? parseTradeInAppraisal(typed) : null;
  if (!vehicle.ok || (appraisal !== null && !appraisal.ok)) {
    return {
      kind: "invalid",
      errors: {
        ...(vehicle.ok ? {} : vehicle.errors),
        ...(appraisal === null || appraisal.ok ? {} : appraisal.errors),
      },
      values,
    };
  }
  return {
    kind: "ok",
    opportunityId,
    vehicle: vehicle.vehicle,
    appraisal: appraisal?.appraisal ?? null,
    values,
  };
}

export type ParsedAppraiseTradeIn =
  | Readonly<{
      kind: "ok";
      tradeInId: string;
      seen: TradeInStatus;
      appraisal: TradeInAppraisal;
      values: TradeInFormValues;
    }>
  | Readonly<{ kind: "not_found" }>
  | Readonly<{
      kind: "invalid";
      errors: TradeInFormErrors;
      values: TradeInFormValues;
    }>;

/**
 * Lee una tasación. `from` es el estado que vio quien tasa (pendiente o
 * tasado): el servidor lo compara con la fila bloqueada.
 */
export function parseAppraiseTradeInRequest(
  formData: FormData,
): ParsedAppraiseTradeIn {
  const tradeInId = idOf(formData, TRADE_IN_APPRAISAL_FIELDS.tradeInId);
  const seen = text(formData.get(TRADE_IN_APPRAISAL_FIELDS.from)).trim();
  if (tradeInId === null || !isTradeInStatus(seen))
    return { kind: "not_found" };
  const typed = typedValues(formData);
  const values = echoOf(typed);
  const appraisal = parseTradeInAppraisal(typed);
  if (!appraisal.ok) {
    return { kind: "invalid", errors: appraisal.errors, values };
  }
  return {
    kind: "ok",
    tradeInId,
    seen,
    appraisal: appraisal.appraisal,
    values,
  };
}

export type ParsedTradeInDecision =
  | Readonly<{ kind: "ok"; tradeInId: string; decision: TradeInDecisionId }>
  | Readonly<{ kind: "not_found" }>;

/** Lee una decisión: la toma y cuál de las cuatro. */
export function parseTradeInDecisionRequest(
  formData: FormData,
): ParsedTradeInDecision {
  const tradeInId = idOf(formData, TRADE_IN_DECISION_FIELDS.tradeInId);
  const decision = text(formData.get(TRADE_IN_DECISION_FIELDS.decision)).trim();
  if (tradeInId === null || !isTradeInDecisionId(decision)) {
    return { kind: "not_found" };
  }
  return { kind: "ok", tradeInId, decision };
}

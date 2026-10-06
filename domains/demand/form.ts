import {
  DEMAND_TEXT_MAX_LENGTH,
  type DemandFact,
  type DemandField,
  type DemandFieldError,
} from "./facts";

/*
 * "Lo que busca" (H1.4, DEC-030 §10): el contrato de formulario de la
 * demanda entre la UI y el servidor, común al alta de una oportunidad y a la
 * edición desde /opportunities. Módulo puro y apto para el navegador: la UI
 * lo usa para los nombres y límites de cada campo, pero la validación
 * definitiva ocurre siempre en el servidor (lib/opportunities/demand-form.ts
 * y el planner de domains/demand).
 *
 * Todo es opcional: un campo vacío o "Sin dato" no crea fact. El vendedor no
 * es un data-entry.
 */

/** Campos de la demanda, en el orden del formulario (las 3 preguntas). */
export const DEMAND_FORM_FIELDS = [
  "brand",
  "model",
  "purchaseType",
  "downPaymentAmount",
  "downPaymentCurrency",
  "tradeIn",
  "budgetAmount",
  "budgetCurrency",
  "yearMin",
  "yearMax",
] as const;

export type DemandFormField = (typeof DEMAND_FORM_FIELDS)[number];

/** Campos de cada fact. */
export const DEMAND_FORM_FIELDS_BY_FACT: Readonly<
  Record<DemandFact, readonly DemandFormField[]>
> = {
  desired_vehicle: ["brand", "model"],
  year_range: ["yearMin", "yearMax"],
  budget_max: ["budgetAmount", "budgetCurrency"],
  purchase_type: ["purchaseType"],
  trade_in_intent: ["tradeIn"],
  down_payment: ["downPaymentAmount", "downPaymentCurrency"],
};

/** Campo del formulario de cada campo de un fact (para ubicar un error). */
export const DEMAND_FORM_FIELD_OF: Readonly<
  Record<DemandFact, Readonly<Partial<Record<DemandField, DemandFormField>>>>
> = {
  desired_vehicle: { brand: "brand", model: "model", value: "brand" },
  year_range: { min: "yearMin", max: "yearMax", value: "yearMin" },
  budget_max: {
    amount: "budgetAmount",
    currency: "budgetCurrency",
    value: "budgetAmount",
  },
  purchase_type: { value: "purchaseType" },
  trade_in_intent: { value: "tradeIn" },
  down_payment: {
    amount: "downPaymentAmount",
    currency: "downPaymentCurrency",
    value: "downPaymentAmount",
  },
};

/** Largos máximos de los textos, los de la base (C-12). */
export const DEMAND_FORM_MAX_LENGTH = {
  brand: DEMAND_TEXT_MAX_LENGTH.brand,
  model: DEMAND_TEXT_MAX_LENGTH.model,
  note: DEMAND_TEXT_MAX_LENGTH.evidenceText,
} as const;

/** "¿Entrega un usado?": valores del select. Vacío es "Sin dato". */
export const TRADE_IN_FORM_VALUES = { yes: true, no: false } as const;

export type TradeInFormValue = keyof typeof TRADE_IN_FORM_VALUES;

/** Error de un campo del formulario. El copy (es-PY) lo pone la UI. */
export type DemandFormError = DemandFieldError;

export type DemandFormErrors = Readonly<
  Partial<Record<DemandFormField | "note", DemandFormError>>
>;

/** Lo que cargó el usuario, para no tener que reescribirlo tras un error. */
export type DemandFormValues = Readonly<Record<DemandFormField, string>>;

export const EMPTY_DEMAND_FORM_VALUES: DemandFormValues = Object.fromEntries(
  DEMAND_FORM_FIELDS.map((field) => [field, ""]),
) as Record<DemandFormField, string>;

/*
 * Edición desde /opportunities (recordDemand()): además de los campos, por
 * cada fact modificado el formulario manda el head humano que vio el
 * usuario (compare-and-set), el valor vigente que reemplaza (para Quitar) y
 * si fue un error de carga. Solo se envían los facts modificados.
 */
export const DEMAND_EDIT_FIELDS = {
  opportunityId: "opportunityId",
  changed: "changed",
  note: "note",
  head: (fact: DemandFact) => `head.${fact}`,
  current: (fact: DemandFact) => `current.${fact}`,
  loadError: (fact: DemandFact) => `loadError.${fact}`,
} as const;

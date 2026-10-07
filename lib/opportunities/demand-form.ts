import {
  DEMAND_FACTS,
  isDemandFact,
  validateFactValue,
  type DemandFact,
  type DemandValues,
} from "@/domains/demand/facts";
import {
  DEMAND_EDIT_FIELDS,
  DEMAND_FORM_FIELD_OF,
  DEMAND_FORM_FIELDS,
  DEMAND_FORM_FIELDS_BY_FACT,
  DEMAND_FORM_MAX_LENGTH,
  TRADE_IN_FORM_VALUES,
  type DemandFormError,
  type DemandFormErrors,
  type DemandFormField,
  type DemandFormValues,
} from "@/domains/demand/form";
import type { DemandItem, DemandItemError } from "@/domains/demand/planner";
import { parseAmount } from "@/domains/money";
import { singleLine } from "@/lib/forms/text";

/*
 * Lectura de "Lo que busca" (H1.4) en el servidor, para el alta y para la
 * edición. Lo que valide el navegador no se da por bueno.
 *
 * - Solo lee los campos de la demanda (DEMAND_FORM_FIELDS). Estado, fuente,
 *   autor, reloj, organización e ids del ledger nunca salen del formulario.
 * - Textos de una línea (NFC, sin caracteres de control, un solo espacio
 *   entre palabras); montos escritos en es-PY ("250.000.000", "29.990,50"),
 *   exactos, sin pasar por float; años de cuatro dígitos.
 * - Un fact con todos sus campos vacíos no tiene dato (Unknown): en el alta
 *   no se crea; en la edición es Quitar.
 * - Las reglas de cada fact son las del dominio (validateFactValue); acá
 *   solo se pasa del texto del formulario al valor candidato.
 */

/** Cota de lo que vuelve al formulario tras un error (el eco del input). */
const MAX_ECHO_LENGTH = 256;

const YEAR = /^\d{4}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Valor de cada fact leído: el valor, o null si quedó vacío (Unknown). */
export type DemandFieldValues = Partial<{
  [F in DemandFact]: DemandValues[F] | null;
}>;

export type ParsedDemandFields =
  | Readonly<{
      ok: true;
      values: DemandFieldValues;
      echo: DemandFormValues;
    }>
  | Readonly<{
      ok: false;
      errors: DemandFormErrors;
      echo: DemandFormValues;
    }>;

/** Lo cargado en los campos de la demanda, normalizado y acotado. */
export function readDemandEcho(formData: FormData): DemandFormValues {
  return Object.fromEntries(
    DEMAND_FORM_FIELDS.map((field) => [
      field,
      singleLine(formData.get(field)).slice(0, MAX_ECHO_LENGTH),
    ]),
  ) as Record<DemandFormField, string>;
}

type Candidate =
  | Readonly<{ kind: "empty" }>
  | Readonly<{ kind: "value"; value: unknown }>
  | Readonly<{
      kind: "invalid";
      errors: Partial<Record<DemandFormField, DemandFormError>>;
    }>;

function money(
  amountRaw: string,
  currencyRaw: string,
  amountField: DemandFormField,
  currencyField: DemandFormField,
): Candidate {
  if (amountRaw === "" && currencyRaw === "") return { kind: "empty" };
  const errors: Partial<Record<DemandFormField, DemandFormError>> = {};
  let amount: string | null = null;
  if (amountRaw === "") errors[amountField] = "required";
  else {
    amount = parseAmount(amountRaw);
    if (amount === null) errors[amountField] = "invalid_amount";
  }
  if (currencyRaw === "") errors[currencyField] = "required";
  if (Object.keys(errors).length > 0) return { kind: "invalid", errors };
  return { kind: "value", value: { amount, currency: currencyRaw } };
}

function candidateOf(
  fact: DemandFact,
  raw: Readonly<Record<DemandFormField, string>>,
): Candidate {
  switch (fact) {
    case "desired_vehicle": {
      if (raw.brand === "" && raw.model === "") return { kind: "empty" };
      return {
        kind: "value",
        value: {
          ...(raw.brand !== "" ? { brand: raw.brand } : {}),
          ...(raw.model !== "" ? { model: raw.model } : {}),
        },
      };
    }
    case "year_range": {
      if (raw.yearMin === "" && raw.yearMax === "") return { kind: "empty" };
      const errors: Partial<Record<DemandFormField, DemandFormError>> = {};
      const range: { min?: number; max?: number } = {};
      for (const [field, key] of [
        ["yearMin", "min"],
        ["yearMax", "max"],
      ] as const) {
        if (raw[field] === "") continue;
        if (YEAR.test(raw[field])) range[key] = Number(raw[field]);
        else errors[field] = "invalid_year";
      }
      return Object.keys(errors).length > 0
        ? { kind: "invalid", errors }
        : { kind: "value", value: range };
    }
    case "budget_max":
      return money(
        raw.budgetAmount,
        raw.budgetCurrency,
        "budgetAmount",
        "budgetCurrency",
      );
    case "down_payment":
      return money(
        raw.downPaymentAmount,
        raw.downPaymentCurrency,
        "downPaymentAmount",
        "downPaymentCurrency",
      );
    case "purchase_type":
      return raw.purchaseType === ""
        ? { kind: "empty" }
        : { kind: "value", value: raw.purchaseType };
    case "trade_in_intent": {
      if (raw.tradeIn === "") return { kind: "empty" };
      const value = Object.entries(TRADE_IN_FORM_VALUES).find(
        ([key]) => key === raw.tradeIn,
      )?.[1];
      return value === undefined
        ? { kind: "invalid", errors: { tradeIn: "invalid_boolean" } }
        : { kind: "value", value };
    }
  }
}

/**
 * Lee y valida los facts `facts` del formulario (por defecto, todos). Un
 * fact vacío vuelve como null (Unknown).
 */
export function parseDemandFields(
  formData: FormData,
  facts: readonly DemandFact[] = DEMAND_FACTS,
): ParsedDemandFields {
  const raw = Object.fromEntries(
    DEMAND_FORM_FIELDS.map((field) => [field, singleLine(formData.get(field))]),
  ) as Record<DemandFormField, string>;
  const echo = readDemandEcho(formData);
  const errors: Partial<Record<DemandFormField, DemandFormError>> = {};
  const values: DemandFieldValues = {};

  for (const fact of facts) {
    const candidate = candidateOf(fact, raw);
    if (candidate.kind === "empty") {
      (values as Record<DemandFact, unknown>)[fact] = null;
      continue;
    }
    if (candidate.kind === "invalid") {
      Object.assign(errors, candidate.errors);
      continue;
    }
    const validation = validateFactValue(fact, candidate.value);
    if (validation.ok) {
      (values as Record<DemandFact, unknown>)[fact] = validation.value;
    } else {
      for (const [field, error] of Object.entries(validation.errors)) {
        const formField =
          DEMAND_FORM_FIELD_OF[fact][field as keyof typeof validation.errors];
        if (formField && error) errors[formField] = error;
      }
    }
  }

  return Object.keys(errors).length > 0
    ? { ok: false, errors, echo }
    : { ok: true, values, echo };
}

/*
 * Edición desde /opportunities (recordDemand()): solo los facts modificados,
 * cada uno con el head humano que vio el usuario, el valor vigente que
 * reemplaza y si fue un error de carga. Una nota opcional para toda la
 * edición.
 */

export type ParsedDemandEdit =
  | Readonly<{
      kind: "ok";
      opportunityId: string;
      items: readonly DemandItem[];
      echo: DemandFormValues;
      note: string;
    }>
  | Readonly<{
      kind: "invalid";
      errors: DemandFormErrors;
      echo: DemandFormValues;
      note: string;
    }>
  /** Sin una oportunidad identificable: no existe para este pedido. */
  | Readonly<{ kind: "not_found" }>;

function idOrNull(raw: FormDataEntryValue | null): string | null {
  return typeof raw === "string" && UUID.test(raw) ? raw.toLowerCase() : null;
}

export function parseDemandEditForm(formData: FormData): ParsedDemandEdit {
  const opportunityId = idOrNull(
    formData.get(DEMAND_EDIT_FIELDS.opportunityId),
  );
  if (!opportunityId) return { kind: "not_found" };

  const changed = [
    ...new Set(
      formData
        .getAll(DEMAND_EDIT_FIELDS.changed)
        .filter((fact): fact is DemandFact => isDemandFact(fact)),
    ),
  ];
  const note = singleLine(formData.get(DEMAND_EDIT_FIELDS.note));
  const echoNote = note.slice(0, DEMAND_FORM_MAX_LENGTH.note);

  const parsed = parseDemandFields(formData, changed);
  const errors: Partial<Record<DemandFormField | "note", DemandFormError>> = {
    ...(parsed.ok ? {} : parsed.errors),
  };
  if (note.length > DEMAND_FORM_MAX_LENGTH.note) errors.note = "too_long";
  if (!parsed.ok || Object.keys(errors).length > 0) {
    return { kind: "invalid", errors, echo: parsed.echo, note: echoNote };
  }

  const items: DemandItem[] = changed.map((fact) => {
    const basedOnHead = idOrNull(formData.get(DEMAND_EDIT_FIELDS.head(fact)));
    const value = parsed.values[fact];
    const withNote = note === "" ? {} : { note };
    if (value === null || value === undefined) {
      return {
        op: "remove",
        fact,
        target: idOrNull(formData.get(DEMAND_EDIT_FIELDS.current(fact))) ?? "",
        basedOnHead,
        ...withNote,
      };
    }
    const loadError = formData.get(DEMAND_EDIT_FIELDS.loadError(fact)) === "on";
    return {
      op: "set",
      fact,
      value,
      basedOnHead,
      ...(loadError ? { reason: "load_error" as const } : {}),
      ...withNote,
    };
  });
  return { kind: "ok", opportunityId, items, echo: parsed.echo, note };
}

/**
 * Errores del planner → campos del formulario. Los de un ítem (target,
 * motivo) no son de un campo que el usuario pueda corregir: van al primero
 * del fact.
 */
export function demandErrorsToForm(
  errors: readonly DemandItemError[],
): DemandFormErrors {
  const form: Partial<Record<DemandFormField | "note", DemandFormError>> = {};
  for (const error of errors) {
    if (error.field === "note") form.note = error.error;
    else if (error.fact === null) continue;
    else if (error.field === "item") {
      const [first] = DEMAND_FORM_FIELDS_BY_FACT[error.fact];
      if (first) form[first] = "invalid_option";
    } else {
      const field = DEMAND_FORM_FIELD_OF[error.fact][error.field];
      if (field) form[field] = error.error;
    }
  }
  return form;
}

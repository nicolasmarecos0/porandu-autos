import type { NewOpportunity } from "@/db/queries/create-opportunity";
import { SOURCES } from "@/domains/opportunities/labels";
import {
  NEW_OPPORTUNITY_FIELDS,
  NEW_OPPORTUNITY_MAX_LENGTH,
  type NewOpportunityErrors,
  type NewOpportunityField,
  type NewOpportunityFieldError,
  type NewOpportunityValues,
} from "@/domains/opportunities/new-opportunity";
import { normalizePhone } from "@/lib/contacts/phone";
import { singleLine } from "@/lib/forms/text";

/*
 * Validación definitiva del alta manual de una oportunidad (H1.2). Corre en
 * el servidor (el teléfono se normaliza con lib/contacts/phone.ts, solo
 * servidor): la UI puede marcar campos obligatorios, pero nada de lo que
 * valide el navegador se da por bueno.
 *
 * - Solo lee los campos de NEW_OPPORTUNITY_FIELDS. Cualquier otro campo del
 *   payload (organización, usuario, contacto, etapa, timestamps, scores) se
 *   ignora: no tiene adónde ir.
 * - Textos de una línea: NFC, sin caracteres de control y con un solo
 *   espacio entre palabras.
 * - Nombre, teléfono y origen son obligatorios; ciudad, modelo y versión,
 *   opcionales (vacío = sin dato).
 * - El teléfono tiene que ser un número válido (E.164, Paraguay por
 *   defecto). El origen, uno de los permitidos.
 */

/** Estado del formulario que devuelve la Server Action createOpportunity(). */
export type CreateOpportunityState =
  | Readonly<{
      status: "invalid";
      errors: NewOpportunityErrors;
      values: NewOpportunityValues;
    }>
  /** Falla inesperada al guardar: nada quedó escrito y se puede reintentar. */
  | Readonly<{ status: "failed"; values: NewOpportunityValues }>
  | Readonly<{
      status: "created";
      opportunityId: string;
      contactName: string;
      /** El teléfono ya era de un contacto: se usó ese, sin modificarlo. */
      contactReused: boolean;
    }>
  | null;

export type ParsedNewOpportunity =
  | Readonly<{ ok: true; input: NewOpportunity; values: NewOpportunityValues }>
  | Readonly<{
      ok: false;
      errors: NewOpportunityErrors;
      values: NewOpportunityValues;
    }>;

/** Cota de lo que vuelve al formulario tras un error (el eco del input). */
const MAX_ECHO_LENGTH = 256;

export function parseNewOpportunityForm(
  formData: FormData,
): ParsedNewOpportunity {
  const values = Object.fromEntries(
    NEW_OPPORTUNITY_FIELDS.map((field) => [
      field,
      singleLine(formData.get(field)),
    ]),
  ) as Record<NewOpportunityField, string>;
  const errors: Partial<Record<NewOpportunityField, NewOpportunityFieldError>> =
    {};

  const text = (
    field: keyof typeof NEW_OPPORTUNITY_MAX_LENGTH,
    required: boolean,
  ): string | null => {
    const value = values[field];
    if (value === "") {
      if (required) errors[field] = "required";
      return null;
    }
    if (value.length > NEW_OPPORTUNITY_MAX_LENGTH[field]) {
      errors[field] = "too_long";
      return null;
    }
    return value;
  };

  const name = text("name", true);
  const phone = text("phone", true);
  const phoneNormalized = phone === null ? null : normalizePhone(phone);
  if (phone !== null && phoneNormalized === null) {
    errors.phone = "invalid_phone";
  }
  const city = text("city", false);
  const interestModel = text("interestModel", false);
  const interestVersion = text("interestVersion", false);

  const source = SOURCES.find((candidate) => candidate === values.source);
  if (!source) {
    errors.source = values.source === "" ? "required" : "invalid_source";
  }

  const echo = Object.fromEntries(
    NEW_OPPORTUNITY_FIELDS.map((field) => [
      field,
      values[field].slice(0, MAX_ECHO_LENGTH),
    ]),
  ) as NewOpportunityValues;

  if (
    name === null ||
    phone === null ||
    phoneNormalized === null ||
    source === undefined ||
    Object.keys(errors).length > 0
  ) {
    return { ok: false, errors, values: echo };
  }
  return {
    ok: true,
    input: {
      contact: { name, phone, phoneNormalized, city },
      source,
      interestModel,
      interestVersion,
      demand: {},
    },
    values: echo,
  };
}

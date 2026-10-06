import {
  DEMAND_FORM_FIELDS,
  type DemandFormError,
} from "@/domains/demand/form";

/*
 * Alta manual de una oportunidad (H1.2, H1.4): el contrato del formulario
 * entre la UI y la Server Action. Módulo puro y apto para el navegador: la UI
 * lo usa para los límites de cada campo, pero la validación definitiva
 * (incluida la del teléfono) ocurre siempre en el servidor
 * (lib/opportunities/new-opportunity.ts).
 *
 * El formulario solo trae datos del contacto, el origen y "Lo que busca"
 * (H1.4, DEC-030: marca y modelo, pago, entrega, usado, presupuesto y años,
 * todo opcional; reemplaza a "Modelo buscado" y "Versión", C-4).
 * Organización, usuario, contacto existente, etapa, estado de la demanda,
 * timestamps, scores e Intelligence nunca salen del cliente.
 */

/** Únicos campos que el servidor lee del formulario. */
export const NEW_OPPORTUNITY_FIELDS = [
  "name",
  "phone",
  "city",
  "source",
  ...DEMAND_FORM_FIELDS,
] as const;

export type NewOpportunityField = (typeof NEW_OPPORTUNITY_FIELDS)[number];

/** Campos del contacto, con su largo máximo después de normalizar espacios. */
export const NEW_OPPORTUNITY_MAX_LENGTH = {
  name: 120,
  phone: 32,
  city: 80,
} as const;

/** Error de validación de un campo. El copy (es-PY) lo pone la UI. */
export type NewOpportunityFieldError =
  | "required"
  | "too_long"
  | "invalid_phone"
  | "invalid_source"
  | DemandFormError;

export type NewOpportunityErrors = Readonly<
  Partial<Record<NewOpportunityField, NewOpportunityFieldError>>
>;

/** Lo que cargó el usuario, para no tener que reescribirlo tras un error. */
export type NewOpportunityValues = Readonly<
  Record<NewOpportunityField, string>
>;

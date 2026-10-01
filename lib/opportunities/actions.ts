"use server";

import { revalidatePath } from "next/cache";

import {
  createOpportunityWithContact,
  type CreatedOpportunity,
} from "@/db/queries/create-opportunity";
import { requireTenant } from "@/lib/tenant/session";

import {
  parseNewOpportunityForm,
  type CreateOpportunityState,
} from "./new-opportunity";

/*
 * Alta manual de una oportunidad (H1.2). Es un endpoint público y la única
 * puerta de escritura del flujo:
 *
 *   requireTenant() → validar el formulario → createOpportunityWithContact()
 *   (withTenant(), una transacción) → revalidar /opportunities
 *
 * 1. El TenantContext sale de requireTenant(), como en todo loader o acción
 *    tenant-scoped (DEC-021): sin sesión → /login, sin membership activa →
 *    /no-access. Nada del payload elige organización, usuario ni rol.
 * 2. El formulario se valida acá, en el servidor. Un payload inválido no
 *    llega a la base.
 * 3. La escritura toma `organization_id` del contexto y fija la etapa
 *    inicial; el payload solo aporta datos del contacto y del interés.
 * 4. Un error inesperado al guardar no expone detalles de la base: el
 *    formulario vuelve con lo cargado para reintentar.
 *
 * El estado previo (`_previous`) lo envía el cliente: no se usa.
 */

const OPPORTUNITIES_PATH = "/opportunities";

/*
 * Para diagnosticar sin exponer datos personales: solo el tipo de error y el
 * SQLSTATE. El mensaje de Drizzle incluye la query y sus parámetros
 * (nombre, teléfono), así que nunca se registra.
 */
function logCreateFailure(error: unknown): void {
  const { name, cause } =
    error instanceof Error ? error : { name: undefined, cause: undefined };
  const code =
    typeof cause === "object" && cause !== null && "code" in cause
      ? cause.code
      : undefined;
  console.error("[opportunities] create failed", { name, code });
}

export async function createOpportunity(
  _previous: CreateOpportunityState,
  formData: FormData,
): Promise<CreateOpportunityState> {
  const ctx = await requireTenant();

  const parsed = parseNewOpportunityForm(formData);
  if (!parsed.ok) {
    return { status: "invalid", errors: parsed.errors, values: parsed.values };
  }

  let created: CreatedOpportunity;
  try {
    created = await createOpportunityWithContact(ctx, parsed.input);
  } catch (error) {
    logCreateFailure(error);
    return { status: "failed", values: parsed.values };
  }

  revalidatePath(OPPORTUNITIES_PATH);
  return {
    status: "created",
    opportunityId: created.opportunityId,
    contactName: created.contact.name,
    contactReused: created.contact.reused,
  };
}

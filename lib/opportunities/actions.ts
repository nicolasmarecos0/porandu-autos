"use server";

import { revalidatePath } from "next/cache";

import {
  createOpportunityWithContact,
  type CreatedOpportunity,
} from "@/db/queries/create-opportunity";
import {
  recordDemandCapture,
  type DemandWriteOutcome,
} from "@/db/queries/demand-facts";
import { requireTenant } from "@/lib/tenant/session";

import { demandErrorsToForm, parseDemandEditForm } from "./demand-form";
import {
  parseNewOpportunityForm,
  type CreateOpportunityState,
} from "./new-opportunity";
import type { RecordDemandState } from "./record-demand";

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
 * Para diagnosticar sin exponer datos personales: solo el tipo de error, el
 * SQLSTATE y la constraint. El mensaje de Drizzle incluye la query y sus
 * parámetros (nombre, teléfono, lo que busca, la nota), así que nunca se
 * registra.
 */
function logFailure(
  operation: "create" | "record demand",
  error: unknown,
): void {
  const { name, cause } =
    error instanceof Error ? error : { name: undefined, cause: undefined };
  const detail = (key: "code" | "constraint_name") =>
    typeof cause === "object" && cause !== null && key in cause
      ? (cause as Record<typeof key, unknown>)[key]
      : undefined;
  console.error(`[opportunities] ${operation} failed`, {
    name,
    code: detail("code"),
    constraint_name: detail("constraint_name"),
  });
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
    logFailure("create", error);
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

/*
 * Edición de lo que busca (H1.4, DEC-030), recordDemand(): la segunda puerta
 * del único módulo de escritura de la demanda.
 *
 *   requireTenant() → leer los facts modificados → recordDemandCapture()
 *   (withTenant(), planner del dominio, un INSERT append-only) → revalidar
 *   /opportunities y /opportunities/[id]
 *
 * 1. El TenantContext sale de requireTenant(). Autorización: membership
 *    activa AND role IN ('admin', 'seller') (DEC-027 §4), hoy todo contexto
 *    que emite requireTenant(); si se agrega un rol, un test falla y esta
 *    regla se revisa. Cualquier miembro edita la demanda que cargó otro
 *    (DEC-023: sin responsable asignado).
 * 2. El pedido trae la oportunidad, los facts modificados con el head que
 *    vio el usuario y sus valores. Estado, fuente, autor, reloj y
 *    organización no salen del pedido: los deriva el planner o los fija la
 *    base. Un id malformado o ajeno es `not_found`, sin revelar nada.
 * 3. Todo o nada: si otro miembro cambió un fact mientras se editaba
 *    (`stale`) o un dato no es válido, no se escribe ninguno.
 * 4. Un error inesperado no expone detalles de la base ni lo cargado.
 *
 * La carga de demanda no modifica `last_activity_at`. El estado previo
 * (`_previous`) lo envía el cliente: no se usa.
 */
export async function recordDemand(
  _previous: RecordDemandState,
  formData: FormData,
): Promise<RecordDemandState> {
  const ctx = await requireTenant();

  const parsed = parseDemandEditForm(formData);
  if (parsed.kind === "not_found") return { status: "not_found" };
  if (parsed.kind === "invalid") {
    return {
      status: "invalid",
      errors: parsed.errors,
      values: parsed.echo,
      note: parsed.note,
    };
  }
  const { opportunityId, echo: values, note } = parsed;

  let outcome: DemandWriteOutcome;
  try {
    outcome = await recordDemandCapture(ctx, {
      opportunityId,
      source: { kind: "member", userId: ctx.userId },
      items: parsed.items,
    });
  } catch (error) {
    logFailure("record demand", error);
    return { status: "failed", values, note };
  }

  const revalidate = () => {
    revalidatePath(OPPORTUNITIES_PATH);
    revalidatePath(`${OPPORTUNITIES_PATH}/${opportunityId}`);
  };
  switch (outcome.kind) {
    case "written":
      revalidate();
      return { status: "saved", opportunityId, facts: outcome.facts };
    case "unchanged":
      return { status: "unchanged", opportunityId };
    case "stale":
      // Los valores vigentes se refrescan; lo tipeado vuelve al formulario.
      revalidate();
      return { status: "stale", facts: outcome.facts, values, note };
    case "pending_unresolved":
      revalidate();
      return { status: "pending", facts: outcome.facts, values, note };
    case "invalid":
      return {
        status: "invalid",
        errors: demandErrorsToForm(outcome.errors),
        values,
        note,
      };
    case "inconsistent":
      return { status: "inconsistent", facts: outcome.facts };
    case "not_found":
    // La fuente sale del contexto: `forbidden` no ocurre. Si ocurriera, no
    // revela nada más que una oportunidad inexistente.
    case "forbidden":
      return { status: "not_found" };
  }
}

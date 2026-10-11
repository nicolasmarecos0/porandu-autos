"use server";

import { revalidatePath } from "next/cache";

import {
  transitionOpportunityStage,
  type StageChangeOutcome,
} from "@/db/queries/change-opportunity-stage";
import {
  closeOpportunityWithMetadata,
  type CloseOpportunityOutcome,
} from "@/db/queries/close-opportunity";
import {
  createOpportunityWithContact,
  type CreatedOpportunity,
} from "@/db/queries/create-opportunity";
import {
  recordDemandCapture,
  type DemandWriteOutcome,
} from "@/db/queries/demand-facts";
import {
  setOpportunityVehicle,
  type VehicleLinkOutcome,
} from "@/db/queries/link-opportunity-vehicle";
import {
  insertOpportunityNote,
  type NoteWriteOutcome,
} from "@/db/queries/record-opportunity-note";
import { todayInAsuncion } from "@/domains/opportunities/closure";
import { requireTenant } from "@/lib/tenant/session";

import { parseCloseRequest, type CloseOpportunityState } from "./closure";
import { demandErrorsToForm, parseDemandEditForm } from "./demand-form";
import {
  parseNewOpportunityForm,
  type CreateOpportunityState,
} from "./new-opportunity";
import { parseNoteRequest, type AddNoteState } from "./note";
import type { RecordDemandState } from "./record-demand";
import { parseStageChange, type ChangeStageState } from "./stage-change";
import { parseVehicleLink, type LinkVehicleState } from "./vehicle-link";

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
  operation:
    | "create"
    | "record demand"
    | "change stage"
    | "close"
    | "add note"
    | "link vehicle",
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

/*
 * Cambio de etapa (H1.6, DEC-032), changeOpportunityStage(): la única puerta
 * de las transiciones de la oportunidad.
 *
 *   requireTenant() → leer el pedido → transitionOpportunityStage()
 *   (withTenant(), fila bloqueada, máquina de estados del dominio, UPDATE,
 *   trigger de transiciones) → revalidar /opportunities y /opportunities/[id]
 *
 * 1. El TenantContext sale de requireTenant(). Autorización: membership
 *    activa AND role IN ('admin', 'seller') (DEC-027 §4), hoy todo contexto
 *    que emite requireTenant(); si se agrega un rol, un test falla y esta
 *    regla se revisa. Cualquier miembro mueve la oportunidad de otro
 *    (DEC-023: sin responsable asignado).
 * 2. El pedido solo trae la oportunidad y la etapa de destino. La etapa de
 *    origen la lee el servidor de la fila bloqueada; organización, usuario
 *    y reloj no salen del pedido. Un id malformado o ajeno es `not_found`,
 *    sin revelar nada.
 * 3. Falla de forma segura: un pase que la máquina no permite (p. ej. la
 *    oportunidad ya estaba cerrada) es `invalid_transition` con la etapa
 *    real, y pedir la etapa actual es `unchanged`; en ninguno cambia nada y
 *    las páginas se revalidan igual para mostrar el estado real. Un cierre
 *    (`won` o `lost`) es `closure_required`: va por closeOpportunity(), con
 *    sus metadatos (DEC-034 §1).
 * 4. Un error inesperado no expone detalles de la base y no revalida.
 *
 * Cambiar de etapa no modifica `last_activity_at` (DEC-032 §7). El estado
 * previo (`_previous`) lo envía el cliente: no se usa.
 */
export async function changeOpportunityStage(
  _previous: ChangeStageState,
  formData: FormData,
): Promise<ChangeStageState> {
  const ctx = await requireTenant();

  const parsed = parseStageChange(formData);
  if (parsed.kind === "not_found") return { status: "not_found" };
  if (parsed.kind === "invalid") return { status: "invalid" };

  let outcome: StageChangeOutcome;
  try {
    outcome = await transitionOpportunityStage(ctx, {
      opportunityId: parsed.opportunityId,
      to: parsed.to,
    });
  } catch (error) {
    logFailure("change stage", error);
    return { status: "failed" };
  }

  const revalidate = (opportunityId: string) => {
    revalidatePath(OPPORTUNITIES_PATH);
    revalidatePath(`${OPPORTUNITIES_PATH}/${opportunityId}`);
  };
  switch (outcome.outcome) {
    case "changed":
      revalidate(outcome.opportunityId);
      return {
        status: "changed",
        opportunityId: outcome.opportunityId,
        from: outcome.from,
        to: outcome.to,
      };
    case "unchanged":
      return {
        status: "unchanged",
        opportunityId: outcome.opportunityId,
        stage: outcome.stage,
      };
    case "invalid_transition":
      revalidate(outcome.opportunityId);
      return {
        status: "invalid_transition",
        opportunityId: outcome.opportunityId,
        current: outcome.current,
      };
    case "closure_required":
      return {
        status: "closure_required",
        opportunityId: outcome.opportunityId,
        current: outcome.current,
      };
    case "not_found":
      return { status: "not_found" };
  }
}

/*
 * Cierre comercial (DEC-034), closeOpportunity(): la única puerta para
 * marcar una oportunidad ganada o perdida, con sus metadatos.
 *
 *   requireTenant() → leer y validar el pedido (Zod) →
 *   closeOpportunityWithMetadata() (withTenant(), fila bloqueada, planner
 *   del dominio, una UPDATE, CHECKs de cierre y trigger) → revalidar
 *   /opportunities y /opportunities/[id]
 *
 * 1. El TenantContext sale de requireTenant(). Autorización: membership
 *    activa AND role IN ('admin', 'seller') (DEC-027 §4), hoy todo contexto
 *    que emite requireTenant(); si se agrega un rol, un test falla y esta
 *    regla se revisa. Cualquier miembro cierra la oportunidad de otro
 *    (DEC-023: sin responsable asignado).
 * 2. El pedido solo trae la oportunidad, el resultado y sus campos. La
 *    etapa de origen y la unidad las lee el servidor de la fila bloqueada;
 *    organización, usuario y reloj no salen del pedido ("hoy" es el día de
 *    Asunción del servidor). Un id malformado o ajeno es `not_found`, sin
 *    revelar nada.
 * 3. Un campo inválido vuelve con lo cargado y el error de cada campo, sin
 *    llegar a la base. Falla de forma segura: un cierre que la máquina no
 *    permite es `invalid_transition` con la etapa real, ganar sin unidad es
 *    `vehicle_required` y pedir el cierre que ya tiene es `unchanged` (los
 *    metadatos no se reescriben); en ninguno cambia nada.
 * 4. Un error inesperado no expone detalles de la base ni lo cargado (los
 *    logs no registran valores) y lo devuelve para reintentar.
 *
 * Cerrar no modifica `last_activity_at` (DEC-034 §9) ni el stock. El estado
 * previo (`_previous`) lo envía el cliente: no se usa.
 */
export async function closeOpportunity(
  _previous: CloseOpportunityState,
  formData: FormData,
): Promise<CloseOpportunityState> {
  const ctx = await requireTenant();

  const parsed = parseCloseRequest(formData, todayInAsuncion(new Date()));
  if (parsed.kind === "not_found") return { status: "not_found" };
  if (parsed.kind === "invalid_outcome") return { status: "invalid_outcome" };
  if (parsed.kind === "invalid") {
    return {
      status: "invalid",
      outcome: parsed.outcome,
      errors: parsed.errors,
      values: parsed.values,
    };
  }
  const { opportunityId, closure, values } = parsed;

  let outcome: CloseOpportunityOutcome;
  try {
    outcome = await closeOpportunityWithMetadata(ctx, {
      opportunityId,
      closure,
    });
  } catch (error) {
    logFailure("close", error);
    return { status: "failed", outcome: closure.outcome, values };
  }

  const revalidate = () => {
    revalidatePath(OPPORTUNITIES_PATH);
    revalidatePath(`${OPPORTUNITIES_PATH}/${opportunityId}`);
  };
  switch (outcome.outcome) {
    case "closed":
      revalidate();
      return {
        status: "closed",
        opportunityId,
        from: outcome.from,
        to: outcome.to,
      };
    case "unchanged":
      return { status: "unchanged", opportunityId, stage: outcome.stage };
    case "invalid_transition":
      revalidate();
      return {
        status: "invalid_transition",
        opportunityId,
        current: outcome.current,
      };
    case "vehicle_required":
      // La unidad pudo cambiar desde que se abrió el formulario.
      revalidate();
      return { status: "vehicle_required", opportunityId };
    case "not_found":
      return { status: "not_found" };
  }
}

/*
 * Bitácora comercial (Hito 2, DEC-033 §1), addOpportunityNote(): la única
 * puerta del alta de notas.
 *
 *   requireTenant() → normalizar y validar el texto → insertOpportunityNote()
 *   (withTenant(), la oportunidad en la organización activa, INSERT
 *   append-only, RLS) → revalidar /opportunities/[id]
 *
 * 1. El TenantContext sale de requireTenant(). Autorización: membership
 *    activa AND role IN ('admin', 'seller') (DEC-027 §4), hoy todo contexto
 *    que emite requireTenant(); si se agrega un rol, un test falla y esta
 *    regla se revisa. Cualquier miembro anota en la oportunidad de otro
 *    (DEC-023: sin responsable asignado).
 * 2. El pedido solo trae la oportunidad y el texto. Autor, organización y
 *    fecha no salen del pedido: los fijan el contexto y la base. Un id
 *    malformado o ajeno es `not_found`, sin revelar nada.
 * 3. Un texto vacío o demasiado largo vuelve, tal como se tipeó, para
 *    corregirlo. Un error inesperado no expone detalles de la base ni el
 *    texto (los logs no lo registran) y lo devuelve para reintentar.
 *
 * Una nota no modifica `last_activity_at` (DEC-033 §6) ni la cola: solo se
 * revalida el detalle. El estado previo (`_previous`) lo envía el cliente: no
 * se usa.
 */
export async function addOpportunityNote(
  _previous: AddNoteState,
  formData: FormData,
): Promise<AddNoteState> {
  const ctx = await requireTenant();

  const parsed = parseNoteRequest(formData);
  if (parsed.kind === "not_found") return { status: "not_found" };
  if (parsed.kind === "invalid") {
    return { status: "invalid", error: parsed.error, body: parsed.body };
  }

  let outcome: NoteWriteOutcome;
  try {
    outcome = await insertOpportunityNote(ctx, {
      opportunityId: parsed.opportunityId,
      body: parsed.body,
    });
  } catch (error) {
    logFailure("add note", error);
    return { status: "failed", body: parsed.body };
  }

  switch (outcome.outcome) {
    case "recorded":
      revalidatePath(`${OPPORTUNITIES_PATH}/${outcome.opportunityId}`);
      return { status: "recorded", opportunityId: outcome.opportunityId };
    case "not_found":
      return { status: "not_found" };
  }
}

/*
 * Unidad vinculada a la negociación (Hito 2, DEC-033 §2),
 * linkOpportunityVehicle(): la única puerta de la vinculación.
 *
 *   requireTenant() → leer el pedido → setOpportunityVehicle() (withTenant(),
 *   fila bloqueada, unidad y demanda vigente, planner del dominio, UPDATE,
 *   trigger) → revalidar /opportunities/[id]
 *
 * 1. El TenantContext sale de requireTenant(). Autorización: la misma de
 *    DEC-027 §4. Cualquier miembro vincula en la oportunidad de otro.
 * 2. El pedido solo trae la oportunidad y la unidad (vacía para quitarla).
 *    Etapa, unidad actual, estado de la unidad y organización los lee el
 *    servidor. Un id malformado o ajeno es `not_found` (oportunidad) o
 *    `vehicle_not_found` (unidad), sin revelar nada.
 * 3. Falla de forma segura: si la etapa no lo admite, si la unidad ya no
 *    está disponible o si dejó de ser un match, no cambia nada y la página se
 *    revalida igual para mostrar el estado real. Pedir lo que ya está es
 *    `unchanged`.
 * 4. Un error inesperado no expone detalles de la base y no revalida.
 *
 * Vincular no cambia el stock ni `last_activity_at` (DEC-033 §2 y §6): solo
 * se revalida el detalle. El estado previo (`_previous`) lo envía el
 * cliente: no se usa.
 */
export async function linkOpportunityVehicle(
  _previous: LinkVehicleState,
  formData: FormData,
): Promise<LinkVehicleState> {
  const ctx = await requireTenant();

  const parsed = parseVehicleLink(formData);
  if (parsed.kind === "not_found") return { status: "not_found" };
  if (parsed.kind === "vehicle_not_found") {
    return { status: "vehicle_not_found" };
  }
  if (parsed.kind === "invalid") return { status: "invalid" };

  let outcome: VehicleLinkOutcome;
  try {
    outcome = await setOpportunityVehicle(ctx, {
      opportunityId: parsed.opportunityId,
      vehicleId: parsed.vehicleId,
    });
  } catch (error) {
    logFailure("link vehicle", error);
    return { status: "failed" };
  }

  const revalidate = (opportunityId: string) =>
    revalidatePath(`${OPPORTUNITIES_PATH}/${opportunityId}`);
  switch (outcome.outcome) {
    case "linked":
      revalidate(outcome.opportunityId);
      return {
        status: "linked",
        opportunityId: outcome.opportunityId,
        vehicleId: outcome.vehicleId,
      };
    case "unlinked":
      revalidate(outcome.opportunityId);
      return { status: "unlinked", opportunityId: outcome.opportunityId };
    case "unchanged":
      return {
        status: "unchanged",
        opportunityId: outcome.opportunityId,
        vehicleId: outcome.vehicleId,
      };
    case "stage_not_allowed":
      revalidate(outcome.opportunityId);
      return {
        status: "stage_not_allowed",
        opportunityId: outcome.opportunityId,
        stage: outcome.stage,
      };
    case "vehicle_not_found":
      return { status: "vehicle_not_found" };
    case "vehicle_not_available":
    case "not_a_match":
      revalidate(outcome.opportunityId);
      return { status: outcome.outcome };
    case "not_found":
      return { status: "not_found" };
  }
}

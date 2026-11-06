"use server";

import { revalidatePath } from "next/cache";

import {
  transitionVehicleStatus,
  type StatusChangeVehicle,
  type VehicleStatusChangeOutcome,
} from "@/db/queries/change-vehicle-status";
import {
  createVehicleInPreparation,
  type CreatedVehicle,
} from "@/db/queries/create-vehicle";
import {
  transitionVehicleToAvailable,
  type AvailabilityTransition,
  type AvailabilityVehicle,
} from "@/db/queries/mark-vehicle-available";
import { requireTenant } from "@/lib/tenant/session";

import { readVehicleId, type MarkVehicleAvailableState } from "./availability";
import { parseNewVehicleForm, type CreateVehicleState } from "./new-vehicle";
import { STOCK_PATH, VEHICLE_LIFECYCLE_PATHS } from "./paths";
import {
  parseVehicleStatusChange,
  type ChangeVehicleStatusState,
} from "./status-change";

/*
 * Escrituras de unidades desde Stock. Cada Server Action es un endpoint
 * público y la única puerta de su flujo.
 *
 * Alta rápida (H1.3B), createVehicle():
 *
 *   requireTenant() → validar el formulario → createVehicleInPreparation()
 *   (withTenant(), INSERT) → revalidar /stock
 *
 * 1. El TenantContext sale de requireTenant(), como en todo loader o acción
 *    tenant-scoped (DEC-021): sin sesión → /login, sin membership activa →
 *    /no-access. Nada del payload elige organización, usuario ni rol.
 *    Autorización: membership activa AND role IN ('admin', 'seller'). Hoy
 *    membership_role es exactamente admin | seller, así que todo contexto
 *    que emite requireTenant() la cumple; si se agrega un rol, un test falla
 *    y esta regla se revisa explícitamente.
 * 2. El formulario se valida acá, en el servidor. Un payload inválido no
 *    llega a la base.
 * 3. La escritura toma `organization_id` del contexto y fija el estado
 *    inicial (en preparación); el payload solo aporta datos de la unidad.
 * 4. Un error inesperado al guardar no expone detalles de la base: el
 *    formulario vuelve con lo cargado para reintentar.
 *
 * El estado previo (`_previous`) lo envía el cliente: no se usa.
 */

/*
 * Para diagnosticar sin exponer lo cargado: solo el tipo de error y el
 * SQLSTATE. El mensaje de Drizzle incluye la query y sus parámetros, así que
 * nunca se registra.
 */
function logFailure(
  operation: "create" | "mark available" | "change status",
  error: unknown,
) {
  const { name, cause } =
    error instanceof Error ? error : { name: undefined, cause: undefined };
  // Drizzle deja el error del driver en `cause`; uno del COMMIT (el
  // constraint trigger diferido de 0020) llega sin envoltorio.
  const source = cause ?? error;
  const detail = (key: "code" | "constraint_name") =>
    typeof source === "object" && source !== null && key in source
      ? (source as Record<typeof key, unknown>)[key]
      : undefined;
  console.error(`[vehicles] ${operation} failed`, {
    name,
    code: detail("code"),
    constraint_name: detail("constraint_name"),
  });
}

export async function createVehicle(
  _previous: CreateVehicleState,
  formData: FormData,
): Promise<CreateVehicleState> {
  const ctx = await requireTenant();

  const parsed = parseNewVehicleForm(formData);
  if (!parsed.ok) {
    return { status: "invalid", errors: parsed.errors, values: parsed.values };
  }

  let created: CreatedVehicle;
  try {
    created = await createVehicleInPreparation(ctx, parsed.input);
  } catch (error) {
    logFailure("create", error);
    return { status: "failed", values: parsed.values };
  }

  revalidatePath(STOCK_PATH);
  return {
    status: "created",
    vehicleId: created.id,
    brand: created.brand,
    model: created.model,
    year: created.year,
  };
}

/*
 * Disponibilidad (H1.3C), markVehicleAvailable(): la única transición de
 * estado aprobada, in_preparation → available.
 *
 *   requireTenant() → validar el id → transitionVehicleToAvailable()
 *   (withTenant(), UPDATE … AND status = 'in_preparation') → revalidar /stock
 *
 * 1. El TenantContext sale de requireTenant(), como en createVehicle(). La
 *    autorización es la misma (membership activa AND role IN ('admin',
 *    'seller'), hoy todo contexto que emite requireTenant()).
 * 2. El pedido solo identifica la unidad (`vehicleId`). Organización, estado
 *    de destino y cualquier otro campo se ignoran: el destino es siempre
 *    `available` y el origen exigido, `in_preparation`. Un id malformado no
 *    llega a la base.
 * 3. Falla de forma segura: una unidad inexistente o de otra organización
 *    es `not_found`; una que ya no está en preparación (p. ej. otra persona
 *    la marcó un instante antes) es `unchanged`, con su estado real. En
 *    ninguno de los dos casos cambia nada; /stock se revalida igual para
 *    mostrar el estado real.
 * 4. Un error inesperado no expone detalles de la base y no revalida.
 *
 * El estado previo (`_previous`) lo envía el cliente: no se usa.
 */
export async function markVehicleAvailable(
  _previous: MarkVehicleAvailableState,
  formData: FormData,
): Promise<MarkVehicleAvailableState> {
  const ctx = await requireTenant();

  const vehicleId = readVehicleId(formData);
  if (!vehicleId) return { status: "not_found" };

  let transition: AvailabilityTransition;
  try {
    transition = await transitionVehicleToAvailable(ctx, vehicleId);
  } catch (error) {
    logFailure("mark available", error);
    return { status: "failed" };
  }

  revalidatePath(STOCK_PATH);
  switch (transition.outcome) {
    case "became_available":
      // Hito 3 (Match Engine): "vehicle became available → matching" se
      // engancha acá, y solo en esta rama: es la única en la que este
      // pedido hizo la transición (una vez por unidad, aun con dos usuarios
      // marcándola a la vez).
      return { status: "available", ...vehicleOf(transition.vehicle) };
    case "unchanged":
      return {
        status: "unchanged",
        ...vehicleOf(transition.vehicle),
        current: transition.status,
      };
    case "not_found":
      return { status: "not_found" };
  }
}

function vehicleOf({ id, brand, model, year }: AvailabilityVehicle) {
  return { vehicleId: id, brand, model, year };
}

/*
 * Ciclo de vida de una unidad (Hito 19, propuesta DEC-051),
 * changeVehicleStatus(): la puerta de las transiciones de Stock (poner en el
 * salón, reservar y liberar la reserva).
 *
 *   requireTenant() → leer el pedido → transitionVehicleStatus()
 *   (withTenant(), fila bloqueada, máquina de estados del dominio, UPDATE,
 *   trigger de transiciones) → revalidar Stock, Catálogo, Oportunidades,
 *   Embudo, Cockpit y Métricas
 *
 * 1. El TenantContext sale de requireTenant(). Autorización: membership
 *    activa AND role IN ('admin', 'seller') (DEC-027 §4), hoy todo contexto
 *    que emite requireTenant(); si se agrega un rol, un test falla y esta
 *    regla se revisa. Cualquier miembro reserva o libera la unidad que
 *    reservó otro (DEC-023: sin responsable asignado; la reserva no guarda
 *    para quién es).
 * 2. El pedido solo trae la unidad y la transición. El estado actual lo lee
 *    el servidor de la fila bloqueada y el destino lo fija la transición;
 *    organización, usuario y reloj no salen del pedido. Un id malformado o
 *    ajeno es `not_found`, sin revelar nada. Vender no es una transición de
 *    Stock: es `sale_requires_closure` sin llegar a la base, porque la venta
 *    nace del cierre Ganada (DEC-034 §3).
 * 3. Falla de forma segura: una unidad que ya está en el destino es
 *    `unchanged` y una que ya no está en el origen (otra persona la cambió,
 *    o se vendió) es `conflict` con su estado real; en ninguno cambia nada y
 *    las páginas se revalidan igual para mostrar el estado real.
 * 4. Un error inesperado no expone detalles de la base y no revalida.
 *
 * Cambiar el estado de una unidad no modifica ninguna oportunidad (ni su
 * `last_activity_at`, ni su unidad vinculada). Revalida todas las vistas que
 * leen `vehicles.status`: el Inventario y el Catálogo, la cola y el embudo
 * (Match v0 y el cierre usan el estado), y el Cockpit con sus Métricas. El
 * estado previo (`_previous`) lo envía el cliente: no se usa.
 */
export async function changeVehicleStatus(
  _previous: ChangeVehicleStatusState,
  formData: FormData,
): Promise<ChangeVehicleStatusState> {
  const ctx = await requireTenant();

  const parsed = parseVehicleStatusChange(formData);
  if (parsed.kind === "not_found") return { status: "not_found" };
  if (parsed.kind === "invalid") return { status: "invalid" };
  if (parsed.kind === "sale_requires_closure") {
    return { status: "sale_requires_closure" };
  }

  let outcome: VehicleStatusChangeOutcome;
  try {
    outcome = await transitionVehicleStatus(ctx, {
      vehicleId: parsed.vehicleId,
      transition: parsed.transition,
    });
  } catch (error) {
    logFailure("change status", error);
    return { status: "failed" };
  }

  for (const path of VEHICLE_LIFECYCLE_PATHS) revalidatePath(path);
  switch (outcome.outcome) {
    case "changed":
      return {
        status: "changed",
        ...unitOf(outcome.vehicle),
        transition: outcome.transition,
        from: outcome.from,
        to: outcome.to,
      };
    case "unchanged":
      return {
        status: "unchanged",
        ...unitOf(outcome.vehicle),
        transition: outcome.transition,
        current: outcome.status,
      };
    case "conflict":
      return {
        status: "conflict",
        ...unitOf(outcome.vehicle),
        transition: outcome.transition,
        current: outcome.current,
      };
    case "not_found":
      return { status: "not_found" };
  }
}

function unitOf({ id, brand, model, year }: StatusChangeVehicle) {
  return { vehicleId: id, brand, model, year };
}

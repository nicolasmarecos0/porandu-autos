"use server";

import { revalidatePath } from "next/cache";

import {
  createVehicleInPreparation,
  type CreatedVehicle,
} from "@/db/queries/create-vehicle";
import { requireTenant } from "@/lib/tenant/session";

import { parseNewVehicleForm, type CreateVehicleState } from "./new-vehicle";

/*
 * Alta rápida de una unidad desde Stock (H1.3B). Es un endpoint público y la
 * única puerta de escritura del flujo:
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

const STOCK_PATH = "/stock";

/*
 * Para diagnosticar sin exponer lo cargado: solo el tipo de error y el
 * SQLSTATE. El mensaje de Drizzle incluye la query y sus parámetros, así que
 * nunca se registra.
 */
function logCreateFailure(error: unknown): void {
  const { name, cause } =
    error instanceof Error ? error : { name: undefined, cause: undefined };
  const code =
    typeof cause === "object" && cause !== null && "code" in cause
      ? cause.code
      : undefined;
  console.error("[vehicles] create failed", { name, code });
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
    logCreateFailure(error);
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

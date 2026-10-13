"use server";

import { revalidatePath } from "next/cache";

import {
  insertOpportunityMessage,
  type MessageWriteOutcome,
} from "@/db/queries/record-message";
import { requireTenant } from "@/lib/tenant/session";

import { parseMessageRequest, type AddMessageState } from "./message";

/*
 * Mensajes de una conversación (Hito 4, DEC-036 §6), addMessage(): la única
 * puerta del registro de mensajes.
 *
 *   requireTenant() → leer y validar el pedido (Zod) →
 *   insertOpportunityMessage() (withTenant(), la oportunidad en la
 *   organización activa y su contacto, INSERT append-only, RLS, trigger de
 *   actividad) → revalidar /opportunities y /opportunities/[id]
 *
 * 1. El TenantContext sale de requireTenant(), como en todo loader o acción
 *    tenant-scoped (DEC-021): sin sesión → /login, sin membership activa →
 *    /no-access. Autorización: membership activa AND role IN ('admin',
 *    'seller') (DEC-027 §4), hoy todo contexto que emite requireTenant(); si
 *    se agrega un rol, un test falla y esta regla se revisa. Cualquier
 *    miembro registra mensajes en la oportunidad de otro (DEC-023: sin
 *    responsable asignado).
 * 2. El pedido solo trae la oportunidad, el canal, la dirección y el texto.
 *    Organización, contacto, autor y fecha no salen del pedido: los fijan el
 *    contexto, la oportunidad y la base. Un id malformado o ajeno es
 *    `not_found`, sin revelar nada.
 * 3. Un campo inválido vuelve con lo cargado y el error de cada campo, sin
 *    llegar a la base. Un error inesperado no expone detalles de la base ni
 *    el texto (los logs no lo registran) y lo devuelve para reintentar.
 * 4. Registrar no envía ni recibe nada por WhatsApp ni por email: no hay
 *    integración con proveedores (DEC-036 §4).
 *
 * El mensaje mueve el `last_activity_at` de la oportunidad (trigger de la
 * base, DEC-036 §1): cambian la recencia y el orden de la cola, así que se
 * revalidan las dos páginas. El estado previo (`_previous`) lo envía el
 * cliente: no se usa.
 */

const OPPORTUNITIES_PATH = "/opportunities";

/*
 * Para diagnosticar sin exponer datos personales: solo el tipo de error, el
 * SQLSTATE y la constraint. El mensaje de Drizzle incluye la query y sus
 * parámetros (el texto del mensaje), así que nunca se registra.
 */
function logFailure(error: unknown): void {
  const { name, cause } =
    error instanceof Error ? error : { name: undefined, cause: undefined };
  const detail = (key: "code" | "constraint_name") =>
    typeof cause === "object" && cause !== null && key in cause
      ? (cause as Record<typeof key, unknown>)[key]
      : undefined;
  console.error("[conversations] add message failed", {
    name,
    code: detail("code"),
    constraint_name: detail("constraint_name"),
  });
}

export async function addMessage(
  _previous: AddMessageState,
  formData: FormData,
): Promise<AddMessageState> {
  const ctx = await requireTenant();

  const parsed = parseMessageRequest(formData);
  if (parsed.kind === "not_found") return { status: "not_found" };
  if (parsed.kind === "invalid") {
    return { status: "invalid", errors: parsed.errors, values: parsed.values };
  }

  let outcome: MessageWriteOutcome;
  try {
    outcome = await insertOpportunityMessage(ctx, {
      opportunityId: parsed.opportunityId,
      message: parsed.message,
    });
  } catch (error) {
    logFailure(error);
    return { status: "failed", values: parsed.values };
  }

  switch (outcome.outcome) {
    case "recorded":
      revalidatePath(OPPORTUNITIES_PATH);
      revalidatePath(`${OPPORTUNITIES_PATH}/${outcome.opportunityId}`);
      return { status: "recorded", opportunityId: outcome.opportunityId };
    case "not_found":
      return { status: "not_found" };
  }
}

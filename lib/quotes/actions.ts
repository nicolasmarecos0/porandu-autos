"use server";

import { revalidatePath } from "next/cache";

import {
  insertQuote,
  updateQuoteStatus,
  type CreateQuoteOutcome,
  type QuoteStatusOutcome,
} from "@/db/queries/quotes-write";
import { todayInAsuncion } from "@/domains/opportunities/closure";
import { parseQuoteTerms } from "@/domains/quotes/request";
import { planQuoteTransition } from "@/domains/quotes/statuses";
import { requireTenant } from "@/lib/tenant/session";

import { opportunityPath, quoteDocumentPath } from "./paths";
import {
  parseCreateQuoteRequest,
  parseQuoteStatusChangeRequest,
  type ChangeQuoteStatusState,
  type CreateQuoteState,
} from "./requests";

/*
 * Escrituras de las cotizaciones (Hito 10, DEC-042 §8). Cada Server Action
 * es un endpoint público y la única puerta de su flujo.
 *
 * Crear, createQuote():
 *
 *   requireTenant() → leer el pedido → insertQuote() (withTenant(),
 *   oportunidad cotizable y unidad en stock con precio publicado, validar
 *   las condiciones contra esa lista con Zod, total, INSERT) → revalidar
 *   /opportunities/[id]
 *
 * Cambiar el estado, changeQuoteStatus():
 *
 *   requireTenant() → leer el pedido → updateQuoteStatus() (withTenant(),
 *   fila bloqueada, estado esperado, plan del dominio con el rol de la
 *   membership, UPDATE, trigger) → revalidar /opportunities/[id]
 *
 * 1. El TenantContext sale de requireTenant() (DEC-021): sin sesión →
 *    /login, sin membership activa → /no-access. Nada del payload elige
 *    organización, usuario ni rol. El rol (`admin` para aprobar más del
 *    10 %) es el de la membership en la base; la base lo vuelve a exigir.
 * 2. El pedido se valida acá, en el servidor. Un pedido inválido no llega a
 *    escribirse.
 * 3. Nada se envía al cliente: "Enviada" lo marca el vendedor (DEC-042 §6).
 *    Aceptar no cierra la oportunidad: el cierre sigue siendo
 *    closeOpportunity() (DEC-034 §1).
 * 4. Un error inesperado no expone detalles de la base y no revalida.
 *
 * El estado previo (`_previous`) lo envía el cliente: no se usa.
 */

/*
 * Un cambio de estado se ve en el panel de la oportunidad y en la vista
 * previa del presupuesto (Hito 14, DEC-046 §6), que muestra el estado y si
 * el PDF se puede descargar.
 */
function revalidateQuote(opportunityId: string, quoteId: string): void {
  revalidatePath(opportunityPath(opportunityId));
  revalidatePath(quoteDocumentPath(opportunityId, quoteId));
}

/*
 * Para diagnosticar sin exponer lo cargado: solo el tipo de error y el
 * SQLSTATE. El mensaje de Drizzle incluye la query y sus parámetros, así que
 * nunca se registra.
 */
function logFailure(operation: "create" | "change status", error: unknown) {
  const { name, cause } =
    error instanceof Error ? error : { name: undefined, cause: undefined };
  const code =
    typeof cause === "object" && cause !== null && "code" in cause
      ? cause.code
      : undefined;
  console.error(`[quotes] ${operation} failed`, { name, code });
}

export async function createQuote(
  _previous: CreateQuoteState,
  formData: FormData,
): Promise<CreateQuoteState> {
  const ctx = await requireTenant();

  const parsed = parseCreateQuoteRequest(formData);
  if (!parsed.ok) {
    return parsed.opportunityMissing
      ? { status: "opportunity_unavailable", values: parsed.values }
      : { status: "invalid", errors: parsed.errors, values: parsed.values };
  }
  const { opportunityId, vehicleId, terms, values } = parsed;
  // "Hoy" de Asunción, fijado al recibir el pedido: ancla la validez.
  const today = todayInAsuncion(new Date());

  let outcome: CreateQuoteOutcome;
  try {
    outcome = await insertQuote(ctx, { opportunityId, vehicleId }, (list) =>
      parseQuoteTerms(terms, list, today),
    );
  } catch (error) {
    logFailure("create", error);
    return { status: "failed", values };
  }

  switch (outcome.outcome) {
    case "created":
      revalidatePath(opportunityPath(opportunityId));
      return {
        status: "created",
        quoteId: outcome.quoteId,
        number: outcome.number,
      };
    case "opportunity_unavailable":
      return { status: "opportunity_unavailable", values };
    case "vehicle_unavailable":
      return {
        status: "invalid",
        errors: { vehicleId: "unavailable" },
        values,
      };
    case "vehicle_without_price":
      return {
        status: "invalid",
        errors: { vehicleId: "without_price" },
        values,
      };
    case "invalid":
      return { status: "invalid", errors: outcome.parsed.errors, values };
  }
}

export async function changeQuoteStatus(
  _previous: ChangeQuoteStatusState,
  formData: FormData,
): Promise<ChangeQuoteStatusState> {
  const ctx = await requireTenant();

  const parsed = parseQuoteStatusChangeRequest(formData);
  if (!parsed.ok) return { status: "not_found" };
  const { quoteId, from, to } = parsed;
  const today = todayInAsuncion(new Date());
  const actor = { isAdmin: ctx.role === "admin" };

  let outcome: QuoteStatusOutcome;
  try {
    outcome = await updateQuoteStatus(ctx, { quoteId, from, to }, (locked) => {
      const plan = planQuoteTransition(locked, to, actor, today);
      return plan.ok ? "ok" : plan.error;
    });
  } catch (error) {
    logFailure("change status", error);
    return { status: "failed" };
  }

  switch (outcome.outcome) {
    case "changed":
      revalidateQuote(outcome.opportunityId, quoteId);
      return { status: "changed", quoteId, to: outcome.status };
    case "unchanged":
      // Muestra el estado real que dejó otra persona.
      revalidateQuote(outcome.opportunityId, quoteId);
      return { status: "unchanged", quoteId, current: outcome.current };
    case "not_found":
      return { status: "not_found" };
    case "already_accepted":
      revalidateQuote(outcome.opportunityId, quoteId);
      return { status: "already_accepted" };
    case "invalid_transition":
    case "expired":
    case "opportunity_closed":
    case "vehicle_unavailable":
    case "requires_admin":
      return { status: outcome.outcome };
  }
}

"use server";

import { revalidatePath } from "next/cache";

import {
  insertTradeIn,
  writeTradeInAppraisal,
  writeTradeInDecision,
  type AppraiseTradeInOutcome,
  type DecideTradeInOutcome,
  type RegisterTradeInOutcome,
  type TradeInIdentity,
} from "@/db/queries/trade-ins-write";
import { formatMoney } from "@/domains/money";
import { tradeInLabel } from "@/domains/opportunities/trade-in-presentation";
import { PIPELINE_PATH } from "@/lib/opportunities/paths";
import { opportunityPath } from "@/lib/quotes/paths";
import { requireTenant } from "@/lib/tenant/session";

import {
  parseAppraiseTradeInRequest,
  parseRegisterTradeInRequest,
  parseTradeInDecisionRequest,
  type AppraiseTradeInState,
  type ChangeTradeInStatusState,
  type RegisterTradeInState,
} from "./requests";

/*
 * Escrituras de la toma de usados (Hito 20, DEC-052 §3). Cada Server
 * Action es un endpoint público y la única puerta de su flujo.
 *
 * Registrar el usado, registerTradeIn():
 *
 *   requireTenant() → leer y validar el pedido (Zod) → insertTradeIn()
 *   (withTenant(), la oportunidad abierta bloqueada, ninguna toma vigente,
 *   INSERT pendiente y, si un admin cargó la tasación, la tasación en la
 *   misma transacción) → revalidar /opportunities/[id]
 *
 * Tasar o retasar, appraiseTradeIn() (solo un admin: el tasador o gerente):
 *
 *   requireTenant() → leer y validar la tasación → writeTradeInAppraisal()
 *   (withTenant(), oportunidad y toma bloqueadas, plan del dominio con el
 *   rol de la membership, UPDATE, trigger) → revalidar
 *
 * Decidir, changeTradeInStatus() (cualquier miembro: registra lo que dijo
 * el cliente o que la toma no sigue):
 *
 *   requireTenant() → leer la decisión → writeTradeInDecision() (withTenant(),
 *   filas bloqueadas, plan del dominio, UPDATE compare-and-set, trigger) →
 *   revalidar
 *
 * 1. El TenantContext sale de requireTenant() (DEC-021): sin sesión →
 *    /login, sin membership activa → /no-access. Nada del payload elige
 *    organización, usuario ni rol. El rol (`admin` para tasar) es el de la
 *    membership en la base; la base lo vuelve a exigir.
 * 2. El pedido se valida acá, en el servidor. Un pedido inválido no llega a
 *    escribirse y vuelve con lo cargado.
 * 3. Ninguna de las tres crea stock ni toca la oportunidad: el usado
 *    aceptado entra al stock solo con el cierre Ganada (closeOpportunity(),
 *    la regla de oro de DEC-052 §5). No modifican `last_activity_at`.
 * 4. Un error inesperado no expone detalles de la base ni lo cargado (los
 *    logs no registran valores) y no revalida.
 *
 * Se revalidan el detalle de la oportunidad y el embudo, cuya confirmación
 * del cierre Ganada avisa qué pasa con la toma. El estado previo
 * (`_previous`) lo envía el cliente: no se usa.
 */

function revalidateTradeIn(opportunityId: string): void {
  revalidatePath(opportunityPath(opportunityId));
  revalidatePath(PIPELINE_PATH);
}

/*
 * Para diagnosticar sin exponer lo cargado: solo el tipo de error, el
 * SQLSTATE y la constraint. El mensaje de Drizzle incluye la query y sus
 * parámetros (el usado, la chapa, los montos), así que nunca se registra.
 */
function logFailure(
  operation: "register" | "appraise" | "change status",
  error: unknown,
): void {
  const { name, cause } =
    error instanceof Error ? error : { name: undefined, cause: undefined };
  const source = cause ?? error;
  const detail = (key: "code" | "constraint_name") =>
    typeof source === "object" && source !== null && key in source
      ? (source as Record<typeof key, unknown>)[key]
      : undefined;
  console.error(`[trade-ins] ${operation} failed`, {
    name,
    code: detail("code"),
    constraint_name: detail("constraint_name"),
  });
}

function labelOf(identity: TradeInIdentity): string {
  return tradeInLabel(identity);
}

export async function registerTradeIn(
  _previous: RegisterTradeInState,
  formData: FormData,
): Promise<RegisterTradeInState> {
  const ctx = await requireTenant();

  const parsed = parseRegisterTradeInRequest(formData);
  if (parsed.kind === "not_found") return { status: "not_found" };
  if (parsed.kind === "invalid") {
    return { status: "invalid", errors: parsed.errors, values: parsed.values };
  }
  const { opportunityId, vehicle, appraisal, values } = parsed;

  let outcome: RegisterTradeInOutcome;
  try {
    outcome = await insertTradeIn(
      ctx,
      { opportunityId, vehicle, appraisal },
      { isAdmin: ctx.role === "admin" },
    );
  } catch (error) {
    logFailure("register", error);
    return { status: "failed", values };
  }

  switch (outcome.outcome) {
    case "registered":
      revalidateTradeIn(opportunityId);
      return {
        status: "registered",
        tradeInId: outcome.tradeInId,
        appraised: outcome.status === "appraised",
        label: tradeInLabel(vehicle),
      };
    case "opportunity_closed":
    case "already_registered":
      // La página vuelve con la etapa o la toma real.
      revalidateTradeIn(opportunityId);
      return { status: outcome.outcome, values };
    case "requires_admin":
      return { status: "requires_admin", values };
    case "not_found":
      return { status: "not_found" };
  }
}

export async function appraiseTradeIn(
  _previous: AppraiseTradeInState,
  formData: FormData,
): Promise<AppraiseTradeInState> {
  const ctx = await requireTenant();

  const parsed = parseAppraiseTradeInRequest(formData);
  if (parsed.kind === "not_found") return { status: "not_found" };
  if (parsed.kind === "invalid") {
    return { status: "invalid", errors: parsed.errors, values: parsed.values };
  }
  const { tradeInId, seen, appraisal, values } = parsed;

  let outcome: AppraiseTradeInOutcome;
  try {
    outcome = await writeTradeInAppraisal(
      ctx,
      { tradeInId, seen, appraisal },
      { isAdmin: ctx.role === "admin" },
    );
  } catch (error) {
    logFailure("appraise", error);
    return { status: "failed", values };
  }

  switch (outcome.outcome) {
    case "appraised":
      revalidateTradeIn(outcome.opportunityId);
      return {
        status: "appraised",
        label: labelOf(outcome.identity),
        offerPriceLabel: formatMoney(outcome.offerPrice),
      };
    case "unchanged":
      return { status: "unchanged", label: labelOf(outcome.identity) };
    case "conflict":
      // Muestra el estado real que dejó otra persona.
      revalidateTradeIn(outcome.opportunityId);
      return {
        status: "conflict",
        current: outcome.current,
        label: labelOf(outcome.identity),
      };
    case "opportunity_closed":
      revalidateTradeIn(outcome.opportunityId);
      return { status: "opportunity_closed" };
    case "requires_admin":
      return { status: "requires_admin" };
    case "not_found":
      return { status: "not_found" };
  }
}

export async function changeTradeInStatus(
  _previous: ChangeTradeInStatusState,
  formData: FormData,
): Promise<ChangeTradeInStatusState> {
  const ctx = await requireTenant();

  const parsed = parseTradeInDecisionRequest(formData);
  if (parsed.kind === "not_found") return { status: "not_found" };

  let outcome: DecideTradeInOutcome;
  try {
    outcome = await writeTradeInDecision(ctx, {
      tradeInId: parsed.tradeInId,
      decision: parsed.decision,
    });
  } catch (error) {
    logFailure("change status", error);
    return { status: "failed" };
  }

  switch (outcome.outcome) {
    case "changed":
      revalidateTradeIn(outcome.opportunityId);
      return {
        status: "changed",
        decision: outcome.decision,
        to: outcome.to,
        label: labelOf(outcome.identity),
      };
    case "unchanged":
      revalidateTradeIn(outcome.opportunityId);
      return {
        status: "unchanged",
        current: outcome.status,
        label: labelOf(outcome.identity),
      };
    case "conflict":
      revalidateTradeIn(outcome.opportunityId);
      return {
        status: "conflict",
        current: outcome.current,
        label: labelOf(outcome.identity),
      };
    case "offer_price_required":
      return { status: "offer_price_required" };
    case "opportunity_closed":
      revalidateTradeIn(outcome.opportunityId);
      return { status: "opportunity_closed" };
    case "not_found":
      return { status: "not_found" };
  }
}

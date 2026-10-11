import "server-only";

import { and, eq } from "drizzle-orm";

import { planStageChange, type Stage } from "@/domains/opportunities/stages";

import { opportunities } from "../schema";
import { withTenant, type TenantContext } from "../tenant";
import { stageFromDb } from "./opportunities";

/*
 * Cambio de etapa de una oportunidad (H1.6, DEC-032). La única puerta es la
 * Server Action changeOpportunityStage() (lib/opportunities/actions.ts), que
 * obtiene el contexto con requireTenant() y valida el pedido antes de llegar
 * acá; ESLint impide importar este módulo desde cualquier otro lado.
 *
 *   TenantContext → withTenant() → SELECT … FOR UPDATE (la fila) →
 *   planStageChange() (dominio) → UPDATE … AND stage = <la leída> → RLS +
 *   trigger de transiciones → COMMIT
 *
 * - El cliente solo identifica la oportunidad y pide una etapa de destino.
 *   La etapa de origen la lee este módulo de la fila bloqueada y
 *   `organization_id` sale del contexto (defensa en profundidad: la policy
 *   de UPDATE exige además una organización con membership activa).
 * - Solo avances que no cierran (DEC-034 §1): un pase válido a `won` o
 *   `lost` es `closure_required` y no se escribe. Cerrar lleva sus metadatos
 *   y tiene su propia puerta (db/queries/close-opportunity.ts); la base
 *   rechaza un cierre sin ellos (CHECKs de cierre).
 * - La regla la decide el dominio sobre la fila bloqueada, y la base la
 *   vuelve a exigir con un trigger que valida el par etapa anterior → etapa
 *   nueva: si este módulo tuviera un bug, la base igual rechaza la
 *   transición (23514, `opportunities_stage_transition`).
 * - Solo cambian `stage` y `updated_at` (el trigger lo fija con el reloj de
 *   la base). No toca `last_activity_at`, que es la recencia de la
 *   interacción con el cliente y no del trabajo del vendedor (DEC-032 §7),
 *   ni la demanda ni el stock.
 * - Concurrencia: el FOR UPDATE serializa los cambios de una misma
 *   oportunidad. El segundo pedido espera, lee la etapa ya confirmada y el
 *   dominio decide sobre ella: pedir la misma etapa es `unchanged`, y un
 *   par que dejó de existir (p. ej. ya estaba perdida) es
 *   `invalid_transition`, con la etapa real. Ninguno escribe ni pisa nada.
 * - Una oportunidad inexistente o de otra organización es `not_found`, sin
 *   revelar cuál de las dos.
 */

export type StageChangeRequest = Readonly<{
  opportunityId: string;
  to: Stage;
}>;

export type StageChangeOutcome =
  /** Este pedido hizo la transición. */
  | Readonly<{
      outcome: "changed";
      opportunityId: string;
      from: Stage;
      to: Stage;
    }>
  /** Ya estaba en la etapa pedida: no se escribió nada. */
  | Readonly<{ outcome: "unchanged"; opportunityId: string; stage: Stage }>
  /** La máquina de estados no permite ese par. `current` es la etapa real. */
  | Readonly<{
      outcome: "invalid_transition";
      opportunityId: string;
      current: Stage;
    }>
  /** El pase cierra la oportunidad: va por closeOpportunity(). */
  | Readonly<{
      outcome: "closure_required";
      opportunityId: string;
      current: Stage;
    }>
  /** No existe, o no es de la organización activa. Nada cambió. */
  | Readonly<{ outcome: "not_found" }>;

export async function transitionOpportunityStage(
  ctx: TenantContext,
  request: StageChangeRequest,
): Promise<StageChangeOutcome> {
  return withTenant(ctx, async (tx) => {
    // Ya validado por withTenant(): un contexto emitido por Tenant Resolution.
    const { organizationId } = ctx;
    const { opportunityId } = request;
    const opportunity = and(
      eq(opportunities.id, opportunityId),
      eq(opportunities.organizationId, organizationId),
    );

    const [current] = await tx
      .select({ stage: opportunities.stage })
      .from(opportunities)
      .where(opportunity)
      .for("update");
    if (!current) return { outcome: "not_found" };
    const from = stageFromDb[current.stage];

    const plan = planStageChange(from, request);
    switch (plan.kind) {
      case "unchanged":
        return { outcome: "unchanged", opportunityId, stage: plan.stage };
      case "invalid_transition":
        return { outcome: "invalid_transition", opportunityId, current: from };
      case "closure_required":
        return { outcome: "closure_required", opportunityId, current: from };
      case "change":
        break;
    }

    // `stage = <la leída>`: la fila está bloqueada, así que no puede haber
    // cambiado; la condición es una barrera más contra un bug de este módulo.
    const updated = await tx
      .update(opportunities)
      .set({ stage: plan.to })
      .where(and(opportunity, eq(opportunities.stage, current.stage)))
      .returning({ id: opportunities.id });
    if (updated.length !== 1) {
      throw new Error(
        "opportunity stage update affected an unexpected row count",
      );
    }
    return {
      outcome: "changed",
      opportunityId,
      from: plan.from,
      to: plan.to,
    };
  });
}

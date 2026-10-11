import "server-only";

import { and, eq, isNull } from "drizzle-orm";

import { resolveDemand } from "@/domains/demand/resolver";
import { demandSnapshot } from "@/domains/demand/snapshot";
import type { Stage } from "@/domains/opportunities/stages";
import { planVehicleLink } from "@/domains/opportunities/vehicle-link";

import { opportunities } from "../schema";
import { withTenant, type TenantContext } from "../tenant";
import { selectDemandRows } from "./demand-rows";
import { stageFromDb } from "./opportunities";
import { selectVehicleById } from "./vehicles";

/*
 * Unidad vinculada a la negociación (Hito 2, DEC-033 §2). La única puerta es
 * la Server Action linkOpportunityVehicle() (lib/opportunities/actions.ts),
 * que obtiene el contexto con requireTenant() y lee el pedido antes de
 * llegar acá; ESLint impide importar este módulo desde cualquier otro lado.
 *
 *   TenantContext → withTenant() → SELECT … FOR UPDATE (la oportunidad) →
 *   la unidad pedida y la demanda vigente (misma organización) →
 *   planVehicleLink() (dominio) → UPDATE … AND stage = <la leída> AND
 *   vehicle_id = <el leído> → RLS + FK compuesta + CHECK + trigger → COMMIT
 *
 * - El cliente solo identifica la oportunidad y la unidad (null para quitar
 *   el vínculo). La etapa y la unidad actual las lee este módulo de la fila
 *   bloqueada, y `organization_id` sale del contexto.
 * - La regla la decide el dominio: etapa `negotiating`, unidad de la
 *   organización activa, `available` y match de la demanda vigente (Match
 *   v0), calculado acá de nuevo, sin confiar en lo que mostró la tarjeta. La
 *   base la vuelve a exigir: la FK compuesta (misma organización), el CHECK
 *   de etapa y el trigger (solo cambia en `negotiating`, y nunca
 *   junto con un pase de etapa).
 * - Solo cambian `vehicle_id` y `updated_at` (lo fija el trigger). No toca
 *   el estado de la unidad (vincular no la reserva ni la vende), la etapa,
 *   la demanda ni `last_activity_at` (DEC-033 §6).
 * - Concurrencia: el FOR UPDATE serializa los pedidos sobre una misma
 *   oportunidad. El segundo lee la unidad y la etapa ya confirmadas y el
 *   dominio decide sobre ellas: pedir lo que ya está es `unchanged`, y si la
 *   oportunidad se cerró como perdida, `stage_not_allowed`. Entre dos
 *   unidades distintas gana el último pedido (DEC-033 §2).
 * - Una oportunidad inexistente o de otra organización es `not_found`, y una
 *   unidad inexistente o de otra organización, `vehicle_not_found`, sin
 *   revelar cuál de los dos casos fue.
 */

export type VehicleLinkRequest = Readonly<{
  opportunityId: string;
  /** La unidad a vincular, o null para quitar el vínculo. */
  vehicleId: string | null;
}>;

export type VehicleLinkOutcome =
  /** Este pedido vinculó la unidad (en lugar de la anterior, si había). */
  | Readonly<{
      outcome: "linked";
      opportunityId: string;
      vehicleId: string;
      previousVehicleId: string | null;
    }>
  /** Este pedido quitó la unidad vinculada. */
  | Readonly<{
      outcome: "unlinked";
      opportunityId: string;
      previousVehicleId: string;
    }>
  /** Ya estaba así: no se escribió nada. */
  | Readonly<{
      outcome: "unchanged";
      opportunityId: string;
      vehicleId: string | null;
    }>
  /** La etapa actual no admite cambiar la unidad. `stage` es la real. */
  | Readonly<{
      outcome: "stage_not_allowed";
      opportunityId: string;
      stage: Stage;
    }>
  /** La unidad no existe en la organización activa. Nada cambió. */
  | Readonly<{ outcome: "vehicle_not_found"; opportunityId: string }>
  /** La unidad ya no está disponible. Nada cambió. */
  | Readonly<{ outcome: "vehicle_not_available"; opportunityId: string }>
  /** La unidad no es un match de la demanda vigente. Nada cambió. */
  | Readonly<{ outcome: "not_a_match"; opportunityId: string }>
  /** La oportunidad no existe o no es de la organización activa. */
  | Readonly<{ outcome: "not_found" }>;

export async function setOpportunityVehicle(
  ctx: TenantContext,
  request: VehicleLinkRequest,
): Promise<VehicleLinkOutcome> {
  return withTenant(ctx, async (tx) => {
    // Ya validado por withTenant(): un contexto emitido por Tenant Resolution.
    const { organizationId } = ctx;
    const { opportunityId, vehicleId: requestedVehicleId } = request;
    const opportunity = and(
      eq(opportunities.id, opportunityId),
      eq(opportunities.organizationId, organizationId),
    );

    const [current] = await tx
      .select({
        stage: opportunities.stage,
        vehicleId: opportunities.vehicleId,
      })
      .from(opportunities)
      .where(opportunity)
      .for("update");
    if (!current) return { outcome: "not_found" };

    // La unidad y la demanda solo importan para vincular una unidad nueva.
    const linking =
      requestedVehicleId !== null && requestedVehicleId !== current.vehicleId;
    const vehicle = linking
      ? await selectVehicleById(tx, organizationId, requestedVehicleId)
      : null;
    const rows =
      linking && vehicle !== null
        ? ((await selectDemandRows(tx, organizationId, [opportunityId])).get(
            opportunityId,
          ) ?? [])
        : [];

    const plan = planVehicleLink({
      stage: stageFromDb[current.stage],
      currentVehicleId: current.vehicleId,
      requestedVehicleId,
      vehicle,
      demand: demandSnapshot(resolveDemand(rows)),
    });
    switch (plan.kind) {
      case "unchanged":
        return {
          outcome: "unchanged",
          opportunityId,
          vehicleId: plan.vehicleId,
        };
      case "stage_not_allowed":
        return {
          outcome: "stage_not_allowed",
          opportunityId,
          stage: plan.stage,
        };
      case "vehicle_not_found":
      case "vehicle_not_available":
      case "not_a_match":
        return { outcome: plan.kind, opportunityId };
      case "link":
      case "unlink":
        break;
    }

    const next = plan.kind === "link" ? plan.vehicleId : null;
    // La fila está bloqueada, así que etapa y unidad no pueden haber
    // cambiado; la condición es una barrera más contra un bug de este módulo.
    const updated = await tx
      .update(opportunities)
      .set({ vehicleId: next })
      .where(
        and(
          opportunity,
          eq(opportunities.stage, current.stage),
          current.vehicleId === null
            ? isNull(opportunities.vehicleId)
            : eq(opportunities.vehicleId, current.vehicleId),
        ),
      )
      .returning({ id: opportunities.id });
    if (updated.length !== 1) {
      throw new Error(
        "opportunity vehicle link update affected an unexpected row count",
      );
    }
    return plan.kind === "link"
      ? {
          outcome: "linked",
          opportunityId,
          vehicleId: plan.vehicleId,
          previousVehicleId: plan.previousVehicleId,
        }
      : {
          outcome: "unlinked",
          opportunityId,
          previousVehicleId: plan.previousVehicleId,
        };
  });
}

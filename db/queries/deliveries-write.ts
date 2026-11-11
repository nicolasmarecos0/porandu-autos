import "server-only";

import { and, eq } from "drizzle-orm";

import {
  planDeliveryCancellation,
  planDeliveryChecklistChange,
  planDeliveryCompletion,
  planDeliveryReschedule,
  planDeliverySchedule,
  type DeliveryChecklist,
  type DeliveryChecklistItem,
  type DeliveryRecordStatus,
  type DeliveryTarget,
  type DeliveryVehicleConflictReason,
} from "@/domains/opportunities/deliveries";
import type { Stage } from "@/domains/opportunities/stages";
import type { VehicleStatus } from "@/domains/vehicles/stock";

import { deliveries, opportunities, vehicles } from "../schema";
import {
  withTenant,
  type ScopedTransaction,
  type TenantContext,
} from "../tenant";
import { checklistFromDb, checklistToDb } from "./deliveries";
import { stageFromDb } from "./opportunities";
import { statusFromDb, statusToDb } from "./vehicles";

/*
 * Escrituras de la logística de entregas (Hito 21, DEC-053 §3 y §4). La
 * única puerta son las Server Actions de lib/deliveries/actions.ts
 * (scheduleDelivery(), rescheduleDelivery(), setDeliveryChecklistItem() y
 * completeDelivery()), que obtienen el contexto con requireTenant() y leen
 * el pedido antes de llegar acá; ESLint impide importar este módulo desde
 * cualquier otro lado.
 *
 *   TenantContext → withTenant() → filas de la organización activa,
 *   bloqueadas → plan del dominio sobre las filas bloqueadas → INSERT /
 *   UPDATE … AND status = <el leído> → RLS + CHECKs + triggers → COMMIT
 *
 * - El cliente solo identifica la oportunidad o la entrega y manda la fecha
 *   pactada o el ítem del checklist. Organización, unidad (la vinculada de
 *   la ganada), autor, estado, sello y reloj no salen del pedido.
 * - Orden de los bloqueos, siempre:
 *     programar: oportunidad (FOR SHARE) → unidad (FOR SHARE);
 *     tildar, reprogramar: entrega (FOR UPDATE);
 *     completar: entrega (FOR UPDATE) → unidad (FOR UPDATE).
 *   Ningún camino bloquea la unidad antes que la entrega, así que no hay
 *   ciclos. El cierre Ganada bloquea oportunidad → unidad, pero una ganada
 *   ya no se vuelve a cerrar; Stock bloquea solo la unidad y no escribe
 *   sobre una vendida.
 * - Completar es atómico: la entrega pasa a `completed` (el trigger fija el
 *   sello) y la unidad a `delivered` en la misma transacción, la entrega
 *   primero porque el trigger de vehicles exige la entrega completada. El
 *   constraint trigger diferido de deliveries revierte al COMMIT una
 *   entrega completada sin su unidad entregada.
 * - Una oportunidad o una entrega inexistente o de otra organización es
 *   `not_found`, sin revelar cuál.
 */

/** Rechazos de la base → resultado para el usuario. */
const UNIQUE_SCHEDULE_CONSTRAINTS = new Set([
  "deliveries_organization_id_opportunity_id_key",
  "deliveries_organization_id_vehicle_id_key",
]);

function constraintNameOf(error: unknown): string | undefined {
  const cause =
    error instanceof Error && typeof error.cause === "object"
      ? error.cause
      : error;
  if (typeof cause !== "object" || cause === null) return undefined;
  const name = (cause as { constraint_name?: unknown }).constraint_name;
  return typeof name === "string" ? name : undefined;
}

/** "Toyota Hilux 2025": la unidad, para los avisos. */
export type DeliveryUnitLabel = Readonly<{
  brand: string;
  model: string;
  year: number;
}>;

/* ── Programar ──────────────────────────────────────────────────────────── */

export type ScheduleDeliveryRequest = Readonly<{
  opportunityId: string;
  scheduledAt: Date;
}>;

export type ScheduleDeliveryOutcome =
  | Readonly<{
      outcome: "scheduled";
      deliveryId: string;
      opportunityId: string;
    }>
  | Readonly<{ outcome: "already_scheduled"; opportunityId: string }>
  | Readonly<{
      outcome: "opportunity_not_won";
      opportunityId: string;
      stage: Stage;
    }>
  | Readonly<{
      outcome: "vehicle_conflict";
      opportunityId: string;
      current: VehicleStatus;
      reason: DeliveryVehicleConflictReason;
    }>
  | Readonly<{ outcome: "vehicle_required"; opportunityId: string }>
  | Readonly<{ outcome: "not_found" }>;

export async function insertDelivery(
  ctx: TenantContext,
  request: ScheduleDeliveryRequest,
): Promise<ScheduleDeliveryOutcome> {
  const { opportunityId } = request;
  try {
    return await withTenant(ctx, async (tx) => {
      // Ya validado por withTenant(): un contexto emitido por Tenant Resolution.
      const { organizationId, userId } = ctx;
      const [opportunity] = await tx
        .select({
          stage: opportunities.stage,
          vehicleId: opportunities.vehicleId,
        })
        .from(opportunities)
        .where(
          and(
            eq(opportunities.organizationId, organizationId),
            eq(opportunities.id, opportunityId),
          ),
        )
        .for("share");
      if (!opportunity) return { outcome: "not_found" };

      const vehicleStatus = opportunity.vehicleId
        ? await lockVehicleStatus(
            tx,
            organizationId,
            opportunity.vehicleId,
            "share",
          )
        : null;
      const [existing] = await tx
        .select({ id: deliveries.id, status: deliveries.status })
        .from(deliveries)
        .where(
          and(
            eq(deliveries.organizationId, organizationId),
            eq(deliveries.opportunityId, opportunityId),
          ),
        )
        .limit(1);

      const plan = planDeliverySchedule({
        stage: stageFromDb[opportunity.stage],
        vehicleId: opportunity.vehicleId,
        vehicleStatus,
        delivery: existing ?? null,
      });
      switch (plan.kind) {
        case "opportunity_not_won":
          return {
            outcome: "opportunity_not_won",
            opportunityId,
            stage: plan.stage,
          };
        case "already_scheduled":
          return { outcome: "already_scheduled", opportunityId };
        case "vehicle_required":
          return { outcome: "vehicle_required", opportunityId };
        case "vehicle_conflict":
          return {
            outcome: "vehicle_conflict",
            opportunityId,
            current: plan.current,
            reason: plan.reason,
          };
        case "schedule":
          break;
      }

      const [created] = await tx
        .insert(deliveries)
        .values({
          organizationId,
          opportunityId,
          vehicleId: plan.vehicleId,
          scheduledAt: request.scheduledAt,
          createdBy: userId,
        })
        .returning({ id: deliveries.id });
      if (!created) throw new Error("delivery insert returned no row");
      return { outcome: "scheduled", deliveryId: created.id, opportunityId };
    });
  } catch (error) {
    // Dos pedidos simultáneos: el segundo choca con la unique.
    const name = constraintNameOf(error);
    if (name !== undefined && UNIQUE_SCHEDULE_CONSTRAINTS.has(name)) {
      return { outcome: "already_scheduled", opportunityId };
    }
    throw error;
  }
}

/* ── Filas bloqueadas ───────────────────────────────────────────────────── */

async function lockVehicleStatus(
  tx: ScopedTransaction,
  organizationId: string,
  vehicleId: string,
  strength: "share" | "update",
): Promise<VehicleStatus | null> {
  const [row] = await tx
    .select({ status: vehicles.status })
    .from(vehicles)
    .where(
      and(
        eq(vehicles.organizationId, organizationId),
        eq(vehicles.id, vehicleId),
      ),
    )
    .for(strength);
  return row ? statusFromDb[row.status] : null;
}

type LockedDelivery = Readonly<{
  opportunityId: string;
  vehicleId: string;
  status: DeliveryRecordStatus;
  target: DeliveryTarget;
}>;

/** La entrega en la organización activa, bloqueada FOR UPDATE. */
async function lockDelivery(
  tx: ScopedTransaction,
  organizationId: string,
  deliveryId: string,
): Promise<LockedDelivery | null> {
  const [row] = await tx
    .select({
      opportunityId: deliveries.opportunityId,
      vehicleId: deliveries.vehicleId,
      status: deliveries.status,
      scheduledAt: deliveries.scheduledAt,
      checklist: deliveries.checklist,
    })
    .from(deliveries)
    .where(
      and(
        eq(deliveries.organizationId, organizationId),
        eq(deliveries.id, deliveryId),
      ),
    )
    .for("update");
  if (!row) return null;
  return {
    opportunityId: row.opportunityId,
    vehicleId: row.vehicleId,
    status: row.status,
    target: {
      status: row.status,
      scheduledAt: row.scheduledAt,
      checklist: checklistFromDb(row.checklist),
    },
  };
}

function deliveryRow(organizationId: string, deliveryId: string) {
  return and(
    eq(deliveries.organizationId, organizationId),
    eq(deliveries.id, deliveryId),
    eq(deliveries.status, "pending"),
  );
}

/* ── Reprogramar ────────────────────────────────────────────────────────── */

export type RescheduleDeliveryRequest = Readonly<{
  deliveryId: string;
  scheduledAt: Date;
}>;

export type RescheduleDeliveryOutcome =
  | Readonly<{ outcome: "rescheduled"; opportunityId: string }>
  | Readonly<{ outcome: "unchanged"; opportunityId: string }>
  | Readonly<{ outcome: "already_completed"; opportunityId: string }>
  | Readonly<{ outcome: "not_found" }>;

export async function writeDeliverySchedule(
  ctx: TenantContext,
  request: RescheduleDeliveryRequest,
): Promise<RescheduleDeliveryOutcome> {
  return withTenant(ctx, async (tx) => {
    const { organizationId } = ctx;
    const locked = await lockDelivery(tx, organizationId, request.deliveryId);
    if (!locked) return { outcome: "not_found" };
    const { opportunityId } = locked;
    const plan = planDeliveryReschedule(locked.target, request.scheduledAt);
    if (plan.kind !== "reschedule")
      return { outcome: plan.kind, opportunityId };
    const updated = await tx
      .update(deliveries)
      .set({ scheduledAt: plan.scheduledAt })
      .where(deliveryRow(organizationId, request.deliveryId))
      .returning({ id: deliveries.id });
    if (updated.length !== 1) {
      throw new Error("delivery reschedule affected an unexpected row count");
    }
    return { outcome: "rescheduled", opportunityId };
  });
}

/* ── Tildar el checklist ────────────────────────────────────────────────── */

export type DeliveryChecklistRequest = Readonly<{
  deliveryId: string;
  item: DeliveryChecklistItem;
  checked: boolean;
}>;

export type DeliveryChecklistOutcome =
  | Readonly<{
      outcome: "changed";
      opportunityId: string;
      checklist: DeliveryChecklist;
    }>
  | Readonly<{
      outcome: "unchanged";
      opportunityId: string;
      checklist: DeliveryChecklist;
    }>
  | Readonly<{ outcome: "already_completed"; opportunityId: string }>
  | Readonly<{ outcome: "not_found" }>;

export async function writeDeliveryChecklistItem(
  ctx: TenantContext,
  request: DeliveryChecklistRequest,
): Promise<DeliveryChecklistOutcome> {
  return withTenant(ctx, async (tx) => {
    const { organizationId } = ctx;
    const locked = await lockDelivery(tx, organizationId, request.deliveryId);
    if (!locked) return { outcome: "not_found" };
    const { opportunityId } = locked;
    const plan = planDeliveryChecklistChange(
      locked.target,
      request.item,
      request.checked,
    );
    switch (plan.kind) {
      case "already_completed":
        return { outcome: "already_completed", opportunityId };
      case "unchanged":
        return {
          outcome: "unchanged",
          opportunityId,
          checklist: plan.checklist,
        };
      case "change":
        break;
    }
    const updated = await tx
      .update(deliveries)
      .set({ checklist: checklistToDb(plan.checklist) })
      .where(deliveryRow(organizationId, request.deliveryId))
      .returning({ id: deliveries.id });
    if (updated.length !== 1) {
      throw new Error(
        "delivery checklist change affected an unexpected row count",
      );
    }
    return { outcome: "changed", opportunityId, checklist: plan.checklist };
  });
}

/* ── Anular (Hito 22, DEC-054 §4) ───────────────────────────────────────── */

export type CancelDeliveryOutcome =
  | Readonly<{ outcome: "cancelled"; opportunityId: string }>
  | Readonly<{ outcome: "already_completed"; opportunityId: string }>
  /** La base no borró la fila: la policy de DELETE exige un admin. */
  | Readonly<{ outcome: "unauthorized_role"; opportunityId: string }>
  | Readonly<{ outcome: "not_found" }>;

/**
 * Anula una entrega pendiente: bloquea la entrega (el mismo orden que
 * tildar o completar), decide con el estado guardado y borra el remito con
 * compare-and-set sobre `pending`. La unidad sigue Vendida y la oportunidad
 * Ganada: se puede programar otra entrega. La única puerta es la Server
 * Action cancelDelivery(), que exige `delivery.cancel` antes de llegar acá.
 * La policy deliveries_delete_admin filtra el DELETE de quien no es admin
 * (0 filas, defensa en profundidad) y el trigger deliveries_delete_guard
 * rechaza borrar una completada, también al rol dueño.
 */
export async function deleteDelivery(
  ctx: TenantContext,
  deliveryId: string,
): Promise<CancelDeliveryOutcome> {
  return withTenant(ctx, async (tx) => {
    const { organizationId } = ctx;
    const locked = await lockDelivery(tx, organizationId, deliveryId);
    if (!locked) return { outcome: "not_found" };
    const { opportunityId } = locked;

    const plan = planDeliveryCancellation(locked.target);
    if (plan.kind === "already_completed") {
      return { outcome: "already_completed", opportunityId };
    }
    const deleted = await tx
      .delete(deliveries)
      .where(deliveryRow(organizationId, deliveryId))
      .returning({ id: deliveries.id });
    if (deleted.length === 0) {
      return { outcome: "unauthorized_role", opportunityId };
    }
    return { outcome: "cancelled", opportunityId };
  });
}

/* ── Completar y dar salida ─────────────────────────────────────────────── */

export type CompleteDeliveryOutcome =
  | Readonly<{
      outcome: "completed";
      opportunityId: string;
      vehicleId: string;
      unit: DeliveryUnitLabel;
    }>
  | Readonly<{ outcome: "already_completed"; opportunityId: string }>
  | Readonly<{
      outcome: "checklist_incomplete";
      opportunityId: string;
      missing: readonly DeliveryChecklistItem[];
    }>
  | Readonly<{
      outcome: "vehicle_conflict";
      opportunityId: string;
      current: VehicleStatus;
      reason: DeliveryVehicleConflictReason;
    }>
  | Readonly<{ outcome: "not_found" }>;

/**
 * Completa la entrega y da salida a la unidad en una sola transacción:
 * bloquea la entrega y después la unidad, decide con el checklist guardado
 * (no el del navegador) y escribe las dos filas con compare-and-set sobre
 * el estado leído. Cualquier falla revierte las dos.
 */
export async function completeDeliveryWithExit(
  ctx: TenantContext,
  deliveryId: string,
): Promise<CompleteDeliveryOutcome> {
  return withTenant(ctx, async (tx) => {
    const { organizationId } = ctx;
    const locked = await lockDelivery(tx, organizationId, deliveryId);
    if (!locked) return { outcome: "not_found" };
    const { opportunityId, vehicleId } = locked;

    const [unit] = await tx
      .select({
        status: vehicles.status,
        brand: vehicles.brand,
        model: vehicles.model,
        year: vehicles.year,
      })
      .from(vehicles)
      .where(
        and(
          eq(vehicles.organizationId, organizationId),
          eq(vehicles.id, vehicleId),
        ),
      )
      .for("update");
    // La FK compuesta garantiza la unidad; sin ella, nada que entregar.
    if (!unit) throw new Error("delivery vehicle not found");

    const plan = planDeliveryCompletion(
      locked.target,
      statusFromDb[unit.status],
    );
    switch (plan.kind) {
      case "already_completed":
        return { outcome: "already_completed", opportunityId };
      case "checklist_incomplete":
        return {
          outcome: "checklist_incomplete",
          opportunityId,
          missing: plan.missing,
        };
      case "vehicle_conflict":
        return {
          outcome: "vehicle_conflict",
          opportunityId,
          current: plan.current,
          reason: plan.reason,
        };
      case "complete":
        break;
    }

    // La entrega primero: el trigger de vehicles exige la entrega
    // completada para la salida, y el de deliveries, la unidad vendida.
    const completed = await tx
      .update(deliveries)
      .set({ status: "completed" })
      .where(deliveryRow(organizationId, deliveryId))
      .returning({ id: deliveries.id });
    if (completed.length !== 1) {
      throw new Error("delivery completion affected an unexpected row count");
    }
    const exited = await tx
      .update(vehicles)
      .set({ status: statusToDb.delivered })
      .where(
        and(
          eq(vehicles.organizationId, organizationId),
          eq(vehicles.id, vehicleId),
          eq(vehicles.status, statusToDb.sold),
        ),
      )
      .returning({ id: vehicles.id });
    if (exited.length !== 1) {
      throw new Error("vehicle exit affected an unexpected row count");
    }
    return {
      outcome: "completed",
      opportunityId,
      vehicleId,
      unit: { brand: unit.brand, model: unit.model, year: unit.year },
    };
  });
}

import type { DemandSnapshot } from "@/domains/demand/snapshot";
import { evaluateMatch } from "@/domains/match/engine";
import type { MatchableVehicle } from "@/domains/match/types";
import {
  formatKm,
  formatPrice,
  vehicleDetail,
  vehicleName,
  vehicleStatusLabel,
  type Price,
  type VehicleStatus,
} from "@/domains/vehicles/stock";

import type { Stage } from "./stages";

/*
 * Unidad vinculada a la negociación (Hito 2, DEC-033 §2): la unidad del
 * stock que se está negociando con el cliente. Módulo puro y apto para el
 * navegador: la UI lo usa para ofrecer la acción, pero la regla la imponen el
 * servidor (planVehicleLink() sobre la fila bloqueada) y la base (CHECK de
 * etapa y el trigger de la oportunidad, que espejan estas listas).
 *
 * - Solo se elige, cambia o quita en `negotiating` o `won`.
 * - En `lost` se conserva la que había y ya no cambia; en `new` y
 *   `qualifying` no existe.
 * - La unidad tiene que estar disponible y ser un match de la demanda
 *   vigente (Match v0, DEC-031) en el momento de vincularla.
 * - Vincular no cambia el stock: la unidad sigue `available` y `won` no la
 *   marca `sold` (DEC-032 §10).
 */

/** Etapas en las que se elige, cambia o quita la unidad vinculada. */
export const VEHICLE_LINK_STAGES = [
  "negotiating",
  "won",
] as const satisfies readonly Stage[];

/**
 * Etapas en las que puede existir una unidad vinculada: las de vinculación
 * más `lost`, que conserva la que se negociaba (CHECK
 * `opportunities_vehicle_stage_check`).
 */
export const VEHICLE_HOLDING_STAGES = [
  ...VEHICLE_LINK_STAGES,
  "lost",
] as const satisfies readonly Stage[];

export function canChangeVehicleLink(stage: Stage): boolean {
  return (VEHICLE_LINK_STAGES as readonly Stage[]).includes(stage);
}

export function canHoldVehicle(stage: Stage): boolean {
  return (VEHICLE_HOLDING_STAGES as readonly Stage[]).includes(stage);
}

/**
 * Campos que el servidor lee del pedido: la oportunidad y la unidad (vacía
 * para quitar el vínculo). Organización, etapa y reloj nunca salen del
 * cliente.
 */
export const VEHICLE_LINK_FIELDS = {
  opportunityId: "opportunityId",
  vehicleId: "vehicleId",
} as const;

/** Qué hacer con un pedido, dado el estado actual de la oportunidad. */
export type VehicleLinkPlan =
  /** Escribir la unidad pedida (en lugar de la anterior, si había). */
  | Readonly<{
      kind: "link";
      vehicleId: string;
      previousVehicleId: string | null;
    }>
  /** Quitar la unidad vinculada. */
  | Readonly<{ kind: "unlink"; previousVehicleId: string }>
  /** Ya está así (p. ej. otra persona la vinculó antes). */
  | Readonly<{ kind: "unchanged"; vehicleId: string | null }>
  /** La etapa actual no admite cambiar la unidad. */
  | Readonly<{ kind: "stage_not_allowed"; stage: Stage }>
  /** La unidad no existe en la organización activa. */
  | Readonly<{ kind: "vehicle_not_found" }>
  /** La unidad existe, pero ya no está disponible. */
  | Readonly<{ kind: "vehicle_not_available" }>
  /** La unidad está disponible, pero no es un match de la demanda vigente. */
  | Readonly<{ kind: "not_a_match" }>;

export type VehicleLinkInput = Readonly<{
  /** Etapa actual de la oportunidad, leída de la fila bloqueada. */
  stage: Stage;
  /** Unidad vinculada hoy, leída de la misma fila. */
  currentVehicleId: string | null;
  /** Unidad pedida; null para quitar el vínculo. */
  requestedVehicleId: string | null;
  /**
   * La unidad pedida tal como la leyó el servidor en la organización activa
   * (cualquier estado), o null si no existe ahí.
   */
  vehicle: MatchableVehicle | null;
  /** Demanda vigente de la oportunidad. */
  demand: DemandSnapshot;
}>;

/**
 * Decide, sin tocar nada, qué pasa con un pedido de vinculación. Pedir lo
 * que ya está es idempotente (`unchanged`), aun en una etapa que no admite
 * cambios.
 */
export function planVehicleLink(input: VehicleLinkInput): VehicleLinkPlan {
  const { stage, currentVehicleId, requestedVehicleId, vehicle } = input;
  if (requestedVehicleId === currentVehicleId) {
    return { kind: "unchanged", vehicleId: currentVehicleId };
  }
  if (!canChangeVehicleLink(stage)) return { kind: "stage_not_allowed", stage };
  if (requestedVehicleId === null) {
    // requested !== current, así que había una unidad vinculada.
    return { kind: "unlink", previousVehicleId: currentVehicleId! };
  }
  if (vehicle === null || vehicle.id !== requestedVehicleId) {
    return { kind: "vehicle_not_found" };
  }
  if (vehicle.status !== "available") return { kind: "vehicle_not_available" };
  if (evaluateMatch(input.demand, vehicle) === null) {
    return { kind: "not_a_match" };
  }
  return {
    kind: "link",
    vehicleId: requestedVehicleId,
    previousVehicleId: currentVehicleId,
  };
}

/** Lo que se muestra de la unidad vinculada. */
export type LinkedVehicleCard = Readonly<{
  vehicleId: string;
  /** "Toyota Hilux". */
  name: string;
  /** Versión y año: "SRV 2.8 4x4 AT · 2025". */
  detail: string;
  /** "USD 49.900", o null si la unidad no tiene precio. */
  price: string | null;
  /** "0 km", o null sin dato. */
  km: string | null;
  status: VehicleStatus;
  /** "Disponible", "Reservado"… */
  statusLabel: string;
}>;

/** Unidad del stock → tarjeta de la unidad vinculada. Pura. */
export function linkedVehicleCard(
  vehicle: Readonly<{
    id: string;
    brand: string;
    model: string;
    version?: string;
    year: number;
    km?: number;
    price: Price | null;
    status: VehicleStatus;
  }>,
): LinkedVehicleCard {
  return {
    vehicleId: vehicle.id,
    name: vehicleName(vehicle),
    detail: vehicleDetail(vehicle),
    price: vehicle.price ? formatPrice(vehicle.price) : null,
    km: vehicle.km === undefined ? null : formatKm(vehicle.km),
    status: vehicle.status,
    statusLabel: vehicleStatusLabel(vehicle.status),
  };
}

"use client";

import { startTransition, useMemo, useOptimistic } from "react";

import {
  optimisticStatusOf,
  SALE_REQUIRES_CLOSURE_MESSAGE,
  transitionConflictMessage,
  transitionSuccessMessage,
  transitionUnchangedMessage,
  VEHICLE_CHANGE_FAILED_MESSAGE,
  VEHICLE_NOT_FOUND_MESSAGE,
  VEHICLE_STATUS_CHANGE_FIELDS,
  type StockTransitionId,
} from "@/domains/vehicles/lifecycle";
import { vehicleName, type VehicleStatus } from "@/domains/vehicles/stock";
import { changeVehicleStatus } from "@/lib/vehicles/actions";
import type { ChangeVehicleStatusState } from "@/lib/vehicles/status-change";

/*
 * Ciclo de vida de las unidades en la UI (Hito 19, propuesta DEC-051): el
 * estado optimista que comparten el Inventario (/stock) y el Catálogo
 * (/stock/catalog).
 *
 * - Al confirmar una transición, la unidad pasa al instante a su estado de
 *   destino (useOptimistic de React 19), marcada "Guardando…" y sin poder
 *   pedir otra transición hasta que el servidor responda.
 * - La Server Action changeVehicleStatus() decide sobre la fila bloqueada y
 *   revalida las vistas: la página revalidada reemplaza el estado optimista
 *   en la misma transición, sin parpadeo.
 * - Si el servidor no hizo el pase (otra persona la cambió, se vendió, no
 *   existe o falló), el estado optimista se descarta solo al terminar el
 *   pedido: la unidad vuelve a su estado real y el aviso dice qué pasó.
 *
 * No conoce la base: envía solo la unidad y la transición. El aviso lo
 * muestra quien lo usa (`onSettled`), donde mira el vendedor.
 */

type LifecycleUnit = Readonly<{
  id: string;
  brand: string;
  model: string;
  year: number;
  status: VehicleStatus;
}>;

export type LifecycleNotice = Readonly<{
  tone: "success" | "neutral" | "error";
  message: string;
  vehicleId: string;
}>;

type Pending = Readonly<{ vehicleId: string; transition: StockTransitionId }>;

type View<T> = Readonly<{ vehicles: readonly T[]; saving: readonly string[] }>;

/** La unidad como la nombran los avisos: "Toyota Hilux 2025". */
function unitLabel(unit: Pick<LifecycleUnit, "brand" | "model" | "year">) {
  return `${vehicleName(unit)} ${unit.year}`;
}

/** Qué dice la UI de una respuesta de changeVehicleStatus(). */
export function lifecycleNoticeOf(
  result: ChangeVehicleStatusState,
  unit: LifecycleUnit,
  transition: StockTransitionId,
): LifecycleNotice {
  const label = unitLabel(unit);
  const base = { vehicleId: unit.id };
  switch (result?.status) {
    case "changed":
      return {
        ...base,
        tone: "success",
        message: transitionSuccessMessage(result.transition, label),
      };
    case "unchanged":
      return {
        ...base,
        tone: "neutral",
        message: transitionUnchangedMessage(result.current, label),
      };
    case "conflict":
      return {
        ...base,
        tone: "error",
        message: transitionConflictMessage(transition, result.current, label),
      };
    case "sale_requires_closure":
      return { ...base, tone: "error", message: SALE_REQUIRES_CLOSURE_MESSAGE };
    case "not_found":
      return { ...base, tone: "error", message: VEHICLE_NOT_FOUND_MESSAGE };
    case "invalid":
    case "failed":
    case undefined:
      return { ...base, tone: "error", message: VEHICLE_CHANGE_FAILED_MESSAGE };
  }
}

export function useVehicleLifecycle<T extends LifecycleUnit>(
  vehicles: readonly T[],
  onSettled: (notice: LifecycleNotice) => void,
) {
  const base = useMemo<View<T>>(() => ({ vehicles, saving: [] }), [vehicles]);
  const [view, addPending] = useOptimistic(
    base,
    (current: View<T>, pending: Pending): View<T> => ({
      vehicles: current.vehicles.map((vehicle) =>
        vehicle.id === pending.vehicleId
          ? { ...vehicle, status: optimisticStatusOf(pending.transition) }
          : vehicle,
      ),
      saving: [...current.saving, pending.vehicleId],
    }),
  );
  const saving = useMemo(() => new Set(view.saving), [view.saving]);

  function run(unit: T, transition: StockTransitionId): void {
    if (saving.has(unit.id)) return;
    const formData = new FormData();
    formData.set(VEHICLE_STATUS_CHANGE_FIELDS.vehicleId, unit.id);
    formData.set(VEHICLE_STATUS_CHANGE_FIELDS.transition, transition);
    startTransition(async () => {
      addPending({ vehicleId: unit.id, transition });
      let result: ChangeVehicleStatusState;
      try {
        result = await changeVehicleStatus(null, formData);
      } catch {
        result = { status: "failed" };
      }
      onSettled(lifecycleNoticeOf(result, unit, transition));
    });
  }

  return { vehicles: view.vehicles, saving, run };
}

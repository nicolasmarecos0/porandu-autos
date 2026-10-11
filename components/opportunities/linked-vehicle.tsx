import { StatusChip } from "@/components/stock/stock-status";
import type { Stage } from "@/domains/opportunities/stages";
import type { LinkedVehicleCard } from "@/domains/opportunities/vehicle-link";

import { VehicleLinkButton } from "./vehicle-link";

/*
 * Unidad vinculada a la negociación en /opportunities/[id] (Hito 2, DEC-033
 * §2): la unidad del stock que se negocia con el cliente, arriba de los
 * matches.
 *
 * - En negociación se puede quitar el vínculo (la elección o el cambio se
 *   hacen desde las tarjetas de match).
 * - Ganada la muestra de solo lectura: es la unidad vendida, parte del
 *   cierre (DEC-034 §4). Perdida también: es la unidad que se negociaba.
 * - Si la unidad ya no está disponible, se dice con su estado de Stock.
 *
 * Vincular no cambia el stock: la unidad sigue disponible y Ganada no la
 * marca vendida. La copy lo dice para que nadie lo suponga.
 */

const TITLES: Readonly<Record<Stage, string>> = {
  new: "Unidad vinculada",
  qualifying: "Unidad vinculada",
  negotiating: "Unidad en negociación",
  won: "Unidad de la venta",
  lost: "Unidad que se negociaba",
};

const NOTES: Readonly<Partial<Record<Stage, string>>> = {
  negotiating: "Vincularla no la reserva: el stock no cambia.",
  won: "La venta y el estado Vendido de la unidad no se registran acá: el stock no cambia.",
};

export function LinkedVehicle({
  stage,
  linked,
  canChange,
}: {
  stage: Stage;
  linked: LinkedVehicleCard | null;
  canChange: boolean;
}) {
  if (!linked) {
    if (!canChange) return null;
    return (
      <section
        aria-label="Unidad en negociación"
        className="shrink-0 rounded-lg border border-dashed border-border-default bg-surface-1 p-4"
      >
        <h3 className="text-label font-semibold text-text-primary">
          {TITLES[stage]}
        </h3>
        <p className="mt-1 text-body text-text-secondary">
          Todavía no hay una unidad vinculada. Se elige desde los matches en
          stock.
        </p>
      </section>
    );
  }

  const note = NOTES[stage];
  return (
    <section
      aria-label={TITLES[stage]}
      className="shrink-0 rounded-lg border border-border-subtle bg-surface-1 p-4 shadow-card"
    >
      <header className="flex items-center gap-2">
        <h3 className="text-label font-semibold text-text-muted">
          {TITLES[stage]}
        </h3>
        {linked.status !== "available" ? (
          <span className="ml-auto">
            <StatusChip status={linked.status} />
          </span>
        ) : null}
      </header>
      <p className="mt-1 text-heading text-text-primary">{linked.name}</p>
      <p className="text-caption text-text-muted">{linked.detail}</p>
      <dl className="mt-3 grid grid-cols-[5.5rem_1fr] gap-x-2 gap-y-1 text-label">
        <dt className="text-text-muted">Precio</dt>
        <dd className="font-semibold text-text-primary tabular-nums">
          {linked.price ?? "Sin precio"}
        </dd>
        <dt className="text-text-muted">Km</dt>
        <dd className="text-text-primary tabular-nums">
          {linked.km ?? "Sin dato"}
        </dd>
      </dl>
      {note ? (
        <p className="mt-2 text-caption text-text-secondary">{note}</p>
      ) : null}
      {canChange ? (
        <div className="mt-3">
          <VehicleLinkButton vehicleId={null} vehicleName={linked.name} />
        </div>
      ) : null}
    </section>
  );
}

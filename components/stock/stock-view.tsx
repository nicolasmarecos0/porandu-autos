import type { ComponentProps } from "react";
import { PageHeader } from "@/components/shell/page-header";
import { WorkspaceLayout } from "@/components/shell/workspace-layout";
import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/ui/panel";
import {
  formatKm,
  formatPrice,
  vehicleName,
  vehicleStatusLabel,
  type StockVehicle,
  type VehicleStatus,
} from "@/domains/vehicles/stock";

/*
 * Stock List (H1.3A): las unidades de la organización activa, tal como las
 * trae el loader de la página (PostgreSQL, tenant-scoped), en una tabla
 * densa de solo lectura. Lo que la fuente no trae se dice "Sin dato"; no hay
 * fotos (las reales llegan con vehicle_media), matches ni interesados.
 */

type BadgeTone = NonNullable<ComponentProps<typeof Badge>["tone"]>;

const STATUS_TONE: Record<VehicleStatus, BadgeTone> = {
  inPreparation: "warning",
  available: "success",
  reserved: "brand",
  sold: "neutral",
};

/** Dato que la fuente todavía no trae. */
const NO_DATA = <span className="font-normal text-text-muted">Sin dato</span>;

function unitsLabel(count: number): string {
  return count === 1 ? "1 unidad" : `${count} unidades`;
}

type StockViewProps = {
  title: string;
  vehicles: readonly StockVehicle[];
};

export function StockView({ title, vehicles }: StockViewProps) {
  return (
    <WorkspaceLayout
      header={
        <PageHeader
          title={title}
          status={
            vehicles.length > 0 ? (
              <Badge>{unitsLabel(vehicles.length)}</Badge>
            ) : null
          }
        />
      }
    >
      {vehicles.length > 0 ? (
        <StockTable vehicles={vehicles} />
      ) : (
        <EmptyStock />
      )}
    </WorkspaceLayout>
  );
}

const HEAD_CELL = "px-4 py-2.5 text-overline font-semibold uppercase";
const CELL = "px-4 py-3 tabular-nums";

function StockTable({ vehicles }: { vehicles: readonly StockVehicle[] }) {
  return (
    <Panel>
      <div className="overflow-x-auto">
        <table className="w-full min-w-160 border-collapse text-body">
          <caption className="sr-only">Unidades en stock</caption>
          <thead className="bg-surface-inverse text-text-inverse-muted">
            <tr>
              <th scope="col" className={`${HEAD_CELL} text-left`}>
                Vehículo
              </th>
              <th scope="col" className={`${HEAD_CELL} text-right`}>
                Año
              </th>
              <th scope="col" className={`${HEAD_CELL} text-right`}>
                Km
              </th>
              <th scope="col" className={`${HEAD_CELL} text-right`}>
                Precio
              </th>
              <th scope="col" className={`${HEAD_CELL} text-left`}>
                Estado
              </th>
            </tr>
          </thead>
          <tbody>
            {vehicles.map((vehicle) => (
              <tr
                key={vehicle.id}
                className="border-t border-border-subtle first:border-t-0"
              >
                <th scope="row" className="px-4 py-3 text-left font-normal">
                  <span className="block font-semibold text-text-primary">
                    {vehicleName(vehicle)}
                  </span>
                  {vehicle.version ? (
                    <span className="block text-caption text-text-muted">
                      {vehicle.version}
                    </span>
                  ) : null}
                </th>
                <td className={`${CELL} text-right text-text-primary`}>
                  {vehicle.year}
                </td>
                <td className={`${CELL} text-right text-text-secondary`}>
                  {vehicle.km === undefined ? NO_DATA : formatKm(vehicle.km)}
                </td>
                <td
                  className={`${CELL} text-right font-semibold text-text-primary`}
                >
                  {vehicle.price ? formatPrice(vehicle.price) : NO_DATA}
                </td>
                <td className="px-4 py-3">
                  <Badge tone={STATUS_TONE[vehicle.status]}>
                    {vehicleStatusLabel(vehicle.status)}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

/** Organización sin vehículos: estado vacío, sin datos de ejemplo. */
function EmptyStock() {
  return (
    <div className="rounded-lg bg-surface-1 px-5 py-8 text-center shadow-card">
      <p className="text-heading text-text-primary">
        Todavía no hay vehículos en stock
      </p>
      <p className="mt-1 text-label text-text-muted">
        Las unidades de la organización van a aparecer acá con su estado, precio
        y kilometraje.
      </p>
    </div>
  );
}

import { pipelineColumnId } from "@/components/pipeline/links";
import { getNavItem } from "@/components/shell/navigation";
import type { FunnelStage } from "@/domains/cockpit/metrics";
import {
  metricsPeriodSearch,
  type MetricsPeriodKind,
} from "@/domains/cockpit/metrics-period";
import {
  catalogSearch,
  DEFAULT_CATALOG_FILTERS,
} from "@/domains/vehicles/catalog";
import type { VehicleStatus } from "@/domains/vehicles/stock";
import { COCKPIT_METRICS_PATH } from "@/lib/cockpit/paths";
import { OPPORTUNITIES_PATH, PIPELINE_PATH } from "@/lib/opportunities/paths";
import { STOCK_CATALOG_PATH, STOCK_PATH } from "@/lib/vehicles/paths";

/*
 * Enlaces de las Métricas del salón (propuesta DEC-050 §9): el período en
 * la URL y el drill-down de cada número hacia la superficie donde se actúa
 * (la cola, el embudo, la agenda o el catálogo). Se arman con las rutas y
 * los helpers de cada módulo, para que una ruta cambie en un solo lugar.
 */

/** La vista con el período elegido; el default no lleva parámetro. */
export function metricsPeriodHref(kind: MetricsPeriodKind): string {
  return `${COCKPIT_METRICS_PATH}${metricsPeriodSearch(kind)}`;
}

/** La cola operativa: ordena por urgencia y muestra la recencia (DEC-035). */
export const QUEUE_HREF = OPPORTUNITIES_PATH;

/** El embudo de ventas completo. */
export const PIPELINE_HREF = PIPELINE_PATH;

/** El embudo con la columna de la etapa a la vista (su id del DOM). */
export function pipelineStageHref(stage: FunnelStage): string {
  return `${PIPELINE_PATH}#${pipelineColumnId(stage)}`;
}

/** La agenda de pruebas de manejo, en la semana de hoy. */
export const CALENDAR_HREF = getNavItem("calendar").href;

/** El catálogo con su filtro por defecto: las disponibles. */
export const CATALOG_HREF = STOCK_CATALOG_PATH;

/**
 * Las unidades de un estado: el catálogo filtrado por ese estado (el mismo
 * `vehicles.status`, así que muestra las mismas unidades que cuenta la
 * métrica) o, para las que están en preparación, el Inventario: el
 * catálogo no las muestra (DEC-049 §2).
 */
export function stockStatusHref(status: VehicleStatus): string {
  if (status === "inPreparation") return STOCK_PATH;
  return `${STOCK_CATALOG_PATH}${catalogSearch({ ...DEFAULT_CATALOG_FILTERS, status })}`;
}

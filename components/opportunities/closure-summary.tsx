import { Panel, PanelHeader } from "@/components/ui/panel";
import type { ClosureSummary } from "@/domains/opportunities/closure";

import { StageBadge } from "./stage-badge";

/*
 * Tarjeta "Cierre" de /opportunities/[id] (DEC-034 §11): cómo se cerró una
 * oportunidad ganada o perdida.
 *
 *   ┌ Cierre ─────────────────────────────── [Ganada] ┐
 *   │ Precio final   USD 47.500                       │
 *   │ Forma de pago  Financiación                     │
 *   │ Entrega        Programada para el 15 oct 2026   │
 *   │ Unidad         Toyota Hilux                     │
 *   │ Los datos del cierre no se pueden modificar.    │
 *   └─────────────────────────────────────────────────┘
 *
 * Server Component, de solo lectura: el resumen llega armado del servidor
 * (precio con su moneda, sin pasar por float; fechas de calendario de
 * Asunción). Los metadatos son inmutables (DEC-034 §4), así que no ofrece
 * acciones.
 */

export function ClosureSummaryCard({
  closure,
  vehicleName,
}: {
  closure: ClosureSummary;
  /** La unidad vendida (la vinculada), si es una venta. */
  vehicleName: string | null;
}) {
  const rows: [string, string][] =
    closure.outcome === "won"
      ? [
          ["Precio final", closure.salePrice],
          ["Forma de pago", closure.paymentMethod],
          ["Entrega", closure.delivery],
          ...(vehicleName ? [["Unidad", vehicleName] as [string, string]] : []),
        ]
      : [["Motivo", closure.reason]];

  return (
    <section aria-labelledby="closure-heading" className="max-w-3xl">
      <Panel>
        <PanelHeader>
          <h2 id="closure-heading" className="text-heading text-text-primary">
            Cierre
          </h2>
          <span className="ml-auto">
            <StageBadge stage={closure.outcome} />
          </span>
        </PanelHeader>
        <div className="flex flex-col gap-3 px-4 py-3.5">
          <dl className="grid grid-cols-[7.5rem_1fr] gap-x-3 gap-y-1.5 text-label">
            {rows.map(([term, value]) => (
              <div key={term} className="contents">
                <dt className="text-text-muted">{term}</dt>
                <dd className="font-semibold text-text-primary tabular-nums">
                  {value}
                </dd>
              </div>
            ))}
            {closure.outcome === "lost" ? (
              <div className="contents">
                <dt className="text-text-muted">Notas</dt>
                <dd className="text-body whitespace-pre-line text-text-primary">
                  {closure.notes ?? (
                    <span className="text-text-muted">Sin notas</span>
                  )}
                </dd>
              </div>
            ) : null}
          </dl>
          <p className="text-caption text-text-secondary">
            {closure.outcome === "won"
              ? "La venta y el estado Vendido de la unidad no se registran acá: el stock no cambia. Los datos del cierre no se pueden modificar."
              : "Los datos del cierre no se pueden modificar."}
          </p>
        </div>
      </Panel>
    </section>
  );
}

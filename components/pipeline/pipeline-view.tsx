import type { PipelineBoard as PipelineBoardModel } from "@/domains/opportunities/pipeline";

import { PipelineBoard } from "./pipeline-board";

/*
 * Embudo de ventas (Pipeline como vista de Opportunities, DEC-001 y B1 §4;
 * propuesta DEC-048): una columna por etapa de DEC-032, de punta a punta de
 * la pantalla, con scroll propio en cada columna.
 *
 *   ┌ Embudo de ventas [Cola|Embudo] ─────────────── [+ Nueva oportunidad] ┐
 *   │ 24 abiertas · ● 5 inactivas · ● 3 con acciones pendientes · 14:32    │
 *   ├ (debajo de xl) Nueva 8 · En calificación 9 · En negociación 7 · …    ┤
 *   │ Nueva      │ En calif.  │ En negoc.  │ Ganada     │ Perdida          │
 *   │ ▢ tarjeta  │ ▢ tarjeta  │ ▢ tarjeta  │ ✓ tarjeta  │ ✕ tarjeta        │
 *   └────────────┴────────────┴────────────┴────────────┴──────────────────┘
 *
 * Desde `xl` entran las cinco columnas. Debajo, el tablero se recorre de a
 * una columna con scroll horizontal y snap (en el teléfono, cada columna
 * ocupa casi todo el ancho y asoma la siguiente), con la tira de etapas
 * para saltar a cualquiera. Mover se puede arrastrando (mantener presionado
 * en el teléfono) o con "Mover a…" en cada tarjeta.
 */

export function PipelineView({
  title,
  board,
}: {
  title: string;
  board: PipelineBoardModel;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PipelineBoard title={title} board={board} />
    </div>
  );
}

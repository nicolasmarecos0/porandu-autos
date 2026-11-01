import { formatDemandDate } from "@/domains/demand/presentation";
import { stageLabel } from "@/domains/opportunities/labels";
import type { Stage } from "@/domains/opportunities/stages";

/*
 * Oportunidad de una conversación (Hito 12, DEC-044 §4). La asociación la
 * decide la base al registrar cada mensaje (DEC-039 §9, DEC-040 §6): un
 * mensaje se asocia a la oportunidad abierta del contacto cuando hay
 * exactamente una; con ninguna o con varias queda solo en la conversación.
 * Una vez registrado no cambia: los mensajes son append-only (C-11).
 *
 * Este módulo arma lo que el encabezado del historial le dice al vendedor:
 * a qué oportunidad se suma lo que responda ahora. Puro: no decide la
 * asociación ni la adivina cuando hay varias abiertas.
 */

/**
 * Etapas de una oportunidad abierta, la única que recibe mensajes. Espeja
 * el `stage IN ('new', 'qualifying', 'negotiating')` de las funciones de
 * ingesta y envío (0013, 0014); un test la cruza con las no terminales.
 */
export const LINKABLE_STAGES = [
  "new",
  "qualifying",
  "negotiating",
] as const satisfies readonly Stage[];

/** Cuántas oportunidades abiertas lista el encabezado cuando hay varias. */
export const OPPORTUNITY_LINK_LIMIT = 5;

/** Una oportunidad abierta del contacto, tal como la lee la capa de datos. */
export type LinkCandidateRow = Readonly<{
  id: string;
  stage: Stage;
  lastActivityAt: Date;
}>;

/** Una oportunidad del encabezado, lista para mostrar. */
export type LinkedOpportunity = Readonly<{
  id: string;
  href: string;
  /** "En negociación". */
  stage: string;
  /** Última actividad, de Asunción: "29 oct 2026 14:32". */
  lastActivity: string;
}>;

export type ConversationOpportunity =
  /** Sin oportunidad abierta: los mensajes quedan solo en la conversación. */
  | Readonly<{ kind: "none" }>
  /** Una sola abierta: los mensajes se suman a su actividad. */
  | Readonly<{ kind: "linked"; opportunity: LinkedOpportunity }>
  /** Varias abiertas: no se asocian a ninguna. */
  | Readonly<{
      kind: "ambiguous";
      /** Todas las abiertas, también las que no se listan. */
      total: number;
      /** Las de actividad más reciente, a lo sumo OPPORTUNITY_LINK_LIMIT. */
      opportunities: readonly LinkedOpportunity[];
    }>;

export function opportunityHref(id: string): string {
  return `/opportunities/${encodeURIComponent(id)}`;
}

export function isLinkableStage(stage: Stage): boolean {
  return (LINKABLE_STAGES as readonly Stage[]).includes(stage);
}

function linkedOpportunity(row: LinkCandidateRow): LinkedOpportunity {
  return {
    id: row.id,
    href: opportunityHref(row.id),
    stage: stageLabel(row.stage),
    lastActivity: formatDemandDate(row.lastActivityAt),
  };
}

/**
 * La oportunidad de la conversación a partir de las abiertas del contacto
 * (`rows`) y de cuántas hay en total (`total`, también las que la capa de
 * datos no trajo). Una fila cerrada se ignora. Con varias, de la actividad
 * más reciente a la más vieja, con desempate por id.
 */
export function conversationOpportunity(
  rows: readonly LinkCandidateRow[],
  total: number,
): ConversationOpportunity {
  const open = rows
    .filter((row) => isLinkableStage(row.stage))
    .toSorted(
      (a, b) =>
        b.lastActivityAt.getTime() - a.lastActivityAt.getTime() ||
        a.id.localeCompare(b.id),
    );
  const [first] = open;
  if (first === undefined) return { kind: "none" };
  const count = Math.max(total, open.length);
  if (count === 1) {
    return { kind: "linked", opportunity: linkedOpportunity(first) };
  }
  return {
    kind: "ambiguous",
    total: count,
    opportunities: open.slice(0, OPPORTUNITY_LINK_LIMIT).map(linkedOpportunity),
  };
}

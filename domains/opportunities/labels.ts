import { type LossReason, type Stage, LOSS_REASONS } from "./stages";
import type { Bucket, Channel, OpportunitySource } from "./types";

/* Copy visible (es-PY) de los estados de una oportunidad. */

/** Etapas del ciclo comercial (H1.6, DEC-032 §1), en el orden del flujo. */
export const STAGES: readonly { id: Stage; label: string; hint: string }[] = [
  { id: "new", label: "Nueva", hint: "Consulta nueva, sin calificar" },
  {
    id: "qualifying",
    label: "En calificación",
    hint: "Relevando qué busca el cliente",
  },
  {
    id: "negotiating",
    label: "En negociación",
    hint: "Propuesta activa",
  },
  { id: "won", label: "Ganada", hint: "Venta concretada" },
  { id: "lost", label: "Perdida", hint: "Oportunidad descartada" },
];

export function stageLabel(stage: Stage): string {
  return STAGES.find((item) => item.id === stage)?.label ?? stage;
}

/**
 * Acción que lleva una oportunidad a `to`: el texto del botón. Pasar a
 * `lost` y a `won` cierra la oportunidad.
 */
export const STAGE_ACTION_LABELS: Readonly<
  Record<Exclude<Stage, "new">, string>
> = {
  qualifying: "Pasar a calificación",
  negotiating: "Pasar a negociación",
  won: "Marcar como ganada",
  lost: "Marcar como perdida",
};

/** Motivos de pérdida (H1.6, DEC-032 §3), en el orden en que se ofrecen. */
export const LOSS_REASON_LABELS: Readonly<Record<LossReason, string>> = {
  price: "Precio",
  vehicle_not_available: "Unidad no disponible",
  bought_elsewhere: "Compró en otro lado",
  no_response: "Sin respuesta",
  unqualified: "No calificaba",
  other: "Otro motivo",
};

/** Motivos válidos, en el orden en que se ofrecen al cerrar una oportunidad. */
export const LOSS_REASON_OPTIONS: readonly {
  id: LossReason;
  label: string;
}[] = LOSS_REASONS.map((id) => ({ id, label: LOSS_REASON_LABELS[id] }));

export const BUCKETS: readonly { id: Bucket; label: string }[] = [
  { id: "now", label: "Actuar ahora" },
  { id: "today", label: "Durante el día" },
  { id: "followUp", label: "En seguimiento" },
];

/** Copy del origen de una oportunidad (el canal que muestra la UI). */
export const SOURCE_LABELS: Readonly<Record<OpportunitySource, Channel>> = {
  whatsapp: "WhatsApp",
  meta_ads: "Meta Ads",
  web: "Web",
  showroom: "Showroom",
  referral: "Referido",
};

/** Orígenes válidos, en el orden en que se ofrecen al cargar una oportunidad. */
export const SOURCES: readonly OpportunitySource[] = [
  "whatsapp",
  "meta_ads",
  "web",
  "showroom",
  "referral",
];

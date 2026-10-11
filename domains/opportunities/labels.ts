import type { DeliveryStatus, LossReason, PaymentMethod } from "./closure";
import type { Stage } from "./stages";
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

/*
 * Metadatos de un cierre (DEC-034), en el orden en que se ofrecen. Las
 * listas de opciones las arma `./closure`, dueño de los valores.
 */

/** Motivos de pérdida (DEC-034 §2). */
export const LOSS_REASON_LABELS: Readonly<Record<LossReason, string>> = {
  price: "Precio",
  vehicle_unavailable: "Unidad no disponible",
  competitor: "Compró en la competencia",
  financing_rejected: "Financiación rechazada",
  ghosted: "Dejó de responder",
  other: "Otro motivo",
};

/** Formas de pago de una venta (DEC-034 §3). */
export const PAYMENT_METHOD_LABELS: Readonly<Record<PaymentMethod, string>> = {
  cash: "Contado",
  financing: "Financiación",
  trade_in: "Usado como parte de pago",
  mixed: "Mixto",
};

/** Estado de la entrega al cerrar la venta (DEC-034 §3). */
export const DELIVERY_STATUS_LABELS: Readonly<Record<DeliveryStatus, string>> =
  {
    scheduled: "Entrega programada",
    delivered: "Entregada",
  };

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

import type { Bucket, Channel, OpportunitySource, Stage } from "./types";

/* Copy visible (es-PY) de los estados de una oportunidad. */

export const STAGES: readonly { id: Stage; label: string }[] = [
  { id: "new", label: "Nuevo" },
  { id: "qualified", label: "Calificado" },
  { id: "testDrive", label: "Test drive" },
  { id: "negotiation", label: "Negociación" },
];

export function stageLabel(stage: Stage): string {
  return STAGES.find((item) => item.id === stage)?.label ?? stage;
}

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

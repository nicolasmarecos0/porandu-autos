import type { Bucket, Stage } from "./types";

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

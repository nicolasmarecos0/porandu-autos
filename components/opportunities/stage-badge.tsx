import type { ComponentProps } from "react";
import { Badge } from "@/components/ui/badge";
import { stageLabel } from "@/domains/opportunities/labels";
import type { Stage } from "@/domains/opportunities/stages";

/*
 * Etapa de una oportunidad (H1.6) como badge: el mismo color en el
 * encabezado y en el panel de etapa. El color acompaña a la etiqueta, nunca
 * la reemplaza.
 */

type Tone = NonNullable<ComponentProps<typeof Badge>["tone"]>;

export const STAGE_TONES: Readonly<Record<Stage, Tone>> = {
  new: "neutral",
  qualifying: "brand",
  negotiating: "warning",
  won: "success",
  lost: "danger",
};

export function StageBadge({ stage }: { stage: Stage }) {
  return <Badge tone={STAGE_TONES[stage]}>{stageLabel(stage)}</Badge>;
}

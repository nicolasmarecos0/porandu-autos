import { Badge } from "@/components/ui/badge";
import {
  RECENCY_STATE_LABELS,
  type RecencyState,
} from "@/domains/scoring/types";

/** Tono de cada estado: verde activa, ámbar enfriándose, rojo inactiva. */
export const RECENCY_TONES = {
  active: "success",
  warning: "warning",
  stale: "danger",
} as const satisfies Record<RecencyState, "success" | "warning" | "danger">;

/**
 * Estado de recencia del motor de inteligencia (DEC-035): cuánto hace que el
 * cliente no interactúa. El color acompaña al texto ("Activa", "Enfriándose",
 * "Inactiva"), nunca lo reemplaza.
 */
export function RecencyStatus({
  state,
  elapsed,
}: {
  state: RecencyState;
  /** Tiempo transcurrido ya formateado ("2 h", "ayer", "6 d"). */
  elapsed?: string;
}) {
  return (
    <Badge tone={RECENCY_TONES[state]} className="font-semibold">
      <span
        aria-hidden="true"
        className="size-1.5 shrink-0 rounded-full bg-current"
      />
      {RECENCY_STATE_LABELS[state]}
      {elapsed ? <span className="font-normal">· {elapsed}</span> : null}
    </Badge>
  );
}

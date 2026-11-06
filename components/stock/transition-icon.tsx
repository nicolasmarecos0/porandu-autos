import { CheckIcon, LockIcon, UndoIcon } from "@/components/ui/icons";
import type { StockTransitionId } from "@/domains/vehicles/lifecycle";

/*
 * Ícono de cada transición de Stock (Hito 19, DEC-051), siempre
 * junto a su texto (DEC-013): poner en el salón confirma la unidad, reservar
 * la aparta (candado) y liberar deshace la reserva.
 */
export function TransitionIcon({
  transition,
  className,
}: {
  transition: StockTransitionId;
  className?: string;
}) {
  const props = { "aria-hidden": true, className } as const;
  switch (transition) {
    case "put_on_floor":
      return <CheckIcon {...props} strokeWidth={2.25} />;
    case "reserve":
      return <LockIcon {...props} />;
    case "release":
      return <UndoIcon {...props} />;
  }
}

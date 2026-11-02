import { cn } from "@/components/ui/cn";
import { AlertIcon, CheckIcon, CloseIcon } from "@/components/ui/icons";
import {
  TEST_DRIVE_STATUS_LABELS,
  type TestDriveStatus,
} from "@/domains/calendar/test-drives";

/*
 * Lenguaje de estado de la agenda (Hito 9, DEC-041 §4; Hito 13, DEC-045 §5),
 * con los tokens de DEC-013. El color nunca es la única señal: cada estado
 * tiene además su forma (TestDriveStatusGlyph), que se lee también en un
 * bloque angosto de la grilla, y cada chip lleva su etiqueta.
 * - Agendada: neutra y con anillo: todavía sin confirmar con el cliente.
 * - Confirmada: marca y punto lleno: el cliente dijo que viene.
 * - Realizada: verde, con tilde.
 * - No asistió: ámbar, con alerta: una alerta comercial.
 * - Cancelada: gris, cruz, contorno punteado y hora tachada: nunca se lee
 *   como activa.
 */

/** Canto izquierdo de la tarjeta y del bloque; segmento del medidor. */
export const TEST_DRIVE_EDGE: Readonly<Record<TestDriveStatus, string>> = {
  scheduled: "bg-border-strong",
  confirmed: "bg-brand",
  completed: "bg-success",
  no_show: "bg-warning",
  cancelled: "bg-border-default",
};

export const TEST_DRIVE_TEXT: Readonly<Record<TestDriveStatus, string>> = {
  scheduled: "text-text-primary",
  confirmed: "text-brand-strong",
  completed: "text-success",
  no_show: "text-warning",
  cancelled: "text-text-muted",
};

/** Bloque de la grilla horaria: relleno suave y borde del estado. */
export const TEST_DRIVE_BLOCK: Readonly<Record<TestDriveStatus, string>> = {
  scheduled: "border-border-default bg-surface-1",
  confirmed: "border-brand-border bg-brand-soft",
  completed: "border-success-border bg-success-soft",
  no_show: "border-warning-border bg-warning-soft",
  cancelled: "border-dashed border-border-strong bg-surface-2",
};

const CHIP: Readonly<Record<TestDriveStatus, string>> = {
  scheduled: "border-border-default bg-surface-2 text-text-secondary",
  confirmed: "border-brand-border bg-brand-soft text-brand-strong",
  completed: "border-success-border bg-success-soft text-success",
  no_show: "border-warning-border bg-warning-soft text-warning",
  cancelled:
    "border-dashed border-border-strong bg-transparent text-text-muted",
};

/**
 * Forma de cada estado, en el color del texto que la rodea. Decorativa: el
 * estado siempre se dice también en texto (visible o para lectores de
 * pantalla).
 */
export function TestDriveStatusGlyph({
  status,
  className,
}: {
  status: TestDriveStatus;
  className?: string;
}) {
  switch (status) {
    case "scheduled":
      return (
        <span
          aria-hidden="true"
          className={cn(
            "size-2 shrink-0 rounded-full border-[1.5px] border-current",
            className,
          )}
        />
      );
    case "confirmed":
      return (
        <span
          aria-hidden="true"
          className={cn("size-2 shrink-0 rounded-full bg-current", className)}
        />
      );
    case "completed":
      return (
        <CheckIcon
          className={cn("size-3 shrink-0", className)}
          strokeWidth={2.5}
        />
      );
    case "no_show":
      return (
        <AlertIcon
          className={cn("size-3 shrink-0", className)}
          strokeWidth={2.25}
        />
      );
    case "cancelled":
      return (
        <CloseIcon
          className={cn("size-3 shrink-0", className)}
          strokeWidth={2.5}
        />
      );
  }
}

export function TestDriveStatusChip({ status }: { status: TestDriveStatus }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-sm border px-2 text-caption font-semibold whitespace-nowrap",
        CHIP[status],
      )}
    >
      <TestDriveStatusGlyph status={status} />
      {TEST_DRIVE_STATUS_LABELS[status]}
    </span>
  );
}

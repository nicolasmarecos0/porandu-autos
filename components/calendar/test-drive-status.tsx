import { cn } from "@/components/ui/cn";
import { CheckIcon, CloseIcon } from "@/components/ui/icons";
import {
  TEST_DRIVE_STATUS_LABELS,
  type TestDriveStatus,
} from "@/domains/calendar/test-drives";

/*
 * Lenguaje de estado de la agenda (Hito 9, DEC-041 §4), con los tokens de
 * DEC-013. El color nunca es la única señal: cada chip lleva su etiqueta.
 * - Agendada: neutra, todavía sin confirmar con el cliente.
 * - Confirmada: marca, el cliente dijo que viene.
 * - Realizada: verde, con check.
 * - No asistió: ámbar, una alerta comercial.
 * - Cancelada: gris, contorno punteado y cruz: nunca se lee como activa.
 */

export const TEST_DRIVE_DOT: Readonly<Record<TestDriveStatus, string>> = {
  scheduled: "bg-text-muted",
  confirmed: "bg-brand",
  completed: "bg-success",
  no_show: "bg-warning",
  cancelled: "bg-border-strong",
};

/** Canto izquierdo de la tarjeta. */
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

const CHIP: Readonly<Record<TestDriveStatus, string>> = {
  scheduled: "border-border-default bg-surface-2 text-text-secondary",
  confirmed: "border-brand-border bg-brand-soft text-brand-strong",
  completed: "border-success-border bg-success-soft text-success",
  no_show: "border-warning-border bg-warning-soft text-warning",
  cancelled:
    "border-dashed border-border-strong bg-transparent text-text-muted",
};

export function TestDriveStatusChip({ status }: { status: TestDriveStatus }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-sm border px-2 text-caption font-semibold whitespace-nowrap",
        CHIP[status],
      )}
    >
      {status === "completed" ? (
        <CheckIcon className="size-3" strokeWidth={2.25} />
      ) : status === "cancelled" ? (
        <CloseIcon className="size-3" strokeWidth={2.25} />
      ) : (
        <span
          aria-hidden="true"
          className={cn("size-1.5 rounded-full", TEST_DRIVE_DOT[status])}
        />
      )}
      {TEST_DRIVE_STATUS_LABELS[status]}
    </span>
  );
}

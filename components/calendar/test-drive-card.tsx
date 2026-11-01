"use client";

import Link from "next/link";
import { useActionState, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import {
  ConfirmDialog,
  ConfirmDialogCancel,
  ConfirmDialogContent,
} from "@/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ChevronRightIcon,
  MoreIcon,
  SteeringIcon,
} from "@/components/ui/icons";
import type { AgendaItem } from "@/domains/calendar/agenda";
import {
  STATUS_CHANGE_FIELDS,
  TEST_DRIVE_ACTION_LABELS,
  TEST_DRIVE_STATUS_LABELS,
  type TestDriveStatus,
} from "@/domains/calendar/test-drives";
import { changeTestDriveStatus } from "@/lib/calendar/actions";
import type { ChangeTestDriveStatusState } from "@/lib/calendar/requests";

import {
  TEST_DRIVE_EDGE,
  TEST_DRIVE_TEXT,
  TestDriveStatusChip,
} from "./test-drive-status";

/*
 * Tarjeta de una prueba de manejo en la agenda (Hito 9, DEC-041 §4): hora,
 * cliente (lleva a su oportunidad), unidad, estado y, si la prueba sigue
 * abierta, el menú de acciones. Cada cambio de estado pasa por una
 * confirmación breve: tiene significado comercial y los estados terminales
 * no se reabren.
 *
 * No conoce la base: envía id, estado de partida y destino a la Server
 * Action changeTestDriveStatus(), que vuelve a validar todo. Con una
 * respuesta definitiva la confirmación se cierra y la página ya está
 * revalidada; una falla la deja abierta, con lo que pasó, para reintentar.
 */

type StatusCopy = Readonly<{ title: string; description: string; cta: string }>;

const CONFIRM_COPY: Readonly<
  Record<Exclude<TestDriveStatus, "scheduled">, StatusCopy>
> = {
  confirmed: {
    title: "Confirmar prueba de manejo",
    description: "Registrá que el cliente confirmó que viene.",
    cta: "Confirmar",
  },
  completed: {
    title: "Marcar prueba como realizada",
    description: "El cliente hizo la prueba. No se puede deshacer.",
    cta: "Marcar realizada",
  },
  no_show: {
    title: "Marcar que el cliente no asistió",
    description:
      "La prueba queda cerrada como no asistió. No se puede deshacer.",
    cta: "Marcar no asistió",
  },
  cancelled: {
    title: "Cancelar prueba de manejo",
    description:
      "La prueba queda cancelada. Para reprogramarla, agendá una nueva.",
    cta: "Cancelar prueba",
  },
};

const RESULT_MESSAGES: Partial<
  Record<NonNullable<ChangeTestDriveStatusState>["status"], string>
> = {
  not_found: "No encontramos la prueba. Puede que ya no exista.",
  invalid_transition: "Ese cambio ya no está disponible para esta prueba.",
  not_started:
    "Todavía no llegó la hora agendada: solo se puede confirmar o cancelar.",
  failed:
    "No pudimos guardar el cambio. No se modificó nada: intentá de nuevo en unos minutos.",
};

export function TestDriveCard({ item }: { item: AgendaItem }) {
  const [target, setTarget] = useState<TestDriveStatus | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Falla del intento en curso: se limpia al abrir otra confirmación.
  const [failure, setFailure] = useState<string | null>(null);
  const settled = useRef(false);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);

  const [, action, pending] = useActionState<
    ChangeTestDriveStatusState,
    FormData
  >(async (previous, formData) => {
    const result = await changeTestDriveStatus(previous, formData);
    if (result?.status === "changed") {
      settled.current = true;
      setTarget(null);
      setNotice(null);
    } else if (result?.status === "unchanged") {
      settled.current = true;
      setTarget(null);
      setNotice(
        `Otra persona ya la había movido: está ${TEST_DRIVE_STATUS_LABELS[
          result.current
        ].toLowerCase()}.`,
      );
    } else if (result !== null) {
      setFailure(RESULT_MESSAGES[result.status] ?? null);
    }
    return result;
  }, null);

  const errorMessage = pending ? null : failure;
  const copy =
    target && target !== "scheduled" ? CONFIRM_COPY[target] : undefined;
  const cancelled = item.status === "cancelled";

  return (
    <article
      aria-label={`Prueba de manejo de ${item.contactName}, ${item.whenLabel}`}
      className="group/card relative flex overflow-hidden rounded-md border border-border-subtle bg-surface-1 shadow-card transition-[border-color,box-shadow] duration-150 ease-out-strong hover:border-border-default hover:shadow-md"
    >
      <span
        aria-hidden="true"
        className={cn("w-1 shrink-0", TEST_DRIVE_EDGE[item.status])}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-2 px-3 py-2.5">
        <div className="flex items-start justify-between gap-2">
          <time
            dateTime={item.scheduledAtIso}
            className={cn(
              "text-heading tabular-nums",
              TEST_DRIVE_TEXT[item.status],
              cancelled && "line-through decoration-1",
            )}
          >
            {item.timeLabel}
          </time>
          {item.transitions.length > 0 ? (
            // No modal: la confirmación que abre un ítem es su propio modal.
            // Con dos modales encadenados, Radix deja el body sin
            // pointer-events al cerrar la confirmación.
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <button
                  ref={menuTriggerRef}
                  type="button"
                  aria-label={`Acciones de la prueba de ${item.contactName}`}
                  className="-mt-0.5 -mr-1.5 flex size-7 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-2 hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring data-[state=open]:bg-surface-2 data-[state=open]:text-text-primary"
                >
                  <MoreIcon className="size-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuLabel>Cambiar estado</DropdownMenuLabel>
                {item.transitions.map((to) =>
                  to === "scheduled" ? null : (
                    <DropdownMenuItem
                      key={to}
                      tone={to === "cancelled" ? "danger" : "neutral"}
                      onSelect={() => {
                        settled.current = false;
                        setFailure(null);
                        setTarget(to);
                      }}
                    >
                      {TEST_DRIVE_ACTION_LABELS[to]}
                    </DropdownMenuItem>
                  ),
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>

        <div className="min-w-0">
          <Link
            href={`/opportunities/${item.opportunityId}`}
            className="group/link inline-flex max-w-full items-center gap-0.5 rounded-sm text-body font-semibold text-text-primary hover:text-brand-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            <span className="truncate">{item.contactName}</span>
            <ChevronRightIcon
              aria-hidden="true"
              className="size-3.5 shrink-0 text-text-muted transition-transform duration-150 ease-out-strong group-hover/link:translate-x-0.5 motion-reduce:transition-none"
            />
          </Link>
          <p className="mt-0.5 flex items-start gap-1.5 text-label text-text-secondary">
            <SteeringIcon
              aria-hidden="true"
              className="mt-px size-3.5 shrink-0 text-text-muted"
            />
            <span className="line-clamp-2 [font-feature-settings:'calt'_0] break-words">
              {item.vehicleLabel}
            </span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <TestDriveStatusChip status={item.status} />
          {item.overlaps ? (
            <span className="inline-flex h-6 items-center rounded-sm border border-warning-border bg-warning-soft px-2 text-caption font-semibold text-warning">
              Unidad superpuesta
            </span>
          ) : null}
        </div>

        <p className="text-caption text-text-muted">
          Agendó: {item.scheduledByLabel}
        </p>

        {notice ? (
          <p
            role="status"
            className="rounded-sm border border-brand-border bg-brand-soft px-2 py-1.5 text-caption text-brand-strong"
          >
            {notice}
          </p>
        ) : null}
      </div>

      <ConfirmDialog
        open={target !== null}
        onOpenChange={(next) => {
          if (!next && pending) return;
          if (!next) setTarget(null);
        }}
      >
        {copy && target ? (
          <ConfirmDialogContent
            title={copy.title}
            description={copy.description}
            onEscapeKeyDown={(event) => {
              if (pending) event.preventDefault();
            }}
            onCloseAutoFocus={(event) => {
              // Tras un cambio, la tarjeta se vuelve a renderizar con su
              // estado nuevo: el foco vuelve al menú si sigue existiendo.
              event.preventDefault();
              if (settled.current) menuTriggerRef.current?.focus();
            }}
          >
            <form action={action} aria-busy={pending}>
              <input
                type="hidden"
                name={STATUS_CHANGE_FIELDS.testDriveId}
                value={item.id}
              />
              <input
                type="hidden"
                name={STATUS_CHANGE_FIELDS.from}
                value={item.status}
              />
              <input
                type="hidden"
                name={STATUS_CHANGE_FIELDS.to}
                value={target}
              />
              <div className="flex flex-col gap-3 px-5 pb-5">
                <div className="flex flex-col gap-2.5 rounded-md border border-border-subtle bg-surface-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-label text-text-primary">
                      {item.contactName}
                    </p>
                    <p className="text-caption text-text-muted first-letter:uppercase">
                      {item.whenLabel} · {item.vehicleLabel}
                    </p>
                  </div>
                  <p className="flex shrink-0 items-center gap-1">
                    <span className="sr-only">Pasa de</span>
                    <TestDriveStatusChip status={item.status} />
                    <span className="sr-only">a</span>
                    <ChevronRightIcon
                      aria-hidden="true"
                      className="size-3.5 text-text-muted"
                    />
                    <TestDriveStatusChip status={target} />
                  </p>
                </div>
                {errorMessage ? (
                  <p
                    role="alert"
                    className="rounded-md border border-danger-border bg-danger-soft px-3 py-2 text-label text-danger"
                  >
                    {errorMessage}
                  </p>
                ) : null}
              </div>
              <footer className="flex justify-end gap-2 rounded-b-lg border-t border-border-subtle bg-surface-2 px-5 py-3">
                <ConfirmDialogCancel asChild>
                  <Button variant="secondary" disabled={pending}>
                    Volver
                  </Button>
                </ConfirmDialogCancel>
                <Button
                  type="submit"
                  variant={target === "cancelled" ? "danger" : "primary"}
                  disabled={pending}
                  className="disabled:cursor-wait disabled:opacity-70"
                >
                  {pending ? "Guardando…" : copy.cta}
                </Button>
              </footer>
            </form>
          </ConfirmDialogContent>
        ) : null}
      </ConfirmDialog>
    </article>
  );
}

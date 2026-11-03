"use client";

import { useRouter } from "next/navigation";
import {
  useActionState,
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
  type RefObject,
} from "react";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { FormField, inputClassName } from "@/components/ui/form-field";
import { PlusIcon } from "@/components/ui/icons";
import type {
  ScheduleOpportunityOption,
  ScheduleVehicleOption,
} from "@/domains/calendar/agenda";
import {
  CALENDAR_TIME_ZONE,
  SCHEDULE_FIELDS,
  SCHEDULE_HORIZON_DAYS,
  toLocalDateTime,
  type ScheduleField,
} from "@/domains/calendar/test-drives";
import { WEEK_PARAM } from "@/domains/calendar/week";
import { isoDate, zonedDate } from "@/domains/calendar/zoned-time";
import { scheduleTestDrive } from "@/lib/calendar/actions";
import type {
  ScheduleFieldError,
  ScheduleTestDriveState,
} from "@/lib/calendar/requests";

import { SCHEDULE_VEHICLE_PARAM } from "./links";
import { TestDriveStatusChip } from "./test-drive-status";

/*
 * Agendar una prueba de manejo (Hito 9, DEC-041 §3): botón "Agendar prueba"
 * y drawer lateral con el formulario corto. No conoce la base: envía el
 * formulario a la Server Action scheduleTestDrive(), que valida en el
 * servidor y crea la prueba agendada en la organización activa.
 *
 * El formulario solo trae la oportunidad, la unidad y la hora (de
 * Asunción): ni organización, ni estado, ni autor. El estado inicial se
 * muestra, pero no se elige. Mientras guarda no se puede cerrar ni
 * reenviar. Un error deja lo cargado para corregir o reintentar; al
 * agendar, el drawer se cierra y la agenda salta a la semana de la prueba.
 * Agendar no le envía nada al cliente.
 *
 * Atajo del catálogo (propuesta DEC-049): con `initialVehicleId` (una de las
 * opciones, `?schedule=`), el drawer llega abierto con esa unidad elegida y
 * el foco en el cliente. Es solo una preselección: se puede cambiar, y al
 * cerrarlo el parámetro sale de la URL para que recargar no lo reabra.
 */

type ScheduleTestDriveDrawerProps = {
  opportunities: readonly ScheduleOpportunityOption[];
  vehicles: readonly ScheduleVehicleOption[];
  /** `now` del request (ISO), para el mínimo y el máximo del campo de hora. */
  nowIso: string;
  /** Unidad que llega elegida (atajo del catálogo); abre el drawer. */
  initialVehicleId?: string;
};

/** El atajo ya se usó: recargar la agenda no vuelve a abrir el alta. */
function forgetScheduleHandoff(): void {
  const url = new URL(window.location.href);
  if (!url.searchParams.has(SCHEDULE_VEHICLE_PARAM)) return;
  url.searchParams.delete(SCHEDULE_VEHICLE_PARAM);
  window.history.replaceState(null, "", `${url.pathname}${url.search}`);
}

export function ScheduleTestDriveDrawer({
  opportunities,
  vehicles,
  nowIso,
  initialVehicleId,
}: ScheduleTestDriveDrawerProps) {
  const router = useRouter();
  const [preselected, setPreselected] = useState(initialVehicleId);
  const [open, setOpen] = useState(initialVehicleId !== undefined);
  const [saving, setSaving] = useState(false);
  const firstFieldRef = useRef<HTMLSelectElement>(null);

  // Mientras se guarda, ni Escape, ni el velo, ni el botón cierran.
  const keepOpenWhileSaving = (event: Event) => {
    if (saving) event.preventDefault();
  };

  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        if (!next && saving) return;
        if (!next && preselected !== undefined) {
          setPreselected(undefined);
          forgetScheduleHandoff();
        }
        setOpen(next);
      }}
    >
      <DrawerTrigger asChild>
        <Button variant="primary">
          <PlusIcon className="size-4" />
          <span>
            Agendar <span className="hidden sm:inline">prueba</span>
          </span>
        </Button>
      </DrawerTrigger>
      <DrawerContent
        title="Agendar prueba de manejo"
        description="Elegí el cliente, la unidad y la hora. Queda agendada en la agenda del equipo."
        closeDisabled={saving}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          firstFieldRef.current?.focus();
        }}
        onEscapeKeyDown={keepOpenWhileSaving}
        onInteractOutside={keepOpenWhileSaving}
      >
        <ScheduleForm
          opportunities={opportunities}
          vehicles={vehicles}
          nowIso={nowIso}
          initialVehicleId={preselected}
          firstFieldRef={firstFieldRef}
          onSavingChange={setSaving}
          onScheduled={(scheduledAt) => {
            setSaving(false);
            setOpen(false);
            // La URL nueva ya no lleva el atajo: la unidad no se repropone.
            setPreselected(undefined);
            const week = isoDate(
              zonedDate(new Date(scheduledAt), CALENDAR_TIME_ZONE),
            );
            router.push(`/calendar?${WEEK_PARAM}=${week}`, { scroll: false });
          }}
        />
      </DrawerContent>
    </Drawer>
  );
}

/** Copy es-PY de cada error. Ninguno expone detalles internos. */
function errorMessage(field: ScheduleField, error: ScheduleFieldError): string {
  switch (error) {
    case "required":
      if (field === "opportunityId") return "Elegí el cliente.";
      if (field === "vehicleId") return "Elegí la unidad.";
      return "Elegí el día y la hora.";
    case "unavailable":
      return field === "opportunityId"
        ? "Esa oportunidad ya no está abierta. Elegí otra."
        : "Esa unidad ya no está disponible para probar. Elegí otra.";
    case "invalid":
      return "Ingresá una fecha y hora válidas.";
    case "in_the_past":
      return "Elegí una hora que todavía no pasó.";
    case "too_far":
      return `Se puede agendar hasta ${SCHEDULE_HORIZON_DAYS} días adelante.`;
  }
}

const FORM_MESSAGES = {
  invalid: "Revisá los datos marcados.",
  failed:
    "No pudimos agendar la prueba. No se guardó nada: intentá de nuevo en unos minutos.",
} as const;

const FIELD_ORDER: readonly ScheduleField[] = [
  "opportunityId",
  "vehicleId",
  "scheduledAt",
];

type ScheduleFormProps = ScheduleTestDriveDrawerProps & {
  firstFieldRef: RefObject<HTMLSelectElement | null>;
  onSavingChange: (saving: boolean) => void;
  onScheduled: (scheduledAt: string) => void;
};

function ScheduleForm({
  opportunities,
  vehicles,
  nowIso,
  initialVehicleId,
  firstFieldRef,
  onSavingChange,
  onScheduled,
}: ScheduleFormProps) {
  const [state, action, pending] = useActionState<
    ScheduleTestDriveState,
    FormData
  >(scheduleTestDrive, null);
  const id = useId();
  const fieldId = (field: ScheduleField) => `${id}-${field}`;
  const submitRef = useRef<HTMLButtonElement>(null);

  const now = new Date(nowIso);
  const min = toLocalDateTime(now, CALENDAR_TIME_ZONE);
  const max = toLocalDateTime(
    new Date(now.getTime() + SCHEDULE_HORIZON_DAYS * 24 * 60 * 60 * 1000),
    CALENDAR_TIME_ZONE,
  );

  const values =
    state?.status === "invalid" || state?.status === "failed"
      ? state.values
      : undefined;
  const errors = state?.status === "invalid" ? state.errors : {};
  // Solo un id de la lista vuelve al select.
  const echoedOpportunity =
    opportunities.find((option) => option.id === values?.opportunityId)?.id ??
    "";
  // Lo que volvió del servidor manda; si no, la unidad del atajo.
  const echoedVehicle =
    vehicles.find(
      (option) => option.id === (values?.vehicleId ?? initialVehicleId),
    )?.id ?? "";
  const message =
    !pending && (state?.status === "invalid" || state?.status === "failed")
      ? FORM_MESSAGES[state.status]
      : null;
  const missingOptions = opportunities.length === 0 || vehicles.length === 0;

  const reportSaving = useEffectEvent(onSavingChange);
  useEffect(() => reportSaving(pending), [pending]);

  // Al terminar, el foco vuelve a donde hay que actuar: el primer campo a
  // corregir o, tras una falla, el botón para reintentar.
  const settle = useEffectEvent(() => {
    if (state?.status === "scheduled") {
      onScheduled(state.scheduledAt);
    } else if (state?.status === "invalid") {
      const first = FIELD_ORDER.find((field) => state.errors[field]);
      if (first) document.getElementById(fieldId(first))?.focus();
    } else if (state?.status === "failed") {
      submitRef.current?.focus();
    }
  });
  useEffect(() => settle(), [state]);

  /** Props de accesibilidad de un campo según su error. */
  const described = (field: ScheduleField, hint?: boolean) => {
    const error = errors[field];
    const ids = [
      hint ? `${fieldId(field)}-hint` : null,
      error ? `${fieldId(field)}-error` : null,
    ].filter(Boolean);
    return {
      id: fieldId(field),
      name: SCHEDULE_FIELDS[field],
      disabled: pending || missingOptions,
      "aria-invalid": error ? true : undefined,
      "aria-describedby": ids.length > 0 ? ids.join(" ") : undefined,
    } as const;
  };

  const fieldError = (field: ScheduleField) => {
    const error = errors[field];
    return {
      error: error && errorMessage(field, error),
      errorId: `${fieldId(field)}-error`,
    };
  };

  return (
    <form
      action={action}
      noValidate
      aria-busy={pending}
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-4">
        {message ? (
          <p
            role="alert"
            className={
              state?.status === "failed"
                ? "rounded-md border border-danger-border bg-danger-soft px-3 py-2 text-label text-danger"
                : "rounded-md border border-warning-border bg-warning-soft px-3 py-2 text-label text-warning"
            }
          >
            {message}
          </p>
        ) : null}

        {missingOptions ? (
          <div className="rounded-md border border-border-subtle bg-surface-2 px-3 py-2.5 text-label text-text-secondary">
            {opportunities.length === 0 ? (
              <p>
                No hay oportunidades abiertas. Creá una desde Oportunidades para
                agendarle una prueba.
              </p>
            ) : null}
            {vehicles.length === 0 ? (
              <p>
                No hay unidades disponibles o reservadas. Marcá una unidad como
                disponible en Stock.
              </p>
            ) : null}
          </div>
        ) : null}

        <fieldset className="flex flex-col gap-3.5">
          <legend className="mb-3 text-overline text-text-muted uppercase">
            Prueba
          </legend>
          <FormField
            label="Cliente"
            htmlFor={fieldId("opportunityId")}
            hint="Solo oportunidades abiertas."
            hintId={`${fieldId("opportunityId")}-hint`}
            {...fieldError("opportunityId")}
          >
            <select
              ref={firstFieldRef}
              // Con otra `key`, el reset del formulario tras la acción
              // conserva la opción elegida.
              key={`o-${echoedOpportunity}`}
              defaultValue={echoedOpportunity}
              required
              className={inputClassName}
              {...described("opportunityId", true)}
            >
              <option value="">Elegí un cliente</option>
              {opportunities.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.contactName}
                </option>
              ))}
            </select>
          </FormField>
          <FormField
            label="Unidad"
            htmlFor={fieldId("vehicleId")}
            hint="Disponibles o reservadas."
            hintId={`${fieldId("vehicleId")}-hint`}
            {...fieldError("vehicleId")}
          >
            <select
              key={`v-${echoedVehicle}`}
              defaultValue={echoedVehicle}
              required
              className={`${inputClassName} [font-feature-settings:'calt'_0]`}
              {...described("vehicleId", true)}
            >
              <option value="">Elegí una unidad</option>
              {vehicles.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </FormField>
          <FormField
            label="Día y hora"
            htmlFor={fieldId("scheduledAt")}
            hint="Hora de Asunción."
            hintId={`${fieldId("scheduledAt")}-hint`}
            {...fieldError("scheduledAt")}
          >
            <input
              type="datetime-local"
              required
              step={60 * 15}
              min={min}
              max={max}
              defaultValue={values?.scheduledAt}
              className={`${inputClassName} tabular-nums`}
              {...described("scheduledAt", true)}
            />
          </FormField>
        </fieldset>

        <div className="flex items-center justify-between gap-3 rounded-md border border-border-subtle bg-surface-2 px-3 py-2.5">
          <p className="text-label text-text-secondary">Estado al agendarla</p>
          <TestDriveStatusChip status="scheduled" />
        </div>
        <p className="text-caption text-text-muted">
          Agendar no le envía ningún mensaje al cliente.
        </p>
      </div>

      <footer className="flex shrink-0 justify-end gap-2 border-t border-border-subtle bg-surface-2 px-5 py-3">
        <DrawerClose asChild>
          <Button variant="secondary" disabled={pending}>
            Cancelar
          </Button>
        </DrawerClose>
        <Button
          ref={submitRef}
          type="submit"
          variant="primary"
          disabled={pending || missingOptions}
          className={
            pending
              ? "disabled:cursor-wait disabled:opacity-70"
              : "disabled:cursor-not-allowed disabled:opacity-50"
          }
        >
          {pending ? "Agendando…" : "Agendar prueba"}
        </Button>
      </footer>
    </form>
  );
}

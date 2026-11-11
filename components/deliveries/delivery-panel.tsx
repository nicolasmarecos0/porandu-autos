"use client";

import Link from "next/link";
import {
  startTransition,
  useId,
  useOptimistic,
  useRef,
  useState,
  useTransition,
  type FormEvent,
} from "react";

import { LITERAL, StatusChip } from "@/components/stock/stock-status";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/components/ui/cn";
import { inputClassName } from "@/components/ui/form-field";
import {
  AlertIcon,
  CalendarIcon,
  CheckIcon,
  LockIcon,
} from "@/components/ui/icons";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { RestrictedAction } from "@/components/ui/restricted-action";
import {
  checklistIncompleteMessage,
  COMPLETE_DELIVERY_LABEL,
  DELIVERY_ALREADY_COMPLETED_MESSAGE,
  DELIVERY_ALREADY_SCHEDULED_MESSAGE,
  DELIVERY_CHECKLIST_FIELDS,
  DELIVERY_COMPLETION_FIELDS,
  DELIVERY_FAILED_MESSAGE,
  DELIVERY_NOT_FOUND_MESSAGE,
  DELIVERY_PANEL_TITLE,
  DELIVERY_PENDING_LABEL,
  DELIVERY_RESCHEDULE_FIELDS,
  DELIVERY_SCHEDULE_FIELDS,
  DELIVERY_SCHEDULED_AT_ERRORS,
  deliveryCompletedMessage,
  deliveryVehicleConflictMessage,
  CANCEL_DELIVERY_LABEL,
  DELIVERY_CANCELLATION_FIELDS,
  missingChecklistItems,
  OPPORTUNITY_NOT_WON_MESSAGE,
  type DeliveryChecklistItem,
} from "@/domains/opportunities/deliveries";
import {
  optimisticDeliveryPanel,
  progressLabel,
  type DeliveryOptimisticAction,
  type DeliveryPanelData,
  type DeliveryPanelState,
  type DeliveryUnit,
  type DeliveryView,
} from "@/domains/opportunities/delivery-presentation";
import {
  CAPABILITY_REQUIREMENTS,
  unauthorizedRoleMessage,
} from "@/lib/auth/roles";
import {
  cancelDelivery,
  completeDelivery,
  rescheduleDelivery,
  scheduleDelivery,
  setDeliveryChecklistItem,
} from "@/lib/deliveries/actions";
import type {
  CancelDeliveryState,
  CompleteDeliveryState,
  DeliveryChecklistState,
  ScheduleDeliveryState,
} from "@/lib/deliveries/requests";
import { STOCK_PATH } from "@/lib/vehicles/paths";

import { CancelDeliveryDialog } from "./cancel-delivery-dialog";
import { CompleteDeliveryDialog } from "./complete-delivery-dialog";
import { DeliveryStatusChip } from "./delivery-status";

/*
 * Panel "Coordinación de Entrega" en /opportunities/[id] (Hito 21,
 * DEC-053). Solo existe con la oportunidad Ganada: el loader manda
 * `hidden` en cualquier otra etapa y el panel no se dibuja.
 *
 * - Sin entrega: la unidad vendida y la fecha y hora pactadas con el
 *   cliente (la que se acordó en el cierre, sugerida), "Programar entrega".
 * - Programada: la fecha pactada (con "Reprogramar"), el checklist físico
 *   (casillas de Radix, de a un ítem, guardado en cada cambio) con su
 *   progreso, y "Completar Entrega y Dar Salida al Vehículo", habilitado
 *   solo con todo verificado. Confirmar abre un alertdialog (la acción es
 *   irreversible: CLAUDE.md §2) que dice qué pasa con la unidad.
 * - Completada: el sello de quién y cuándo entregó, el checklist de solo
 *   lectura y que la unidad salió del salón.
 *
 * Optimista (useOptimistic de React 19): cada casilla, la reprogramación y
 * el completado se ven al instante y dicen "Guardando…"; completar no
 * admite otro pedido hasta la respuesta. La página revalidada reemplaza el
 * estado optimista; si el servidor no hizo el cambio, vuelve el estado real
 * y un aviso (región `status`) dice cómo terminó.
 *
 * Mobile-first: una columna en el teléfono, filas de checklist de 48 px de
 * alto (toda la fila es el área táctil) y el botón principal a todo el
 * ancho; desde sm, el pie se alinea a la derecha.
 */

type Notice = Readonly<{ tone: "success" | "error"; text: string }>;

function scheduleNotice(result: ScheduleDeliveryState): Notice | null {
  switch (result?.status) {
    case "scheduled":
      return {
        tone: "success",
        text: "Entrega programada. Tildá el checklist a medida que preparás la unidad.",
      };
    case "rescheduled":
      return { tone: "success", text: "Se reprogramó la entrega." };
    case "unchanged":
      return {
        tone: "success",
        text: "La entrega ya estaba pactada para ese momento. No se hizo ningún cambio.",
      };
    case "already_scheduled":
      return { tone: "error", text: DELIVERY_ALREADY_SCHEDULED_MESSAGE };
    case "already_completed":
      return { tone: "error", text: DELIVERY_ALREADY_COMPLETED_MESSAGE };
    case "opportunity_not_won":
      return { tone: "error", text: OPPORTUNITY_NOT_WON_MESSAGE };
    case "vehicle_conflict":
      return {
        tone: "error",
        text: deliveryVehicleConflictMessage(result.reason),
      };
    case "not_found":
      return { tone: "error", text: DELIVERY_NOT_FOUND_MESSAGE };
    case "failed":
      return { tone: "error", text: DELIVERY_FAILED_MESSAGE };
    case "invalid":
    case undefined:
      return null;
  }
}

function checklistNotice(result: DeliveryChecklistState): Notice | null {
  switch (result?.status) {
    case "changed":
    case "unchanged":
    case undefined:
      // Cada casilla se ve guardada: no hace falta un aviso por ítem.
      return null;
    case "already_completed":
      return { tone: "error", text: DELIVERY_ALREADY_COMPLETED_MESSAGE };
    case "not_found":
      return { tone: "error", text: DELIVERY_NOT_FOUND_MESSAGE };
    case "failed":
      return { tone: "error", text: DELIVERY_FAILED_MESSAGE };
  }
}

function completeNotice(result: CompleteDeliveryState): Notice | null {
  switch (result?.status) {
    case "completed":
      return { tone: "success", text: deliveryCompletedMessage(result.label) };
    case "already_completed":
      return { tone: "error", text: DELIVERY_ALREADY_COMPLETED_MESSAGE };
    case "checklist_incomplete":
      return {
        tone: "error",
        text: checklistIncompleteMessage(result.missing),
      };
    case "vehicle_conflict":
      return {
        tone: "error",
        text: deliveryVehicleConflictMessage(result.reason),
      };
    case "not_found":
      return { tone: "error", text: DELIVERY_NOT_FOUND_MESSAGE };
    case "failed":
      return { tone: "error", text: DELIVERY_FAILED_MESSAGE };
    case undefined:
      return null;
  }
}

/** Qué dice el panel de una respuesta de cancelDelivery() (DEC-054 §4). */
function cancelNotice(result: CancelDeliveryState): Notice | null {
  switch (result?.status) {
    case "cancelled":
      return {
        tone: "success",
        text: "Entrega anulada. La unidad sigue Vendida: podés programar otra entrega.",
      };
    case "already_completed":
      return { tone: "error", text: DELIVERY_ALREADY_COMPLETED_MESSAGE };
    case "unauthorized_role":
      return {
        tone: "error",
        text: unauthorizedRoleMessage(result.capability),
      };
    case "not_found":
      return { tone: "error", text: DELIVERY_NOT_FOUND_MESSAGE };
    case "failed":
      return { tone: "error", text: DELIVERY_FAILED_MESSAGE };
    case undefined:
      return null;
  }
}

export function DeliveryPanel({
  opportunityId,
  data,
  canCancel,
}: {
  opportunityId: string;
  data: DeliveryPanelData;
  /** El rol tiene `delivery.cancel` (lib/auth/roles.ts, DEC-054 §4). */
  canCancel: boolean;
}) {
  const [view, addOptimistic] = useOptimistic<
    DeliveryPanelState,
    DeliveryOptimisticAction
  >({ data, saving: false }, optimisticDeliveryPanel);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelPending, startCancel] = useTransition();
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const settled = useRef(false);

  if (view.data.kind === "hidden") return null;

  const announce = (next: Notice | null) => {
    setNotice(next);
    if (next) noticeRef.current?.focus();
  };

  function run<T>(
    action: DeliveryOptimisticAction,
    call: () => Promise<T>,
    fallback: T,
    toNotice: (result: T) => Notice | null,
    after?: (result: T) => void,
  ) {
    setNotice(null);
    startTransition(async () => {
      addOptimistic(action);
      let result: T;
      try {
        result = await call();
      } catch {
        result = fallback;
      }
      after?.(result);
      announce(toNotice(result));
    });
  }

  const current = view.data;

  return (
    <section aria-labelledby="delivery-heading" className="max-w-3xl">
      <Panel>
        <PanelHeader>
          <h2
            id="delivery-heading"
            className="min-w-0 truncate text-heading text-text-primary"
          >
            {DELIVERY_PANEL_TITLE}
          </h2>
          <span className="ml-auto hidden sm:inline-flex">
            {current.kind === "scheduled" ? (
              <DeliveryStatusChip status={current.delivery.status} />
            ) : null}
          </span>
        </PanelHeader>

        <div className="flex flex-col gap-4 px-3 py-3.5 sm:px-4">
          {current.unit ? <UnitStrip unit={current.unit} /> : null}

          {current.kind === "blocked" ? (
            <p className="flex items-start gap-2 rounded-md border border-border-subtle bg-surface-2 px-3 py-2.5 text-label text-text-secondary">
              <LockIcon
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-text-muted"
              />
              {current.message}
            </p>
          ) : null}

          {current.kind === "unscheduled" ? (
            <ScheduleForm
              opportunityId={opportunityId}
              suggested={current.suggestedInput}
              min={current.minInput}
              saving={view.saving}
              onSubmit={(formData) =>
                run<ScheduleDeliveryState>(
                  { kind: "schedule" },
                  () => scheduleDelivery(null, formData),
                  {
                    status: "failed",
                    value: String(
                      formData.get(DELIVERY_SCHEDULE_FIELDS.scheduledAt) ?? "",
                    ),
                  },
                  scheduleNotice,
                )
              }
            />
          ) : null}

          {current.kind === "scheduled" ? (
            <ScheduledDelivery
              delivery={current.delivery}
              min={current.minInput}
              saving={view.saving || cancelPending}
              canCancel={canCancel}
              onCancel={() => {
                settled.current = false;
                setCancelling(true);
              }}
              onReschedule={(formData, scheduledInput) =>
                run<ScheduleDeliveryState>(
                  { kind: "reschedule", scheduledInput },
                  () => rescheduleDelivery(null, formData),
                  { status: "failed", value: scheduledInput },
                  scheduleNotice,
                )
              }
              onCheck={(item, checked) => {
                const formData = new FormData();
                formData.set(
                  DELIVERY_CHECKLIST_FIELDS.deliveryId,
                  current.delivery.id,
                );
                formData.set(DELIVERY_CHECKLIST_FIELDS.item, item);
                formData.set(
                  DELIVERY_CHECKLIST_FIELDS.checked,
                  String(checked),
                );
                run<DeliveryChecklistState>(
                  { kind: "check", item, checked },
                  () => setDeliveryChecklistItem(null, formData),
                  { status: "failed" },
                  checklistNotice,
                );
              }}
              onComplete={() => {
                settled.current = false;
                setConfirming(true);
              }}
            />
          ) : null}

          <p
            ref={noticeRef}
            role="status"
            tabIndex={-1}
            className={cn(
              "text-caption focus:outline-none",
              notice && !view.saving
                ? notice.tone === "error"
                  ? "text-danger"
                  : "text-success"
                : "sr-only",
            )}
          >
            {notice && !view.saving ? notice.text : null}
          </p>
        </div>
      </Panel>

      {current.kind === "scheduled" ? (
        <CancelDeliveryDialog
          open={cancelling}
          onCancel={() => setCancelling(false)}
          onConfirm={() => {
            settled.current = true;
            setCancelling(false);
            setNotice(null);
            const formData = new FormData();
            formData.set(
              DELIVERY_CANCELLATION_FIELDS.deliveryId,
              current.delivery.id,
            );
            startCancel(async () => {
              let result: CancelDeliveryState;
              try {
                result = await cancelDelivery(null, formData);
              } catch {
                result = { status: "failed" };
              }
              announce(cancelNotice(result));
            });
          }}
          onCloseAutoFocus={(event) => {
            if (settled.current) {
              event.preventDefault();
              noticeRef.current?.focus();
            }
          }}
        />
      ) : null}
      {current.kind === "scheduled" ? (
        <CompleteDeliveryDialog
          open={confirming}
          unit={current.unit}
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            settled.current = true;
            setConfirming(false);
            const formData = new FormData();
            formData.set(
              DELIVERY_COMPLETION_FIELDS.deliveryId,
              current.delivery.id,
            );
            run<CompleteDeliveryState>(
              { kind: "complete" },
              () => completeDelivery(null, formData),
              { status: "failed" },
              completeNotice,
            );
          }}
          onCloseAutoFocus={(event) => {
            // Confirmada, el botón que la abrió deja de existir: el foco va
            // al aviso, que además se anuncia.
            if (settled.current) {
              event.preventDefault();
              noticeRef.current?.focus();
            }
          }}
        />
      ) : null}
    </section>
  );
}

/** La unidad vendida que se entrega: nombre, versión y año, y su estado. */
function UnitStrip({ unit }: { unit: DeliveryUnit }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 rounded-md border border-border-subtle bg-surface-2 px-3 py-2.5">
      <div className="min-w-0">
        <p className="text-caption text-text-muted">Unidad de la venta</p>
        <p className="truncate text-body font-semibold text-text-primary">
          {unit.name}
        </p>
        <p className={cn("truncate text-label text-text-secondary", LITERAL)}>
          {unit.detail}
        </p>
      </div>
      <StatusChip status={unit.status} />
    </div>
  );
}

function ScheduleForm({
  opportunityId,
  suggested,
  min,
  saving,
  onSubmit,
}: {
  opportunityId: string;
  suggested: string;
  min: string;
  saving: boolean;
  onSubmit: (formData: FormData) => void;
}) {
  const inputId = useId();
  const hintId = useId();
  const errorId = useId();
  const [error, setError] = useState<string | null>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const value = String(
      formData.get(DELIVERY_SCHEDULE_FIELDS.scheduledAt) ?? "",
    );
    if (value.trim() === "") {
      setError(DELIVERY_SCHEDULED_AT_ERRORS.required);
      return;
    }
    setError(null);
    onSubmit(formData);
  }

  return (
    <form
      onSubmit={submit}
      noValidate
      className="flex flex-col gap-3 rounded-md border border-dashed border-border-default px-3 py-4 sm:px-4"
    >
      <input
        type="hidden"
        name={DELIVERY_SCHEDULE_FIELDS.opportunityId}
        value={opportunityId}
      />
      <div className="flex items-start gap-2.5">
        <CalendarIcon
          aria-hidden="true"
          className="mt-0.5 size-5 shrink-0 text-brand"
        />
        <div>
          <p className="text-body font-semibold text-text-primary">
            Programá la entrega de la unidad vendida
          </p>
          <p className="text-label text-text-secondary">
            Pactá con el cliente el día y la hora. Después, tildá el checklist
            físico a medida que preparás la unidad.
          </p>
        </div>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex flex-1 flex-col gap-1.5">
          <label htmlFor={inputId} className="text-label text-text-secondary">
            Fecha y hora pactadas
          </label>
          <input
            id={inputId}
            type="datetime-local"
            name={DELIVERY_SCHEDULE_FIELDS.scheduledAt}
            defaultValue={suggested}
            min={min}
            step={300}
            aria-describedby={error ? `${hintId} ${errorId}` : hintId}
            aria-invalid={error ? true : undefined}
            className={cn(inputClassName, "h-10 sm:h-9")}
          />
        </div>
        <Button
          type="submit"
          variant="primary"
          disabled={saving}
          className="h-10 sm:h-9"
        >
          {saving ? DELIVERY_PENDING_LABEL : "Programar entrega"}
        </Button>
      </div>
      <p id={hintId} className="text-caption text-text-muted">
        Hora de Asunción.
      </p>
      {error ? (
        <p id={errorId} className="text-caption text-danger">
          {error}
        </p>
      ) : null}
    </form>
  );
}

function ScheduledDelivery({
  delivery,
  min,
  saving,
  canCancel,
  onCancel,
  onReschedule,
  onCheck,
  onComplete,
}: {
  delivery: DeliveryView;
  min: string;
  saving: boolean;
  canCancel: boolean;
  onCancel: () => void;
  onReschedule: (formData: FormData, scheduledInput: string) => void;
  onCheck: (item: DeliveryChecklistItem, checked: boolean) => void;
  onComplete: () => void;
}) {
  const completed = delivery.status === "completed";
  const [rescheduling, setRescheduling] = useState(false);
  const inputId = useId();
  const helperId = useId();
  const missing = missingChecklistItems(delivery.checklist);

  function reschedule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const value = String(
      formData.get(DELIVERY_RESCHEDULE_FIELDS.scheduledAt) ?? "",
    );
    if (value.trim() === "") return;
    setRescheduling(false);
    onReschedule(formData, value);
  }

  return (
    <div className="flex flex-col gap-4">
      {/* En el teléfono el estado va acá; desde sm, en el encabezado. */}
      <div className="sm:hidden">
        <DeliveryStatusChip status={delivery.status} />
      </div>

      {completed ? (
        <div className="flex items-start gap-2.5 rounded-md border border-success-border bg-success-soft px-3 py-3">
          <CheckIcon
            aria-hidden="true"
            className="mt-0.5 size-5 shrink-0 text-success"
            strokeWidth={2.25}
          />
          <div className="min-w-0">
            <p className="text-body font-semibold text-text-primary">
              Entrega completada
            </p>
            <p className="text-label text-text-secondary">
              {delivery.completedLabel ??
                (saving ? DELIVERY_PENDING_LABEL : null)}
            </p>
            <p className="mt-1 text-label text-text-secondary">
              La unidad salió del salón: ya no figura en el Inventario ni en el
              Catálogo.{" "}
              <Link
                href={STOCK_PATH}
                className="font-semibold text-brand hover:text-brand-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
              >
                Ver Inventario
              </Link>
            </p>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
            <div className="min-w-0">
              <p className="text-caption text-text-muted">Entrega pactada</p>
              <p className="flex flex-wrap items-center gap-2 text-body font-semibold text-text-primary first-letter:uppercase">
                <span className="tabular-nums">{delivery.scheduledLabel}</span>
                {delivery.overdue ? (
                  <span className="inline-flex h-5 items-center gap-1 rounded-sm border border-warning-border bg-warning-soft px-1.5 text-caption font-semibold text-warning">
                    <AlertIcon aria-hidden="true" className="size-3" />
                    Fecha vencida
                  </span>
                ) : null}
              </p>
              <p className="text-caption text-text-muted">
                {delivery.scheduledByLabel}
              </p>
            </div>
            {rescheduling ? null : (
              <div className="flex flex-wrap gap-2">
                <Button
                  className="h-10 sm:h-8"
                  disabled={saving}
                  onClick={() => setRescheduling(true)}
                >
                  Reprogramar
                </Button>
                {/* Anular es de la gerencia (DEC-054 §4). */}
                {canCancel ? (
                  <Button
                    className="h-10 text-danger sm:h-8"
                    disabled={saving}
                    onClick={onCancel}
                  >
                    {CANCEL_DELIVERY_LABEL}
                  </Button>
                ) : (
                  <RestrictedAction
                    label={CANCEL_DELIVERY_LABEL}
                    reason={CAPABILITY_REQUIREMENTS["delivery.cancel"]}
                    className="h-10 sm:h-8"
                  />
                )}
              </div>
            )}
          </div>
          {rescheduling ? (
            <form
              onSubmit={reschedule}
              className="flex flex-col gap-2 rounded-md border border-border-subtle bg-surface-2 p-3 sm:flex-row sm:items-end"
            >
              <input
                type="hidden"
                name={DELIVERY_RESCHEDULE_FIELDS.deliveryId}
                value={delivery.id}
              />
              <div className="flex flex-1 flex-col gap-1.5">
                <label
                  htmlFor={inputId}
                  className="text-label text-text-secondary"
                >
                  Nueva fecha y hora (Asunción)
                </label>
                <input
                  id={inputId}
                  type="datetime-local"
                  name={DELIVERY_RESCHEDULE_FIELDS.scheduledAt}
                  defaultValue={delivery.scheduledInput}
                  min={min}
                  step={300}
                  required
                  className={cn(inputClassName, "h-10 sm:h-9")}
                />
              </div>
              <div className="flex gap-2">
                <Button
                  className="h-10 flex-1 sm:h-9 sm:flex-none"
                  onClick={() => setRescheduling(false)}
                >
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  className="h-10 flex-1 sm:h-9 sm:flex-none"
                >
                  Guardar fecha
                </Button>
              </div>
            </form>
          ) : null}
        </div>
      )}

      <fieldset className="flex flex-col gap-2.5">
        <div className="flex items-baseline justify-between gap-3">
          <legend className="text-label font-semibold text-text-primary">
            Checklist físico
          </legend>
          <span className="text-caption text-text-secondary tabular-nums">
            {progressLabel(delivery.progress)}
          </span>
        </div>
        <ProgressMeter
          done={delivery.progress.done}
          total={delivery.progress.total}
        />
        <ul className="flex flex-col divide-y divide-border-subtle overflow-hidden rounded-md border border-border-subtle">
          {delivery.entries.map((entry) => (
            <ChecklistRow
              key={entry.item}
              item={entry.item}
              label={entry.label}
              hint={entry.hint}
              checked={entry.checked}
              disabled={completed}
              onChange={(checked) => onCheck(entry.item, checked)}
            />
          ))}
        </ul>
      </fieldset>

      {completed ? null : (
        <div className="flex flex-col gap-2 border-t border-border-subtle pt-3.5 sm:flex-row sm:items-center sm:justify-end sm:gap-3">
          <p
            id={helperId}
            className={cn(
              "text-caption sm:mr-auto",
              delivery.verified ? "text-success" : "text-text-muted",
            )}
          >
            {delivery.verified
              ? "Todo verificado: la unidad está lista para salir."
              : checklistIncompleteMessage(missing)}
          </p>
          <Button
            variant="primary"
            className="h-11 w-full sm:h-9 sm:w-auto"
            disabled={!delivery.verified || saving}
            aria-describedby={helperId}
            onClick={onComplete}
          >
            {saving ? DELIVERY_PENDING_LABEL : COMPLETE_DELIVERY_LABEL}
          </Button>
        </div>
      )}
    </div>
  );
}

/** Cinco segmentos, uno por ítem: el avance se lee sin contar. */
function ProgressMeter({ done, total }: { done: number; total: number }) {
  return (
    <div
      aria-hidden="true"
      className="grid gap-1"
      style={{ gridTemplateColumns: `repeat(${total}, minmax(0, 1fr))` }}
    >
      {Array.from({ length: total }, (_, index) => (
        <span
          key={index}
          className={cn(
            "h-1 rounded-full transition-colors duration-200 ease-out-strong motion-reduce:transition-none",
            index < done
              ? done === total
                ? "bg-success"
                : "bg-brand"
              : "bg-border-subtle",
          )}
        />
      ))}
    </div>
  );
}

function ChecklistRow({
  item,
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  item: DeliveryChecklistItem;
  label: string;
  hint: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <li>
      <label
        htmlFor={id}
        className={cn(
          "flex min-h-12 items-center gap-3 px-3 py-2.5 transition-colors duration-150 ease-out-strong motion-reduce:transition-none",
          disabled ? "cursor-default" : "cursor-pointer hover:bg-surface-2",
          checked ? "bg-success-soft/40" : "bg-surface-1",
        )}
      >
        <Checkbox
          id={id}
          name={item}
          checked={checked}
          disabled={disabled}
          aria-describedby={hintId}
          onCheckedChange={(state) => onChange(state === true)}
        />
        <span className="flex min-w-0 flex-col">
          <span className="text-body font-semibold text-text-primary">
            {label}
          </span>
          <span id={hintId} className="text-caption text-text-secondary">
            {hint}
          </span>
        </span>
        {checked ? (
          <span className="ml-auto shrink-0 text-caption font-semibold text-success">
            Verificado
          </span>
        ) : null}
      </label>
    </li>
  );
}

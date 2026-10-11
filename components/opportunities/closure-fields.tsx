"use client";

import { useId, useState } from "react";
import { cn } from "@/components/ui/cn";
import { FormField, inputClassName } from "@/components/ui/form-field";
import { CURRENCIES, CURRENCY_LABELS } from "@/domains/money";
import {
  CLOSURE_FIELDS,
  DELIVERY_STATUS_OPTIONS,
  LOSS_NOTES_MAX_LENGTH,
  LOSS_REASON_OPTIONS,
  PAYMENT_METHOD_OPTIONS,
  type ClosureErrors,
  type ClosureField,
  type ClosureFieldError,
  type ClosureOutcome,
  type ClosureValues,
  type DeliveryStatus,
} from "@/domains/opportunities/closure";
import { noteLength, normalizeNoteBody } from "@/domains/opportunities/notes";

/*
 * Campos del cierre comercial (DEC-034) dentro de la confirmación de
 * /opportunities/[id]. Cambian según el resultado:
 *
 *   Ganada   Unidad vendida (solo lectura) · Precio final + Moneda ·
 *            Forma de pago · Entrega (estado) + Fecha
 *   Perdida  Motivo · Notas (opcionales, con contador)
 *
 * Reacciona a lo que se carga: la fecha admite hoy o antes con "Entregada"
 * y hoy o después con "Entrega programada", la ayuda del precio dice si van
 * decimales según la moneda y el contador cuenta las notas ya normalizadas
 * (como las guarda el servidor). No conoce la base ni valida por su cuenta:
 * los errores llegan por campo (del navegador, con la misma validación del
 * dominio, o del servidor) y se enlazan a cada control.
 */

/** La unidad que se vende: la vinculada a la negociación. */
export type SaleVehicle = Readonly<{ name: string; detail: string }>;

const textareaClassName =
  "min-h-20 w-full resize-y rounded-md border border-border-default bg-surface-1 px-3 py-2 text-body text-text-primary transition-[border-color] hover:border-border-strong focus-visible:border-brand focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring aria-invalid:border-danger disabled:cursor-not-allowed disabled:bg-surface-2";

const REQUIRED: Readonly<Record<ClosureField, string>> = {
  salePrice: "Ingresá el precio final de la venta.",
  saleCurrency: "Elegí la moneda.",
  paymentMethod: "Elegí la forma de pago.",
  deliveryStatus: "Elegí el estado de la entrega.",
  deliveryDate: "Ingresá la fecha de entrega.",
  lossReason: "Elegí un motivo para cerrarla.",
  lossNotes: "Revisá las notas.",
};

const MESSAGES: Readonly<
  Record<Exclude<ClosureFieldError, "required">, string>
> = {
  invalid_option: "Elegí una opción de la lista.",
  invalid_amount: "Escribí el monto como 47.500 o 32.990,50.",
  not_positive: "El precio tiene que ser mayor que cero.",
  pyg_decimals: "En guaraníes, el monto va sin decimales.",
  invalid_date: "Elegí una fecha válida.",
  delivered_in_future: "Una entrega hecha no puede tener una fecha futura.",
  scheduled_in_past: "Una entrega programada no puede tener una fecha pasada.",
  too_long: `Las notas pueden tener hasta ${LOSS_NOTES_MAX_LENGTH} caracteres.`,
};

/** Copy del error de un campo (es-PY). */
export function closureErrorMessage(
  field: ClosureField,
  error: ClosureFieldError,
): string {
  return error === "required" ? REQUIRED[field] : MESSAGES[error];
}

type ClosureFieldsProps = Readonly<{
  outcome: ClosureOutcome;
  /** Día de Asunción, "AAAA-MM-DD": acota la fecha de entrega. */
  today: string;
  errors: ClosureErrors;
  /** Lo cargado antes (el eco del servidor): valores iniciales. */
  values?: Partial<ClosureValues>;
  /** La unidad vinculada; ganar sin ella no se ofrece. */
  saleVehicle: SaleVehicle | null;
  disabled: boolean;
}>;

export function ClosureFields(props: ClosureFieldsProps) {
  return props.outcome === "won" ? (
    <WonFields {...props} />
  ) : (
    <LostFields {...props} />
  );
}

/** Ids del control, su error y su ayuda, y los atributos que los enlazan. */
function fieldProps(
  prefix: string,
  field: ClosureField,
  errors: ClosureErrors,
  hint = false,
) {
  const id = `${prefix}-${field}`;
  const error = errors[field];
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  return {
    id,
    errorId,
    hintId,
    message: error ? closureErrorMessage(field, error) : undefined,
    control: {
      id,
      name: CLOSURE_FIELDS[field],
      "aria-invalid": error ? true : undefined,
      "aria-describedby": cn(hint && hintId, error && errorId) || undefined,
    },
  } as const;
}

function WonFields({
  today,
  errors,
  values,
  saleVehicle,
  disabled,
}: ClosureFieldsProps) {
  const prefix = useId();
  const [currency, setCurrency] = useState(values?.saleCurrency ?? "");
  const [status, setStatus] = useState<DeliveryStatus | "">(
    values?.deliveryStatus === "scheduled" ||
      values?.deliveryStatus === "delivered"
      ? values.deliveryStatus
      : "",
  );
  const price = fieldProps(prefix, "salePrice", errors, true);
  const saleCurrency = fieldProps(prefix, "saleCurrency", errors);
  const payment = fieldProps(prefix, "paymentMethod", errors);
  const delivery = fieldProps(prefix, "deliveryStatus", errors);
  const date = fieldProps(prefix, "deliveryDate", errors, true);

  if (saleVehicle === null) {
    return (
      <p
        role="alert"
        className="rounded-md border border-warning-border bg-warning-soft px-3 py-2.5 text-label text-warning"
      >
        Para marcarla como ganada, primero vinculá la unidad que se vende desde
        los matches en stock.
      </p>
    );
  }

  return (
    <>
      <div className="rounded-md border border-border-subtle bg-surface-2 px-3 py-2.5">
        <p className="text-caption text-text-muted">Unidad vendida</p>
        <p className="text-label font-semibold text-text-primary">
          {saleVehicle.name}
        </p>
        <p className="text-caption text-text-secondary">{saleVehicle.detail}</p>
      </div>
      <div className="grid grid-cols-[1fr_9rem] gap-3">
        <FormField
          label="Precio final"
          htmlFor={price.id}
          hint={
            currency === "PYG"
              ? "Lo acordado con el cliente. En guaraníes, sin decimales."
              : "Lo acordado con el cliente, no el precio publicado."
          }
          hintId={price.hintId}
          error={price.message}
          errorId={price.errorId}
        >
          <input
            {...price.control}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            required
            placeholder="47.500"
            defaultValue={values?.salePrice ?? ""}
            disabled={disabled}
            className={cn(inputClassName, "tabular-nums")}
          />
        </FormField>
        <FormField
          label="Moneda"
          htmlFor={saleCurrency.id}
          error={saleCurrency.message}
          errorId={saleCurrency.errorId}
        >
          <select
            {...saleCurrency.control}
            required
            value={currency}
            onChange={(event) => setCurrency(event.currentTarget.value)}
            disabled={disabled}
            className={inputClassName}
          >
            <option value="" disabled>
              Elegí
            </option>
            {CURRENCIES.map((option) => (
              <option key={option} value={option}>
                {CURRENCY_LABELS[option]}
              </option>
            ))}
          </select>
        </FormField>
      </div>
      <FormField
        label="Forma de pago"
        htmlFor={payment.id}
        error={payment.message}
        errorId={payment.errorId}
      >
        <select
          {...payment.control}
          required
          defaultValue={values?.paymentMethod ?? ""}
          disabled={disabled}
          className={inputClassName}
        >
          <option value="" disabled>
            Elegí la forma de pago
          </option>
          {PAYMENT_METHOD_OPTIONS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </FormField>
      <div className="grid grid-cols-2 gap-3">
        <FormField
          label="Entrega"
          htmlFor={delivery.id}
          error={delivery.message}
          errorId={delivery.errorId}
        >
          <select
            {...delivery.control}
            required
            value={status}
            onChange={(event) =>
              setStatus(event.currentTarget.value as DeliveryStatus)
            }
            disabled={disabled}
            className={inputClassName}
          >
            <option value="" disabled>
              Elegí
            </option>
            {DELIVERY_STATUS_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </FormField>
        <FormField
          label="Fecha de entrega"
          htmlFor={date.id}
          hint={
            status === "delivered"
              ? "Hoy o antes."
              : status === "scheduled"
                ? "Hoy o después."
                : "Elegí primero el estado."
          }
          hintId={date.hintId}
          error={date.message}
          errorId={date.errorId}
        >
          <input
            {...date.control}
            type="date"
            required
            defaultValue={values?.deliveryDate ?? ""}
            min={status === "scheduled" ? today : undefined}
            max={status === "delivered" ? today : undefined}
            disabled={disabled}
            className={cn(inputClassName, "tabular-nums")}
          />
        </FormField>
      </div>
    </>
  );
}

function LostFields({ errors, values, disabled }: ClosureFieldsProps) {
  const prefix = useId();
  const [notes, setNotes] = useState(values?.lossNotes ?? "");
  const reason = fieldProps(prefix, "lossReason", errors);
  const notesField = fieldProps(prefix, "lossNotes", errors, true);
  const length = noteLength(normalizeNoteBody(notes));
  const tooLong = length > LOSS_NOTES_MAX_LENGTH;

  return (
    <>
      <FormField
        label="Motivo de la pérdida"
        htmlFor={reason.id}
        error={reason.message}
        errorId={reason.errorId}
      >
        <select
          {...reason.control}
          required
          defaultValue={values?.lossReason ?? ""}
          disabled={disabled}
          className={inputClassName}
        >
          <option value="" disabled>
            Elegí un motivo
          </option>
          {LOSS_REASON_OPTIONS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </FormField>
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={notesField.id}
          className="text-label text-text-secondary"
        >
          Notas
          <span className="font-normal text-text-muted"> (opcional)</span>
        </label>
        <textarea
          {...notesField.control}
          aria-invalid={notesField.message || tooLong ? true : undefined}
          rows={3}
          value={notes}
          onChange={(event) => setNotes(event.currentTarget.value)}
          disabled={disabled}
          placeholder="Qué pasó, con quién compró, qué se podría haber hecho distinto…"
          className={textareaClassName}
        />
        <div className="flex items-start justify-between gap-3">
          <p
            id={notesField.errorId}
            className={cn(
              "text-caption text-danger",
              !notesField.message && "sr-only",
            )}
          >
            {notesField.message}
          </p>
          <p
            id={notesField.hintId}
            className={cn(
              "shrink-0 text-caption tabular-nums",
              tooLong ? "text-danger" : "text-text-muted",
            )}
          >
            {length.toLocaleString("es-PY")} /{" "}
            {LOSS_NOTES_MAX_LENGTH.toLocaleString("es-PY")}
          </p>
        </div>
      </div>
    </>
  );
}

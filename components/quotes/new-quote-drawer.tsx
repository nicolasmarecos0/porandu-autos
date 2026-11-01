"use client";

import {
  startTransition,
  useActionState,
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { FormField, inputClassName } from "@/components/ui/form-field";
import { LockIcon, PlusIcon } from "@/components/ui/icons";
import { formatMoney, parseAmount, type Money } from "@/domains/money";
import { noteLength, normalizeNoteBody } from "@/domains/opportunities/notes";
import type { QuoteVehicleOption } from "@/domains/quotes/presentation";
import { quoteDiscountView } from "@/domains/quotes/presentation";
import {
  DISCOUNT_KIND_LABELS,
  DISCOUNT_KINDS,
  discountExceeds,
  MAX_DISCOUNT_PERCENT,
  quoteTotal,
  requiresAdminApproval,
  SELLER_DISCOUNT_LIMIT_PERCENT,
  type Discount,
  type DiscountKind,
} from "@/domains/quotes/pricing";
import {
  addDays,
  DEFAULT_VALIDITY_DAYS,
  MAX_VALIDITY_DAYS,
  parsePercent,
  parseQuoteTerms,
  QUOTE_FIELD_ERROR_LABELS,
  QUOTE_FIELDS,
  QUOTE_NOTES_MAX_LENGTH,
} from "@/domains/quotes/request";
import { createQuote } from "@/lib/quotes/actions";
import type {
  CreateQuoteState,
  QuoteFormError,
  QuoteFormErrors,
  QuoteFormField,
} from "@/lib/quotes/requests";

import { QuoteStatusChip } from "./quote-status";

/*
 * Nueva cotización (Hito 10, DEC-042 §4 y §9): botón "Nueva cotización" y
 * drawer lateral con el formulario. Arriba, la unidad (su precio publicado
 * es la lista, de solo lectura); después, el descuento (ninguno, monto fijo
 * o porcentaje), la validez y las condiciones. Un resumen fijo muestra el
 * total en vivo y avisa si el descuento va a necesitar la aprobación de un
 * admin o supera el tope.
 *
 * Valida antes de enviar con la misma validación del dominio (Zod,
 * parseQuoteTerms()) y avisa por campo; el servidor la repite contra la
 * lista real de la unidad y es el que decide. No conoce la base: envía a la
 * Server Action createQuote() la oportunidad, la unidad y las condiciones.
 * Lista, moneda, número, estado y autor los pone el servidor.
 *
 * Mientras guarda no se puede cerrar ni reenviar. Un error deja lo cargado
 * para corregir o reintentar; al crearla, el drawer se cierra y la
 * cotización aparece arriba del panel, en Borrador. Crear no le envía nada
 * al cliente.
 */

type NewQuoteDrawerProps = Readonly<{
  opportunityId: string;
  vehicleOptions: readonly QuoteVehicleOption[];
  suggestedVehicleId: string | null;
  /** Día de Asunción del request, "AAAA-MM-DD". */
  today: string;
}>;

export function NewQuoteDrawer(props: NewQuoteDrawerProps) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const firstFieldRef = useRef<HTMLSelectElement>(null);

  // Mientras se guarda, ni Escape, ni el velo, ni el botón cierran.
  const keepOpenWhileSaving = (event: Event) => {
    if (saving) event.preventDefault();
  };

  return (
    <>
      <Drawer
        open={open}
        onOpenChange={(next) => {
          if (!next && saving) return;
          if (next) setAnnouncement("");
          setOpen(next);
        }}
      >
        <DrawerTrigger asChild>
          <Button variant="primary">
            <PlusIcon className="size-4" />
            <span>
              Nueva <span className="hidden sm:inline">cotización</span>
            </span>
          </Button>
        </DrawerTrigger>
        <DrawerContent
          title="Nueva cotización"
          description="Presupuesto formal de una unidad para este cliente. Nace en Borrador y se aprueba antes de entregarla."
          closeDisabled={saving}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            firstFieldRef.current?.focus();
          }}
          onEscapeKeyDown={keepOpenWhileSaving}
          onInteractOutside={keepOpenWhileSaving}
        >
          <QuoteForm
            {...props}
            firstFieldRef={firstFieldRef}
            onSavingChange={setSaving}
            onCreated={(number) => {
              setSaving(false);
              setOpen(false);
              setAnnouncement(
                `Cotización N.º ${String(number).padStart(4, "0")} creada en Borrador.`,
              );
            }}
          />
        </DrawerContent>
      </Drawer>
      <p role="status" className="sr-only">
        {announcement}
      </p>
    </>
  );
}

/** Copy es-PY de cada error. Ninguno expone detalles internos. */
function errorMessage(field: QuoteFormField, error: QuoteFormError): string {
  switch (error) {
    case "required":
      if (field === "vehicleId") return "Elegí la unidad a cotizar.";
      if (field === "discountValue") return "Ingresá el descuento.";
      if (field === "validUntil") return "Elegí hasta cuándo vale.";
      return QUOTE_FIELD_ERROR_LABELS.required;
    case "unavailable":
      return "Esa unidad ya no está en stock. Elegí otra.";
    case "without_price":
      return "Esa unidad no tiene precio publicado. Cargalo en Stock para cotizarla.";
    default:
      return QUOTE_FIELD_ERROR_LABELS[error];
  }
}

const FORM_MESSAGES = {
  invalid: "Revisá los datos marcados. No se creó la cotización.",
  opportunity_unavailable:
    "La oportunidad ya no admite cotizaciones (cambió de etapa o se cerró). No se creó nada.",
  failed:
    "No pudimos crear la cotización. No se guardó nada: intentá de nuevo en unos minutos.",
} as const;

const FIELD_ORDER: readonly QuoteFormField[] = [
  "vehicleId",
  "discountKind",
  "discountValue",
  "validUntil",
  "notes",
];

const textareaClassName =
  "min-h-20 w-full resize-y rounded-md border border-border-default bg-surface-1 px-3 py-2 text-body text-text-primary transition-[border-color] hover:border-border-strong focus-visible:border-brand focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring aria-invalid:border-danger disabled:cursor-not-allowed disabled:bg-surface-2";

/** Descuento que se puede previsualizar, o null si todavía no es válido. */
function previewDiscount(
  kind: DiscountKind,
  raw: string,
  listPrice: Money,
): Discount | null {
  if (kind === "none") return { kind };
  const value = kind === "amount" ? parseAmount(raw.trim()) : parsePercent(raw);
  if (value === null || value === "0.00") return null;
  if (
    kind === "amount" &&
    listPrice.currency === "PYG" &&
    !value.endsWith(".00")
  ) {
    return null;
  }
  const discount: Discount = { kind, value };
  return discountExceeds(listPrice, discount, MAX_DISCOUNT_PERCENT)
    ? null
    : discount;
}

type QuoteFormProps = NewQuoteDrawerProps & {
  firstFieldRef: RefObject<HTMLSelectElement | null>;
  onSavingChange: (saving: boolean) => void;
  onCreated: (number: number) => void;
};

function QuoteForm({
  opportunityId,
  vehicleOptions,
  suggestedVehicleId,
  today,
  firstFieldRef,
  onSavingChange,
  onCreated,
}: QuoteFormProps) {
  const [state, action, pending] = useActionState<CreateQuoteState, FormData>(
    createQuote,
    null,
  );
  const id = useId();
  const fieldId = (field: QuoteFormField) => `${id}-${field}`;
  const submitRef = useRef<HTMLButtonElement>(null);

  const echo =
    state !== null && state.status !== "created" ? state.values : undefined;
  const [vehicleId, setVehicleId] = useState(
    echo?.vehicleId ?? suggestedVehicleId ?? "",
  );
  const [kind, setKind] = useState<DiscountKind>("none");
  const [value, setValue] = useState("");
  const [notes, setNotes] = useState("");
  const [localErrors, setLocalErrors] = useState<QuoteFormErrors | null>(null);

  const selected = vehicleOptions.find((option) => option.id === vehicleId);
  const errors: QuoteFormErrors =
    localErrors ??
    (!pending && state?.status === "invalid" ? state.errors : {});
  const message =
    !pending &&
    state !== null &&
    state.status !== "created" &&
    localErrors === null
      ? FORM_MESSAGES[state.status]
      : localErrors && Object.keys(localErrors).length > 0
        ? FORM_MESSAGES.invalid
        : null;
  const noVehicles = vehicleOptions.length === 0;
  const latest = addDays(today, MAX_VALIDITY_DAYS);
  const notesLength = noteLength(normalizeNoteBody(notes));
  const notesTooLong = notesLength > QUOTE_NOTES_MAX_LENGTH;

  const discount = selected
    ? previewDiscount(kind, value, selected.listPrice)
    : null;
  const total =
    selected && discount ? quoteTotal(selected.listPrice, discount) : null;
  const discountView =
    selected && discount
      ? quoteDiscountView(selected.listPrice, discount)
      : null;
  const needsAdmin =
    selected && discount
      ? requiresAdminApproval(selected.listPrice, discount)
      : false;

  const reportSaving = useEffectEvent(onSavingChange);
  useEffect(() => reportSaving(pending), [pending]);

  // Al terminar, el foco vuelve a donde hay que actuar: el primer campo a
  // corregir o, tras una falla, el botón para reintentar.
  const settle = useEffectEvent(() => {
    if (state?.status === "created") {
      onCreated(state.number);
    } else if (state?.status === "invalid") {
      focusFirst(state.errors);
    } else if (state !== null) {
      submitRef.current?.focus();
    }
  });
  useEffect(() => settle(), [state]);

  function focusFirst(found: QuoteFormErrors) {
    const first = FIELD_ORDER.find((field) => found[field]);
    if (first) document.getElementById(fieldId(first))?.focus();
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || noVehicles) return;
    const form = event.currentTarget;
    if (!selected) {
      const found: QuoteFormErrors = { vehicleId: "required" };
      setLocalErrors(found);
      focusFirst(found);
      return;
    }
    const data = new FormData(form);
    const text = (field: QuoteFormField) => {
      const raw = data.get(QUOTE_FIELDS[field]);
      return typeof raw === "string" ? raw : "";
    };
    const checked = parseQuoteTerms(
      {
        discountKind: text("discountKind"),
        discountValue: text("discountValue"),
        validUntil: text("validUntil"),
        notes: text("notes"),
      },
      selected.listPrice,
      today,
    );
    if (!checked.ok) {
      setLocalErrors(checked.errors);
      focusFirst(checked.errors);
      return;
    }
    setLocalErrors(null);
    startTransition(() => action(data));
  }

  /** Props de accesibilidad de un campo según su error. */
  const described = (field: QuoteFormField, hint?: boolean) => {
    const error = errors[field];
    const ids = [
      hint ? `${fieldId(field)}-hint` : null,
      error ? `${fieldId(field)}-error` : null,
    ].filter(Boolean);
    return {
      id: fieldId(field),
      name: QUOTE_FIELDS[field],
      disabled: pending || noVehicles,
      "aria-invalid": error ? true : undefined,
      "aria-describedby": ids.length > 0 ? ids.join(" ") : undefined,
    } as const;
  };

  const fieldError = (field: QuoteFormField) => {
    const error = errors[field];
    return {
      error: error && errorMessage(field, error),
      errorId: `${fieldId(field)}-error`,
    };
  };

  /** Al editar un campo, su error local deja de aplicar. */
  const clearLocal = (field: QuoteFormField) => {
    if (localErrors?.[field]) {
      const rest = { ...localErrors };
      delete rest[field];
      setLocalErrors(rest);
    }
  };

  return (
    <form
      onSubmit={submit}
      noValidate
      aria-busy={pending}
      className="flex min-h-0 flex-1 flex-col"
    >
      <input
        type="hidden"
        name={QUOTE_FIELDS.opportunityId}
        value={opportunityId}
      />
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-4">
        {message ? (
          <p
            role="alert"
            className={
              state?.status === "failed" ||
              state?.status === "opportunity_unavailable"
                ? "rounded-md border border-danger-border bg-danger-soft px-3 py-2 text-label text-danger"
                : "rounded-md border border-warning-border bg-warning-soft px-3 py-2 text-label text-warning"
            }
          >
            {message}
          </p>
        ) : null}

        {noVehicles ? (
          <p className="rounded-md border border-border-subtle bg-surface-2 px-3 py-2.5 text-label text-text-secondary">
            No hay unidades disponibles o reservadas con precio publicado. Cargá
            el precio de una unidad en Stock para cotizarla.
          </p>
        ) : null}

        <fieldset className="flex flex-col gap-3.5">
          <legend className="mb-3 text-overline text-text-muted uppercase">
            Unidad
          </legend>
          <FormField
            label="Unidad a cotizar"
            htmlFor={fieldId("vehicleId")}
            hint="Disponibles o reservadas, con precio publicado."
            hintId={`${fieldId("vehicleId")}-hint`}
            {...fieldError("vehicleId")}
          >
            <select
              ref={firstFieldRef}
              value={vehicleId}
              onChange={(event) => {
                setVehicleId(event.currentTarget.value);
                clearLocal("vehicleId");
                clearLocal("discountValue");
              }}
              required
              className={`${inputClassName} [font-feature-settings:'calt'_0]`}
              {...described("vehicleId", true)}
            >
              <option value="">Elegí una unidad</option>
              {vehicleOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label} · {option.listPriceLabel}
                </option>
              ))}
            </select>
          </FormField>
          <div className="flex items-center justify-between gap-3 rounded-md border border-border-subtle bg-surface-2 px-3 py-2.5">
            <p className="flex items-center gap-1.5 text-label text-text-secondary">
              <LockIcon
                aria-hidden="true"
                className="size-3.5 text-text-muted"
              />
              Precio de lista
            </p>
            <p className="text-body font-semibold text-text-primary tabular-nums">
              {selected ? selected.listPriceLabel : "—"}
            </p>
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-3.5">
          <legend className="mb-3 text-overline text-text-muted uppercase">
            Descuento
          </legend>
          <div
            id={fieldId("discountKind")}
            tabIndex={-1}
            role="radiogroup"
            aria-label="Tipo de descuento"
            aria-invalid={errors.discountKind ? true : undefined}
            className="grid grid-cols-3 gap-1 rounded-md border border-border-default bg-surface-2 p-1"
          >
            {DISCOUNT_KINDS.map((option) => (
              <label
                key={option}
                className={cn(
                  "relative flex h-8 cursor-pointer items-center justify-center rounded-sm px-2 text-center text-label font-semibold transition-[background-color,color,box-shadow] duration-150 ease-out-strong has-focus-visible:outline-2 has-focus-visible:outline-offset-1 has-focus-visible:outline-focus-ring has-disabled:cursor-not-allowed has-disabled:opacity-60",
                  kind === option
                    ? "bg-surface-1 text-text-primary shadow-sm"
                    : "text-text-secondary hover:text-text-primary",
                )}
              >
                <input
                  type="radio"
                  name={QUOTE_FIELDS.discountKind}
                  value={option}
                  checked={kind === option}
                  onChange={() => {
                    setKind(option);
                    clearLocal("discountKind");
                    clearLocal("discountValue");
                  }}
                  disabled={pending || noVehicles}
                  className="sr-only"
                />
                <span className="truncate">{DISCOUNT_KIND_LABELS[option]}</span>
              </label>
            ))}
          </div>
          {kind !== "none" ? (
            <FormField
              label={kind === "percent" ? "Porcentaje" : "Monto a descontar"}
              htmlFor={fieldId("discountValue")}
              hint={
                kind === "percent"
                  ? `Hasta ${MAX_DISCOUNT_PERCENT} %, con coma para decimales (7,5).`
                  : `En ${selected?.listPrice.currency === "PYG" ? "guaraníes, sin decimales" : "la moneda de la lista"}. Hasta el ${MAX_DISCOUNT_PERCENT} % del precio.`
              }
              hintId={`${fieldId("discountValue")}-hint`}
              {...fieldError("discountValue")}
            >
              <div className="relative">
                <input
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  value={value}
                  onChange={(event) => {
                    setValue(event.currentTarget.value);
                    clearLocal("discountValue");
                  }}
                  placeholder={kind === "percent" ? "7,5" : "1.500"}
                  className={cn(inputClassName, "pr-14 tabular-nums")}
                  {...described("discountValue", true)}
                />
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-label text-text-muted"
                >
                  {kind === "percent"
                    ? "%"
                    : selected?.listPrice.currency === "PYG"
                      ? "Gs."
                      : (selected?.listPrice.currency ?? "")}
                </span>
              </div>
            </FormField>
          ) : (
            <input type="hidden" name={QUOTE_FIELDS.discountValue} value="" />
          )}
        </fieldset>

        <fieldset className="flex flex-col gap-3.5">
          <legend className="mb-3 text-overline text-text-muted uppercase">
            Condiciones
          </legend>
          <FormField
            label="Válida hasta"
            htmlFor={fieldId("validUntil")}
            hint={`Inclusive. Hasta ${MAX_VALIDITY_DAYS} días desde hoy.`}
            hintId={`${fieldId("validUntil")}-hint`}
            {...fieldError("validUntil")}
          >
            <input
              type="date"
              required
              min={today}
              max={latest}
              defaultValue={
                echo?.validUntil || addDays(today, DEFAULT_VALIDITY_DAYS)
              }
              onChange={() => clearLocal("validUntil")}
              className={`${inputClassName} tabular-nums`}
              {...described("validUntil", true)}
            />
          </FormField>
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor={fieldId("notes")}
              className="text-label text-text-secondary"
            >
              Condiciones
              <span className="font-normal text-text-muted"> (opcional)</span>
            </label>
            <textarea
              {...described("notes", true)}
              aria-invalid={errors.notes || notesTooLong ? true : undefined}
              rows={3}
              value={notes}
              onChange={(event) => {
                setNotes(event.currentTarget.value);
                clearLocal("notes");
              }}
              placeholder="Incluye transferencia y primer service. Entrega en 15 días."
              className={textareaClassName}
            />
            <div className="flex items-start justify-between gap-3">
              <p
                id={`${fieldId("notes")}-error`}
                className={cn(
                  "text-caption text-danger",
                  !errors.notes && "sr-only",
                )}
              >
                {errors.notes ? errorMessage("notes", errors.notes) : null}
              </p>
              <p
                id={`${fieldId("notes")}-hint`}
                className={cn(
                  "shrink-0 text-caption tabular-nums",
                  notesTooLong ? "text-danger" : "text-text-muted",
                )}
              >
                {notesLength.toLocaleString("es-PY")} /{" "}
                {QUOTE_NOTES_MAX_LENGTH.toLocaleString("es-PY")}
              </p>
            </div>
          </div>
        </fieldset>

        <section
          aria-label="Resumen de la cotización"
          aria-live="polite"
          className="flex flex-col gap-2 rounded-md border border-brand-border bg-brand-soft/40 px-3.5 py-3"
        >
          <div className="flex items-center justify-between gap-3">
            <p className="text-overline text-text-muted uppercase">Resumen</p>
            <QuoteStatusChip status="draft" />
          </div>
          <dl className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-label text-text-secondary">Lista</dt>
              <dd className="text-body text-text-primary tabular-nums">
                {selected ? selected.listPriceLabel : "—"}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-label text-text-secondary">
                Descuento
                {discountView ? ` (${discountView.effectiveLabel})` : ""}
              </dt>
              <dd
                className={cn(
                  "text-body tabular-nums",
                  discountView ? "text-success" : "text-text-muted",
                )}
              >
                {discountView
                  ? discountView.amountLabel
                  : kind === "none"
                    ? "Sin descuento"
                    : "—"}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-4 border-t border-brand-border pt-2">
              <dt className="text-label font-semibold text-text-primary">
                Total
              </dt>
              <dd className="text-title font-semibold text-text-primary tabular-nums">
                {total ? formatMoney(total) : "—"}
              </dd>
            </div>
          </dl>
          {needsAdmin ? (
            <p className="flex items-start gap-1.5 text-caption text-warning">
              <LockIcon
                aria-hidden="true"
                className="mt-px size-3.5 shrink-0"
              />
              Supera el {SELLER_DISCOUNT_LIMIT_PERCENT} %: la cotización la
              tiene que aprobar un admin.
            </p>
          ) : null}
        </section>
        <p className="text-caption text-text-muted">
          Las condiciones no se editan después: para corregirla se anula y se
          crea otra. Crear la cotización no le envía nada al cliente.
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
          disabled={pending || noVehicles}
          className={
            pending
              ? "disabled:cursor-wait disabled:opacity-70"
              : "disabled:cursor-not-allowed disabled:opacity-50"
          }
        >
          {pending ? "Creando…" : "Crear cotización"}
        </Button>
      </footer>
    </form>
  );
}

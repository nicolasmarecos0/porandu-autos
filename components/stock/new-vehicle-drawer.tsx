"use client";

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
import { cn } from "@/components/ui/cn";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { FormField, inputClassName } from "@/components/ui/form-field";
import { PlusIcon } from "@/components/ui/icons";
import {
  CURRENCIES,
  CURRENCY_LABELS,
  NEW_VEHICLE_FIELDS,
  NEW_VEHICLE_MAX_LENGTH,
  VEHICLE_YEAR_RANGE,
  type NewVehicleField,
  type NewVehicleFieldError,
} from "@/domains/vehicles/new-vehicle";
import { createVehicle } from "@/lib/vehicles/actions";
import type { CreateVehicleState } from "@/lib/vehicles/new-vehicle";

import { LITERAL, StatusChip } from "./stock-status";

/*
 * Alta rápida de una unidad (H1.3B): botón "Nueva unidad" y drawer lateral
 * con el formulario corto. No conoce la base: envía el formulario a la
 * Server Action createVehicle(), que valida en el servidor y crea la unidad
 * en preparación, en la organización activa.
 *
 * El formulario solo tiene datos de la unidad: ni organización, ni estado,
 * ni campos ocultos. El estado inicial se muestra, pero no se elige. Mientras
 * guarda no se puede cerrar ni reenviar. Un error deja lo cargado para
 * corregir o reintentar; al crear, el drawer se cierra y la vista selecciona
 * la unidad nueva.
 */

export type VehicleCreated = Extract<CreateVehicleState, { status: "created" }>;

type NewVehicleDrawerProps = {
  onCreated: (created: VehicleCreated) => void;
};

export function NewVehicleDrawer({ onCreated }: NewVehicleDrawerProps) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  // Mientras se guarda, ni Escape, ni el velo, ni el botón cierran.
  const keepOpenWhileSaving = (event: Event) => {
    if (saving) event.preventDefault();
  };

  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        if (!next && saving) return;
        setOpen(next);
      }}
    >
      <DrawerTrigger asChild>
        <Button variant="primary">
          <PlusIcon className="size-4" />
          Nueva unidad
        </Button>
      </DrawerTrigger>
      <DrawerContent
        title="Nueva unidad"
        description="Cargá lo básico de la unidad. Entra al stock en preparación."
        closeDisabled={saving}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          firstFieldRef.current?.focus();
        }}
        onEscapeKeyDown={keepOpenWhileSaving}
        onInteractOutside={keepOpenWhileSaving}
      >
        <NewVehicleForm
          firstFieldRef={firstFieldRef}
          onSavingChange={setSaving}
          onCreated={(created) => {
            setSaving(false);
            setOpen(false);
            onCreated(created);
          }}
        />
      </DrawerContent>
    </Drawer>
  );
}

/** Copy es-PY de cada error. Ninguno expone detalles internos. */
const REQUIRED: Partial<Record<NewVehicleField, string>> = {
  brand: "Ingresá la marca.",
  model: "Ingresá el modelo.",
  year: "Ingresá el año.",
  price: "Ingresá el precio, o dejá la moneda sin elegir.",
  currency: "Elegí la moneda del precio.",
};

function errorMessage(
  field: NewVehicleField,
  error: NewVehicleFieldError,
): string {
  switch (error) {
    case "required":
      return REQUIRED[field] ?? "Completá este dato.";
    case "too_long":
      return field in NEW_VEHICLE_MAX_LENGTH
        ? `Usá hasta ${NEW_VEHICLE_MAX_LENGTH[field as keyof typeof NEW_VEHICLE_MAX_LENGTH]} caracteres.`
        : "Revisá este dato.";
    case "invalid_year":
      return `Ingresá un año entre ${VEHICLE_YEAR_RANGE.min} y ${VEHICLE_YEAR_RANGE.max}.`;
    case "invalid_km":
      return "Ingresá un número entero, sin decimales.";
    case "invalid_price":
      return "Ingresá un precio mayor a 0, como 31.500 o 32.990,50.";
    case "pyg_decimals":
      return "En guaraníes el precio va sin decimales.";
    case "invalid_currency":
      return "Elegí una moneda de la lista.";
  }
}

const FORM_MESSAGES = {
  invalid: "Revisá los datos marcados.",
  failed:
    "No pudimos guardar la unidad. No se guardó nada: intentá de nuevo en unos minutos.",
} as const;

type NewVehicleFormProps = {
  firstFieldRef: RefObject<HTMLInputElement | null>;
  onSavingChange: (saving: boolean) => void;
  onCreated: (created: VehicleCreated) => void;
};

function NewVehicleForm({
  firstFieldRef,
  onSavingChange,
  onCreated,
}: NewVehicleFormProps) {
  const [state, action, pending] = useActionState<CreateVehicleState, FormData>(
    createVehicle,
    null,
  );
  const id = useId();
  const fieldId = (field: NewVehicleField) => `${id}-${field}`;
  const submitRef = useRef<HTMLButtonElement>(null);

  const values =
    state?.status === "invalid" || state?.status === "failed"
      ? state.values
      : undefined;
  const errors = state?.status === "invalid" ? state.errors : {};
  // Solo una moneda de la lista vuelve al select.
  const echoedCurrency =
    CURRENCIES.find((currency) => currency === values?.currency) ?? "";
  // Mientras guarda no queda el aviso del intento anterior; si vuelve a
  // fallar, la alerta se inserta de nuevo y se vuelve a anunciar.
  const message =
    !pending && (state?.status === "invalid" || state?.status === "failed")
      ? FORM_MESSAGES[state.status]
      : null;

  const reportSaving = useEffectEvent(onSavingChange);
  useEffect(() => reportSaving(pending), [pending]);

  // Al terminar, el foco vuelve a donde hay que actuar: el primer campo a
  // corregir o, tras una falla, el botón para reintentar. Al crear, el
  // drawer se cierra y Radix lo devuelve al trigger.
  const settle = useEffectEvent(() => {
    if (state?.status === "created") {
      onCreated(state);
    } else if (state?.status === "invalid") {
      const first = NEW_VEHICLE_FIELDS.find((field) => state.errors[field]);
      if (first) document.getElementById(fieldId(first))?.focus();
    } else if (state?.status === "failed") {
      submitRef.current?.focus();
    }
  });
  useEffect(() => settle(), [state]);

  /** Props de accesibilidad de un campo según su error. */
  const described = (field: NewVehicleField, hint?: boolean) => {
    const error = errors[field];
    const ids = [
      hint ? `${fieldId(field)}-hint` : null,
      error ? `${fieldId(field)}-error` : null,
    ].filter(Boolean);
    return {
      id: fieldId(field),
      name: field,
      disabled: pending,
      "aria-invalid": error ? true : undefined,
      "aria-describedby": ids.length > 0 ? ids.join(" ") : undefined,
    } as const;
  };

  /** Mensaje de error y su id, para el FormField del campo. */
  const fieldError = (field: NewVehicleField) => {
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

        <fieldset className="flex flex-col gap-3.5">
          <legend className="mb-3 text-overline text-text-muted uppercase">
            Unidad
          </legend>
          <div className="grid grid-cols-2 gap-3">
            <FormField
              label="Marca"
              htmlFor={fieldId("brand")}
              {...fieldError("brand")}
            >
              <input
                ref={firstFieldRef}
                type="text"
                autoComplete="off"
                required
                placeholder="Toyota"
                maxLength={NEW_VEHICLE_MAX_LENGTH.brand}
                defaultValue={values?.brand}
                className={cn(inputClassName, LITERAL)}
                {...described("brand")}
              />
            </FormField>
            <FormField
              label="Modelo"
              htmlFor={fieldId("model")}
              {...fieldError("model")}
            >
              <input
                type="text"
                autoComplete="off"
                required
                placeholder="Hilux"
                maxLength={NEW_VEHICLE_MAX_LENGTH.model}
                defaultValue={values?.model}
                className={cn(inputClassName, LITERAL)}
                {...described("model")}
              />
            </FormField>
          </div>
          <FormField
            label="Versión"
            optional
            htmlFor={fieldId("version")}
            {...fieldError("version")}
          >
            <input
              type="text"
              autoComplete="off"
              placeholder="SRV 2.8 4x4 AT"
              maxLength={NEW_VEHICLE_MAX_LENGTH.version}
              defaultValue={values?.version}
              className={cn(inputClassName, LITERAL)}
              {...described("version")}
            />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField
              label="Año"
              htmlFor={fieldId("year")}
              {...fieldError("year")}
            >
              <input
                type="text"
                inputMode="numeric"
                autoComplete="off"
                required
                placeholder="2021"
                maxLength={4}
                defaultValue={values?.year}
                className={`${inputClassName} tabular-nums`}
                {...described("year")}
              />
            </FormField>
            <FormField
              label="Kilometraje"
              optional
              htmlFor={fieldId("km")}
              hint="0 si es 0 km."
              hintId={`${fieldId("km")}-hint`}
              {...fieldError("km")}
            >
              <input
                type="text"
                inputMode="numeric"
                autoComplete="off"
                placeholder="142.000"
                maxLength={13}
                defaultValue={values?.km}
                className={`${inputClassName} tabular-nums`}
                {...described("km", true)}
              />
            </FormField>
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-3.5">
          <legend className="mb-3 text-overline text-text-muted uppercase">
            Precio publicado
          </legend>
          <div className="grid grid-cols-[minmax(0,1fr)_9.5rem] gap-3">
            <FormField
              label="Precio"
              optional
              htmlFor={fieldId("price")}
              hint="Va con su moneda. Punto para los miles, coma para los decimales."
              hintId={`${fieldId("price")}-hint`}
              {...fieldError("price")}
            >
              <input
                type="text"
                inputMode="decimal"
                autoComplete="off"
                placeholder="28.500"
                maxLength={18}
                defaultValue={values?.price}
                className={`${inputClassName} tabular-nums`}
                {...described("price", true)}
              />
            </FormField>
            <FormField
              label="Moneda"
              optional
              htmlFor={fieldId("currency")}
              {...fieldError("currency")}
            >
              <select
                // React no actualiza la opción por defecto de un select ya
                // montado: con otra `key`, el reset del formulario tras la
                // acción conserva la moneda elegida.
                key={echoedCurrency}
                defaultValue={echoedCurrency}
                className={inputClassName}
                {...described("currency")}
              >
                <option value="">Elegí</option>
                {CURRENCIES.map((currency) => (
                  <option key={currency} value={currency}>
                    {CURRENCY_LABELS[currency]}
                  </option>
                ))}
              </select>
            </FormField>
          </div>
        </fieldset>

        <div className="flex items-center justify-between gap-3 rounded-md border border-border-subtle bg-surface-2 px-3 py-2.5">
          <p className="text-label text-text-secondary">Estado al crearla</p>
          <StatusChip status="inPreparation" />
        </div>
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
          disabled={pending}
          className="disabled:cursor-wait disabled:opacity-70"
        >
          {pending ? "Creando…" : "Crear unidad"}
        </Button>
      </footer>
    </form>
  );
}

"use client";

import { useId, useRef, useState, type FormEvent, type RefObject } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Drawer, DrawerClose, DrawerContent } from "@/components/ui/drawer";
import { FormField, inputClassName } from "@/components/ui/form-field";
import { LockIcon } from "@/components/ui/icons";
import { CURRENCIES, CURRENCY_LABELS, formatMoney } from "@/domains/money";
import type {
  TradeInCardView,
  TradeInOptimisticAction,
} from "@/domains/opportunities/trade-in-presentation";
import {
  parseTradeInAppraisal,
  parseTradeInVehicle,
  TRADE_IN_APPRAISAL_FIELDS,
  TRADE_IN_FIELDS,
  TRADE_IN_MAX_LENGTH,
  tradeInIntakeCost,
  type TradeInAppraisalField,
  type TradeInAppraisalValues,
  type TradeInFieldError,
  type TradeInVehicleField,
  type TradeInVehicleValues,
} from "@/domains/opportunities/trade-ins";
import {
  TRADE_IN_FORM_FIELDS,
  type TradeInFormErrors,
  type TradeInFormField,
  type TradeInFormValues,
} from "@/lib/trade-ins/requests";

import { TradeInStatusChip } from "./trade-in-status";

/*
 * Formulario de la toma (Hito 20, DEC-052 §4) en un drawer lateral (Radix
 * Dialog): dos secciones, como pidió el fundador.
 *
 *   Datos del usado   Marca · Modelo · Versión · Año · Kilometraje · Chapa
 *   Tasación          Moneda · Costo de reacondicionamiento · Valor de toma
 *                     → Costo total de ingreso (en vivo)
 *
 * - Registrar: cualquier miembro carga el usado y queda Pendiente de
 *   tasación. Un admin (el tasador o gerente) puede cargar además la
 *   tasación en el mismo acto.
 * - Tasar / Retasar: solo el admin, sobre la toma vigente; el usado se
 *   muestra de solo lectura (no cambia: es lo que se tasa y lo que entra al
 *   stock).
 * - La sección financiera es exclusiva del admin: un seller ve que la carga
 *   el admin, sin campos.
 *
 * Valida antes de enviar con la validación del dominio (Zod) y avisa por
 * campo, con el foco en el primer error; el servidor la repite y es el que
 * decide. No envía nada por su cuenta: entrega el pedido ya validado, con
 * el estado optimista que corresponde, a `onSubmit`, y el panel lo guarda.
 * Si el servidor devuelve un error o una falla, el panel lo reabre con lo
 * cargado (`retry`).
 */

export type TradeInDrawerMode = "register" | "appraise" | "reappraise";

export type TradeInDrawerRequest = Readonly<{
  mode: TradeInDrawerMode;
  /** El intento anterior que volvió del servidor: errores, lo cargado y aviso. */
  retry: Readonly<{
    errors: TradeInFormErrors;
    values: TradeInFormValues | null;
    message: string | null;
  }> | null;
}>;

const COPY: Readonly<
  Record<
    TradeInDrawerMode,
    Readonly<{ title: string; description: string; submit: string }>
  >
> = {
  register: {
    title: "Registrar usado",
    description:
      "El vehículo que el cliente entrega en parte de pago. Queda Pendiente de tasación hasta que lo tase un admin.",
    submit: "Registrar usado",
  },
  appraise: {
    title: "Tasar usado",
    description:
      "Cargá el costo de reacondicionamiento y el valor de toma que se le ofrece al cliente.",
    submit: "Guardar tasación",
  },
  reappraise: {
    title: "Retasar usado",
    description:
      "Corregí la tasación mientras el cliente no responde. El valor nuevo reemplaza al anterior.",
    submit: "Guardar tasación",
  },
};

const REQUIRED: Readonly<Record<TradeInFormField, string>> = {
  brand: "Ingresá la marca.",
  model: "Ingresá el modelo.",
  version: "Revisá la versión.",
  year: "Ingresá el año modelo.",
  km: "Revisá el kilometraje.",
  plate: "Revisá la chapa.",
  currency: "Elegí la moneda de la tasación.",
  estimatedRepairCost: "Ingresá el costo (0 si no necesita arreglos).",
  offerPrice: "Ingresá el valor de toma.",
};

const MAX: Partial<Record<TradeInFormField, number>> = {
  brand: TRADE_IN_MAX_LENGTH.brand,
  model: TRADE_IN_MAX_LENGTH.model,
  version: TRADE_IN_MAX_LENGTH.version,
};

/** Copy del error de un campo (es-PY). Ninguno expone detalles internos. */
export function tradeInErrorMessage(
  field: TradeInFormField,
  error: TradeInFieldError,
): string {
  switch (error) {
    case "required":
      return REQUIRED[field];
    case "too_long":
      return `Puede tener hasta ${MAX[field] ?? 80} caracteres.`;
    case "invalid_year":
      return "Escribí el año con cuatro dígitos, por ejemplo 2015.";
    case "invalid_km":
      return "Escribí el kilometraje como 98.000.";
    case "invalid_plate":
      return "Escribí la chapa con letras y números, por ejemplo ABC 123.";
    case "invalid_option":
      return "Elegí una opción de la lista.";
    case "invalid_amount":
      return "Escribí el monto como 8.000 o 8.000,50.";
    case "not_positive":
      return "El valor de toma tiene que ser mayor que cero.";
    case "pyg_decimals":
      return "En guaraníes, el monto va sin decimales.";
  }
}

/** El `name` del control de cada campo (los del alta o los de la tasación). */
function fieldName(field: TradeInFormField): string {
  return field in TRADE_IN_FIELDS
    ? TRADE_IN_FIELDS[field as TradeInVehicleField]
    : TRADE_IN_APPRAISAL_FIELDS[field as TradeInAppraisalField];
}

function valuesOf(data: FormData): Record<TradeInFormField, string> {
  return Object.fromEntries(
    TRADE_IN_FORM_FIELDS.map((field) => {
      const raw = data.get(fieldName(field));
      return [field, typeof raw === "string" ? raw : ""];
    }),
  ) as Record<TradeInFormField, string>;
}

export function TradeInDrawer({
  request,
  opportunityId,
  current,
  viewerIsAdmin,
  onCancel,
  onSubmit,
}: {
  request: TradeInDrawerRequest | null;
  opportunityId: string;
  /** La toma vigente: la que se tasa o retasa. */
  current: TradeInCardView | null;
  viewerIsAdmin: boolean;
  onCancel: () => void;
  onSubmit: (
    mode: TradeInDrawerMode,
    formData: FormData,
    action: TradeInOptimisticAction,
  ) => void;
}) {
  const firstFieldRef = useRef<HTMLInputElement & HTMLSelectElement>(null);
  const copy = request ? COPY[request.mode] : null;
  return (
    <Drawer
      open={request !== null}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      {request && copy ? (
        <DrawerContent
          title={copy.title}
          description={copy.description}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            firstFieldRef.current?.focus();
          }}
        >
          <TradeInForm
            // Cada apertura empieza con lo que corresponde (lo cargado tras
            // un error, o la tasación vigente para retasar).
            key={`${request.mode}-${current?.id ?? "new"}`}
            request={request}
            opportunityId={opportunityId}
            current={current}
            viewerIsAdmin={viewerIsAdmin}
            firstFieldRef={firstFieldRef}
            submitLabel={copy.submit}
            onSubmit={onSubmit}
          />
        </DrawerContent>
      ) : null}
    </Drawer>
  );
}

function TradeInForm({
  request,
  opportunityId,
  current,
  viewerIsAdmin,
  firstFieldRef,
  submitLabel,
  onSubmit,
}: {
  request: TradeInDrawerRequest;
  opportunityId: string;
  current: TradeInCardView | null;
  viewerIsAdmin: boolean;
  firstFieldRef: RefObject<(HTMLInputElement & HTMLSelectElement) | null>;
  submitLabel: string;
  onSubmit: (
    mode: TradeInDrawerMode,
    formData: FormData,
    action: TradeInOptimisticAction,
  ) => void;
}) {
  const id = useId();
  const { mode, retry } = request;
  const registering = mode === "register";
  const initial: Partial<TradeInFormValues> =
    retry?.values ??
    (mode === "reappraise" && current?.appraisalValues
      ? current.appraisalValues
      : {});
  const [localErrors, setLocalErrors] = useState<TradeInFormErrors | null>(
    null,
  );
  const [appraisal, setAppraisal] = useState<TradeInAppraisalValues>({
    currency: initial.currency ?? "",
    estimatedRepairCost: initial.estimatedRepairCost ?? "",
    offerPrice: initial.offerPrice ?? "",
  });
  const errors: TradeInFormErrors = localErrors ?? retry?.errors ?? {};
  const message =
    localErrors && Object.keys(localErrors).length > 0
      ? "Revisá los datos marcados. No se guardó nada."
      : (retry?.message ?? null);

  const parsedAppraisal = parseTradeInAppraisal(appraisal);
  const intake = parsedAppraisal.ok
    ? formatMoney(tradeInIntakeCost(parsedAppraisal.appraisal))
    : null;
  const typedAppraisal = Object.values(appraisal).some(
    (value) => value.trim() !== "",
  );

  const fieldId = (field: TradeInFormField) => `${id}-${field}`;
  const control = (field: TradeInFormField, hint = false) => {
    const error = errors[field];
    const describedBy = [
      hint ? `${fieldId(field)}-hint` : null,
      error ? `${fieldId(field)}-error` : null,
    ].filter(Boolean);
    return {
      id: fieldId(field),
      name: fieldName(field),
      "aria-invalid": error ? true : undefined,
      "aria-describedby":
        describedBy.length > 0 ? describedBy.join(" ") : undefined,
    } as const;
  };
  const fieldError = (field: TradeInFormField) => {
    const error = errors[field];
    return {
      error: error ? tradeInErrorMessage(field, error) : undefined,
      errorId: `${fieldId(field)}-error`,
    };
  };
  const clear = (field: TradeInFormField) => {
    if (localErrors?.[field]) {
      const rest = { ...localErrors };
      delete rest[field];
      setLocalErrors(rest);
    }
  };

  function focusFirst(found: TradeInFormErrors) {
    const first = TRADE_IN_FORM_FIELDS.find((field) => found[field]);
    if (first) document.getElementById(fieldId(first))?.focus();
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const values = valuesOf(data);
    if (registering) {
      const vehicle = parseTradeInVehicle(values as TradeInVehicleValues);
      const withAppraisal = viewerIsAdmin && typedAppraisal;
      const checked = withAppraisal ? parseTradeInAppraisal(values) : null;
      if (!vehicle.ok || (checked !== null && !checked.ok)) {
        const found: TradeInFormErrors = {
          ...(vehicle.ok ? {} : vehicle.errors),
          ...(checked === null || checked.ok ? {} : checked.errors),
        };
        setLocalErrors(found);
        focusFirst(found);
        return;
      }
      setLocalErrors(null);
      onSubmit(mode, data, {
        kind: "register",
        vehicle: vehicle.vehicle,
        appraisal: checked?.ok ? checked.appraisal : null,
      });
      return;
    }
    const checked = parseTradeInAppraisal(values);
    if (!checked.ok) {
      setLocalErrors(checked.errors);
      focusFirst(checked.errors);
      return;
    }
    setLocalErrors(null);
    onSubmit(mode, data, { kind: "appraise", appraisal: checked.appraisal });
  }

  return (
    <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
      {registering ? (
        <input
          type="hidden"
          name={TRADE_IN_FIELDS.opportunityId}
          value={opportunityId}
        />
      ) : current ? (
        <>
          <input
            type="hidden"
            name={TRADE_IN_APPRAISAL_FIELDS.tradeInId}
            value={current.id}
          />
          <input
            type="hidden"
            name={TRADE_IN_APPRAISAL_FIELDS.from}
            value={current.status}
          />
        </>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-4">
        {message ? (
          <p
            role="alert"
            className="rounded-md border border-warning-border bg-warning-soft px-3 py-2 text-label text-warning"
          >
            {message}
          </p>
        ) : null}

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-label font-semibold text-text-primary">
            Datos del usado
          </legend>
          {registering ? (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <FormField
                  label="Marca"
                  htmlFor={fieldId("brand")}
                  {...fieldError("brand")}
                >
                  <input
                    {...control("brand")}
                    ref={firstFieldRef}
                    type="text"
                    autoComplete="off"
                    required
                    placeholder="Toyota"
                    defaultValue={initial.brand ?? ""}
                    onChange={() => clear("brand")}
                    className={inputClassName}
                  />
                </FormField>
                <FormField
                  label="Modelo"
                  htmlFor={fieldId("model")}
                  {...fieldError("model")}
                >
                  <input
                    {...control("model")}
                    type="text"
                    autoComplete="off"
                    required
                    placeholder="Vitz"
                    defaultValue={initial.model ?? ""}
                    onChange={() => clear("model")}
                    className={inputClassName}
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
                  {...control("version")}
                  type="text"
                  autoComplete="off"
                  placeholder="1.3 F"
                  defaultValue={initial.version ?? ""}
                  onChange={() => clear("version")}
                  className={inputClassName}
                />
              </FormField>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <FormField
                  label="Año"
                  htmlFor={fieldId("year")}
                  {...fieldError("year")}
                >
                  <input
                    {...control("year")}
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    required
                    placeholder="2015"
                    maxLength={4}
                    defaultValue={initial.year ?? ""}
                    onChange={() => clear("year")}
                    className={cn(inputClassName, "tabular-nums")}
                  />
                </FormField>
                <FormField
                  label="Kilometraje"
                  optional
                  htmlFor={fieldId("km")}
                  {...fieldError("km")}
                >
                  <input
                    {...control("km")}
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="98.000"
                    defaultValue={initial.km ?? ""}
                    onChange={() => clear("km")}
                    className={cn(inputClassName, "tabular-nums")}
                  />
                </FormField>
                <div className="col-span-2 sm:col-span-1">
                  <FormField
                    label="Chapa"
                    optional
                    htmlFor={fieldId("plate")}
                    {...fieldError("plate")}
                  >
                    <input
                      {...control("plate")}
                      type="text"
                      autoComplete="off"
                      autoCapitalize="characters"
                      placeholder="ABC 123"
                      defaultValue={initial.plate ?? ""}
                      onChange={() => clear("plate")}
                      className={cn(inputClassName, "uppercase tabular-nums")}
                    />
                  </FormField>
                </div>
              </div>
            </>
          ) : current ? (
            <div className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-border-subtle bg-surface-2 px-3 py-2.5">
              <div className="min-w-0">
                <p className="text-label font-semibold text-text-primary">
                  {current.name}
                </p>
                <p className="text-caption text-text-secondary tabular-nums">
                  {[current.detail, current.kmLabel, current.plateLabel]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <TradeInStatusChip status={current.status} />
            </div>
          ) : null}
        </fieldset>

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 flex items-center gap-1.5 text-label font-semibold text-text-primary">
            Tasación
            <span className="inline-flex items-center gap-1 rounded-sm border border-border-default bg-surface-2 px-1.5 text-caption font-normal text-text-secondary">
              <LockIcon aria-hidden="true" className="size-3" />
              Solo admin
            </span>
          </legend>
          {viewerIsAdmin ? (
            <>
              {registering ? (
                <p className="text-caption text-text-muted">
                  Opcional: si ya inspeccionaste el usado, cargá la tasación; si
                  no, queda Pendiente de tasación.
                </p>
              ) : null}
              <FormField
                label="Moneda"
                htmlFor={fieldId("currency")}
                {...fieldError("currency")}
              >
                <select
                  {...control("currency")}
                  ref={registering ? undefined : firstFieldRef}
                  value={appraisal.currency}
                  onChange={(event) => {
                    const currency = event.currentTarget.value;
                    setAppraisal((previous) => ({ ...previous, currency }));
                    clear("currency");
                  }}
                  className={inputClassName}
                >
                  <option value="">Elegí la moneda</option>
                  {CURRENCIES.map((option) => (
                    <option key={option} value={option}>
                      {CURRENCY_LABELS[option]}
                    </option>
                  ))}
                </select>
              </FormField>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <FormField
                  label="Costo de reacondicionamiento"
                  htmlFor={fieldId("estimatedRepairCost")}
                  hint="Arreglos, chapería, limpieza. 0 si no necesita."
                  hintId={`${fieldId("estimatedRepairCost")}-hint`}
                  {...fieldError("estimatedRepairCost")}
                >
                  <input
                    {...control("estimatedRepairCost", true)}
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="800"
                    value={appraisal.estimatedRepairCost}
                    onChange={(event) => {
                      const estimatedRepairCost = event.currentTarget.value;
                      setAppraisal((previous) => ({
                        ...previous,
                        estimatedRepairCost,
                      }));
                      clear("estimatedRepairCost");
                    }}
                    className={cn(inputClassName, "tabular-nums")}
                  />
                </FormField>
                <FormField
                  label="Valor de toma"
                  htmlFor={fieldId("offerPrice")}
                  hint="Lo que se le ofrece al cliente por el usado."
                  hintId={`${fieldId("offerPrice")}-hint`}
                  {...fieldError("offerPrice")}
                >
                  <input
                    {...control("offerPrice", true)}
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="8.000"
                    value={appraisal.offerPrice}
                    onChange={(event) => {
                      const offerPrice = event.currentTarget.value;
                      setAppraisal((previous) => ({ ...previous, offerPrice }));
                      clear("offerPrice");
                    }}
                    className={cn(inputClassName, "tabular-nums")}
                  />
                </FormField>
              </div>
              <div
                className="flex items-baseline justify-between gap-4 rounded-md border border-brand-border bg-brand-soft px-3 py-2.5"
                aria-live="polite"
              >
                <span className="text-label font-semibold text-brand-strong">
                  Costo total de ingreso
                </span>
                <span className="text-title font-semibold text-text-primary tabular-nums">
                  {intake ?? "—"}
                </span>
              </div>
              <p className="-mt-1 text-caption text-text-muted">
                Valor de toma + costo de reacondicionamiento: lo que cuesta
                poner el usado en el salón.
              </p>
            </>
          ) : (
            <p className="flex items-start gap-2 rounded-md border border-border-subtle bg-surface-2 px-3 py-2.5 text-label text-text-secondary">
              <LockIcon
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-text-muted"
              />
              La tasación (costo de reacondicionamiento y valor de toma) la
              carga un admin: el tasador o gerente. El usado queda Pendiente de
              tasación.
            </p>
          )}
        </fieldset>
      </div>
      <footer className="flex shrink-0 flex-col-reverse gap-2 border-t border-border-subtle bg-surface-2 px-5 py-3 sm:flex-row sm:justify-end">
        <DrawerClose asChild>
          <Button variant="secondary" className="h-10 sm:h-8">
            Cancelar
          </Button>
        </DrawerClose>
        <Button type="submit" variant="primary" className="h-10 sm:h-8">
          {registering && viewerIsAdmin && typedAppraisal
            ? "Registrar y tasar"
            : submitLabel}
        </Button>
      </footer>
    </form>
  );
}

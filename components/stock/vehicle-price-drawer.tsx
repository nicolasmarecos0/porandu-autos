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
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { FormField, inputClassName } from "@/components/ui/form-field";
import { RestrictedAction } from "@/components/ui/restricted-action";
import { CURRENCIES, CURRENCY_LABELS, formatAmount } from "@/domains/money";
import {
  isPriceEditable,
  VEHICLE_PRICE_ERROR_MESSAGES,
  VEHICLE_PRICE_FIELDS,
  type VehiclePriceField,
} from "@/domains/vehicles/price";
import {
  formatPrice,
  vehicleName,
  type StockVehicle,
} from "@/domains/vehicles/stock";
import {
  CAPABILITY_REQUIREMENTS,
  unauthorizedRoleMessage,
} from "@/lib/auth/roles";
import { changeVehiclePrice } from "@/lib/vehicles/actions";
import type { ChangeVehiclePriceState } from "@/lib/vehicles/price-change";

/*
 * Precio publicado de una unidad, en el contexto de la unidad del Stock
 * (Hito 22, DEC-054 §3).
 *
 * - Admin (`vehicle.edit_price`): "Editar precio" abre un drawer de Radix
 *   con el precio y la moneda precargados, validación del servidor y
 *   reintento sin perder lo cargado. Al guardar, la Server Action revalida
 *   Stock y el aviso dice el precio nuevo.
 * - Seller: el mismo lugar muestra "Editar precio" bloqueado, con un
 *   tooltip que dice quién lo cambia. La Server Action responde
 *   UNAUTHORIZED_ROLE y la base lo rechaza igual.
 * - Vendida o entregada: el precio quedó en la venta; no hay acción.
 */

export type PriceChangeNotice = Readonly<{
  tone: "success" | "neutral" | "error";
  message: string;
}>;

const EDIT_PRICE_LABEL = "Editar precio";

export function VehiclePriceAction({
  vehicle,
  canEditPrice,
  onNotice,
}: {
  vehicle: StockVehicle;
  canEditPrice: boolean;
  onNotice: (notice: PriceChangeNotice) => void;
}) {
  if (!isPriceEditable(vehicle.status)) return null;
  if (!canEditPrice) {
    return (
      <RestrictedAction
        label={EDIT_PRICE_LABEL}
        reason={CAPABILITY_REQUIREMENTS["vehicle.edit_price"]}
        className="mt-2 h-10 w-full"
      />
    );
  }
  return <VehiclePriceDrawer vehicle={vehicle} onNotice={onNotice} />;
}

function VehiclePriceDrawer({
  vehicle,
  onNotice,
}: {
  vehicle: StockVehicle;
  onNotice: (notice: PriceChangeNotice) => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const firstFieldRef = useRef<HTMLInputElement>(null);
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
        <Button variant="secondary" className="mt-2 h-10 w-full">
          {EDIT_PRICE_LABEL}
        </Button>
      </DrawerTrigger>
      <DrawerContent
        title={EDIT_PRICE_LABEL}
        description={`${vehicleName(vehicle)} ${vehicle.year}. El precio publicado lo ven el Inventario, el Catálogo y las cotizaciones nuevas.`}
        closeDisabled={saving}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          firstFieldRef.current?.focus();
        }}
        onEscapeKeyDown={keepOpenWhileSaving}
        onInteractOutside={keepOpenWhileSaving}
      >
        <VehiclePriceForm
          // Cada apertura empieza de cero, con el precio vigente.
          key={`${vehicle.id}-${open}`}
          vehicle={vehicle}
          firstFieldRef={firstFieldRef}
          onSavingChange={setSaving}
          onDone={(notice) => {
            setSaving(false);
            setOpen(false);
            onNotice(notice);
          }}
        />
      </DrawerContent>
    </Drawer>
  );
}

function noticeOf(state: ChangeVehiclePriceState): PriceChangeNotice | null {
  switch (state?.status) {
    case "changed":
      return {
        tone: "success",
        message: `Precio actualizado: ${state.brand} ${state.model} ${state.year}, ${state.priceLabel}.`,
      };
    case "unchanged":
      return {
        tone: "neutral",
        message: `${state.brand} ${state.model} ${state.year} ya tenía ese precio. No se hizo ningún cambio.`,
      };
    case "locked":
      return {
        tone: "error",
        message: `${state.brand} ${state.model} ${state.year} ya se vendió: el precio no cambia más.`,
      };
    case "unauthorized_role":
      return {
        tone: "error",
        message: unauthorizedRoleMessage(state.capability),
      };
    case "not_found":
      return {
        tone: "error",
        message: "No encontramos la unidad. Puede que ya no exista.",
      };
    default:
      return null;
  }
}

function VehiclePriceForm({
  vehicle,
  firstFieldRef,
  onSavingChange,
  onDone,
}: {
  vehicle: StockVehicle;
  firstFieldRef: RefObject<HTMLInputElement | null>;
  onSavingChange: (saving: boolean) => void;
  onDone: (notice: PriceChangeNotice) => void;
}) {
  const [state, action, pending] = useActionState<
    ChangeVehiclePriceState,
    FormData
  >(changeVehiclePrice, null);
  const id = useId();
  const fieldId = (field: VehiclePriceField) => `${id}-${field}`;

  const values =
    state?.status === "invalid" || state?.status === "failed"
      ? state.values
      : {
          price: vehicle.price ? formatAmount(vehicle.price.amount) : "",
          currency: vehicle.price?.currency ?? "PYG",
        };
  const errors = state?.status === "invalid" ? state.errors : {};
  const echoedCurrency =
    CURRENCIES.find((currency) => currency === values.currency) ?? "PYG";

  const reportSaving = useEffectEvent(onSavingChange);
  useEffect(() => reportSaving(pending), [pending]);

  const settle = useEffectEvent(() => {
    const notice = noticeOf(state);
    if (notice) {
      onDone(notice);
    } else if (state?.status === "invalid") {
      const first = (["price", "currency"] as const).find((f) => errors[f]);
      if (first) document.getElementById(fieldId(first))?.focus();
    }
  });
  useEffect(() => settle(), [state]);

  const described = (field: VehiclePriceField) => {
    const error = errors[field];
    return {
      id: fieldId(field),
      name: VEHICLE_PRICE_FIELDS[field],
      disabled: pending,
      "aria-invalid": error ? true : undefined,
      "aria-describedby": error ? `${fieldId(field)}-error` : undefined,
    } as const;
  };
  const fieldError = (field: VehiclePriceField) => {
    const error = errors[field];
    return {
      error: error && VEHICLE_PRICE_ERROR_MESSAGES[error],
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
      <input
        type="hidden"
        name={VEHICLE_PRICE_FIELDS.vehicleId}
        value={vehicle.id}
      />
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
        {state?.status === "failed" && !pending ? (
          <p
            role="alert"
            className="rounded-md border border-danger-border bg-danger-soft px-3 py-2 text-label text-danger"
          >
            No pudimos guardar el precio. No se hizo ningún cambio: intentá de
            nuevo.
          </p>
        ) : null}
        <p className="rounded-md border border-border-subtle bg-surface-2 px-3 py-2 text-label text-text-secondary">
          Precio actual:{" "}
          <span className="font-semibold text-text-primary tabular-nums">
            {vehicle.price ? formatPrice(vehicle.price) : "Sin dato"}
          </span>
        </p>
        <div className="grid grid-cols-[minmax(0,1fr)_9.5rem] gap-3">
          <FormField
            label="Precio publicado"
            htmlFor={fieldId("price")}
            {...fieldError("price")}
          >
            <input
              ref={firstFieldRef}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              placeholder="28.500"
              maxLength={18}
              defaultValue={values.price}
              className={`${inputClassName} tabular-nums`}
              {...described("price")}
            />
          </FormField>
          <FormField
            label="Moneda"
            htmlFor={fieldId("currency")}
            {...fieldError("currency")}
          >
            <select
              key={echoedCurrency}
              defaultValue={echoedCurrency}
              className={inputClassName}
              {...described("currency")}
            >
              {CURRENCIES.map((currency) => (
                <option key={currency} value={currency}>
                  {CURRENCY_LABELS[currency]}
                </option>
              ))}
            </select>
          </FormField>
        </div>
        <p className="text-caption text-text-muted">
          Las cotizaciones ya emitidas conservan su precio de lista.
        </p>
      </div>
      <footer className="flex shrink-0 justify-end gap-2 border-t border-border-subtle bg-surface-2 px-5 py-3">
        <DrawerClose asChild>
          <Button variant="secondary" disabled={pending}>
            Cancelar
          </Button>
        </DrawerClose>
        <Button
          type="submit"
          variant="primary"
          disabled={pending}
          className="disabled:cursor-wait disabled:opacity-70"
        >
          {pending ? "Guardando…" : "Guardar precio"}
        </Button>
      </footer>
    </form>
  );
}

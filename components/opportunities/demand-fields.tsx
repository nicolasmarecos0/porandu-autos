"use client";

import { useState, type ReactNode, type Ref } from "react";
import { FormField, inputClassName } from "@/components/ui/form-field";
import { ChevronRightIcon } from "@/components/ui/icons";
import { cn } from "@/components/ui/cn";
import { DEMAND_YEAR_RANGE, type DemandFact } from "@/domains/demand/facts";
import {
  DEMAND_FORM_FIELDS_BY_FACT,
  DEMAND_FORM_MAX_LENGTH,
  type DemandFormError,
  type DemandFormErrors,
  type DemandFormField,
  type DemandFormValues,
} from "@/domains/demand/form";
import { PURCHASE_TYPE_LABELS } from "@/domains/demand/presentation";
import { PURCHASE_TYPES } from "@/domains/demand/facts";
import { CURRENCIES, CURRENCY_LABELS } from "@/domains/money";

/*
 * Campos de "Lo que busca" (H1.4, DEC-030 §10), comunes al alta y a la
 * edición. Todo es opcional: un campo vacío o "Sin dato" no crea fact. El
 * orden sigue las tres preguntas (pago, entrega, usado), después el
 * presupuesto y los años.
 *
 * Controlados: quien los usa guarda los valores (para el eco tras un error
 * y, en la edición, para saber qué se modificó). `nameOf` decide qué campos
 * se envían: un campo sin `name` no viaja en el formulario.
 */

/** Copy es-PY de cada error de la demanda. El de dinero, el de Stock. */
export function demandErrorMessage(
  field: DemandFormField | "note",
  error: DemandFormError,
): string {
  switch (error) {
    case "required":
      if (field === "budgetCurrency" || field === "downPaymentCurrency") {
        return "Elegí la moneda del monto.";
      }
      return "Ingresá el monto, o dejá la moneda sin elegir.";
    case "too_long":
      return `Usá hasta ${
        field === "note"
          ? DEMAND_FORM_MAX_LENGTH.note
          : field === "brand"
            ? DEMAND_FORM_MAX_LENGTH.brand
            : DEMAND_FORM_MAX_LENGTH.model
      } caracteres.`;
    case "invalid_amount":
      return "Ingresá un monto como 250.000.000 o 32.990,50.";
    case "not_positive":
      return "Ingresá un presupuesto mayor a 0.";
    case "pyg_decimals":
      return "En guaraníes el monto va sin decimales.";
    case "too_many_decimals":
      return "Usá hasta dos decimales.";
    case "invalid_currency":
      return "Elegí una moneda de la lista.";
    case "invalid_year":
      return `Ingresá un año entre ${DEMAND_YEAR_RANGE.min} y ${DEMAND_YEAR_RANGE.max}.`;
    case "year_order":
      return "«Hasta» no puede ser anterior a «Desde».";
    case "invalid_option":
    case "invalid_boolean":
      return "Elegí una opción de la lista.";
    case "empty":
    case "unexpected_field":
    case "invalid_text":
      return "Revisá este dato.";
  }
}

type DemandFieldsProps = {
  /** Prefijo de los ids: el formulario los usa para enfocar un error. */
  idPrefix: string;
  values: DemandFormValues;
  onChange: (field: DemandFormField, value: string) => void;
  errors: DemandFormErrors;
  disabled: boolean;
  /** `name` de cada campo; sin `name`, el campo no se envía. */
  nameOf?: (field: DemandFormField) => string | undefined;
  /** Contenido extra al pie de un fact (aviso de Quitar, error de carga). */
  footerOf?: (fact: DemandFact) => ReactNode;
  /** Alta: pago, presupuesto y más detrás de un disclosure cerrado. */
  collapsible?: boolean;
  /** Ref del primer campo (Marca), para el foco inicial. */
  firstFieldRef?: Ref<HTMLInputElement>;
};

export function DemandFields({
  idPrefix,
  values,
  onChange,
  errors,
  disabled,
  nameOf = (field) => field,
  footerOf = () => null,
  collapsible = false,
  firstFieldRef,
}: DemandFieldsProps) {
  const fieldId = (field: DemandFormField) => `${idPrefix}-${field}`;
  const moreId = `${idPrefix}-more`;
  const moreFields = (
    [
      "purchase_type",
      "down_payment",
      "trade_in_intent",
      "budget_max",
      "year_range",
    ] as const
  ).flatMap((fact) => DEMAND_FORM_FIELDS_BY_FACT[fact]);
  const [open, setOpen] = useState(
    !collapsible || moreFields.some((field) => values[field] !== ""),
  );
  // Un error en un campo de más lo deja a la vista.
  const expanded = open || moreFields.some((field) => errors[field]);

  /** Props de un campo: valor, `name` y accesibilidad según su error. */
  const control = (field: DemandFormField, hint?: boolean) => {
    const error = errors[field];
    const ids = [
      hint ? `${fieldId(field)}-hint` : null,
      error ? `${fieldId(field)}-error` : null,
    ].filter(Boolean);
    return {
      id: fieldId(field),
      name: nameOf(field),
      disabled,
      value: values[field],
      "aria-invalid": error ? true : undefined,
      "aria-describedby": ids.length > 0 ? ids.join(" ") : undefined,
    } as const;
  };
  const fieldError = (field: DemandFormField) => ({
    error: errors[field] && demandErrorMessage(field, errors[field]),
    errorId: `${fieldId(field)}-error`,
  });
  const onInput =
    (field: DemandFormField) => (event: { currentTarget: { value: string } }) =>
      onChange(field, event.currentTarget.value);

  const money = (
    fact: "down_payment" | "budget_max",
    label: string,
    hint: string,
  ) => {
    const [amount, currency] = DEMAND_FORM_FIELDS_BY_FACT[fact] as [
      DemandFormField,
      DemandFormField,
    ];
    return (
      <div className="flex flex-col gap-1.5">
        <div className="grid grid-cols-[minmax(0,1fr)_9.5rem] gap-3">
          <FormField
            label={label}
            optional
            htmlFor={fieldId(amount)}
            hint={hint}
            hintId={`${fieldId(amount)}-hint`}
            {...fieldError(amount)}
          >
            <input
              type="text"
              inputMode="decimal"
              autoComplete="off"
              placeholder={fact === "budget_max" ? "250.000.000" : "50.000.000"}
              maxLength={18}
              className={`${inputClassName} tabular-nums`}
              onChange={onInput(amount)}
              {...control(amount, true)}
            />
          </FormField>
          <FormField
            label="Moneda"
            optional
            htmlFor={fieldId(currency)}
            {...fieldError(currency)}
          >
            <select
              className={inputClassName}
              onChange={onInput(currency)}
              {...control(currency)}
            >
              <option value="">Elegí</option>
              {CURRENCIES.map((option) => (
                <option key={option} value={option}>
                  {CURRENCY_LABELS[option]}
                </option>
              ))}
            </select>
          </FormField>
        </div>
        {footerOf(fact)}
      </div>
    );
  };

  return (
    <fieldset className="flex flex-col gap-3.5">
      <legend className="mb-3 text-overline text-text-muted uppercase">
        Lo que busca
      </legend>
      <div className="flex flex-col gap-1.5">
        <div className="grid grid-cols-2 gap-3">
          <FormField
            label="Marca"
            optional
            htmlFor={fieldId("brand")}
            {...fieldError("brand")}
          >
            <input
              ref={firstFieldRef}
              type="text"
              autoComplete="off"
              placeholder="Toyota"
              maxLength={DEMAND_FORM_MAX_LENGTH.brand}
              className={inputClassName}
              onChange={onInput("brand")}
              {...control("brand")}
            />
          </FormField>
          <FormField
            label="Modelo"
            optional
            htmlFor={fieldId("model")}
            {...fieldError("model")}
          >
            <input
              type="text"
              autoComplete="off"
              placeholder="Hilux"
              maxLength={DEMAND_FORM_MAX_LENGTH.model}
              className={inputClassName}
              onChange={onInput("model")}
              {...control("model")}
            />
          </FormField>
        </div>
        <p className="text-caption text-text-muted">
          Un solo vehículo. Si duda entre dos, cargá el principal.
        </p>
        {footerOf("desired_vehicle")}
      </div>

      {collapsible ? (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={moreId}
          onClick={() => setOpen((value) => !value)}
          className="-mx-1 flex items-center gap-1.5 self-start rounded-sm px-1 text-label text-brand hover:text-brand-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        >
          <ChevronRightIcon
            className={cn(
              "size-4 transition-transform duration-150 ease-out-strong motion-reduce:transition-none",
              expanded && "rotate-90",
            )}
          />
          Agregar pago, presupuesto y más (opcional)
        </button>
      ) : null}

      <div id={moreId} hidden={!expanded} className="flex flex-col gap-3.5">
        <div className="flex flex-col gap-1.5">
          <FormField
            label="Pago"
            optional
            htmlFor={fieldId("purchaseType")}
            {...fieldError("purchaseType")}
          >
            <select
              className={inputClassName}
              onChange={onInput("purchaseType")}
              {...control("purchaseType")}
            >
              <option value="">Sin dato</option>
              {PURCHASE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {PURCHASE_TYPE_LABELS[type]}
                </option>
              ))}
            </select>
          </FormField>
          {footerOf("purchase_type")}
        </div>

        {money(
          "down_payment",
          "Entrega inicial",
          "Sin contar el usado. 0 = sin entrega inicial.",
        )}

        <div className="flex flex-col gap-1.5">
          <FormField
            label="¿Entrega un usado?"
            optional
            htmlFor={fieldId("tradeIn")}
            {...fieldError("tradeIn")}
          >
            <select
              className={inputClassName}
              onChange={onInput("tradeIn")}
              {...control("tradeIn")}
            >
              <option value="">Sin dato</option>
              <option value="yes">Sí</option>
              <option value="no">No</option>
            </select>
          </FormField>
          {footerOf("trade_in_intent")}
        </div>

        {money(
          "budget_max",
          "Presupuesto máximo",
          "Precio total que puede pagar.",
        )}

        <div className="flex flex-col gap-1.5">
          <div className="grid grid-cols-2 gap-3">
            <FormField
              label="Año desde"
              optional
              htmlFor={fieldId("yearMin")}
              {...fieldError("yearMin")}
            >
              <input
                type="text"
                inputMode="numeric"
                autoComplete="off"
                placeholder="2018"
                maxLength={4}
                className={`${inputClassName} tabular-nums`}
                onChange={onInput("yearMin")}
                {...control("yearMin")}
              />
            </FormField>
            <FormField
              label="Año hasta"
              optional
              htmlFor={fieldId("yearMax")}
              {...fieldError("yearMax")}
            >
              <input
                type="text"
                inputMode="numeric"
                autoComplete="off"
                placeholder="2022"
                maxLength={4}
                className={`${inputClassName} tabular-nums`}
                onChange={onInput("yearMax")}
                {...control("yearMax")}
              />
            </FormField>
          </div>
          {footerOf("year_range")}
        </div>
      </div>
    </fieldset>
  );
}

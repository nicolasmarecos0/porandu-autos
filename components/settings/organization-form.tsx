"use client";

import {
  useActionState,
  useEffect,
  useEffectEvent,
  useId,
  useRef,
} from "react";
import { Button } from "@/components/ui/button";
import { FormField, inputClassName } from "@/components/ui/form-field";
import { LockIcon } from "@/components/ui/icons";
import { Panel, PanelHeader } from "@/components/ui/panel";
import type { OrganizationSettingsView } from "@/db/queries/settings";
import {
  CURRENCY_LABELS,
  DEFAULT_CURRENCIES,
  ORGANIZATION_FIELDS,
  ORGANIZATION_NAME_MAX_LENGTH,
  type OrganizationField,
  type OrganizationFieldError,
} from "@/domains/settings/organization";
import { updateOrganization } from "@/lib/settings/actions";
import type { UpdateOrganizationState } from "@/lib/settings/requests";

/*
 * Configuración general (Hito 6, DEC-038 §2 y §8): nombre del concesionario
 * y moneda por defecto. No conoce la base: envía el formulario a la Server
 * Action updateOrganization(), que exige rol admin y valida en el servidor.
 *
 * Un seller ve los mismos datos de solo lectura, sin formulario: ocultarlo es
 * UX, la barrera es la acción y la base.
 */

const ERROR_MESSAGES: Record<
  OrganizationField,
  Record<OrganizationFieldError, string>
> = {
  name: {
    required: "Ingresá el nombre del concesionario.",
    too_long: `Usá hasta ${ORGANIZATION_NAME_MAX_LENGTH} caracteres.`,
    invalid_option: "Revisá el nombre.",
  },
  defaultCurrency: {
    required: "Elegí una moneda.",
    too_long: "Elegí una moneda de la lista.",
    invalid_option: "Elegí una moneda de la lista.",
  },
};

const MESSAGES = {
  saved: "Guardamos los cambios.",
  invalid: "Revisá los datos marcados.",
  forbidden:
    "Solo un administrador puede editar la configuración. No se guardó nada.",
  failed:
    "No pudimos guardar los cambios. No se guardó nada: intentá de nuevo en unos minutos.",
} as const;

const TONES = {
  saved: "border-success-border bg-success-soft text-success",
  invalid: "border-warning-border bg-warning-soft text-warning",
  forbidden: "border-danger-border bg-danger-soft text-danger",
  failed: "border-danger-border bg-danger-soft text-danger",
} as const;

export function OrganizationSettingsPanel({
  settings,
}: {
  settings: OrganizationSettingsView;
}) {
  return (
    <Panel>
      <PanelHeader>
        <h2 className="text-heading text-text-primary">
          Datos del concesionario
        </h2>
        {settings.canEdit ? null : (
          <span className="ml-auto flex items-center gap-1.5 text-caption text-text-muted">
            <LockIcon className="size-3.5" />
            Solo lectura
          </span>
        )}
      </PanelHeader>
      {settings.canEdit ? (
        <OrganizationForm settings={settings} />
      ) : (
        <ReadOnlySettings settings={settings} />
      )}
    </Panel>
  );
}

function ReadOnlySettings({
  settings,
}: {
  settings: OrganizationSettingsView;
}) {
  return (
    <div className="flex flex-col gap-4 px-5 py-4">
      <dl className="grid gap-4 sm:grid-cols-2">
        <div>
          <dt className="text-label text-text-muted">Nombre</dt>
          <dd className="mt-1 text-body text-text-primary">{settings.name}</dd>
        </div>
        <div>
          <dt className="text-label text-text-muted">Moneda por defecto</dt>
          <dd className="mt-1 text-body text-text-primary">
            {CURRENCY_LABELS[settings.defaultCurrency]}
          </dd>
        </div>
      </dl>
      <p className="text-caption text-text-muted">
        Solo un administrador puede editar estos datos.
      </p>
    </div>
  );
}

function OrganizationForm({
  settings,
}: {
  settings: OrganizationSettingsView;
}) {
  const [state, action, pending] = useActionState<
    UpdateOrganizationState,
    FormData
  >(updateOrganization, null);
  const id = useId();
  const fieldId = (field: OrganizationField) => `${id}-${field}`;
  const submitRef = useRef<HTMLButtonElement>(null);

  const values =
    state?.status === "invalid" || state?.status === "failed"
      ? state.values
      : state?.status === "saved"
        ? state.settings
        : settings;
  const errors = state?.status === "invalid" ? state.errors : {};
  const echoedCurrency =
    DEFAULT_CURRENCIES.find(
      (currency) => currency === values.defaultCurrency,
    ) ?? "";
  const message = !pending && state ? state.status : null;

  // El foco vuelve a donde hay que actuar: el primer campo a corregir o,
  // tras una falla, el botón para reintentar.
  const settle = useEffectEvent(() => {
    if (state?.status === "invalid") {
      const first = (
        Object.keys(ORGANIZATION_FIELDS) as OrganizationField[]
      ).find((field) => state.errors[field]);
      if (first) document.getElementById(fieldId(first))?.focus();
    } else if (state?.status === "failed") {
      submitRef.current?.focus();
    }
  });
  useEffect(() => settle(), [state]);

  const described = (field: OrganizationField, hint?: boolean) => {
    const error = errors[field];
    const ids = [
      hint ? `${fieldId(field)}-hint` : null,
      error ? `${fieldId(field)}-error` : null,
    ].filter(Boolean);
    return {
      id: fieldId(field),
      name: ORGANIZATION_FIELDS[field],
      disabled: pending,
      "aria-invalid": error ? true : undefined,
      "aria-describedby": ids.length > 0 ? ids.join(" ") : undefined,
    } as const;
  };
  const fieldError = (field: OrganizationField) => {
    const error = errors[field];
    return {
      error: error && ERROR_MESSAGES[field][error],
      errorId: `${fieldId(field)}-error`,
    };
  };

  return (
    // La key reinicia los campos con lo guardado (o lo devuelto) en cada
    // respuesta, sin pisar lo que el usuario está tipeando mientras guarda.
    <form
      key={state ? JSON.stringify(values) : "initial"}
      action={action}
      noValidate
      aria-busy={pending}
      className="flex flex-col gap-4 px-5 py-4"
    >
      {message ? (
        <p
          role={message === "saved" ? "status" : "alert"}
          className={`rounded-md border px-3 py-2 text-label ${TONES[message]}`}
        >
          {MESSAGES[message]}
        </p>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          label="Nombre del concesionario"
          htmlFor={fieldId("name")}
          {...fieldError("name")}
        >
          <input
            type="text"
            autoComplete="organization"
            required
            maxLength={ORGANIZATION_NAME_MAX_LENGTH}
            defaultValue={values.name}
            className={inputClassName}
            {...described("name")}
          />
        </FormField>
        <FormField
          label="Moneda por defecto"
          htmlFor={fieldId("defaultCurrency")}
          hint="La moneda preferida del concesionario. Cada monto sigue guardando su propia moneda."
          hintId={`${fieldId("defaultCurrency")}-hint`}
          {...fieldError("defaultCurrency")}
        >
          <select
            defaultValue={echoedCurrency}
            className={inputClassName}
            {...described("defaultCurrency", true)}
          >
            {DEFAULT_CURRENCIES.map((currency) => (
              <option key={currency} value={currency}>
                {CURRENCY_LABELS[currency]}
              </option>
            ))}
          </select>
        </FormField>
      </div>
      <div className="flex justify-end">
        <Button
          ref={submitRef}
          type="submit"
          variant="primary"
          disabled={pending}
          className="disabled:cursor-wait disabled:opacity-70"
        >
          {pending ? "Guardando…" : "Guardar cambios"}
        </Button>
      </div>
    </form>
  );
}

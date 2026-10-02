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
import { PlusIcon } from "@/components/ui/icons";
import {
  SOURCE_LABELS,
  SOURCES,
  stageLabel,
} from "@/domains/opportunities/labels";
import {
  NEW_OPPORTUNITY_FIELDS,
  NEW_OPPORTUNITY_MAX_LENGTH,
  type NewOpportunityField,
  type NewOpportunityFieldError,
} from "@/domains/opportunities/new-opportunity";
import { createOpportunity } from "@/lib/opportunities/actions";
import type { CreateOpportunityState } from "@/lib/opportunities/new-opportunity";

/*
 * Alta manual de una oportunidad (H1.2): botón "Nueva oportunidad" y drawer
 * lateral con el formulario mínimo. No conoce la base: envía el formulario a
 * la Server Action createOpportunity(), que valida en el servidor, resuelve
 * el contacto por teléfono y crea la oportunidad en la organización activa.
 *
 * El formulario solo tiene campos del contacto y del interés: ni
 * organización, ni etapa, ni campos ocultos. Mientras guarda no se puede
 * cerrar ni reenviar. Un error deja lo cargado para corregir o reintentar;
 * al crear, el drawer se cierra y la vista selecciona la oportunidad nueva.
 */

export type OpportunityCreated = Extract<
  CreateOpportunityState,
  { status: "created" }
>;

type NewOpportunityDrawerProps = {
  onCreated: (created: OpportunityCreated) => void;
};

export function NewOpportunityDrawer({ onCreated }: NewOpportunityDrawerProps) {
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
        <Button variant="secondary" className="w-full">
          <PlusIcon className="size-4" />
          Nueva oportunidad
        </Button>
      </DrawerTrigger>
      <DrawerContent
        title="Nueva oportunidad"
        description="Cargá el contacto y lo que busca. Si el teléfono ya es de un contacto, se usa ese."
        closeDisabled={saving}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          firstFieldRef.current?.focus();
        }}
        onEscapeKeyDown={keepOpenWhileSaving}
        onInteractOutside={keepOpenWhileSaving}
      >
        <NewOpportunityForm
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
const REQUIRED: Partial<Record<NewOpportunityField, string>> = {
  name: "Ingresá el nombre del contacto.",
  phone: "Ingresá el teléfono del contacto.",
  source: "Elegí por dónde llegó.",
};

function errorMessage(
  field: NewOpportunityField,
  error: NewOpportunityFieldError,
): string {
  switch (error) {
    case "required":
      return REQUIRED[field] ?? "Completá este dato.";
    case "too_long":
      return field === "source"
        ? "Elegí un origen de la lista."
        : `Usá hasta ${NEW_OPPORTUNITY_MAX_LENGTH[field]} caracteres.`;
    case "invalid_phone":
      return "No es un teléfono válido. Revisá los dígitos (por ejemplo, 0981 123 456).";
    case "invalid_source":
      return "Elegí un origen de la lista.";
  }
}

const FORM_MESSAGES = {
  invalid: "Revisá los datos marcados.",
  failed:
    "No pudimos guardar la oportunidad. No se guardó nada: intentá de nuevo en unos minutos.",
} as const;

type NewOpportunityFormProps = {
  firstFieldRef: RefObject<HTMLInputElement | null>;
  onSavingChange: (saving: boolean) => void;
  onCreated: (created: OpportunityCreated) => void;
};

function NewOpportunityForm({
  firstFieldRef,
  onSavingChange,
  onCreated,
}: NewOpportunityFormProps) {
  const [state, action, pending] = useActionState<
    CreateOpportunityState,
    FormData
  >(createOpportunity, null);
  const id = useId();
  const fieldId = (field: NewOpportunityField) => `${id}-${field}`;
  const submitRef = useRef<HTMLButtonElement>(null);

  const values =
    state?.status === "invalid" || state?.status === "failed"
      ? state.values
      : undefined;
  const errors = state?.status === "invalid" ? state.errors : {};
  // Solo un origen de la lista vuelve al select.
  const echoedSource =
    SOURCES.find((source) => source === values?.source) ?? "";
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
      const first = NEW_OPPORTUNITY_FIELDS.find((field) => state.errors[field]);
      if (first) document.getElementById(fieldId(first))?.focus();
    } else if (state?.status === "failed") {
      submitRef.current?.focus();
    }
  });
  useEffect(() => settle(), [state]);

  /** Props de accesibilidad de un campo según su error. */
  const described = (field: NewOpportunityField, hint?: boolean) => {
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
            Contacto
          </legend>
          <FormField
            label="Nombre"
            htmlFor={fieldId("name")}
            error={errors.name && errorMessage("name", errors.name)}
            errorId={`${fieldId("name")}-error`}
          >
            <input
              ref={firstFieldRef}
              type="text"
              autoComplete="off"
              required
              maxLength={NEW_OPPORTUNITY_MAX_LENGTH.name}
              defaultValue={values?.name}
              className={inputClassName}
              {...described("name")}
            />
          </FormField>
          <FormField
            label="Teléfono"
            htmlFor={fieldId("phone")}
            hint="Sin prefijo se toma como de Paraguay."
            hintId={`${fieldId("phone")}-hint`}
            error={errors.phone && errorMessage("phone", errors.phone)}
            errorId={`${fieldId("phone")}-error`}
          >
            <input
              type="tel"
              inputMode="tel"
              autoComplete="off"
              required
              placeholder="0981 123 456"
              maxLength={NEW_OPPORTUNITY_MAX_LENGTH.phone}
              defaultValue={values?.phone}
              className={`${inputClassName} tabular-nums`}
              {...described("phone", true)}
            />
          </FormField>
          <FormField
            label="Ciudad"
            optional
            htmlFor={fieldId("city")}
            error={errors.city && errorMessage("city", errors.city)}
            errorId={`${fieldId("city")}-error`}
          >
            <input
              type="text"
              autoComplete="off"
              maxLength={NEW_OPPORTUNITY_MAX_LENGTH.city}
              defaultValue={values?.city}
              className={inputClassName}
              {...described("city")}
            />
          </FormField>
        </fieldset>

        <fieldset className="flex flex-col gap-3.5">
          <legend className="mb-3 text-overline text-text-muted uppercase">
            Oportunidad
          </legend>
          <FormField
            label="Origen"
            htmlFor={fieldId("source")}
            hint={`Por dónde llegó el interés. La oportunidad entra en la etapa ${stageLabel("new")}.`}
            hintId={`${fieldId("source")}-hint`}
            error={errors.source && errorMessage("source", errors.source)}
            errorId={`${fieldId("source")}-error`}
          >
            <select
              // React no actualiza la opción por defecto de un select ya
              // montado: con otra `key`, el reset del formulario tras la
              // acción conserva el origen elegido.
              key={echoedSource}
              required
              defaultValue={echoedSource}
              className={inputClassName}
              {...described("source", true)}
            >
              <option value="" disabled>
                Elegí el origen
              </option>
              {SOURCES.map((source) => (
                <option key={source} value={source}>
                  {SOURCE_LABELS[source]}
                </option>
              ))}
            </select>
          </FormField>
          <FormField
            label="Modelo buscado"
            optional
            htmlFor={fieldId("interestModel")}
            error={
              errors.interestModel &&
              errorMessage("interestModel", errors.interestModel)
            }
            errorId={`${fieldId("interestModel")}-error`}
          >
            <input
              type="text"
              autoComplete="off"
              placeholder="Toyota Hilux"
              maxLength={NEW_OPPORTUNITY_MAX_LENGTH.interestModel}
              defaultValue={values?.interestModel}
              className={inputClassName}
              {...described("interestModel")}
            />
          </FormField>
          <FormField
            label="Versión"
            optional
            htmlFor={fieldId("interestVersion")}
            error={
              errors.interestVersion &&
              errorMessage("interestVersion", errors.interestVersion)
            }
            errorId={`${fieldId("interestVersion")}-error`}
          >
            <input
              type="text"
              autoComplete="off"
              placeholder="SRV 2.8 4x4 AT"
              maxLength={NEW_OPPORTUNITY_MAX_LENGTH.interestVersion}
              defaultValue={values?.interestVersion}
              className={inputClassName}
              {...described("interestVersion")}
            />
          </FormField>
        </fieldset>
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
          {pending ? "Creando…" : "Crear oportunidad"}
        </Button>
      </footer>
    </form>
  );
}

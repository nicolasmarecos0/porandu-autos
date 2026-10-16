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
  EMAIL_MAX_LENGTH,
  INVITATION_FIELDS,
  MEMBER_ROLE_LABELS,
  MEMBER_ROLES,
  type InvitationField,
  type InvitationFieldError,
} from "@/domains/team/members";
import { inviteMember } from "@/lib/settings/actions";
import type { InviteMemberState } from "@/lib/settings/requests";

/*
 * Invitar un miembro (Hito 6, DEC-038 §3 y §8): botón "Invitar miembro" y
 * drawer lateral con email y rol. No conoce la base: envía el formulario a
 * la Server Action inviteMember(), que exige rol admin, valida en el
 * servidor y da acceso a la cuenta de Porandú con ese email.
 *
 * Invitar no crea cuentas ni envía correos (DEC-038 §3): si el email no
 * tiene cuenta, el drawer lo dice y no cambia nada. Mientras guarda no se
 * puede cerrar ni reenviar. Al sumar (o reactivar) a alguien, el drawer se
 * cierra y el panel del equipo avisa el resultado.
 */

export type MemberInvited = Extract<
  InviteMemberState,
  { status: "added" | "reactivated" }
>;

export function InviteMemberDrawer({
  onInvited,
}: {
  onInvited: (result: MemberInvited) => void;
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
        <Button variant="primary">
          <PlusIcon className="size-4" />
          Invitar miembro
        </Button>
      </DrawerTrigger>
      <DrawerContent
        title="Invitar miembro"
        description="Dale acceso a este concesionario a una persona con cuenta de Porandú."
        closeDisabled={saving}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          firstFieldRef.current?.focus();
        }}
        onEscapeKeyDown={keepOpenWhileSaving}
        onInteractOutside={keepOpenWhileSaving}
      >
        <InviteForm
          firstFieldRef={firstFieldRef}
          onSavingChange={setSaving}
          onInvited={(result) => {
            setSaving(false);
            setOpen(false);
            onInvited(result);
          }}
        />
      </DrawerContent>
    </Drawer>
  );
}

const ERROR_MESSAGES: Record<
  InvitationField,
  Record<InvitationFieldError, string>
> = {
  email: {
    required: "Ingresá el email de la persona.",
    invalid_email: "Ingresá un email válido, como nombre@concesionario.com.py.",
    too_long: `Usá hasta ${EMAIL_MAX_LENGTH} caracteres.`,
    invalid_option: "Revisá el email.",
  },
  role: {
    required: "Elegí un rol.",
    invalid_email: "Elegí un rol de la lista.",
    too_long: "Elegí un rol de la lista.",
    invalid_option: "Elegí un rol de la lista.",
  },
};

const ROLE_HINTS = {
  admin: "Edita la configuración, invita, cambia roles y quita accesos.",
  seller: "Trabaja oportunidades y stock. Ve el equipo, sin gestionarlo.",
} as const;

function InviteForm({
  firstFieldRef,
  onSavingChange,
  onInvited,
}: {
  firstFieldRef: RefObject<HTMLInputElement | null>;
  onSavingChange: (saving: boolean) => void;
  onInvited: (result: MemberInvited) => void;
}) {
  const [state, action, pending] = useActionState<InviteMemberState, FormData>(
    inviteMember,
    null,
  );
  const id = useId();
  const fieldId = (field: InvitationField) => `${id}-${field}`;
  const submitRef = useRef<HTMLButtonElement>(null);

  const values =
    state?.status === "invalid" ||
    state?.status === "failed" ||
    state?.status === "no_account"
      ? state.values
      : state?.status === "already_member"
        ? state.invitation
        : undefined;
  const errors = state?.status === "invalid" ? state.errors : {};
  const echoedRole = MEMBER_ROLES.find((role) => role === values?.role);

  const reportSaving = useEffectEvent(onSavingChange);
  useEffect(() => reportSaving(pending), [pending]);

  const settle = useEffectEvent(() => {
    if (state?.status === "added" || state?.status === "reactivated") {
      onInvited(state);
    } else if (state?.status === "invalid") {
      const first = (["email", "role"] as const).find(
        (field) => state.errors[field],
      );
      if (first) document.getElementById(fieldId(first))?.focus();
    } else if (state?.status === "no_account") {
      document.getElementById(fieldId("email"))?.focus();
    } else if (state?.status === "failed") {
      submitRef.current?.focus();
    }
  });
  useEffect(() => settle(), [state]);

  const described = (field: InvitationField) => {
    const error =
      errors[field] ??
      (field === "email" && state?.status === "no_account"
        ? "no_account"
        : undefined);
    return {
      id: fieldId(field),
      name: INVITATION_FIELDS[field],
      disabled: pending,
      "aria-invalid": error ? true : undefined,
      "aria-describedby": error ? `${fieldId(field)}-error` : undefined,
    } as const;
  };
  const emailError = errors.email
    ? ERROR_MESSAGES.email[errors.email]
    : undefined;
  const roleError = errors.role ? ERROR_MESSAGES.role[errors.role] : undefined;

  let message: { tone: string; role: "alert" | "status"; text: string } | null =
    null;
  if (!pending && state) {
    switch (state.status) {
      case "invalid":
        message = {
          tone: "border-warning-border bg-warning-soft text-warning",
          role: "alert",
          text: "Revisá los datos marcados.",
        };
        break;
      case "no_account":
        message = {
          tone: "border-warning-border bg-warning-soft text-warning",
          role: "alert",
          text: "No encontramos una cuenta de Porandú con ese email. Revisalo o pedí el alta de la cuenta y volvé a invitar. No se cambió nada.",
        };
        break;
      case "already_member":
        message = {
          tone: "border-brand-border bg-brand-soft text-brand-strong",
          role: "status",
          text: `${state.invitation.email} ya forma parte del equipo. Para cambiar su rol, usá el menú de acciones de la lista.`,
        };
        break;
      case "forbidden":
        message = {
          tone: "border-danger-border bg-danger-soft text-danger",
          role: "alert",
          text: "Solo un administrador puede invitar. No se cambió nada.",
        };
        break;
      case "failed":
        message = {
          tone: "border-danger-border bg-danger-soft text-danger",
          role: "alert",
          text: "No pudimos invitar. No se cambió nada: intentá de nuevo en unos minutos.",
        };
        break;
      default:
        message = null;
    }
  }

  return (
    <form
      action={action}
      noValidate
      aria-busy={pending}
      className="flex min-h-0 flex-1 flex-col"
    >
      <div
        // Reinicia los campos con lo devuelto en cada respuesta.
        key={state ? JSON.stringify(values ?? null) : "initial"}
        className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-4"
      >
        {message ? (
          <p
            role={message.role}
            className={`rounded-md border px-3 py-2 text-label ${message.tone}`}
          >
            {message.text}
          </p>
        ) : null}
        <FormField
          label="Email"
          htmlFor={fieldId("email")}
          hint="El de su cuenta de Porandú."
          hintId={`${fieldId("email")}-hint`}
          error={emailError}
          errorId={`${fieldId("email")}-error`}
        >
          <input
            ref={firstFieldRef}
            type="email"
            autoComplete="off"
            required
            placeholder="nombre@concesionario.com.py"
            maxLength={EMAIL_MAX_LENGTH}
            defaultValue={values?.email}
            className={inputClassName}
            {...described("email")}
          />
        </FormField>
        <fieldset
          className="flex flex-col gap-2"
          aria-describedby={roleError ? `${fieldId("role")}-error` : undefined}
        >
          <legend className="mb-1.5 text-label text-text-secondary">Rol</legend>
          {MEMBER_ROLES.map((role, index) => (
            <label
              key={role}
              className="flex cursor-pointer items-start gap-2.5 rounded-md border border-border-default px-3 py-2.5 transition-[border-color,background-color] hover:border-border-strong has-checked:border-brand has-checked:bg-brand-soft"
            >
              <input
                type="radio"
                name={INVITATION_FIELDS.role}
                value={role}
                id={index === 0 ? fieldId("role") : undefined}
                defaultChecked={(echoedRole ?? "seller") === role}
                disabled={pending}
                className="mt-0.5 accent-brand"
              />
              <span className="flex flex-col">
                <span className="text-label font-semibold text-text-primary">
                  {MEMBER_ROLE_LABELS[role]}
                </span>
                <span className="text-caption text-text-muted">
                  {ROLE_HINTS[role]}
                </span>
              </span>
            </label>
          ))}
          {roleError ? (
            <p
              id={`${fieldId("role")}-error`}
              className="text-caption text-danger"
            >
              {roleError}
            </p>
          ) : null}
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
          {pending ? "Invitando…" : "Invitar"}
        </Button>
      </footer>
    </form>
  );
}

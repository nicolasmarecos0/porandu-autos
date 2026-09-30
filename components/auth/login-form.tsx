"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { signIn } from "@/lib/auth/actions";
import type { LoginError, LoginFormState } from "@/lib/auth/login";

/*
 * Formulario de login (DEC-012). No usa Supabase en el navegador: envía email
 * y password a la Server Action `signIn`, que valida y autentica en el
 * servidor. Este componente solo muestra el estado de la acción.
 */

/** Copy es-PY. Ningún mensaje revela si la cuenta existe. */
const ERROR_MESSAGES: Record<LoginError, string> = {
  missing_fields: "Ingresá tu email y tu contraseña.",
  invalid_email: "Ingresá un email válido.",
  invalid_credentials: "Email o contraseña incorrectos.",
  rate_limited: "Demasiados intentos. Esperá unos minutos y volvé a intentar.",
  unavailable: "No pudimos iniciar sesión. Intentá de nuevo en unos minutos.",
};

const ERROR_ID = "login-error";

const inputClassName =
  "h-9 w-full rounded-md border border-border-default bg-surface-1 px-3 text-body text-text-primary transition-[border-color] hover:border-border-strong focus-visible:border-brand focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring";

export function LoginForm() {
  const [state, action, pending] = useActionState<LoginFormState, FormData>(
    signIn,
    null,
  );
  const message = state ? ERROR_MESSAGES[state.error] : null;
  const describedBy = message ? ERROR_ID : undefined;

  return (
    <form action={action} className="flex flex-col gap-4">
      <p className="text-body text-text-secondary">
        Ingresá con tu email y tu contraseña.
      </p>

      {message ? (
        <p
          id={ERROR_ID}
          role="alert"
          className="rounded-md border border-danger-border bg-danger-soft px-3 py-2 text-label text-danger"
        >
          {message}
        </p>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="email" className="text-label text-text-secondary">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          defaultValue={state?.email}
          aria-describedby={describedBy}
          className={inputClassName}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="password" className="text-label text-text-secondary">
          Contraseña
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          aria-describedby={describedBy}
          className={inputClassName}
        />
      </div>

      <Button
        type="submit"
        variant="primary"
        disabled={pending}
        className="h-9 w-full disabled:cursor-wait disabled:opacity-70"
      >
        {pending ? "Ingresando…" : "Ingresar"}
      </Button>
    </form>
  );
}

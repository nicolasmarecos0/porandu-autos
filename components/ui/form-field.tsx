import type { ReactNode } from "react";

/*
 * Campo de los formularios de alta en drawers (H1.2, H1.3B): etiqueta,
 * control, ayuda y error. El control lo pone quien lo usa, con
 * `inputClassName`, y se enlaza a la ayuda y al error por
 * `aria-describedby` (los ids `hintId` y `errorId`).
 */

/** Input o select de una línea, con borde de error cuando `aria-invalid`. */
export const inputClassName =
  "h-9 w-full rounded-md border border-border-default bg-surface-1 px-3 text-body text-text-primary transition-[border-color] hover:border-border-strong focus-visible:border-brand focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring aria-invalid:border-danger disabled:cursor-not-allowed disabled:bg-surface-2";

type FormFieldProps = {
  label: string;
  htmlFor: string;
  optional?: boolean;
  hint?: string;
  hintId?: string;
  error?: string | undefined;
  errorId: string;
  children: ReactNode;
};

export function FormField({
  label,
  htmlFor,
  optional = false,
  hint,
  hintId,
  error,
  errorId,
  children,
}: FormFieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-label text-text-secondary">
        {label}
        {optional ? (
          <span className="font-normal text-text-muted"> (opcional)</span>
        ) : null}
      </label>
      {children}
      {hint ? (
        <p id={hintId} className="text-caption text-text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-caption text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

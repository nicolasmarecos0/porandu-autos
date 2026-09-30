"use client";

import { useActionState } from "react";
import type { MembershipRole } from "@/db/queries/memberships";
import {
  selectOrganization,
  type SelectOrganizationState,
} from "@/lib/tenant/actions";

/*
 * Selector de organización (H0.7). Cada opción es un botón de envío que
 * manda solo su `organizationId` a la Server Action `selectOrganization`,
 * que la valida en el servidor contra las memberships activas del usuario.
 * Este componente solo muestra las opciones y el estado de la acción.
 */

export type OrganizationOption = Readonly<{
  organizationId: string;
  organizationName: string;
  role: MembershipRole;
}>;

/** Copy es-PY de los roles de B1. */
const ROLE_LABELS: Record<MembershipRole, string> = {
  admin: "Administrador",
  seller: "Vendedor",
};

const ERROR_ID = "select-organization-error";

export function OrganizationPicker({
  organizations,
}: {
  organizations: readonly OrganizationOption[];
}) {
  const [state, action, pending] = useActionState<
    SelectOrganizationState,
    FormData
  >(selectOrganization, null);

  return (
    <form action={action} className="flex flex-col gap-4">
      <p className="text-body text-text-secondary">
        Tu cuenta tiene acceso a más de una organización. Elegí con cuál querés
        trabajar.
      </p>

      {state ? (
        <p
          id={ERROR_ID}
          role="alert"
          className="rounded-md border border-danger-border bg-danger-soft px-3 py-2 text-label text-danger"
        >
          No pudimos abrir esa organización. Elegí una de la lista.
        </p>
      ) : null}

      <ul className="flex flex-col gap-2">
        {organizations.map((organization) => (
          <li key={organization.organizationId}>
            <button
              type="submit"
              name="organizationId"
              value={organization.organizationId}
              disabled={pending}
              aria-describedby={state ? ERROR_ID : undefined}
              className="flex w-full items-center justify-between gap-3 rounded-md border border-border-default bg-surface-1 px-3 py-2.5 text-left transition-[border-color,background-color] hover:border-border-strong hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-wait disabled:opacity-70"
            >
              <span className="min-w-0 truncate text-body font-semibold text-text-primary">
                {organization.organizationName}
              </span>
              <span className="shrink-0 text-label text-text-muted">
                {ROLE_LABELS[organization.role]}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </form>
  );
}

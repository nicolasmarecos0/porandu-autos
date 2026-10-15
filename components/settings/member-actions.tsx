"use client";

import { useActionState, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  ConfirmDialog,
  ConfirmDialogCancel,
  ConfirmDialogContent,
} from "@/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreIcon } from "@/components/ui/icons";
import {
  MEMBER_FIELDS,
  MEMBER_ROLE_LABELS,
  type MemberRole,
  type TeamMember,
} from "@/domains/team/members";
import { removeMember, updateMemberRole } from "@/lib/settings/actions";
import type { MemberActionState } from "@/lib/settings/requests";

/*
 * Menú de acciones de un miembro (Hito 6, DEC-038 §8): cambiar el rol o
 * quitar el acceso. Solo se muestra cuando el viewer es admin y el miembro
 * no es él mismo (canManageMember()); la barrera real son las Server
 * Actions y la base.
 *
 * Cada acción pide confirmación (alertdialog) porque cambia quién puede
 * hacer qué en el concesionario. Mientras guarda, la confirmación no se
 * cierra ni se reenvía. Con una respuesta (hecho, ya no estaba, no se puede)
 * se cierra y el panel del equipo avisa el resultado; una falla inesperada
 * la deja abierta para reintentar.
 */

export type MemberActionSettled = Exclude<
  MemberActionState,
  null | { status: "failed" }
>;

type Pending = "role" | "remove" | null;

export function MemberActions({
  member,
  onSettled,
}: {
  member: TeamMember;
  onSettled: (member: TeamMember, result: MemberActionSettled) => void;
}) {
  const [dialog, setDialog] = useState<Pending>(null);
  const nextRole: MemberRole = member.role === "admin" ? "seller" : "admin";

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="secondary"
            aria-label={`Acciones para ${member.displayName}`}
            className="w-8 px-0"
          >
            <MoreIcon className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel>{member.displayName}</DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => setDialog("role")}>
            Cambiar a {MEMBER_ROLE_LABELS[nextRole]}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem tone="danger" onSelect={() => setDialog("remove")}>
            Quitar acceso
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {dialog === "role" ? (
        <MemberConfirm
          member={member}
          title="Cambiar rol"
          description={
            nextRole === "admin"
              ? `${member.displayName} pasará a ser Administrador: podrá editar la configuración, invitar, cambiar roles y quitar accesos.`
              : `${member.displayName} pasará a ser Vendedor: seguirá trabajando oportunidades y stock, sin gestionar el equipo ni la configuración.`
          }
          confirmLabel={`Cambiar a ${MEMBER_ROLE_LABELS[nextRole]}`}
          pendingLabel="Cambiando…"
          role={nextRole}
          action={updateMemberRole}
          onClose={() => setDialog(null)}
          onSettled={onSettled}
        />
      ) : null}
      {dialog === "remove" ? (
        <MemberConfirm
          member={member}
          title="Quitar acceso"
          description={`${member.displayName} dejará de acceder a este concesionario desde su próxima acción. Sus registros (notas, mensajes, cierres) se conservan.`}
          confirmLabel="Quitar acceso"
          pendingLabel="Quitando…"
          danger
          action={removeMember}
          onClose={() => setDialog(null)}
          onSettled={onSettled}
        />
      ) : null}
    </>
  );
}

function MemberConfirm({
  member,
  title,
  description,
  confirmLabel,
  pendingLabel,
  role,
  danger = false,
  action: serverAction,
  onClose,
  onSettled,
}: {
  member: TeamMember;
  title: string;
  description: string;
  confirmLabel: string;
  pendingLabel: string;
  role?: MemberRole;
  danger?: boolean;
  action: (
    previous: MemberActionState,
    formData: FormData,
  ) => Promise<MemberActionState>;
  onClose: () => void;
  onSettled: (member: TeamMember, result: MemberActionSettled) => void;
}) {
  const settled = useRef(false);
  const [state, action, pending] = useActionState<MemberActionState, FormData>(
    async (previous, formData) => {
      const result = await serverAction(previous, formData);
      if (result !== null && result.status !== "failed") {
        settled.current = true;
        onClose();
        onSettled(member, result);
      }
      return result;
    },
    null,
  );
  const failed = !pending && state?.status === "failed";

  return (
    <ConfirmDialog
      open
      onOpenChange={(next) => {
        if (!next && !pending) onClose();
      }}
    >
      <ConfirmDialogContent
        title={title}
        description={description}
        onEscapeKeyDown={(event) => {
          if (pending) event.preventDefault();
        }}
        onCloseAutoFocus={(event) => {
          if (settled.current) event.preventDefault();
        }}
      >
        <form action={action} aria-busy={pending}>
          <input
            type="hidden"
            name={MEMBER_FIELDS.membershipId}
            value={member.membershipId}
          />
          {role ? (
            <input type="hidden" name={MEMBER_FIELDS.role} value={role} />
          ) : null}
          {failed ? (
            <p
              role="alert"
              className="mx-5 mb-4 rounded-md border border-danger-border bg-danger-soft px-3 py-2 text-label text-danger"
            >
              No pudimos guardar el cambio. No se hizo nada: intentá de nuevo en
              unos minutos.
            </p>
          ) : null}
          <footer className="flex justify-end gap-2 rounded-b-lg border-t border-border-subtle bg-surface-2 px-5 py-3">
            <ConfirmDialogCancel asChild>
              <Button variant="secondary" disabled={pending}>
                Cancelar
              </Button>
            </ConfirmDialogCancel>
            <Button
              type="submit"
              variant={danger ? "danger" : "primary"}
              disabled={pending}
              className="disabled:cursor-wait disabled:opacity-70"
            >
              {pending ? pendingLabel : confirmLabel}
            </Button>
          </footer>
        </form>
      </ConfirmDialogContent>
    </ConfirmDialog>
  );
}

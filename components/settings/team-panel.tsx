"use client";

import { useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { LockIcon } from "@/components/ui/icons";
import { Panel, PanelHeader } from "@/components/ui/panel";
import {
  MEMBER_ROLE_LABELS,
  memberInitials,
  type TeamMember,
  type TeamView,
} from "@/domains/team/members";

import { InviteMemberDrawer, type MemberInvited } from "./invite-member-drawer";
import { MemberActions, type MemberActionSettled } from "./member-actions";

/*
 * Equipo del concesionario (Hito 6, DEC-038 §6 y §8): los miembros activos
 * con su rol. Un admin invita (drawer) y, desde el menú de cada miembro,
 * cambia el rol o quita el acceso; nunca sobre sí mismo. Un seller ve la
 * misma lista de solo lectura.
 *
 * Después de cada acción la página ya se revalidó (la lista llega del
 * servidor) y este panel anuncia el resultado en una región `status`.
 */

type Notice = Readonly<{ tone: "success" | "warning"; text: string }>;

function invitedNotice(result: MemberInvited): Notice {
  const role = MEMBER_ROLE_LABELS[result.invitation.role];
  return {
    tone: "success",
    text:
      result.status === "added"
        ? `${result.invitation.email} ya forma parte del equipo como ${role}.`
        : `${result.invitation.email} recuperó el acceso como ${role}.`,
  };
}

function actionNotice(member: TeamMember, result: MemberActionSettled): Notice {
  const name = member.displayName;
  switch (result.status) {
    case "updated":
      return {
        tone: "success",
        text: `${name} ahora es ${MEMBER_ROLE_LABELS[member.role === "admin" ? "seller" : "admin"]}.`,
      };
    case "removed":
      return { tone: "success", text: `${name} ya no tiene acceso.` };
    case "not_found":
      return {
        tone: "warning",
        text: `${name} ya no es un miembro activo. Actualizamos la lista.`,
      };
    case "self":
      return {
        tone: "warning",
        text: "No podés cambiar ni quitar tu propio acceso. Pedíselo a otro administrador.",
      };
    case "last_admin":
      return {
        tone: "warning",
        text: "El concesionario necesita al menos un administrador activo. No se hizo el cambio.",
      };
    case "invalid":
      return { tone: "warning", text: "Elegí un rol válido." };
    case "forbidden":
      return {
        tone: "warning",
        text: "Solo un administrador puede gestionar el equipo. No se hizo el cambio.",
      };
  }
}

const NOTICE_TONES = {
  success: "border-success-border bg-success-soft text-success",
  warning: "border-warning-border bg-warning-soft text-warning",
} as const;

export function TeamPanel({ team }: { team: TeamView }) {
  const [notice, setNotice] = useState<Notice | null>(null);
  const count = team.members.length;

  return (
    <Panel>
      <PanelHeader>
        <h2 className="text-heading text-text-primary">Miembros activos</h2>
        <span className="text-label text-text-muted tabular-nums">
          {count} {count === 1 ? "miembro" : "miembros"}
        </span>
        <div className="ml-auto">
          {team.canInvite ? (
            <InviteMemberDrawer
              onInvited={(result) => setNotice(invitedNotice(result))}
            />
          ) : (
            <span className="flex items-center gap-1.5 text-caption text-text-muted">
              <LockIcon className="size-3.5" />
              Solo lectura
            </span>
          )}
        </div>
      </PanelHeader>
      <div role="status" aria-live="polite" className="empty:hidden">
        {notice ? (
          <p
            className={`mx-4 mt-3 rounded-md border px-3 py-2 text-label ${NOTICE_TONES[notice.tone]}`}
          >
            {notice.text}
          </p>
        ) : null}
      </div>
      <ul className="divide-y divide-border-subtle">
        {team.members.map((member) => (
          <li
            key={member.membershipId}
            className="flex items-center gap-3 px-4 py-3"
          >
            <Avatar
              initials={memberInitials(member.displayName)}
              size="md"
              tone={member.isViewer ? "brand" : "neutral"}
            />
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 text-body font-semibold text-text-primary">
                <span className="truncate">{member.displayName}</span>
                {member.isViewer ? (
                  <span className="shrink-0 text-caption font-normal text-text-muted">
                    (vos)
                  </span>
                ) : null}
              </p>
              {member.email && member.email !== member.displayName ? (
                <p className="truncate text-label text-text-muted">
                  {member.email}
                </p>
              ) : null}
            </div>
            <Badge tone={member.role === "admin" ? "brand" : "neutral"}>
              {MEMBER_ROLE_LABELS[member.role]}
            </Badge>
            <div className="flex w-8 shrink-0 justify-end">
              {member.manageable ? (
                <MemberActions
                  member={member}
                  onSettled={(target, result) =>
                    setNotice(actionNotice(target, result))
                  }
                />
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      {team.canInvite ? null : (
        <p className="border-t border-border-subtle px-4 py-3 text-caption text-text-muted">
          Solo un administrador puede invitar, cambiar roles o quitar accesos.
        </p>
      )}
    </Panel>
  );
}

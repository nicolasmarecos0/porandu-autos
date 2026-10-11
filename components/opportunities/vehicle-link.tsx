"use client";

import {
  createContext,
  useActionState,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { stageLabel } from "@/domains/opportunities/labels";
import { VEHICLE_LINK_FIELDS } from "@/domains/opportunities/vehicle-link";
import { linkOpportunityVehicle } from "@/lib/opportunities/actions";
import type { LinkVehicleState } from "@/lib/opportunities/vehicle-link";

/*
 * Vinculación de la unidad en negociación (Hito 2, DEC-033 §2) en
 * /opportunities/[id]. Los botones viven en las tarjetas de match y en la
 * tarjeta de la unidad vinculada, que son Server Components; este módulo
 * aporta el estado de cliente que comparten:
 *
 * - VehicleLinkProvider: un solo pedido a la vez (una sola Server Action) y
 *   un solo aviso, arriba del rail. Al responder, el botón apretado puede
 *   dejar de existir (la tarjeta pasa a "Vinculada"), así que el foco va al
 *   aviso, que además se anuncia.
 * - VehicleLinkButton: "Vincular a la negociación" (una unidad) o "Quitar
 *   vínculo" (sin unidad).
 *
 * No conoce la base: envía a linkOpportunityVehicle() la oportunidad y la
 * unidad. La regla (etapa, disponibilidad, match vigente) la imponen el
 * servidor y la base; esto solo evita ofrecer lo que no corresponde. Un solo
 * click, sin confirmación: vincular es reversible y no tiene efecto
 * económico (no reserva ni vende la unidad).
 */

type VehicleLinkContextValue = Readonly<{
  opportunityId: string;
  pending: boolean;
  /** La unidad del pedido en curso (null: quitar el vínculo). */
  requested: string | null | undefined;
  submit: (formData: FormData, vehicleId: string | null) => void;
}>;

const VehicleLinkContext = createContext<VehicleLinkContextValue | null>(null);

/** Aviso tras un pedido, o null si no hay nada que avisar. */
function noticeOf(
  state: LinkVehicleState,
): { text: string; tone: "info" | "error" } | null {
  switch (state?.status) {
    case undefined:
      return null;
    case "linked":
      return {
        text: "Unidad vinculada a la negociación. El stock no cambia.",
        tone: "info",
      };
    case "unlinked":
      return { text: "Se quitó la unidad vinculada.", tone: "info" };
    case "unchanged":
      return {
        text:
          state.vehicleId === null
            ? "No había una unidad vinculada. No se hizo ningún cambio."
            : "Esa unidad ya estaba vinculada. No se hizo ningún cambio.",
        tone: "info",
      };
    case "stage_not_allowed":
      return {
        text: `No se hizo ningún cambio: la etapa actual es ${stageLabel(state.stage)} y la unidad solo se vincula En negociación.`,
        tone: "error",
      };
    case "vehicle_not_found":
      return {
        text: "No encontramos esa unidad en el stock. No se hizo ningún cambio.",
        tone: "error",
      };
    case "vehicle_not_available":
      return {
        text: "No se hizo ningún cambio: la unidad ya no está disponible.",
        tone: "error",
      };
    case "not_a_match":
      return {
        text: "No se hizo ningún cambio: la unidad ya no es un match de lo que busca el cliente.",
        tone: "error",
      };
    case "invalid":
      return { text: "No pudimos interpretar el pedido.", tone: "error" };
    case "not_found":
      return { text: "No encontramos la oportunidad.", tone: "error" };
    case "failed":
      return {
        text: "No pudimos actualizar la unidad vinculada. No se hizo ningún cambio: intentá de nuevo en unos minutos.",
        tone: "error",
      };
  }
}

export function VehicleLinkProvider({
  opportunityId,
  children,
}: {
  opportunityId: string;
  children: ReactNode;
}) {
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const [requested, setRequested] = useState<string | null | undefined>(
    undefined,
  );
  const [state, action, pending] = useActionState<LinkVehicleState, FormData>(
    async (previous, formData) => {
      const result = await linkOpportunityVehicle(previous, formData);
      noticeRef.current?.focus();
      return result;
    },
    null,
  );
  const notice = pending ? null : noticeOf(state);

  return (
    <VehicleLinkContext
      value={{
        opportunityId,
        pending,
        requested,
        submit: (formData, vehicleId) => {
          setRequested(vehicleId);
          action(formData);
        },
      }}
    >
      <p
        ref={noticeRef}
        role="status"
        tabIndex={-1}
        className={cn(
          "rounded-md border px-3 py-2 text-label focus:outline-none",
          notice
            ? notice.tone === "error"
              ? "border-danger-border bg-danger-soft text-danger"
              : "border-success-border bg-success-soft text-success"
            : "sr-only",
        )}
      >
        {notice?.text}
      </p>
      {children}
    </VehicleLinkContext>
  );
}

/**
 * Botón de vinculación. Con `vehicleId`, vincula esa unidad; con null, quita
 * la vinculada. `vehicleName` completa el nombre accesible ("Vincular a la
 * negociación: Toyota Hilux"), porque puede haber dos tarjetas. Fuera de un
 * VehicleLinkProvider no se dibuja.
 */
export function VehicleLinkButton({
  vehicleId,
  vehicleName,
}: {
  vehicleId: string | null;
  vehicleName: string;
}) {
  const context = useContext(VehicleLinkContext);
  if (!context) return null;
  const { opportunityId, pending, requested, submit } = context;
  const busy = pending && requested === vehicleId;
  const label = vehicleId ? "Vincular a la negociación" : "Quitar vínculo";

  return (
    <form action={(formData) => submit(formData, vehicleId)} aria-busy={busy}>
      <input
        type="hidden"
        name={VEHICLE_LINK_FIELDS.opportunityId}
        value={opportunityId}
      />
      <input
        type="hidden"
        name={VEHICLE_LINK_FIELDS.vehicleId}
        value={vehicleId ?? ""}
      />
      <Button
        type="submit"
        variant={vehicleId ? "primary" : "secondary"}
        disabled={pending}
        className="disabled:cursor-wait disabled:opacity-70"
      >
        {busy ? (vehicleId ? "Vinculando…" : "Quitando…") : label}
        <span className="sr-only">: {vehicleName}</span>
      </Button>
    </form>
  );
}

"use client";

import Link from "next/link";

import {
  CLOSURE_DIALOG_COPY,
  ClosureForm,
} from "@/components/opportunities/closure-form";
import {
  ConfirmDialog,
  ConfirmDialogContent,
} from "@/components/ui/confirm-dialog";
import type { PipelineCard } from "@/domains/opportunities/pipeline";
import type { ClosingStage } from "@/domains/opportunities/pipeline-moves";
import { saleNoticeFor } from "@/domains/vehicles/lifecycle";
import type { CloseOpportunityState } from "@/lib/opportunities/closure";
import { opportunityPath } from "@/lib/quotes/paths";

/*
 * Confirmación de un cierre pedido desde el embudo (propuesta DEC-048):
 * soltar una tarjeta en Ganada o Perdida, o elegirlo en "Mover a…", nunca
 * cierra al instante. Abre el mismo formulario del panel "Etapa" de
 * /opportunities/[id] (ClosureForm, DEC-034): resultado, sus datos y la
 * confirmación humana, porque de una etapa terminal no se vuelve y ganar es
 * una venta (CLAUDE.md §2).
 *
 * El tablero guarda de forma optimista: al confirmar, el diálogo se cierra,
 * la tarjeta pasa a su columna y la Server Action guarda. Si el servidor
 * devuelve un error por campo, una falla o la unidad ya no está vinculada,
 * la tarjeta vuelve y este diálogo reabre con lo cargado y el aviso
 * (`state`). Ganar sin unidad vinculada, o con una que ya no se puede
 * vender (vendida o en preparación, propuesta DEC-051), no se ofrece: lleva
 * a la oportunidad, donde se vincula otra desde los matches.
 */

export type PipelineClosing = Readonly<{
  card: PipelineCard;
  to: ClosingStage;
  /** Día de Asunción al abrir: acota la fecha de entrega. */
  today: string;
  /** Respuesta del intento anterior: errores y lo cargado. */
  state: CloseOpportunityState;
}>;

export function PipelineCloseDialog({
  closing,
  onCancel,
  onConfirm,
  onCloseAutoFocus,
}: {
  closing: PipelineClosing | null;
  onCancel: () => void;
  onConfirm: (closing: PipelineClosing, formData: FormData) => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  const sale = closing?.card.saleVehicle;
  const unsellable =
    closing?.state?.status === "vehicle_conflict" ||
    (sale !== null &&
      sale !== undefined &&
      saleNoticeFor(sale.status).kind === "conflict");
  return (
    <ConfirmDialog
      open={closing !== null}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      {closing ? (
        <ConfirmDialogContent
          title={CLOSURE_DIALOG_COPY[closing.to].title}
          description={CLOSURE_DIALOG_COPY[closing.to].description}
          onCloseAutoFocus={onCloseAutoFocus}
        >
          <ClosureForm
            to={closing.to}
            opportunityId={closing.card.id}
            stage={closing.card.stage}
            saleVehicle={closing.card.saleVehicle}
            acceptedQuoteTotal={closing.card.acceptedQuoteTotal}
            today={closing.today}
            pending={false}
            state={closing.state}
            subject={closing.card.name}
            onSubmit={(formData) => onConfirm(closing, formData)}
            blockedHint={
              <Link
                href={opportunityPath(closing.card.id)}
                prefetch={false}
                className="self-start rounded-sm text-label font-semibold text-brand hover:text-brand-strong hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
              >
                {unsellable
                  ? "Abrir la oportunidad para vincular otra unidad"
                  : "Abrir la oportunidad para vincular la unidad"}
              </Link>
            }
          />
        </ConfirmDialogContent>
      ) : null}
    </ConfirmDialog>
  );
}

"use client";

import { useActionState, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { CheckIcon, ChevronRightIcon } from "@/components/ui/icons";
import { Panel, PanelHeader } from "@/components/ui/panel";
import {
  LOSS_REASON_LABELS,
  STAGE_ACTION_LABELS,
  stageLabel,
} from "@/domains/opportunities/labels";
import {
  isTerminalStage,
  nextStages,
  STAGE_CHANGE_FIELDS,
  type LossReason,
  type Stage,
} from "@/domains/opportunities/stages";
import { changeOpportunityStage } from "@/lib/opportunities/actions";
import type { ChangeStageState } from "@/lib/opportunities/stage-change";

import { StageBadge } from "./stage-badge";
import { StageCloseDialog } from "./stage-close-dialog";

/*
 * Etapa de la oportunidad en /opportunities/[id] (H1.6, DEC-032 §5): dónde
 * está en el ciclo comercial y qué se puede hacer con ella.
 *
 *   ┌ Etapa ──────────────────────────────────────────────────────┐
 *   │ ✓ Nueva ›  ● En calificación ›  ○ En negociación ›  ○ Ganada │
 *   │ [Pasar a negociación]  [Marcar como perdida]                 │
 *   └──────────────────────────────────────────────────────────────┘
 *
 * Las acciones son exactamente las que la máquina de estados del dominio
 * permite desde la etapa actual (nextStages()). Pasar a calificación o a
 * negociación es un click. Cerrar (ganada o perdida) abre una confirmación,
 * porque de una etapa terminal no se vuelve; perder pide además el motivo.
 * Una oportunidad cerrada no ofrece acciones.
 *
 * No conoce la base: envía a la Server Action changeOpportunityStage() la
 * oportunidad y la etapa de destino. La regla la imponen el servidor y la
 * base; este panel solo evita ofrecer lo que no corresponde. Al cambiar, la
 * Server Action revalida la página y la etapa se vuelve a leer en el
 * servidor.
 */

/** Tramo del flujo que se dibuja; `lost` no es un paso, es una salida. */
const PIPELINE = ["new", "qualifying", "negotiating", "won"] as const;

type OpportunityStagePanelProps = Readonly<{
  opportunityId: string;
  stage: Stage;
  /** Motivo de la pérdida; solo existe con `lost`. */
  lossReason: LossReason | null;
}>;

/** Texto del aviso tras un pedido, o null si no hay nada que avisar. */
function noticeOf(state: ChangeStageState): {
  text: string;
  tone: "info" | "error";
} | null {
  switch (state?.status) {
    case undefined:
      return null;
    case "changed":
      return {
        text: `Etapa actualizada: ${stageLabel(state.to)}.`,
        tone: "info",
      };
    case "unchanged":
      return {
        text: `Ya estaba en ${stageLabel(state.stage)}. No se hizo ningún cambio.`,
        tone: "info",
      };
    case "invalid_transition":
      return {
        text: `No se hizo ningún cambio: la oportunidad está en ${stageLabel(state.current)} y desde ahí no se puede hacer ese pase.`,
        tone: "error",
      };
    case "loss_reason_required":
      return { text: "Elegí el motivo de la pérdida.", tone: "error" };
    case "invalid":
      return { text: "No pudimos interpretar el pedido.", tone: "error" };
    case "not_found":
      return { text: "No encontramos la oportunidad.", tone: "error" };
    case "failed":
      return {
        text: "No pudimos cambiar la etapa. No se hizo ningún cambio: intentá de nuevo en unos minutos.",
        tone: "error",
      };
  }
}

function Stepper({ stage }: { stage: Stage }) {
  const current = PIPELINE.indexOf(stage as (typeof PIPELINE)[number]);
  return (
    <ol
      aria-label="Etapas de la oportunidad"
      className="flex flex-wrap items-center gap-x-1.5 gap-y-2"
    >
      {PIPELINE.map((id, index) => {
        const done = index < current;
        const active = index === current;
        const closing = active && id === "won";
        return (
          <li
            key={id}
            aria-current={active ? "step" : undefined}
            className="flex items-center gap-1.5"
          >
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-label",
                active &&
                  (closing
                    ? "border-success bg-success font-semibold text-brand-contrast"
                    : "border-brand bg-brand font-semibold text-brand-contrast"),
                done && "border-brand-border bg-brand-soft text-brand-strong",
                !active &&
                  !done &&
                  "border-border-default bg-surface-2 text-text-muted",
              )}
            >
              {done || closing ? (
                <CheckIcon className="size-3.5" strokeWidth={2.25} />
              ) : null}
              {stageLabel(id)}
              <span className="sr-only">
                {active
                  ? " (etapa actual)"
                  : done
                    ? " (completada)"
                    : " (pendiente)"}
              </span>
            </span>
            {index < PIPELINE.length - 1 ? (
              <ChevronRightIcon
                aria-hidden="true"
                className="size-3.5 text-text-muted"
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

export function OpportunityStagePanel({
  opportunityId,
  stage,
  lossReason,
}: OpportunityStagePanelProps) {
  const [dialog, setDialog] = useState<"won" | "lost" | null>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const settled = useRef(false);
  const [state, action, pending] = useActionState<ChangeStageState, FormData>(
    async (previous, formData) => {
      const result = await changeOpportunityStage(previous, formData);
      // Lo que cierra el diálogo: cualquier respuesta salvo las que se
      // corrigen con el diálogo abierto (falla inesperada, falta el motivo).
      if (
        result !== null &&
        result.status !== "failed" &&
        result.status !== "loss_reason_required"
      ) {
        settled.current = true;
        setDialog(null);
        // El botón apretado deja de existir al cambiar la etapa: el foco
        // pasa al aviso, que además se anuncia.
        noticeRef.current?.focus();
      }
      return result;
    },
    null,
  );

  const notice = noticeOf(state);
  // Con un diálogo abierto, sus errores se muestran adentro.
  const inDialog =
    dialog !== null &&
    (state?.status === "failed" || state?.status === "loss_reason_required");
  const targets = nextStages(stage);
  const advances = targets.filter(
    (to): to is "qualifying" | "negotiating" => !isTerminalStage(to),
  );
  const closes = targets.filter(
    (to): to is "won" | "lost" => to === "won" || to === "lost",
  );

  const dialogProps = {
    opportunityId,
    stage,
    action,
    pending,
    state,
    onCloseAutoFocus: (event: Event) => {
      if (settled.current) {
        event.preventDefault();
        noticeRef.current?.focus();
      }
    },
  } as const;

  return (
    <section aria-labelledby="stage-heading" className="max-w-3xl">
      <Panel>
        <PanelHeader>
          <h2 id="stage-heading" className="text-heading text-text-primary">
            Etapa
          </h2>
          <span className="ml-auto">
            <StageBadge stage={stage} />
          </span>
        </PanelHeader>
        <div className="flex flex-col gap-3 px-4 py-3.5">
          {stage === "lost" ? (
            <p className="rounded-md border border-danger-border bg-danger-soft px-3 py-2 text-label text-danger">
              Oportunidad perdida
              {lossReason ? (
                <>
                  . Motivo:{" "}
                  <span className="font-semibold">
                    {LOSS_REASON_LABELS[lossReason]}
                  </span>
                </>
              ) : null}
              . Es una etapa final: no admite más cambios.
            </p>
          ) : (
            <Stepper stage={stage} />
          )}
          {stage === "won" ? (
            <p className="text-label text-text-secondary">
              Venta concretada. Es una etapa final: no admite más cambios.
            </p>
          ) : null}
          {targets.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              {advances.map((to) => (
                <form
                  key={to}
                  action={(formData) => {
                    settled.current = false;
                    action(formData);
                  }}
                  aria-busy={pending}
                >
                  <input
                    type="hidden"
                    name={STAGE_CHANGE_FIELDS.opportunityId}
                    value={opportunityId}
                  />
                  <input
                    type="hidden"
                    name={STAGE_CHANGE_FIELDS.stage}
                    value={to}
                  />
                  <Button type="submit" variant="primary" disabled={pending}>
                    {pending ? "Guardando…" : STAGE_ACTION_LABELS[to]}
                  </Button>
                </form>
              ))}
              {closes.map((to) => (
                <StageCloseDialog
                  key={to}
                  to={to}
                  open={dialog === to}
                  onOpenChange={(open) => {
                    if (open) settled.current = false;
                    setDialog(open ? to : null);
                  }}
                  {...dialogProps}
                />
              ))}
            </div>
          ) : null}
          <p
            ref={noticeRef}
            role="status"
            tabIndex={-1}
            className={cn(
              "text-caption focus:outline-none",
              notice && !inDialog
                ? notice.tone === "error"
                  ? "text-danger"
                  : "text-success"
                : "sr-only",
            )}
          >
            {notice && !inDialog ? notice.text : null}
          </p>
        </div>
      </Panel>
    </section>
  );
}

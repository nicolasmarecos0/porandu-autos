"use client";

import {
  DndContext,
  DragOverlay,
  MouseSensor,
  pointerWithin,
  rectIntersection,
  TouchSensor,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { useRouter } from "next/navigation";
import {
  startTransition,
  useEffect,
  useMemo,
  useOptimistic,
  useRef,
  useState,
} from "react";

import {
  closureStaysOpen,
  closureValuesOf,
} from "@/components/opportunities/closure-form";
import { cn } from "@/components/ui/cn";
import {
  CLOSURE_FIELDS,
  isLossReason,
  todayInAsuncion,
} from "@/domains/opportunities/closure";
import { stageLabel } from "@/domains/opportunities/labels";
import type {
  PipelineBoard as PipelineBoardModel,
  PipelineCard,
  PipelineColumn,
} from "@/domains/opportunities/pipeline";
import {
  dropZone,
  moveCard,
  planBoardMove,
  type AdvanceStage,
  type OptimisticMove,
} from "@/domains/opportunities/pipeline-moves";
import {
  isStage,
  STAGE_CHANGE_FIELDS,
  type Stage,
} from "@/domains/opportunities/stages";
import {
  changeOpportunityStage,
  closeOpportunity,
} from "@/lib/opportunities/actions";
import type { CloseOpportunityState } from "@/lib/opportunities/closure";
import type { ChangeStageState } from "@/lib/opportunities/stage-change";

import {
  advanceOutcome,
  closeOutcome,
  type MoveOutcome,
  type PipelineNoticeContent,
} from "./notices";
import { DragHint, PipelineCardView } from "./pipeline-card";
import {
  PipelineCloseDialog,
  type PipelineClosing,
} from "./pipeline-close-dialog";
import { PipelineColumnView } from "./pipeline-column";
import { createdNotice, PipelineHeader } from "./pipeline-header";
import { PipelineNotice, type PipelineNoticeState } from "./pipeline-notice";
import { StageTabs } from "./stage-tabs";

/*
 * Embudo de ventas: tablero Kanban de oportunidades (propuesta DEC-048).
 * Client Component: recibe el ViewModel del loader (requireTenant() →
 * withTenant() → RLS) y es dueño del arrastre, del estado optimista, de la
 * confirmación de los cierres y de los avisos.
 *
 * Mover una tarjeta, con el mouse, el dedo o el menú "Mover a…":
 *
 *   planBoardMove(etapa, destino)                       (máquina de DEC-032)
 *   ├─ none / blocked → nada que pedir; el bloqueo se explica en el aviso
 *   ├─ advance → useOptimistic: la tarjeta pasa ya a su columna (Guardando…)
 *   │            → changeOpportunityStage() → la página revalidada reemplaza
 *   │            el estado optimista; si falla, la tarjeta vuelve sola
 *   └─ close   → confirmación con los datos del cierre (ClosureForm, DEC-034)
 *                → al confirmar: optimista + closeOpportunity(); un error por
 *                campo o una falla devuelven la tarjeta y reabren el diálogo
 *                con lo cargado
 *
 * Las Server Actions son las mismas puertas de /opportunities/[id]: el
 * cliente solo envía la oportunidad, el destino y, al cerrar, sus datos. La
 * etapa de origen, la organización, el usuario y el reloj los resuelve el
 * servidor sobre la fila bloqueada, y la base vuelve a exigir el pase con su
 * trigger. Una oportunidad que otra persona movió responde `unchanged` o
 * `invalid_transition` con la etapa real, y el tablero se vuelve a leer.
 *
 * Arrastre (@dnd-kit/core): el mouse arrastra después de 6 px y el dedo
 * después de mantener 220 ms (deslizar sigue desplazando el tablero); el
 * tablero se desplaza solo cerca de los bordes. Las columnas se detectan por
 * el puntero y, si no hay ninguna debajo, por superposición. El teclado y
 * los lectores de pantalla usan "Mover a…", que ofrece los mismos pases; el
 * arrastre se anuncia en es-PY.
 */

type BoardState = Readonly<{
  columns: readonly PipelineColumn[];
  /** Oportunidades con un pase guardándose. */
  saving: readonly string[];
}>;

function withMove(state: BoardState, move: OptimisticMove): BoardState {
  return {
    columns: moveCard(state.columns, move),
    saving: [...state.saving, move.opportunityId],
  };
}

/** Cuánto queda a la vista un aviso. */
const NOTICE_MS = 6000;

/** La columna bajo el puntero; si no hay, la que más se superpone. */
const collisionDetection: CollisionDetection = (args) => {
  const pointer = pointerWithin(args);
  return pointer.length > 0 ? pointer : rectIntersection(args);
};

const SCREEN_READER_INSTRUCTIONS = {
  draggable:
    "Para cambiar la etapa de una oportunidad, usá el botón «Cambiar etapa» de su tarjeta.",
};

export function PipelineBoard({
  title,
  board,
}: {
  title: string;
  board: PipelineBoardModel;
}) {
  const router = useRouter();
  const base = useMemo<BoardState>(
    () => ({ columns: board.columns, saving: [] }),
    [board.columns],
  );
  const [view, addOptimisticMove] = useOptimistic(base, withMove);
  const [activeId, setActiveId] = useState<string | null>(null);
  // La columna bajo la tarjeta arrastrada: la pista que la acompaña.
  const [overStage, setOverStage] = useState<Stage | null>(null);
  const [closing, setClosing] = useState<PipelineClosing | null>(null);
  const [notice, setNotice] = useState<PipelineNoticeState | null>(null);
  const noticeSequence = useRef(0);
  const noticeRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  // Se confirmó un cierre: el foco va al aviso, no a un botón que se movió.
  const confirmedClose = useRef(false);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 220, tolerance: 8 },
    }),
  );

  const cards = useMemo(
    () =>
      new Map(
        view.columns.flatMap((column) =>
          column.cards.map((card) => [card.id, card] as const),
        ),
      ),
    [view.columns],
  );
  const saving = useMemo(() => new Set(view.saving), [view.saving]);
  const active = activeId === null ? null : (cards.get(activeId) ?? null);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(
      () =>
        setNotice((current) => (current?.id === notice.id ? null : current)),
      NOTICE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [notice]);

  function announce(content: PipelineNoticeContent) {
    noticeSequence.current += 1;
    setNotice({ ...content, id: noticeSequence.current });
  }

  function settle(outcome: MoveOutcome) {
    announce(outcome.notice);
    if (outcome.refresh) router.refresh();
  }

  function advance(card: PipelineCard, to: AdvanceStage) {
    const formData = new FormData();
    formData.set(STAGE_CHANGE_FIELDS.opportunityId, card.id);
    formData.set(STAGE_CHANGE_FIELDS.stage, to);
    startTransition(async () => {
      addOptimisticMove({ opportunityId: card.id, to });
      let result: ChangeStageState;
      try {
        result = await changeOpportunityStage(null, formData);
      } catch {
        result = { status: "failed" };
      }
      settle(advanceOutcome(card.name, to, result));
    });
  }

  function requestMove(card: PipelineCard, to: Stage) {
    if (saving.has(card.id)) return;
    const move = planBoardMove(card.stage, to);
    switch (move.kind) {
      case "none":
        return;
      case "blocked":
        announce({ tone: "error", text: move.message });
        return;
      case "advance":
        advance(card, move.to);
        return;
      case "close":
        confirmedClose.current = false;
        setClosing({
          card,
          to: move.to,
          today: todayInAsuncion(new Date()),
          state: null,
        });
        return;
    }
  }

  function confirmClose(current: PipelineClosing, formData: FormData) {
    const { card, to } = current;
    const reason = formData.get(CLOSURE_FIELDS.lossReason);
    confirmedClose.current = true;
    setClosing(null);
    startTransition(async () => {
      addOptimisticMove({
        opportunityId: card.id,
        to,
        ...(to === "lost" && isLossReason(reason)
          ? { lossReason: reason }
          : {}),
      });
      let result: CloseOpportunityState;
      try {
        result = await closeOpportunity(null, formData);
      } catch {
        result = null;
      }
      if (result === null) {
        result = {
          status: "failed",
          outcome: to,
          values: closureValuesOf(formData, to),
        };
      }
      if (closureStaysOpen(result)) {
        // La tarjeta vuelve sola a su columna al terminar el pedido; el
        // diálogo reabre con lo cargado y el aviso para corregir o reintentar.
        confirmedClose.current = false;
        setClosing({ ...current, state: result });
        return;
      }
      settle(closeOutcome(card.name, result));
    });
  }

  function onDragStart({ active: dragged }: DragStartEvent) {
    setActiveId(String(dragged.id));
    setOverStage(null);
  }

  function onDragOver({ over }: DragOverEvent) {
    const stage = over?.id;
    setOverStage(isStage(stage) ? stage : null);
  }

  function endDrag() {
    setActiveId(null);
    setOverStage(null);
  }

  function onDragEnd({ active: dragged, over }: DragEndEvent) {
    endDrag();
    const card = cards.get(String(dragged.id));
    const to = over?.id;
    if (!card || !isStage(to)) return;
    requestMove(card, to);
  }

  const nameOf = (id: UniqueIdentifier) =>
    cards.get(String(id))?.name ?? "la oportunidad";
  const stageOf = (id: UniqueIdentifier | undefined) =>
    isStage(id) ? stageLabel(id) : null;
  const announcements: Announcements = {
    onDragStart: ({ active: dragged }) => `Moviendo a ${nameOf(dragged.id)}.`,
    onDragOver: ({ active: dragged, over }) => {
      const stage = stageOf(over?.id);
      return stage
        ? `${nameOf(dragged.id)} sobre ${stage}.`
        : `${nameOf(dragged.id)} fuera de las columnas.`;
    },
    onDragEnd: ({ active: dragged, over }) => {
      const stage = stageOf(over?.id);
      return stage
        ? `${nameOf(dragged.id)} soltada en ${stage}.`
        : `${nameOf(dragged.id)} soltada fuera de las columnas: no se movió.`;
    },
    onDragCancel: ({ active: dragged }) =>
      `Se canceló el movimiento de ${nameOf(dragged.id)}.`,
  };

  return (
    <DndContext
      id="opportunity-pipeline"
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={endDrag}
      accessibility={{
        announcements,
        screenReaderInstructions: SCREEN_READER_INSTRUCTIONS,
      }}
    >
      <PipelineHeader
        title={title}
        board={board}
        onCreated={(created) =>
          announce({ tone: "info", text: createdNotice(created) })
        }
      />
      <StageTabs columns={view.columns} boardRef={boardRef} />
      <div
        ref={boardRef}
        className={cn(
          // `relative`: el tablero contiene (y recorta) lo posicionado de
          // sus tarjetas, como los textos `sr-only`; si no, su ancho se le
          // suma a <main> y el desplazamiento automático lo movería.
          "relative flex min-h-0 flex-1 scroll-px-gutter gap-3 overflow-x-auto overscroll-x-contain px-gutter pt-3 pb-gutter xl:overflow-x-hidden",
          // El snap pelearía con el desplazamiento automático del arrastre.
          activeId === null && "snap-x snap-mandatory xl:snap-none",
        )}
      >
        {view.columns.map((column) => (
          <PipelineColumnView
            key={column.stage}
            column={column}
            dragFrom={active?.stage ?? null}
            saving={saving}
            closedWindowDays={board.closedWindowDays}
            onMove={requestMove}
          />
        ))}
      </div>
      <DragOverlay dropAnimation={null}>
        {active ? (
          <div className="flex flex-col gap-2">
            <PipelineCardView card={active} overlay />
            {overStage ? (
              <DragHint
                stage={overStage}
                zone={dropZone(active.stage, overStage)}
              />
            ) : null}
          </div>
        ) : null}
      </DragOverlay>
      <PipelineCloseDialog
        closing={closing}
        onCancel={() => setClosing(null)}
        onConfirm={confirmClose}
        onCloseAutoFocus={(event) => {
          if (!confirmedClose.current) return;
          event.preventDefault();
          noticeRef.current?.focus();
        }}
      />
      <PipelineNotice
        ref={noticeRef}
        notice={notice}
        onDismiss={() => setNotice(null)}
      />
    </DndContext>
  );
}

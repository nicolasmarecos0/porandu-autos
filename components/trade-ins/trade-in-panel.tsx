"use client";

import Link from "next/link";
import { startTransition, useOptimistic, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import {
  ChevronRightIcon,
  LockIcon,
  PlusIcon,
  SwapIcon,
} from "@/components/ui/icons";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { STOCK_PATH } from "@/lib/vehicles/paths";
import {
  optimisticTradeInPanel,
  TRADE_IN_APPRAISE_LABELS,
  TRADE_IN_DECISION_LABELS,
  TRADE_IN_MESSAGES,
  TRADE_IN_PENDING,
  TRADE_IN_STEPS,
  tradeInAppraisedMessage,
  tradeInConflictMessage,
  tradeInDecisionMessage,
  type TradeInCardView,
  type TradeInNoteTone,
  type TradeInOptimisticAction,
  type TradeInPanelData,
  type TradeInStep,
} from "@/domains/opportunities/trade-in-presentation";
import {
  TRADE_IN_DECISION_FIELDS,
  TRADE_IN_STATUS_LABELS,
  type TradeInDecisionId,
} from "@/domains/opportunities/trade-ins";
import {
  appraiseTradeIn,
  changeTradeInStatus,
  registerTradeIn,
} from "@/lib/trade-ins/actions";
import {
  tradeInFormValues,
  type AppraiseTradeInState,
  type ChangeTradeInStatusState,
  type RegisterTradeInState,
} from "@/lib/trade-ins/requests";

import {
  TradeInDecisionDialog,
  type TradeInDecisionRequest,
} from "./trade-in-decision-dialog";
import {
  TradeInDrawer,
  type TradeInDrawerMode,
  type TradeInDrawerRequest,
} from "./trade-in-drawer";
import { TRADE_IN_EDGE, TradeInStatusChip } from "./trade-in-status";

/*
 * Panel "Vehículo en parte de pago / Toma" en /opportunities/[id] (Hito 20,
 * DEC-052 §4).
 *
 *   ┌ Vehículo en parte de pago / Toma ─────────────────── [● Tasado] ┐
 *   │ ┃ ▬▬▬ Registrado  ▬▬▬ Tasado  ─── Aprobado  ─── En stock          │
 *   │ ┃ Toyota Vitz                                                     │
 *   │ ┃ 1.3 F · 2015 · 98.000 km  [ABC 123]                             │
 *   │ ┃ Valor de toma                                       USD 8.000   │
 *   │ ┃ Costo de reacondicionamiento (admin)                  USD 800   │
 *   │ ┃ Costo total de ingreso (admin)                      USD 8.800   │
 *   │ ┃ Comunicale al cliente el valor de toma y registrá su respuesta. │
 *   │ ┃ [Cliente aprobó] [Cliente rechazó] [Retasar]                    │
 *   │ ▸ Tomas anteriores (1)                                            │
 *   └──────────────────────────────────────────────────────────────────┘
 *
 * La vista llega armada del servidor (tradeInPanelData()): un seller nunca
 * recibe la sección financiera. Registrar, tasar y decidir son Server
 * Actions de lib/trade-ins/actions.ts; este panel solo ofrece lo que el
 * dominio permite hoy al que mira.
 *
 * Optimista (useOptimistic de React 19): al confirmar, el panel muestra al
 * instante lo que el pedido va a dejar (optimisticTradeInPanel()), marcado
 * "Guardando…" y sin acciones hasta la respuesta. La página revalidada por
 * la Server Action reemplaza el estado optimista en la misma transición,
 * sin parpadeo; si el servidor no hizo el cambio, vuelve lo real y el aviso
 * (región `status`) dice qué pasó. Un dato inválido o una falla reabren el
 * formulario con lo cargado.
 */

type Notice = Readonly<{ tone: "info" | "error"; text: string }>;

const NOTE_TONE: Readonly<Record<TradeInNoteTone, string>> = {
  neutral: "border-border-subtle bg-surface-2 text-text-secondary",
  info: "border-brand-border bg-brand-soft text-brand-strong",
  success: "border-success-border bg-success-soft text-success",
  warning: "border-warning-border bg-warning-soft text-warning",
};

const STEP_SHORT: Readonly<Record<TradeInStep, string>> = {
  registered: "Registrado",
  appraised: "Tasado",
  accepted: "Aprobado",
  stocked: "En stock",
};

const STEP_FULL: Readonly<Record<TradeInStep, string>> = {
  registered: "Registrado",
  appraised: "Tasado",
  accepted: "Aprobado por el cliente",
  stocked: "En stock",
};

function TradeInStepper({ step }: { step: TradeInStep }) {
  const current = TRADE_IN_STEPS.indexOf(step);
  return (
    <ol aria-label="Recorrido de la toma" className="grid grid-cols-4 gap-1.5">
      {TRADE_IN_STEPS.map((id, index) => {
        const done = index < current;
        const active = index === current;
        return (
          <li
            key={id}
            aria-current={active ? "step" : undefined}
            className="flex min-w-0 flex-col gap-1.5"
          >
            <span
              aria-hidden="true"
              className={cn(
                "h-1 rounded-full transition-colors duration-200 ease-out-strong motion-reduce:transition-none",
                done || active
                  ? id === "stocked" || (active && id === "accepted")
                    ? "bg-success"
                    : "bg-brand"
                  : "bg-border-default",
              )}
            />
            <span
              className={cn(
                "truncate text-caption",
                active
                  ? "font-semibold text-text-primary"
                  : done
                    ? "text-text-secondary"
                    : "text-text-muted",
              )}
            >
              <span className="sm:hidden">{STEP_SHORT[id]}</span>
              <span className="hidden sm:inline">{STEP_FULL[id]}</span>
              <span className="sr-only">
                {active
                  ? " (paso actual)"
                  : done
                    ? " (completado)"
                    : " (pendiente)"}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function AmountRow({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-baseline justify-between gap-4",
        emphasis && "border-t border-border-subtle pt-2",
      )}
    >
      <dt
        className={cn(
          "text-label",
          emphasis ? "font-semibold text-text-primary" : "text-text-secondary",
        )}
      >
        {label}
      </dt>
      <dd
        className={cn(
          "text-right tabular-nums",
          emphasis
            ? "text-title font-semibold text-text-primary"
            : "text-body text-text-primary",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function TradeInCard({
  view,
  saving,
  onAppraise,
  onDecide,
}: {
  view: TradeInCardView;
  saving: boolean;
  onAppraise: (mode: TradeInDrawerMode) => void;
  onDecide: (decision: TradeInDecisionId) => void;
}) {
  const { appraisal } = view;
  const primaryDecision = view.decisions.find((id) => id === "accept");
  const otherDecisions = view.decisions.filter((id) => id !== "accept");
  const hasActions =
    !saving && (view.appraise !== null || view.decisions.length > 0);
  return (
    <article
      aria-label={`Usado en parte de pago: ${view.name}`}
      aria-busy={saving}
      className="relative overflow-hidden rounded-md border border-border-subtle bg-surface-1 py-3 pr-3 pl-4 sm:pr-4 sm:pl-5"
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute inset-y-0 left-0 w-1 transition-colors duration-200 motion-reduce:transition-none",
          TRADE_IN_EDGE[view.status],
        )}
      />
      {view.status === "rejected" ? (
        <p className="text-label font-semibold text-danger">
          {TRADE_IN_STATUS_LABELS.rejected}
        </p>
      ) : (
        <TradeInStepper step={view.step} />
      )}

      <div className="mt-3 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h3 className="text-heading text-text-primary">{view.name}</h3>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-label text-text-secondary tabular-nums">
            <span>{view.detail}</span>
            {view.kmLabel ? (
              <>
                <span aria-hidden="true" className="text-text-muted">
                  ·
                </span>
                <span>{view.kmLabel}</span>
              </>
            ) : null}
            {view.plateLabel ? (
              <span className="inline-flex h-5 items-center rounded-sm border border-border-strong bg-surface-2 px-1.5 text-caption font-semibold tracking-wider text-text-primary">
                <span className="sr-only">Chapa </span>
                {view.plateLabel}
              </span>
            ) : null}
          </p>
        </div>
        {saving ? (
          <span className="inline-flex h-6 items-center rounded-sm bg-surface-2 px-2 text-caption text-text-muted">
            {TRADE_IN_PENDING}
          </span>
        ) : null}
      </div>

      {appraisal ? (
        <dl className="mt-3 flex flex-col gap-1.5 rounded-md bg-surface-2 px-3 py-2.5">
          <AmountRow
            label="Valor de toma"
            value={appraisal.offerPriceLabel}
            emphasis={appraisal.financial === null}
          />
          {appraisal.financial ? (
            <>
              <AmountRow
                label="Costo de reacondicionamiento"
                value={appraisal.financial.repairCostLabel}
              />
              <AmountRow
                label="Costo total de ingreso"
                value={appraisal.financial.intakeCostLabel}
                emphasis
              />
            </>
          ) : (
            <p className="flex items-center gap-1.5 text-caption text-text-muted">
              <LockIcon aria-hidden="true" className="size-3.5 shrink-0" />
              El costo de reacondicionamiento y el costo total de ingreso los ve
              el admin (tasador o gerente).
            </p>
          )}
        </dl>
      ) : null}

      <p className="mt-2 text-caption text-text-muted">
        {view.registeredLabel}
        {appraisal?.appraisedLabel ? ` · ${appraisal.appraisedLabel}` : ""}
      </p>

      {view.note ? (
        <p
          className={cn(
            "mt-2.5 rounded-md border px-3 py-2 text-label",
            NOTE_TONE[view.note.tone],
          )}
        >
          {view.note.text}
          {view.stocked ? (
            <>
              {" "}
              <Link
                href={STOCK_PATH}
                prefetch={false}
                className="inline-flex items-center gap-0.5 font-semibold underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
              >
                Ver en Inventario
                <ChevronRightIcon aria-hidden="true" className="size-3.5" />
              </Link>
            </>
          ) : null}
        </p>
      ) : null}

      {hasActions ? (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          {view.appraise === "appraise" ? (
            <Button
              variant="primary"
              className="h-10 sm:h-8"
              onClick={() => onAppraise("appraise")}
            >
              {TRADE_IN_APPRAISE_LABELS.appraise}
            </Button>
          ) : null}
          {primaryDecision ? (
            <Button
              variant="primary"
              className="h-10 sm:h-8"
              onClick={() => onDecide(primaryDecision)}
            >
              {TRADE_IN_DECISION_LABELS[primaryDecision]}
            </Button>
          ) : null}
          {otherDecisions.map((decision) => (
            <Button
              key={decision}
              variant="secondary"
              className="h-10 sm:h-8"
              onClick={() => onDecide(decision)}
            >
              {TRADE_IN_DECISION_LABELS[decision]}
            </Button>
          ))}
          {view.appraise === "reappraise" ? (
            <Button
              variant="secondary"
              className="h-10 sm:ml-auto sm:h-8"
              onClick={() => onAppraise("reappraise")}
            >
              {TRADE_IN_APPRAISE_LABELS.reappraise}
            </Button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

/** Qué dice el panel de una respuesta de registerTradeIn(). */
function registerNotice(result: RegisterTradeInState): Notice | null {
  switch (result?.status) {
    case "registered":
      return {
        tone: "info",
        text: result.appraised
          ? `${result.label} registrado y tasado.`
          : `${result.label} registrado: queda Pendiente de tasación.`,
      };
    case "opportunity_closed":
      return { tone: "error", text: TRADE_IN_MESSAGES.opportunity_closed };
    case "already_registered":
      return { tone: "error", text: TRADE_IN_MESSAGES.already_registered };
    case "not_found":
      return { tone: "error", text: TRADE_IN_MESSAGES.not_found };
    default:
      return null;
  }
}

function appraiseNotice(result: AppraiseTradeInState): Notice | null {
  switch (result?.status) {
    case "appraised":
      return {
        tone: "info",
        text: tradeInAppraisedMessage(result.label, result.offerPriceLabel),
      };
    case "unchanged":
      return {
        tone: "info",
        text: `${result.label} ya tenía esa tasación. No se hizo ningún cambio.`,
      };
    case "conflict":
      return { tone: "error", text: tradeInConflictMessage(result.current) };
    case "opportunity_closed":
      return { tone: "error", text: TRADE_IN_MESSAGES.opportunity_closed };
    case "requires_admin":
      return { tone: "error", text: TRADE_IN_MESSAGES.requires_admin };
    case "not_found":
      return { tone: "error", text: TRADE_IN_MESSAGES.not_found };
    default:
      return null;
  }
}

function decisionNotice(result: ChangeTradeInStatusState): Notice {
  switch (result?.status) {
    case "changed":
      return {
        tone: "info",
        text: tradeInDecisionMessage(result.decision, result.label),
      };
    case "unchanged":
      return {
        tone: "info",
        text: `${result.label} ya estaba «${TRADE_IN_STATUS_LABELS[result.current]}». No se hizo ningún cambio.`,
      };
    case "conflict":
      return { tone: "error", text: tradeInConflictMessage(result.current) };
    case "offer_price_required":
      return { tone: "error", text: TRADE_IN_MESSAGES.offer_price_required };
    case "opportunity_closed":
      return { tone: "error", text: TRADE_IN_MESSAGES.opportunity_closed };
    case "not_found":
      return { tone: "error", text: TRADE_IN_MESSAGES.not_found };
    case "failed":
    case undefined:
      return { tone: "error", text: TRADE_IN_MESSAGES.failed };
  }
}

const RETRY_MESSAGES = {
  invalid: "Revisá los datos marcados. No se guardó nada.",
  failed: TRADE_IN_MESSAGES.failed,
  requires_admin: TRADE_IN_MESSAGES.requires_admin,
} as const;

export function TradeInPanel({
  opportunityId,
  data,
}: {
  opportunityId: string;
  data: TradeInPanelData;
}) {
  const [view, addOptimistic] = useOptimistic(
    data,
    (current: TradeInPanelData, action: TradeInOptimisticAction) =>
      optimisticTradeInPanel(current, action, new Date()),
  );
  const [drawer, setDrawer] = useState<TradeInDrawerRequest | null>(null);
  const [decision, setDecision] = useState<TradeInDecisionRequest | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const settled = useRef(false);
  const { current, history, saving } = view;

  const announce = (next: Notice | null) => {
    setNotice(next);
    noticeRef.current?.focus();
  };

  function save(
    mode: TradeInDrawerMode,
    formData: FormData,
    action: TradeInOptimisticAction,
  ) {
    setDrawer(null);
    setNotice(null);
    startTransition(async () => {
      addOptimistic(action);
      if (mode === "register") {
        let result: RegisterTradeInState;
        try {
          result = await registerTradeIn(null, formData);
        } catch {
          result = { status: "failed", values: tradeInFormValues(formData) };
        }
        if (
          result?.status === "invalid" ||
          result?.status === "failed" ||
          result?.status === "requires_admin"
        ) {
          setDrawer({
            mode,
            retry: {
              errors: result.status === "invalid" ? result.errors : {},
              values: result.values,
              message: RETRY_MESSAGES[result.status],
            },
          });
          return;
        }
        announce(registerNotice(result));
        return;
      }
      let result: AppraiseTradeInState;
      try {
        result = await appraiseTradeIn(null, formData);
      } catch {
        result = { status: "failed", values: tradeInFormValues(formData) };
      }
      if (result?.status === "invalid" || result?.status === "failed") {
        setDrawer({
          mode,
          retry: {
            errors: result.status === "invalid" ? result.errors : {},
            values: result.values,
            message: RETRY_MESSAGES[result.status],
          },
        });
        return;
      }
      announce(appraiseNotice(result));
    });
  }

  function decide(request: TradeInDecisionRequest) {
    settled.current = true;
    setDecision(null);
    setNotice(null);
    const formData = new FormData();
    formData.set(TRADE_IN_DECISION_FIELDS.tradeInId, request.view.id);
    formData.set(TRADE_IN_DECISION_FIELDS.decision, request.decision);
    startTransition(async () => {
      addOptimistic({ kind: "decide", decision: request.decision });
      let result: ChangeTradeInStatusState;
      try {
        result = await changeTradeInStatus(null, formData);
      } catch {
        result = { status: "failed" };
      }
      announce(decisionNotice(result));
    });
  }

  return (
    <section aria-labelledby="trade-in-heading" className="max-w-3xl">
      <Panel>
        <PanelHeader>
          <h2
            id="trade-in-heading"
            className="min-w-0 truncate text-heading text-text-primary"
          >
            Vehículo en parte de pago
            <span className="text-text-muted"> / Toma</span>
          </h2>
          <span className="ml-auto">
            {current ? <TradeInStatusChip status={current.status} /> : null}
          </span>
        </PanelHeader>
        <div className="flex flex-col gap-3 px-3 py-3.5 sm:px-4">
          {view.hint ? (
            <p className="rounded-md border border-border-subtle bg-surface-2 px-3 py-2 text-label text-text-secondary">
              {view.hint}
            </p>
          ) : null}

          {current ? (
            <TradeInCard
              view={current}
              saving={saving}
              onAppraise={(mode) => setDrawer({ mode, retry: null })}
              onDecide={(id) => {
                settled.current = false;
                setDecision({ view: current, decision: id });
              }}
            />
          ) : (
            <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-border-default px-4 py-7 text-center">
              <SwapIcon aria-hidden="true" className="size-6 text-text-muted" />
              <p className="text-body font-semibold text-text-primary">
                Sin vehículo en parte de pago
              </p>
              <p className="max-w-sm text-label text-text-secondary">
                {view.canRegister
                  ? history.length > 0
                    ? "La última toma se rechazó. Si el cliente trae otro usado, o se vuelve a negociar el mismo, registralo para tasarlo."
                    : "Si el cliente entrega su usado, registralo para tasarlo. Aprobado por el cliente, ingresa al stock al ganar la venta."
                  : "La oportunidad está cerrada: no se registraron tomas."}
              </p>
              {view.canRegister ? (
                <Button
                  variant="primary"
                  className="mt-1 h-10 sm:h-8"
                  disabled={saving}
                  onClick={() => setDrawer({ mode: "register", retry: null })}
                >
                  <PlusIcon aria-hidden="true" className="size-4" />
                  Registrar usado
                </Button>
              ) : null}
            </div>
          )}

          {history.length > 0 ? (
            <details className="group">
              <summary className="-mx-1 inline-flex cursor-pointer list-none items-center gap-1 rounded-sm px-1 text-caption text-brand hover:text-brand-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring [&::-webkit-details-marker]:hidden">
                <ChevronRightIcon
                  aria-hidden="true"
                  className="size-3.5 transition-transform duration-150 ease-out-strong group-open:rotate-90 motion-reduce:transition-none"
                />
                Tomas anteriores ({history.length})
              </summary>
              <ol
                aria-label="Tomas anteriores"
                className="mt-2 flex flex-col gap-2 border-l-2 border-border-subtle pl-3"
              >
                {history.map((item) => (
                  <li
                    key={item.id}
                    className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-caption"
                  >
                    <span className="text-label text-text-primary">
                      {item.label}
                    </span>
                    <span className="text-danger">{item.statusLabel}</span>
                    <span className="text-text-secondary tabular-nums">
                      {item.offerPriceLabel
                        ? `Valor de toma ${item.offerPriceLabel}`
                        : "Sin tasar"}
                    </span>
                    <span className="text-text-muted">{item.at}</span>
                  </li>
                ))}
              </ol>
            </details>
          ) : null}

          <p
            ref={noticeRef}
            role="status"
            tabIndex={-1}
            className={cn(
              "text-caption focus:outline-none",
              notice && !saving
                ? notice.tone === "error"
                  ? "text-danger"
                  : "text-success"
                : "sr-only",
            )}
          >
            {notice && !saving ? notice.text : null}
          </p>
        </div>
      </Panel>

      <TradeInDrawer
        request={drawer}
        opportunityId={opportunityId}
        current={current}
        viewerIsAdmin={view.viewerIsAdmin}
        onCancel={() => setDrawer(null)}
        onSubmit={save}
      />
      <TradeInDecisionDialog
        request={decision}
        onCancel={() => setDecision(null)}
        onConfirm={decide}
        onCloseAutoFocus={(event) => {
          // Confirmada, el botón que la abrió deja de existir mientras
          // guarda: el foco va al aviso, que además se anuncia.
          if (settled.current) {
            event.preventDefault();
            noticeRef.current?.focus();
          }
        }}
      />
    </section>
  );
}

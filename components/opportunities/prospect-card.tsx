import type { ReactNode } from "react";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/components/ui/cn";
import {
  ConversationsIcon,
  MapPinIcon,
  PercentIcon,
  PhoneIcon,
  SwapIcon,
  WalletIcon,
} from "@/components/ui/icons";
import { Tooltip } from "@/components/ui/tooltip";
import { stageLabel } from "@/domains/opportunities/labels";
import type { Opportunity } from "@/domains/opportunities/types";

function Flag({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip content={label}>
      <span className="flex size-8 items-center justify-center rounded-full border border-surface-1/40 text-text-inverse">
        {children}
        <span className="sr-only">{label}</span>
      </span>
    </Tooltip>
  );
}

/**
 * Tarjeta de identidad del prospecto seleccionado, en azul marino ejecutivo
 * (DEC-055): nombre, contacto, señales rápidas (usado, forma de pago), etapa
 * y responsable. Las señales salen de la demanda tipada (H1.4):
 * `trade_in_intent` y `purchase_type`, sin parsear textos. La etapa es un
 * pill de solo lectura: cambiarla desde acá no forma parte de DEC-055.
 * El avatar es una ilustración genérica asignada por contacto (DEC-058),
 * con las iniciales como respaldo: no es una foto de la persona.
 */
export function ProspectCard({
  opportunity,
  className,
}: {
  opportunity: Opportunity;
  className?: string;
}) {
  const { prospect, demand, owner } = opportunity;
  const tradeIn = demand?.facts.trade_in_intent.input.tradeIn === "yes";
  const payment = demand?.facts.purchase_type.input.purchaseType;
  return (
    <section
      aria-label="Prospecto seleccionado"
      className={cn(
        "shrink-0 overflow-hidden rounded-lg bg-linear-to-br from-navy to-navy-hover text-text-inverse shadow-card",
        className,
      )}
    >
      <div className="px-5 pt-5 pb-4">
        <div className="flex items-start gap-4">
          <Avatar
            initials={prospect.initials}
            src={prospect.avatar}
            size="2xl"
            tone="onNavy"
          />
          <h2 className="min-w-0 flex-1 pt-1.5 text-title leading-6 tracking-tight">
            {prospect.name}
          </h2>
          {prospect.live ? (
            <Tooltip content="Conversación de WhatsApp en vivo">
              <span className="mt-1.5 inline-flex shrink-0 items-center gap-1.5 rounded-full bg-navy-strong px-2 py-0.5 text-caption font-semibold">
                <span
                  aria-hidden="true"
                  className="size-1.5 rounded-full bg-success-border"
                />
                En vivo
              </span>
            </Tooltip>
          ) : null}
        </div>

        <div className="mt-4 flex items-end justify-between gap-3">
          <ul className="flex min-w-0 flex-col gap-2 text-label">
            {prospect.city ? (
              <li className="flex items-center gap-2">
                <MapPinIcon className="size-4 shrink-0 text-navy-muted" />
                <span className="truncate">{prospect.city}</span>
              </li>
            ) : null}
            {prospect.phone ? (
              <li className="flex items-center gap-2 tabular-nums">
                <PhoneIcon className="size-4 shrink-0 text-navy-muted" />
                {prospect.phone}
              </li>
            ) : null}
            <li className="flex items-center gap-2">
              <ConversationsIcon className="size-4 shrink-0 text-navy-muted" />
              <span className="truncate">
                {prospect.company
                  ? prospect.company.contact
                  : `Vía ${prospect.channel}`}
              </span>
            </li>
          </ul>
          <div className="flex shrink-0 gap-1.5">
            {tradeIn ? (
              <Flag label="Entrega un usado">
                <SwapIcon className="size-4" />
              </Flag>
            ) : null}
            {payment === "cash" ? (
              <Flag label="Pago contado">
                <WalletIcon className="size-4" />
              </Flag>
            ) : payment === "financed" ? (
              <Flag label="Pago financiado">
                <PercentIcon className="size-4" />
              </Flag>
            ) : null}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 px-5 pb-5">
        <span className="inline-flex items-center rounded-full border border-surface-1 px-4 py-1.5 text-label font-semibold">
          <span className="sr-only">Etapa: </span>
          {stageLabel(opportunity.stage)}
        </span>
        {owner ? (
          <span className="flex min-w-0 items-center gap-1.5 text-caption text-navy-muted">
            <Avatar initials={owner.initials} size="xs" tone="onNavy" />
            <span className="sr-only">Responsable:</span>
            <span className="truncate font-semibold">{owner.name}</span>
          </span>
        ) : null}
      </div>
    </section>
  );
}

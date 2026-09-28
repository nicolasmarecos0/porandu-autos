import type { ReactNode } from "react";
import { Avatar } from "@/components/ui/avatar";
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
      <span className="flex size-7 items-center justify-center rounded-full border border-surface-1/40 text-text-inverse">
        {children}
        <span className="sr-only">{label}</span>
      </span>
    </Tooltip>
  );
}

/**
 * Tarjeta de identidad del prospecto seleccionado: nombre, contacto, señales
 * rápidas (trade-in, forma de pago), estado y responsable.
 */
export function ProspectCard({ opportunity }: { opportunity: Opportunity }) {
  const { prospect, interest, tradeIn, owner } = opportunity;
  return (
    <section
      aria-label="Prospecto seleccionado"
      className="shrink-0 overflow-hidden rounded-lg bg-brand text-brand-contrast shadow-card"
    >
      <div className="px-4 pt-4 pb-3.5">
        <div className="flex items-start gap-3">
          <Avatar initials={prospect.initials} size="xl" tone="onBrand" />
          <h2 className="min-w-0 flex-1 pt-1 text-title leading-6 tracking-tight">
            {prospect.name}
          </h2>
          {prospect.live ? (
            <Tooltip content="Conversación de WhatsApp en vivo">
              <span className="mt-1.5 inline-flex shrink-0 items-center gap-1.5 rounded-full bg-brand-strong px-2 py-0.5 text-caption font-semibold">
                <span
                  aria-hidden="true"
                  className="size-1.5 rounded-full bg-success-border"
                />
                En vivo
              </span>
            </Tooltip>
          ) : null}
        </div>

        <div className="mt-3.5 flex items-end justify-between gap-3">
          <ul className="flex min-w-0 flex-col gap-1.5 text-label">
            <li className="flex items-center gap-2">
              <MapPinIcon className="size-4 shrink-0 text-brand-inverse" />
              <span className="truncate">{prospect.city}</span>
            </li>
            <li className="flex items-center gap-2 tabular-nums">
              <PhoneIcon className="size-4 shrink-0 text-brand-inverse" />
              {prospect.phone}
            </li>
            <li className="flex items-center gap-2">
              <ConversationsIcon className="size-4 shrink-0 text-brand-inverse" />
              <span className="truncate">
                {prospect.company
                  ? prospect.company.contact
                  : `Vía ${prospect.channel}`}
              </span>
            </li>
          </ul>
          <div className="flex shrink-0 gap-1.5">
            {tradeIn ? (
              <Flag label={`Entrega un usado: ${tradeIn.vehicle}`}>
                <SwapIcon className="size-4" />
              </Flag>
            ) : null}
            {interest.payment.startsWith("Contado") ? (
              <Flag label="Pago contado">
                <WalletIcon className="size-4" />
              </Flag>
            ) : (
              <Flag label={`Pago: ${interest.payment}`}>
                <PercentIcon className="size-4" />
              </Flag>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-surface-1/15 bg-brand-strong/35 px-4 py-2.5">
        <span className="inline-flex items-center rounded-full border border-surface-1/70 px-2.5 py-0.5 text-label font-semibold">
          {stageLabel(opportunity.stage)}
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-caption">
          <Avatar initials={owner.initials} size="xs" tone="onBrand" />
          <span className="sr-only">Responsable:</span>
          <span className="truncate font-semibold">{owner.name}</span>
        </span>
      </div>
    </section>
  );
}

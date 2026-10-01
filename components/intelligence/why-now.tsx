import type { ComponentType, ReactNode } from "react";
import { cn } from "@/components/ui/cn";
import {
  BoxIcon,
  CalendarIcon,
  ConversationsIcon,
  PercentIcon,
  StockIcon,
  SteeringIcon,
  SwapIcon,
  WalletIcon,
  type IconProps,
} from "@/components/ui/icons";
import type { Driver, DriverKind } from "@/domains/scoring/types";

/**
 * Corte visual temporal del mock de B1 entre "Señales fuertes" y "A validar".
 * No es una regla de negocio ni parte del scoring aprobado.
 */
const MOCK_STRONG_SIGNAL_CUTOFF = 75;

const DRIVER_KINDS: Record<
  DriverKind,
  { label: string; icon: ComponentType<IconProps> }
> = {
  timing: { label: "Plazo", icon: CalendarIcon },
  budget: { label: "Presupuesto", icon: WalletIcon },
  tradeIn: { label: "Trade-in", icon: SwapIcon },
  financing: { label: "Financiación", icon: PercentIcon },
  vehicle: { label: "Vehículo", icon: StockIcon },
  engagement: { label: "Interacción", icon: ConversationsIcon },
  testDrive: { label: "Test drive", icon: SteeringIcon },
  stock: { label: "Stock", icon: BoxIcon },
};

type WhyNowCardProps = {
  drivers: readonly Driver[];
  showSources: boolean;
  /** Última actividad ya formateada (p. ej. "hace 2 min · Preguntó…"). */
  footer: ReactNode;
};

/**
 * ¿Por qué ahora?: drivers agrupados en "Señales fuertes" y "A validar", cada
 * uno con su peso, fuente y momento.
 */
export function WhyNowCard({ drivers, showSources, footer }: WhyNowCardProps) {
  const sections = [
    {
      title: "Señales fuertes",
      text: "text-success",
      rule: "from-success",
      items: drivers.filter(
        (driver) => driver.strength >= MOCK_STRONG_SIGNAL_CUTOFF,
      ),
    },
    {
      title: "A validar",
      text: "text-warning",
      rule: "from-warning",
      items: drivers.filter(
        (driver) => driver.strength < MOCK_STRONG_SIGNAL_CUTOFF,
      ),
    },
  ].filter((section) => section.items.length > 0);

  return (
    <section className="shrink-0 rounded-lg bg-surface-1 px-5 pt-4 pb-4 shadow-card">
      {sections.map((section) => (
        <div key={section.title} className="[&+&]:mt-6">
          <div className="flex items-baseline justify-between">
            <h3 className={cn("text-body font-semibold", section.text)}>
              {section.title}
            </h3>
            <span className="text-caption text-text-muted tabular-nums">
              {section.items.length}
            </span>
          </div>
          <div
            aria-hidden="true"
            className={cn(
              "mt-1.5 h-0.5 bg-linear-to-r to-transparent",
              section.rule,
            )}
          />
          <ul className="mt-4 flex flex-col gap-4">
            {section.items.map((driver) => {
              const kind = DRIVER_KINDS[driver.kind];
              const Icon = kind.icon;
              return (
                <li key={driver.label} className="flex items-center gap-4">
                  <span className="relative flex size-18 shrink-0 flex-col items-center justify-center gap-1.5 rounded-md border border-border-default bg-surface-1 text-text-primary shadow-sm">
                    <Icon className="size-6" />
                    <span className="text-caption">{kind.label}</span>
                    <span className="absolute -top-1.5 -right-1.5 rounded-xs bg-text-muted px-1 text-[0.625rem] leading-4 font-semibold text-text-inverse tabular-nums">
                      <span className="sr-only">Peso </span>
                      {driver.strength}
                    </span>
                  </span>
                  <div className="min-w-0 text-label text-text-secondary">
                    <p>
                      <span className="font-semibold text-text-primary">
                        {driver.label}:
                      </span>{" "}
                      {driver.detail}
                    </p>
                    {showSources ? (
                      <p className="mt-1 text-caption text-text-muted">
                        {driver.source} · {driver.at}
                      </p>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {sections.length === 0 ? (
        <p className="text-label text-text-muted">
          Sin señales registradas todavía.
        </p>
      ) : null}
      <p className="mt-5 flex items-center gap-1.5 border-t border-border-subtle pt-3 text-caption text-text-muted">
        {footer}
      </p>
    </section>
  );
}

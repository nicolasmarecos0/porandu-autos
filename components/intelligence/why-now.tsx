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
 * uno con su peso, fuente y momento. Composición de la referencia (DEC-055):
 * título de color sobre una línea completa de 2 px y un tile cuadrado por
 * driver con su peso en la esquina.
 */
export function WhyNowCard({ drivers, showSources, footer }: WhyNowCardProps) {
  const sections = [
    {
      title: "Señales fuertes",
      text: "text-success",
      rule: "border-success-bright",
      items: drivers.filter(
        (driver) => driver.strength >= MOCK_STRONG_SIGNAL_CUTOFF,
      ),
    },
    {
      title: "A validar",
      text: "text-warning",
      rule: "border-warning-bright",
      items: drivers.filter(
        (driver) => driver.strength < MOCK_STRONG_SIGNAL_CUTOFF,
      ),
    },
  ].filter((section) => section.items.length > 0);

  return (
    <section className="shrink-0 rounded-lg border border-border-subtle bg-surface-1 px-6 pt-5 pb-4 shadow-card">
      {sections.map((section) => (
        <div key={section.title} className="[&+&]:mt-7">
          <div
            className={cn(
              "flex items-baseline justify-between border-b-2 pb-2",
              section.rule,
            )}
          >
            <h3 className={cn("text-heading font-medium", section.text)}>
              {section.title}
            </h3>
            <span className="text-caption text-text-muted tabular-nums">
              {section.items.length}
            </span>
          </div>
          <ul className="mt-5 flex flex-col gap-5">
            {section.items.map((driver) => {
              const kind = DRIVER_KINDS[driver.kind];
              const Icon = kind.icon;
              return (
                <li key={driver.label} className="flex items-center gap-5">
                  <span className="relative flex size-24 shrink-0 flex-col items-center justify-center gap-2 rounded-lg border border-border-default bg-surface-1 p-2 text-text-primary shadow-sm sm:size-28">
                    <Icon className="size-7" />
                    <span className="text-label font-semibold">
                      {kind.label}
                    </span>
                    <span className="absolute top-1.5 right-1.5 rounded-sm bg-text-muted px-1.5 py-0.5 text-caption font-bold text-text-inverse tabular-nums">
                      <span className="sr-only">Peso </span>
                      {driver.strength}
                    </span>
                  </span>
                  <div className="min-w-0 text-body text-text-secondary">
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

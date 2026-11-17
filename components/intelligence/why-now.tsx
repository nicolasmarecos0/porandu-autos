import type { ComponentType, ReactNode } from "react";
import { cn } from "@/components/ui/cn";
import {
  BoxIcon,
  CalendarIcon,
  ConversationsIcon,
  DocumentIcon,
  KeyIcon,
  PercentIcon,
  StockIcon,
  SteeringIcon,
  SwapIcon,
  WalletIcon,
  type IconProps,
} from "@/components/ui/icons";
import { STRONG_DRIVER_MIN_STRENGTH } from "@/domains/scoring/drivers";
import type { Driver, DriverKind } from "@/domains/scoring/types";

const DRIVER_KINDS: Record<
  DriverKind,
  { label: string; icon: ComponentType<IconProps> }
> = {
  timing: { label: "Plazo", icon: CalendarIcon },
  budget: { label: "Presupuesto", icon: WalletIcon },
  downPayment: { label: "Entrega", icon: WalletIcon },
  tradeIn: { label: "Trade-in", icon: KeyIcon },
  appraisal: { label: "Tasación", icon: SwapIcon },
  financing: { label: "Pago", icon: PercentIcon },
  vehicle: { label: "Vehículo", icon: StockIcon },
  engagement: { label: "Interacción", icon: ConversationsIcon },
  testDrive: { label: "Test drive", icon: SteeringIcon },
  quote: { label: "Cotización", icon: DocumentIcon },
  stock: { label: "Stock", icon: BoxIcon },
};

/**
 * El texto de una señal con sus cifras reales en negrita (`emphasis`, en el
 * orden en que aparecen). Un fragmento que no está en el texto se ignora.
 */
function emphasize(detail: string, emphasis: readonly string[] = []) {
  const parts: ReactNode[] = [];
  let rest = detail;
  let key = 0;
  for (;;) {
    let at = -1;
    let found = "";
    for (const fragment of emphasis) {
      if (fragment === "") continue;
      const index = rest.indexOf(fragment);
      if (index !== -1 && (at === -1 || index < at)) {
        at = index;
        found = fragment;
      }
    }
    if (at === -1) break;
    if (at > 0) parts.push(rest.slice(0, at));
    parts.push(
      <strong key={key++} className="font-semibold text-text-primary">
        {found}
      </strong>,
    );
    rest = rest.slice(at + found.length);
  }
  if (rest) parts.push(rest);
  return parts;
}

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
 * driver con su peso en la esquina. Desde DEC-058 los drivers los deriva
 * `deriveOpportunityDrivers()` de los datos reales, y el corte entre los dos
 * grupos es su regla (STRONG_DRIVER_MIN_STRENGTH).
 */
export function WhyNowCard({ drivers, showSources, footer }: WhyNowCardProps) {
  const sections = [
    {
      title: "Señales fuertes",
      text: "text-success",
      rule: "border-success-bright",
      items: drivers.filter(
        (driver) => driver.strength >= STRONG_DRIVER_MIN_STRENGTH,
      ),
    },
    {
      title: "A validar",
      text: "text-warning",
      rule: "border-warning-bright",
      items: drivers.filter(
        (driver) => driver.strength < STRONG_DRIVER_MIN_STRENGTH,
      ),
    },
  ].filter((section) => section.items.length > 0);

  return (
    <section className="shrink-0 rounded-lg border border-border-subtle bg-surface-1 px-4 pt-5 pb-4 shadow-card sm:px-6">
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
                <li
                  key={driver.label}
                  className="flex items-center gap-3 sm:gap-5"
                >
                  <span className="relative flex size-20 shrink-0 flex-col items-center justify-center gap-1.5 rounded-lg border border-border-default bg-surface-1 p-2 text-text-primary shadow-sm sm:size-24 sm:gap-2 xl:size-28">
                    <Icon className="size-6 sm:size-7" />
                    <span className="text-caption font-semibold sm:text-label">
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
                      {emphasize(driver.detail, driver.emphasis)}
                    </p>
                    {showSources ? (
                      <p className="mt-1 text-caption text-text-muted">
                        {driver.at
                          ? `${driver.source} · ${driver.at}`
                          : driver.source}
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

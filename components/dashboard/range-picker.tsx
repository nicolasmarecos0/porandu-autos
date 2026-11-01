import Link from "next/link";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { FormField, inputClassName } from "@/components/ui/form-field";
import type { DashboardRangeView } from "@/domains/dashboard/metrics";
import {
  DASHBOARD_RANGE_PRESETS,
  DEFAULT_RANGE,
  FROM_PARAM,
  MAX_RANGE_DAYS,
  RANGE_LABELS,
  RANGE_PARAM,
  TO_PARAM,
  type DashboardRangePreset,
} from "@/domains/dashboard/range";

/*
 * Selector del rango del Dashboard Directivo (DEC-043 §9). Server
 * Component: el rango viaja en la URL y cambiarlo es una navegación GET, sin
 * Server Actions ni estado de cliente.
 *
 * - Los presets son enlaces de navegación; el activo lleva
 *   `aria-current="page"`. `prefetch={false}` (DEC-043 §6): pasar el mouse
 *   por un preset no dispara las lecturas agregadas de la base.
 * - "Personalizado" abre un drawer (Radix Dialog, components/ui/drawer.tsx,
 *   lo único de cliente) con un formulario GET de dos fechas. El navegador
 *   ya acota los días con `min`/`max`; la URL igual es input no confiable y
 *   el dominio resuelve cualquier valor (resolveDashboardRange()).
 *
 * En teléfono la tira de presets no desborda la página: scrollea sola.
 */

export const INTELLIGENCE_PATH = "/intelligence";

/** Primer día que acepta el rango (parseIsoDate() acota a 2000–2100). */
const FIRST_DAY = "2000-01-01";

/** Enlace canónico de un preset: el default no lleva parámetros. */
export function presetHref(preset: DashboardRangePreset): string {
  if (preset === DEFAULT_RANGE) return INTELLIGENCE_PATH;
  return `${INTELLIGENCE_PATH}?${new URLSearchParams({ [RANGE_PARAM]: preset })}`;
}

const segmentClassName =
  "inline-flex h-7 items-center rounded-md px-2.5 text-label font-semibold whitespace-nowrap transition-[background-color,color,box-shadow] duration-150 ease-out-strong focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring";

const segmentStateClassName = (active: boolean) =>
  active
    ? "bg-surface-1 text-brand-strong shadow-sm"
    : "text-text-secondary hover:bg-surface-2 hover:text-text-primary";

type RangePickerProps = {
  range: DashboardRangeView;
  /** `YYYY-MM-DD` de hoy en Asunción: el último día elegible. */
  today: string;
};

export function RangePicker({ range, today }: RangePickerProps) {
  return (
    <nav aria-label="Rango de fechas" className="max-w-full min-w-0">
      <ul className="flex max-w-full items-center gap-0.5 overflow-x-auto rounded-lg border border-border-subtle bg-surface-3 p-0.5">
        {DASHBOARD_RANGE_PRESETS.map((preset) => {
          const active = range.kind === preset;
          return (
            <li key={preset} className="shrink-0">
              <Link
                href={presetHref(preset)}
                prefetch={false}
                scroll={false}
                aria-current={active ? "page" : undefined}
                className={cn(segmentClassName, segmentStateClassName(active))}
              >
                {RANGE_LABELS[preset]}
              </Link>
            </li>
          );
        })}
        <li className="shrink-0">
          <Drawer>
            <DrawerTrigger asChild>
              <button
                type="button"
                aria-current={range.kind === "custom" ? "true" : undefined}
                className={cn(
                  segmentClassName,
                  segmentStateClassName(range.kind === "custom"),
                )}
              >
                {RANGE_LABELS.custom}
              </button>
            </DrawerTrigger>
            <DrawerContent
              title="Rango personalizado"
              description={`Elegí el primer y el último día, los dos incluidos. Hasta ${MAX_RANGE_DAYS} días.`}
            >
              <CustomRangeForm range={range} today={today} />
            </DrawerContent>
          </Drawer>
        </li>
      </ul>
    </nav>
  );
}

/**
 * Formulario GET del rango personalizado: `?range=custom&from=…&to=…`.
 * Arranca con los días del rango actual (el último, recortado a hoy).
 */
export function CustomRangeForm({ range, today }: RangePickerProps) {
  const lastDay = range.to > today ? today : range.to;
  return (
    <form
      method="get"
      action={INTELLIGENCE_PATH}
      className="flex min-h-0 flex-1 flex-col"
    >
      <input type="hidden" name={RANGE_PARAM} value="custom" />
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-4">
        <FormField
          label="Desde"
          htmlFor="dashboard-range-from"
          errorId="dashboard-range-from-error"
        >
          <input
            id="dashboard-range-from"
            name={FROM_PARAM}
            type="date"
            required
            min={FIRST_DAY}
            max={today}
            defaultValue={range.from}
            className={inputClassName}
          />
        </FormField>
        <FormField
          label="Hasta"
          htmlFor="dashboard-range-to"
          hint="Incluido. Un día posterior a hoy se recorta a hoy."
          hintId="dashboard-range-to-hint"
          errorId="dashboard-range-to-error"
        >
          <input
            id="dashboard-range-to"
            name={TO_PARAM}
            type="date"
            required
            min={FIRST_DAY}
            max={today}
            defaultValue={lastDay}
            aria-describedby="dashboard-range-to-hint"
            className={inputClassName}
          />
        </FormField>
      </div>
      <footer className="flex shrink-0 justify-end gap-2 border-t border-border-subtle bg-surface-2 px-5 py-3">
        <DrawerClose asChild>
          <Button variant="secondary">Cancelar</Button>
        </DrawerClose>
        <Button type="submit" variant="primary">
          Aplicar rango
        </Button>
      </footer>
    </form>
  );
}

import type { ReactNode } from "react";
import { cn } from "@/components/ui/cn";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "./page-header";
import { WorkspaceLayout } from "./workspace-layout";
import {
  ContextRailSkeleton,
  FeedPanelSkeleton,
  SummaryBandSkeleton,
} from "./workspace-skeletons";

/*
 * Estados de carga de las rutas del panel (`loading.tsx`, DEC-058).
 *
 * Sin Cache Components, Next no prefetchea una ruta dinámica que no tenga
 * `loading.js`: al tocar el rail, la navegación esperaba el render completo
 * del servidor sin cambiar nada en pantalla. Con un boundary por ruta, el
 * prefetch trae este skeleton y la navegación lo pinta al instante, mientras
 * el loader tenant-scoped (requireTenant() → withTenant()) responde.
 *
 * Cada skeleton repite la composición de su vista (regiones, columnas y
 * breakpoints) para que el contenido real entre sin saltos. Solo muestra lo
 * que se sabe sin datos: el nombre de la sección. Ningún número, nombre ni
 * estado comercial: la cantidad de filas y tiles no es una decisión de
 * producto.
 *
 * Accesibilidad: un único anuncio `status` ("Cargando …") y `aria-busy` en
 * la región; los bloques son decorativos (`Skeleton` es `aria-hidden`).
 */

const range = (count: number) => Array.from({ length: count }, (_, i) => i);

/** Región de carga de una ruta, con su anuncio para lectores de pantalla. */
export function RouteLoading({
  label,
  className,
  children,
}: {
  /** Nombre visible de la sección (copy es-PY de la navegación). */
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div aria-busy="true" className={cn("flex min-h-0 flex-1", className)}>
      <p role="status" className="sr-only">
        Cargando {label}…
      </p>
      {children}
    </div>
  );
}

/** Acciones del encabezado todavía sin datos (p. ej. un botón y un filtro). */
function HeaderActionsSkeleton({ count = 1 }: { count?: number }) {
  return (
    <>
      {range(count).map((i) => (
        <Skeleton
          key={i}
          tone={i === count - 1 ? "brand" : "strong"}
          radius="md"
          className="h-8 w-28 max-sm:w-20"
        />
      ))}
    </>
  );
}

/** Selector de vistas (Cola · Tabla · Embudo, Feed · Métricas…). */
function ViewSwitchSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex h-9 items-center gap-1 rounded-md border border-border-subtle bg-surface-1 p-1",
        className,
      )}
    >
      <Skeleton tone="brand" radius="sm" className="h-full flex-1" />
      <Skeleton radius="sm" className="h-3 flex-1" />
      <Skeleton radius="sm" className="h-3 flex-1" />
    </div>
  );
}

/* ── Cockpit ─────────────────────────────────────────────────────────── */

/** Encabezado del Cockpit: título, selector Feed · Métricas y un dato. */
function CockpitHeaderSkeleton({ title }: { title: string }) {
  return (
    <header className="shrink-0 border-b border-border-subtle bg-surface-1 px-gutter py-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="text-title text-text-primary">{title}</h1>
          <ViewSwitchSkeleton className="w-44" />
        </div>
        <Skeleton className="h-3 w-32" />
      </div>
    </header>
  );
}

/** /cockpit: franja del día y feed de actividad (DEC-047). */
export function CockpitFeedSkeleton({ title }: { title: string }) {
  return (
    <RouteLoading label={title} className="flex-col">
      <WorkspaceLayout header={<CockpitHeaderSkeleton title={title} />}>
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-section">
          <SummaryBandSkeleton tiles={4} />
          <FeedPanelSkeleton rows={5} />
        </div>
      </WorkspaceLayout>
    </RouteLoading>
  );
}

/** Tile de KPI sobre superficie blanca. */
function KpiPanelSkeleton() {
  return (
    <Panel className="flex flex-col gap-3 p-4">
      <Skeleton className="h-2.5 w-24" />
      <Skeleton tone="strong" className="h-7 w-20" />
      <Skeleton className="h-2.5 w-32" />
    </Panel>
  );
}

/** Anchos decrecientes de las barras: sugieren un ranking, no son datos. */
const BAR_WIDTHS = ["w-4/5", "w-3/5", "w-1/2", "w-2/5", "w-1/4"] as const;

/** Panel con un gráfico de barras horizontales todavía sin datos. */
function ChartPanelSkeleton({ bars = 5 }: { bars?: number }) {
  return (
    <Panel>
      <PanelHeader>
        <Skeleton tone="strong" className="h-3.5 w-40" />
      </PanelHeader>
      <div className="flex flex-col gap-3 p-4">
        {range(bars).map((i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="h-2.5 w-24" />
            <Skeleton
              tone="strong"
              className={cn("h-3", BAR_WIDTHS[i % BAR_WIDTHS.length])}
            />
          </div>
        ))}
      </div>
    </Panel>
  );
}

/**
 * Vistas de métricas: /cockpit/metrics (DEC-050) e /intelligence
 * (DEC-037, DEC-043). Encabezado con período, KPIs y paneles.
 */
export function MetricsSkeleton({
  title,
  withViewSwitch = false,
}: {
  title: string;
  /** /cockpit/metrics comparte el selector Feed · Métricas del Cockpit. */
  withViewSwitch?: boolean;
}) {
  return (
    <RouteLoading label={title} className="flex-col">
      <WorkspaceLayout
        header={
          <header className="shrink-0 border-b border-border-subtle bg-surface-1 px-gutter py-3">
            <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
              <div className="flex min-w-0 flex-col gap-2">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <h1 className="text-title text-text-primary">{title}</h1>
                  {withViewSwitch ? (
                    <ViewSwitchSkeleton className="w-44" />
                  ) : null}
                </div>
                <Skeleton className="h-3 w-48" />
              </div>
              <ViewSwitchSkeleton className="w-60 max-sm:w-full" />
            </div>
          </header>
        }
      >
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-section">
          <div className="grid grid-cols-2 gap-section lg:grid-cols-4">
            {range(4).map((i) => (
              <KpiPanelSkeleton key={i} />
            ))}
          </div>
          <div className="grid gap-section lg:grid-cols-2">
            <ChartPanelSkeleton />
            <ChartPanelSkeleton bars={4} />
          </div>
        </div>
      </WorkspaceLayout>
    </RouteLoading>
  );
}

/* ── Oportunidades ───────────────────────────────────────────────────── */

/** Fila de la cola: avatar, nombre, vehículo y Porandú. */
function QueueRowSkeleton() {
  return (
    <div className="flex items-center gap-3 border-b border-border-subtle px-3 py-3 last:border-b-0">
      <Skeleton tone="strong" radius="full" className="size-9" />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <Skeleton tone="strong" className="h-3 w-3/5" />
        <Skeleton className="h-2.5 w-4/5" />
      </div>
      <Skeleton tone="brand" radius="full" className="size-8" />
    </div>
  );
}

/** Tarjeta del prospecto, en el azul marino de DEC-055. */
function ProspectCardSkeleton() {
  return (
    <div className="flex shrink-0 items-center gap-3 rounded-lg bg-navy p-4 shadow-card max-md:hidden">
      <Skeleton tone="inverse" radius="full" className="size-16" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <Skeleton tone="inverse" className="h-3.5 w-3/4" />
        <Skeleton tone="inverse" className="h-2.5 w-1/2" />
        <Skeleton tone="inverse" radius="full" className="h-5 w-24" />
      </div>
    </div>
  );
}

/** Franja de los cuatro scores, en carbón, con el Porandú elevado. */
function ScoreStripSkeleton() {
  return (
    <div className="grid shrink-0 grid-cols-4 overflow-hidden rounded-lg bg-surface-inverse shadow-card max-md:hidden">
      {range(4).map((i) => (
        <div
          key={i}
          className={cn(
            "flex min-h-24 flex-col items-center justify-center gap-2.5 px-3 py-4",
            i === 0
              ? "bg-surface-inverse-raised"
              : "border-l border-border-inverse",
          )}
        >
          <Skeleton tone="inverse" className="h-2.5 w-16" />
          <Skeleton
            tone="inverse"
            radius="full"
            className={i === 0 ? "size-12" : "h-7 w-10"}
          />
        </div>
      ))}
    </div>
  );
}

/** Tarjeta de texto genérica: título y líneas. */
function TextPanelSkeleton({
  lines = 3,
  className,
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <Panel className={cn("flex shrink-0 flex-col gap-3 p-4", className)}>
      <Skeleton tone="strong" className="h-3.5 w-40" />
      {range(lines).map((i) => (
        <Skeleton
          key={i}
          className={cn("h-2.5", i === lines - 1 ? "w-3/5" : "w-full")}
        />
      ))}
    </Panel>
  );
}

/**
 * /opportunities: cola a la izquierda, decisión al centro y "¿Qué
 * ofrecerle?" a la derecha (DEC-015, DEC-055 §3). En el teléfono, solo la
 * cola, como el maestro/detalle.
 */
export function OpportunityQueueSkeleton({ title }: { title: string }) {
  return (
    <RouteLoading label={title} className="gap-3 p-3">
      <h1 className="sr-only">{title}</h1>
      <div className="flex min-h-0 w-full flex-col gap-3 md:w-64 md:shrink-0 lg:w-72 xl:w-75">
        <ViewSwitchSkeleton />
        <Skeleton tone="brand" radius="md" className="h-9 w-full" />
        <ProspectCardSkeleton />
        <Panel className="flex min-h-0 flex-1 flex-col">
          <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border-subtle px-3">
            {range(3).map((i) => (
              <Skeleton
                key={i}
                tone={i === 0 ? "brand" : "default"}
                radius="full"
                className="h-5 w-16"
              />
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            {range(7).map((i) => (
              <QueueRowSkeleton key={i} />
            ))}
          </div>
        </Panel>
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-hidden max-md:hidden xl:flex-row">
        <div className="flex min-w-0 flex-col gap-3 pt-2 xl:flex-1">
          <ScoreStripSkeleton />
          <Panel highlighted className="flex shrink-0 flex-col gap-3 p-4">
            <Skeleton tone="strong" className="h-3.5 w-32" />
            <Skeleton className="h-2.5 w-4/5" />
            <Skeleton tone="brand" radius="md" className="h-9 w-40" />
          </Panel>
          <Skeleton tone="strong" className="mt-2 h-4 w-36" />
          <div className="grid gap-3 sm:grid-cols-2">
            <TextPanelSkeleton />
            <TextPanelSkeleton />
          </div>
        </div>
        <div className="flex shrink-0 flex-col gap-3 xl:w-98">
          <ContextRailSkeleton />
        </div>
      </div>
    </RouteLoading>
  );
}

/** /opportunities/table (DEC-055 §4): barra de vistas y filtros, y filas. */
export function OpportunityTableSkeleton({ title }: { title: string }) {
  // Clases literales: Tailwind no detecta las que se arman en runtime.
  const columns =
    "grid-cols-[minmax(0,2fr)_minmax(0,1.6fr)_repeat(5,minmax(0,1fr))]";
  const rowColumns =
    "md:grid-cols-[minmax(0,2fr)_minmax(0,1.6fr)_repeat(5,minmax(0,1fr))]";
  return (
    <RouteLoading label={title} className="flex-col gap-3 p-3">
      <h1 className="sr-only">{title}</h1>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border-subtle bg-surface-1 shadow-card">
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3 border-b border-border-subtle px-4 pt-3 pb-2.5">
          <ViewSwitchSkeleton className="w-full sm:w-72" />
          <div className="flex gap-4">
            {range(3).map((i) => (
              <Skeleton key={i} className="h-3 w-16" />
            ))}
          </div>
          <Skeleton radius="md" className="ml-auto h-9 w-56 max-sm:w-full" />
          <Skeleton
            tone="brand"
            radius="md"
            className="h-9 w-40 max-sm:hidden"
          />
        </div>
        <div
          className={cn(
            "grid h-10 shrink-0 items-center gap-4 bg-surface-inverse px-4 max-md:hidden",
            columns,
          )}
        >
          {range(7).map((i) => (
            <Skeleton key={i} tone="inverse" className="h-2.5 w-3/4" />
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          {range(10).map((i) => (
            <div
              key={i}
              className={cn(
                "flex items-center gap-3 border-b border-border-subtle px-4 py-3 md:grid md:gap-4",
                rowColumns,
              )}
            >
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <Skeleton tone="strong" radius="full" className="size-8" />
                <Skeleton tone="strong" className="h-3 w-3/5" />
              </div>
              <Skeleton className="h-2.5 w-4/5 max-md:hidden" />
              <Skeleton radius="full" className="h-5 w-20 max-md:hidden" />
              <Skeleton className="h-2.5 w-16 max-md:hidden" />
              <Skeleton className="h-2.5 w-14 max-md:hidden" />
              <Skeleton className="h-2.5 w-12 max-md:hidden" />
              <Skeleton tone="brand" radius="full" className="size-7" />
            </div>
          ))}
        </div>
      </div>
    </RouteLoading>
  );
}

/** /opportunities/pipeline (DEC-048): columnas por etapa con tarjetas. */
export function PipelineSkeleton({ title }: { title: string }) {
  const cardsPerColumn = [3, 2, 2, 1, 1];
  return (
    <RouteLoading label={title} className="flex-col">
      <PageHeader
        title={title}
        actions={<ViewSwitchSkeleton className="w-60 max-sm:hidden" />}
      />
      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-3">
        {cardsPerColumn.map((cards, column) => (
          <div
            key={column}
            className="flex w-72 shrink-0 flex-col gap-2.5 rounded-lg border border-border-subtle bg-surface-2 p-2.5"
          >
            <div className="flex items-center gap-2 px-1 py-1">
              <Skeleton tone="strong" className="h-3 w-24" />
              <Skeleton radius="full" className="ml-auto h-5 w-7" />
            </div>
            {range(cards).map((card) => (
              <Panel key={card} className="flex flex-col gap-2.5 p-3">
                <div className="flex items-center gap-2.5">
                  <Skeleton tone="strong" radius="full" className="size-8" />
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <Skeleton tone="strong" className="h-3 w-3/4" />
                    <Skeleton className="h-2.5 w-1/2" />
                  </div>
                </div>
                <Skeleton className="h-2.5 w-4/5" />
              </Panel>
            ))}
          </div>
        ))}
      </div>
    </RouteLoading>
  );
}

/**
 * /opportunities/[id] y la cotización: encabezado con la etapa, columna de
 * trabajo y rail de la unidad.
 */
export function OpportunityDetailSkeleton({ label }: { label: string }) {
  return (
    <RouteLoading label={label} className="flex-col">
      <WorkspaceLayout
        header={
          <header className="flex h-page-header shrink-0 items-center gap-3 border-b border-border-subtle bg-surface-1 px-gutter">
            <Skeleton tone="strong" className="h-4 w-48" />
            <Skeleton radius="full" className="h-5 w-24" />
            <Skeleton radius="md" className="ml-auto h-8 w-24" />
          </header>
        }
        aside={<ContextRailSkeleton />}
      >
        <TextPanelSkeleton lines={2} />
        <TextPanelSkeleton lines={4} />
        <TextPanelSkeleton lines={3} />
      </WorkspaceLayout>
    </RouteLoading>
  );
}

/* ── Stock ───────────────────────────────────────────────────────────── */

/** Tarjeta de unidad: media, modelo y precio. */
function VehicleCardSkeleton() {
  return (
    <Panel className="flex flex-col">
      {/* El Panel recorta las esquinas: el bloque de media va al ras. */}
      <Skeleton className="aspect-[16/10] w-full" />
      <div className="flex flex-col gap-2 p-3">
        <Skeleton tone="strong" className="h-3 w-3/4" />
        <Skeleton className="h-2.5 w-1/2" />
        <Skeleton tone="strong" className="h-3.5 w-24" />
      </div>
    </Panel>
  );
}

/** Encabezado de Stock: título, conteos y la acción principal. */
function StockHeaderSkeleton({ title }: { title: string }) {
  return (
    <header className="shrink-0 border-b border-border-subtle bg-surface-1 px-gutter py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="text-title text-text-primary">{title}</h1>
        <ViewSwitchSkeleton className="w-44" />
        <div className="ml-auto">
          <HeaderActionsSkeleton />
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {range(4).map((i) => (
          <Skeleton key={i} radius="full" className="h-6 w-24" />
        ))}
      </div>
    </header>
  );
}

/** /stock (DEC-026): unidades agrupadas por estado y panel de la unidad. */
export function StockSkeleton({ title }: { title: string }) {
  return (
    <RouteLoading label={title} className="flex-col">
      <StockHeaderSkeleton title={title} />
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 p-3 md:grid-cols-[minmax(0,1fr)_17rem] lg:grid-cols-[minmax(0,1fr)_23rem]">
        <div className="flex min-h-0 flex-col gap-3 overflow-hidden px-1 pt-1">
          <Skeleton tone="strong" className="h-3.5 w-32" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {range(6).map((i) => (
              <VehicleCardSkeleton key={i} />
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-3 max-md:hidden">
          <ContextRailSkeleton />
        </div>
      </div>
    </RouteLoading>
  );
}

/** /stock/catalog (DEC-049): filtros y galería. */
export function CatalogSkeleton({ title }: { title: string }) {
  return (
    <RouteLoading label={title} className="flex-col">
      <StockHeaderSkeleton title={title} />
      <div className="min-h-0 flex-1 overflow-hidden p-gutter">
        <div className="mb-4 flex flex-wrap gap-2">
          {range(5).map((i) => (
            <Skeleton key={i} radius="full" className="h-8 w-24" />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {range(8).map((i) => (
            <VehicleCardSkeleton key={i} />
          ))}
        </div>
      </div>
    </RouteLoading>
  );
}

/* ── Conversaciones ──────────────────────────────────────────────────── */

/** /conversations (DEC-040, DEC-044): lista de chats e hilo. */
export function InboxSkeleton({ title }: { title: string }) {
  return (
    <RouteLoading label={title} className="flex-col">
      <PageHeader title={title} />
      <div className="flex min-h-0 flex-1 gap-section overflow-hidden p-2 sm:p-gutter">
        <Panel className="flex w-full flex-col lg:w-context-rail lg:shrink-0">
          <div className="flex h-11 shrink-0 items-center border-b border-border-subtle px-3">
            <Skeleton radius="md" className="h-7 w-full" />
          </div>
          {range(8).map((i) => (
            <QueueRowSkeleton key={i} />
          ))}
        </Panel>
        <Panel className="hidden min-w-0 flex-1 flex-col lg:flex">
          <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border-subtle px-4">
            <Skeleton tone="strong" radius="full" className="size-9" />
            <Skeleton tone="strong" className="h-3.5 w-40" />
          </div>
          <div className="flex min-h-0 flex-1 flex-col justify-end gap-3 bg-surface-2 p-4">
            {range(5).map((i) => (
              <Skeleton
                key={i}
                tone={i % 2 === 0 ? "strong" : "brand"}
                radius="md"
                className={cn(
                  "h-10",
                  i % 2 === 0 ? "w-2/5 self-start" : "w-1/3 self-end",
                )}
              />
            ))}
          </div>
          <div className="flex h-16 shrink-0 items-center gap-3 border-t border-border-subtle px-4">
            <Skeleton radius="md" className="h-10 flex-1" />
            <Skeleton tone="brand" radius="md" className="h-10 w-24" />
          </div>
        </Panel>
      </div>
    </RouteLoading>
  );
}

/* ── Calendario ──────────────────────────────────────────────────────── */

/** Desplazamientos de la primera franja de cada día (no son horarios). */
const SLOT_OFFSETS = [
  "lg:h-4",
  "lg:h-24",
  "lg:h-10",
  "lg:h-32",
  "lg:h-0",
  "lg:h-16",
  "lg:h-40",
] as const;

/** /calendar (DEC-045): encabezado de la semana y grilla de siete días. */
export function CalendarSkeleton({ title }: { title: string }) {
  return (
    <RouteLoading label={title} className="flex-col">
      <header className="shrink-0 border-b border-border-subtle bg-surface-1 px-gutter pt-3 pb-3.5">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <h1 className="text-title text-text-primary">{title}</h1>
          <HeaderActionsSkeleton />
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-8 gap-y-3">
          <Skeleton radius="md" className="h-8 w-64" />
          <div className="flex gap-2 max-sm:hidden">
            {range(3).map((i) => (
              <Skeleton key={i} radius="full" className="h-6 w-24" />
            ))}
          </div>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-hidden p-gutter">
        <Panel className="grid grid-cols-1 lg:grid-cols-7">
          {range(7).map((day) => (
            <div
              key={day}
              className={cn(
                "flex min-h-24 flex-col gap-2.5 border-border-subtle p-3 lg:min-h-96",
                day > 0 && "border-t lg:border-t-0 lg:border-l",
                day > 2 && "max-lg:hidden",
              )}
            >
              <Skeleton tone="strong" className="h-3 w-16" />
              {/* Franjas a distintas horas: sugieren la grilla horaria. */}
              <span
                aria-hidden="true"
                className={cn("block", SLOT_OFFSETS[day % SLOT_OFFSETS.length])}
              />
              {range(day % 3 === 0 ? 2 : 1).map((slot) => (
                <Skeleton
                  key={slot}
                  tone="brand"
                  radius="md"
                  className="h-14 w-full"
                />
              ))}
            </div>
          ))}
        </Panel>
      </div>
    </RouteLoading>
  );
}

/* ── Configuración ───────────────────────────────────────────────────── */

/**
 * Contenido de /settings y /settings/team. El encabezado y las pestañas los
 * pinta el layout de Configuración, que no carga datos.
 */
export function SettingsSkeleton({ label }: { label: string }) {
  return (
    <RouteLoading label={label} className="flex-col gap-section">
      {range(2).map((panel) => (
        <Panel key={panel}>
          <PanelHeader>
            <Skeleton tone="strong" className="h-3.5 w-40" />
          </PanelHeader>
          <div className="flex flex-col gap-4 p-4">
            {range(panel === 0 ? 3 : 4).map((i) => (
              <div key={i} className="flex items-center gap-4">
                <Skeleton className="h-2.5 w-28 shrink-0" />
                <Skeleton tone="strong" className="h-3 w-1/2" />
              </div>
            ))}
          </div>
        </Panel>
      ))}
    </RouteLoading>
  );
}

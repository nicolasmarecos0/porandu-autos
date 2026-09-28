import { Fragment } from "react";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/skeleton";
import { SummaryBand, SummaryTile } from "@/components/ui/summary-band";

/*
 * Skeletons de estructura para las rutas del vertical slice de B1.
 * Muestran la composición de cada región sin datos, rótulos ni contenido
 * comercial. Se reemplazan por los componentes reales de cada módulo; la
 * cantidad de tiles, filas y columnas no es una decisión de producto.
 */

const range = (count: number) => Array.from({ length: count }, (_, i) => i);

export function SummaryBandSkeleton({ tiles = 4 }: { tiles?: number }) {
  return (
    <SummaryBand>
      {range(tiles).map((i) => (
        <SummaryTile key={i} highlighted={i === 0}>
          <Skeleton tone="inverse" className="h-2.5 w-16" />
          <Skeleton tone="inverse" className="h-7 w-10" />
        </SummaryTile>
      ))}
    </SummaryBand>
  );
}

/* Columna central: lista accionable (tarjetas con motivo y CTA). */

function FeedRowSkeleton() {
  return (
    <div className="flex items-center gap-4 border-b border-border-subtle px-4 py-3 last:border-b-0">
      <div className="flex size-14 shrink-0 items-center justify-center rounded-md border border-border-default bg-surface-2">
        <Skeleton tone="strong" className="size-6" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <Skeleton tone="strong" className="h-3 w-2/5" />
        <Skeleton className="h-2.5 w-4/5" />
        <Skeleton className="h-2.5 w-3/5" />
      </div>
      <Skeleton tone="brand" radius="full" className="h-5 w-12" />
      <Skeleton tone="strong" radius="md" className="h-8 w-24" />
    </div>
  );
}

export function FeedPanelSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <Panel>
      <PanelHeader>
        <Skeleton tone="strong" className="h-3.5 w-36" />
        <Skeleton className="ml-auto h-3 w-24" />
      </PanelHeader>
      {range(rows).map((i) => (
        <FeedRowSkeleton key={i} />
      ))}
    </Panel>
  );
}

/* Rail contextual: tarjetas de datos clave-valor, una destacada. */

type ContextCardSkeletonProps = {
  highlighted?: boolean;
  rows?: number;
  media?: boolean;
};

function ContextCardSkeleton({
  highlighted = false,
  rows = 4,
  media = true,
}: ContextCardSkeletonProps) {
  return (
    <Panel highlighted={highlighted} className="shrink-0 p-4">
      <div className="flex items-center gap-2">
        <Skeleton tone="strong" className="h-3 w-24" />
        <Skeleton tone="brand" className="h-4 w-10" />
      </div>
      <div className="mt-3 flex flex-col gap-1.5">
        <Skeleton tone="strong" className="h-3.5 w-3/5" />
        <Skeleton className="h-3 w-4/5" />
      </div>
      <div className="mt-4 flex items-end gap-3">
        <div className="grid flex-1 grid-cols-[4.5rem_1fr] gap-x-3 gap-y-2.5">
          {range(rows).map((i) => (
            <Fragment key={i}>
              <Skeleton className="h-2.5 w-14" />
              <Skeleton tone="strong" className="h-2.5 w-12" />
            </Fragment>
          ))}
        </div>
        {media ? <Skeleton radius="md" className="h-16 w-28" /> : null}
      </div>
    </Panel>
  );
}

export function ContextRailSkeleton() {
  return (
    <>
      <ContextCardSkeleton />
      <ContextCardSkeleton highlighted />
      <ContextCardSkeleton rows={3} media={false} />
    </>
  );
}

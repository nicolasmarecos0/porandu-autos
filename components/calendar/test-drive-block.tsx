"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { ChevronRightIcon, OverlapIcon } from "@/components/ui/icons";
import type { AgendaItem } from "@/domains/calendar/agenda";
import { TEST_DRIVE_STATUS_LABELS } from "@/domains/calendar/test-drives";

import { TestDriveCard } from "./test-drive-card";
import {
  TEST_DRIVE_BLOCK,
  TEST_DRIVE_EDGE,
  TEST_DRIVE_TEXT,
  TestDriveStatusGlyph,
} from "./test-drive-status";

/*
 * Bloque de una prueba de manejo en la grilla horaria (DEC-045 §3). Ocupa el
 * lugar que le da la grilla (lo posiciona su `li`) y muestra hora, estado,
 * cliente y unidad, recortados si el carril es angosto: la forma del estado
 * se ve siempre. Es un botón: abre un drawer (Radix Dialog) con la tarjeta
 * completa de DEC-041 §4, que tiene el enlace a la oportunidad, el aviso de
 * superposición, quién la agendó y el menú de estados con su confirmación.
 *
 * Tras un cambio de estado la página se revalida: el bloque y la tarjeta
 * del drawer, que sigue abierto, muestran el estado nuevo.
 */

const opportunityLinkClassName =
  "inline-flex h-8 shrink-0 items-center justify-center gap-1 rounded-md bg-brand px-3 text-label font-semibold text-brand-contrast shadow-sm transition-[transform,background-color] duration-150 ease-out-strong hover:bg-brand-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring active:scale-[0.97] motion-reduce:active:scale-100";

/** "lunes 2 de noviembre, 10:30" → "Lunes 2 de noviembre, 10:30". */
function sentenceCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function TestDriveBlock({ item }: { item: AgendaItem }) {
  const cancelled = item.status === "cancelled";
  return (
    <Drawer>
      <DrawerTrigger asChild>
        <button
          type="button"
          className={cn(
            "relative flex size-full overflow-hidden rounded-md border text-left shadow-sm transition-[transform,box-shadow] duration-150 ease-out-strong hover:z-10 hover:shadow-md focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring active:scale-[0.98] data-[state=open]:z-10 data-[state=open]:shadow-md motion-reduce:transition-none motion-reduce:active:scale-100",
            TEST_DRIVE_BLOCK[item.status],
            // Superpuesta: el contorno se ve aunque el carril sea angosto.
            item.overlaps && "ring-1 ring-warning",
          )}
        >
          <span
            aria-hidden="true"
            className={cn("w-1 shrink-0", TEST_DRIVE_EDGE[item.status])}
          />
          <span className="flex min-w-0 flex-1 flex-col px-1.5 py-1">
            <span
              className={cn(
                "flex min-w-0 items-center gap-1 text-caption font-semibold",
                TEST_DRIVE_TEXT[item.status],
              )}
            >
              <TestDriveStatusGlyph status={item.status} />
              <time
                dateTime={item.scheduledAtIso}
                className={cn(
                  "shrink-0 tabular-nums",
                  cancelled && "line-through decoration-1",
                )}
              >
                {item.timeLabel}
              </time>
              {item.overlaps ? (
                <OverlapIcon className="size-3 shrink-0 text-warning" />
              ) : null}
              <span className="truncate font-medium">
                <span aria-hidden="true">· </span>
                {TEST_DRIVE_STATUS_LABELS[item.status]}
              </span>
            </span>
            <span
              className={cn(
                "truncate text-label font-semibold",
                cancelled
                  ? "text-text-muted line-through decoration-1"
                  : "text-text-primary",
              )}
            >
              {item.contactName}
            </span>
            <span className="truncate [font-feature-settings:'calt'_0] text-caption text-text-secondary">
              {item.vehicleLabel}
            </span>
            {item.overlaps ? (
              <span className="sr-only">. Unidad superpuesta</span>
            ) : null}
          </span>
        </button>
      </DrawerTrigger>
      <DrawerContent
        title="Prueba de manejo"
        description={sentenceCase(item.whenLabel)}
      >
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-4">
          <TestDriveCard item={item} />
          <p className="text-caption text-text-muted">
            Cambiar el estado no le envía ningún mensaje al cliente.
          </p>
        </div>
        <footer className="flex shrink-0 justify-end gap-2 border-t border-border-subtle bg-surface-2 px-5 py-3">
          <DrawerClose asChild>
            <Button variant="secondary">Cerrar</Button>
          </DrawerClose>
          <Link
            href={`/opportunities/${item.opportunityId}`}
            className={opportunityLinkClassName}
          >
            Ver oportunidad
            <ChevronRightIcon aria-hidden="true" className="size-3.5" />
          </Link>
        </footer>
      </DrawerContent>
    </Drawer>
  );
}

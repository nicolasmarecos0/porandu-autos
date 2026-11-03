"use client";

import Link from "next/link";
import { useDeferredValue, useMemo } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { GridIcon } from "@/components/ui/icons";
import type { StockCatalog } from "@/db/queries/stock-catalog";
import {
  CATALOG_PAGE_SIZE,
  catalogResultLabel,
  hasActiveFilters,
  indexCatalog,
  inPreparationNote,
  queryCatalog,
  type CatalogResult,
} from "@/domains/vehicles/catalog";
import { unitsLabel } from "@/domains/vehicles/stock";
import { STOCK_PATH } from "@/lib/vehicles/paths";

import { StockViewSwitch } from "../stock-view-switch";
import { CatalogCard } from "./catalog-card";
import { CatalogFilterBar } from "./catalog-filters";
import { useCatalogState } from "./use-catalog-state";
import { VehicleSheet } from "./vehicle-sheet";

/*
 * Catálogo visual del stock (propuesta DEC-049): la galería que el vendedor
 * le muestra al cliente en el salón, sin tablas densas.
 *
 *   ┌ Catálogo [Inventario|Catálogo] · 44 unidades ─────────────────────┐
 *   │ Para mostrar en el salón: disponibles, reservadas y vendidas.      │
 *   ├ (fija) [🔍 Buscar…] (Disponibles 12)(Reservadas 2)(…) [Marca ▾]   ┤
 *   │ 12 unidades disponibles                        Limpiar filtros     │
 *   │ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐                                │
 *   │ │ foto │ │ foto │ │ foto │ │ foto │  ← tocar abre la ficha         │
 *   │ │Hilux │ │Yaris │ │Ranger│ │ …    │                                │
 *   │ └──────┘ └──────┘ └──────┘ └──────┘                                │
 *   │                [Mostrar 24 más · quedan 31]                        │
 *   └────────────────────────────────────────────────────────────────────┘
 *
 * Mobile-first: la grilla elige sus columnas por el ancho que tiene (una en
 * el teléfono, dos en la tablet vertical, tres o más en escritorio), sin
 * depender del rail de navegación. Las unidades llegan del loader
 * tenant-scoped (PostgreSQL, sin fixtures); los filtros corren en el
 * navegador sobre esas unidades, con la misma función que el primer render
 * del servidor. La búsqueda se difiere un render para que escribir nunca
 * espere a la grilla.
 */

export function CatalogView({
  title,
  catalog,
}: {
  title: string;
  catalog: StockCatalog;
}) {
  const index = useMemo(
    () => indexCatalog(catalog.vehicles),
    [catalog.vehicles],
  );
  const state = useCatalogState(index);
  const { filters } = state;
  const query = useDeferredValue(filters.query);
  const result = useMemo(
    () =>
      queryCatalog(index, {
        status: filters.status,
        brand: filters.brand,
        query,
      }),
    [index, filters.status, filters.brand, query],
  );
  const selected =
    state.unitId === null ? null : (index.byId.get(state.unitId) ?? null);
  const shown = result.vehicles.slice(0, state.visible);
  const remaining = result.vehicles.length - shown.length;
  const preparation = inPreparationNote(catalog.inPreparation);
  const truncated = catalog.total > catalog.vehicles.length;

  return (
    <div className="flex shrink-0 flex-col">
      <header className="border-b border-border-subtle bg-surface-1 px-gutter pt-3 pb-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="flex items-baseline gap-2">
            <h1 className="text-title text-text-primary">{title}</h1>
            <span className="text-label text-text-muted tabular-nums">
              · {unitsLabel(catalog.total)}
            </span>
          </div>
          <StockViewSwitch current="catalog" />
        </div>
        <p className="mt-2 text-label text-text-muted max-sm:hidden">
          Para mostrar en el salón: disponibles, reservadas y vendidas, con
          precio, año y kilometraje.
        </p>
      </header>

      {catalog.total === 0 ? (
        <EmptyCatalog preparation={preparation} />
      ) : (
        <>
          <CatalogFilterBar
            filters={filters}
            statusCounts={result.statusCounts}
            brands={result.brands}
            onStatusChange={state.setStatus}
            onBrandChange={state.setBrand}
            onQueryChange={state.setQuery}
          />

          <section
            aria-labelledby="catalog-results"
            className="mx-auto w-full max-w-[100rem] px-gutter pt-4 pb-10"
          >
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 pb-3">
              <h2
                id="catalog-results"
                className="text-label text-text-secondary tabular-nums"
              >
                <span role="status">
                  {catalogResultLabel(result.vehicles.length, filters.status)}
                </span>
              </h2>
              {hasActiveFilters(filters) ? (
                <button
                  type="button"
                  onClick={state.clearFilters}
                  className="rounded-sm text-label font-semibold text-brand-strong underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                >
                  Limpiar filtros
                </button>
              ) : null}
            </div>

            <CatalogNotes
              preparation={preparation}
              truncated={truncated}
              catalog={catalog}
            />

            {shown.length === 0 ? (
              <NoMatches
                result={result}
                onShowAll={() => state.setStatus("all")}
                onClear={state.clearFilters}
                canShowAll={filters.status !== "all"}
              />
            ) : (
              <ul
                aria-label="Unidades del catálogo"
                className={cn(
                  "grid grid-cols-[repeat(auto-fill,minmax(min(100%,16rem),1fr))] gap-3 transition-opacity duration-150 sm:gap-4",
                  // Mientras la búsqueda diferida se pone al día.
                  query !== filters.query && "opacity-80",
                )}
              >
                {shown.map((vehicle) => (
                  <li key={vehicle.id}>
                    <CatalogCard vehicle={vehicle} onOpen={state.openUnit} />
                  </li>
                ))}
              </ul>
            )}

            {remaining > 0 ? (
              <div className="mt-6 flex justify-center">
                <Button onClick={state.showMore} className="h-10 px-5">
                  Mostrar {Math.min(remaining, CATALOG_PAGE_SIZE)} más
                  <span className="font-normal text-text-muted tabular-nums">
                    · quedan {remaining}
                  </span>
                </Button>
              </div>
            ) : null}
          </section>
        </>
      )}

      <VehicleSheet
        vehicle={selected}
        quoteCustomers={catalog.quoteCustomers}
        onClose={state.closeUnit}
      />
    </div>
  );
}

/** Lo que el catálogo no muestra, dicho: nunca se esconde en silencio. */
function CatalogNotes({
  preparation,
  truncated,
  catalog,
}: {
  preparation: string | null;
  truncated: boolean;
  catalog: StockCatalog;
}) {
  if (!preparation && !truncated) return null;
  return (
    <div className="mb-4 flex flex-col gap-1 rounded-md border border-border-subtle bg-surface-2 px-3 py-2 text-label text-text-secondary">
      {preparation ? (
        <p>
          {preparation}{" "}
          <Link
            href={STOCK_PATH}
            prefetch={false}
            className="font-semibold text-brand-strong underline-offset-2 hover:underline"
          >
            Ver Inventario
          </Link>
        </p>
      ) : null}
      {truncated ? (
        <p>
          Se cargaron {catalog.vehicles.length} de {catalog.total} unidades:
          quedan afuera las vendidas más antiguas.
        </p>
      ) : null}
    </div>
  );
}

/** Sin coincidencias con los filtros: qué probar. */
function NoMatches({
  result,
  canShowAll,
  onShowAll,
  onClear,
}: {
  result: CatalogResult;
  canShowAll: boolean;
  onShowAll: () => void;
  onClear: () => void;
}) {
  const elsewhere = canShowAll ? result.statusCounts.all : 0;
  return (
    <div className="flex flex-col items-center rounded-lg border border-dashed border-border-strong bg-surface-1 px-6 py-12 text-center">
      <p className="text-heading text-text-primary">Ninguna unidad coincide</p>
      <p className="mt-1 max-w-md text-label font-normal text-text-muted">
        {elsewhere > 0
          ? `Hay ${unitsLabel(elsewhere)} en otros estados que coinciden con la búsqueda y la marca.`
          : "Probá con otra búsqueda o con otra marca."}
      </p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        {elsewhere > 0 ? (
          <Button variant="primary" onClick={onShowAll} className="h-10">
            Ver todas
          </Button>
        ) : null}
        <Button onClick={onClear} className="h-10">
          Limpiar filtros
        </Button>
      </div>
    </div>
  );
}

/** Organización sin unidades para mostrar: estado vacío, sin ejemplos. */
function EmptyCatalog({ preparation }: { preparation: string | null }) {
  return (
    <div className="px-gutter py-6">
      <div className="mx-auto flex max-w-xl flex-col items-center rounded-lg border border-border-subtle bg-surface-1 px-6 py-12 text-center shadow-card">
        <GridIcon aria-hidden="true" className="size-6 text-text-muted" />
        <p className="mt-3 text-heading text-text-primary">
          Todavía no hay unidades para mostrar
        </p>
        <p className="mt-1 max-w-md text-label font-normal text-text-muted">
          Cuando una unidad esté disponible, aparece acá con su precio, año y
          kilometraje.{preparation ? ` ${preparation}` : ""}
        </p>
        <Link
          href={STOCK_PATH}
          prefetch={false}
          className="mt-4 text-label font-semibold text-brand-strong underline-offset-2 hover:underline"
        >
          Ir a Inventario
        </Link>
      </div>
    </div>
  );
}

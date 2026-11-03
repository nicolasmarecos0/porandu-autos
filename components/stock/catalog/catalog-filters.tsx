"use client";

import { useId, useRef, type FormEvent, type ReactNode } from "react";

import { cn } from "@/components/ui/cn";
import { ChevronDownIcon, CloseIcon, SearchIcon } from "@/components/ui/icons";
import {
  CATALOG_PARAMS,
  CATALOG_QUERY_MAX_LENGTH,
  CATALOG_STATUS_FILTER_LABELS,
  CATALOG_STATUS_FILTERS,
  type BrandFacet,
  type CatalogFilters,
  type CatalogStatusFilter,
} from "@/domains/vehicles/catalog";

import { STATUS_DOT } from "../stock-status";

/*
 * Barra de filtros del catálogo (propuesta DEC-049), fija arriba al hacer
 * scroll. Tres filtros rápidos, sin botón "Aplicar": cada cambio actualiza
 * la grilla al instante y la URL.
 *
 *   teléfono:   [🔍 Buscar ……………………………………………]
 *               [Estado ▾            ] [Marca ▾           ]
 *   tablet:     [🔍 Buscar …………………………………] [Marca ▾  ]
 *               (Disponibles 12)(Reservadas 2)(Vendidas 30)(Todas 44)
 *   escritorio: [🔍 Buscar ……] (Disponibles 12)(…)(Todas 44) [Marca ▾]
 *
 * El estado es un grupo de radios nativos (flechas del teclado incluidas)
 * desde sm y un select nativo en el teléfono, donde no entran los cuatro;
 * solo uno de los dos existe para el lector de pantalla a la vez. La marca
 * es un select nativo (el selector del sistema en el teléfono), con cuántas
 * unidades daría cada una con los otros filtros.
 *
 * En el teléfono cada select lleva su rótulo visible arriba ("Estado",
 * "Marca") y un valor corto que entra en la mitad del ancho; la lista
 * nativa sigue mostrando cada opción completa, con su cantidad. Los
 * controles miden 44 px de alto (objetivo táctil) y usan 16 px de texto
 * para que iOS no haga zoom al enfocarlos.
 *
 * Es un formulario GET con los mismos nombres que la URL: Enter cierra el
 * teclado del teléfono y no recarga nada.
 */

const fieldClassName =
  "h-11 w-full rounded-md border border-border-default bg-surface-1 text-[1rem] text-text-primary transition-[border-color] hover:border-border-strong focus-visible:border-brand focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring sm:h-10 sm:text-body";

type CatalogFiltersProps = Readonly<{
  filters: CatalogFilters;
  statusCounts: Readonly<Record<CatalogStatusFilter, number>>;
  brands: readonly BrandFacet[];
  onStatusChange: (status: CatalogStatusFilter) => void;
  onBrandChange: (brand: string | null) => void;
  onQueryChange: (query: string) => void;
}>;

export function CatalogFilterBar({
  filters,
  statusCounts,
  brands,
  onStatusChange,
  onBrandChange,
  onQueryChange,
}: CatalogFiltersProps) {
  const id = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const selectedBrand = brands.find((brand) => brand.key === filters.brand);

  function submit(event: FormEvent<HTMLFormElement>) {
    // La grilla ya está filtrada: Enter solo cierra el teclado.
    event.preventDefault();
    searchRef.current?.blur();
  }

  return (
    <form
      role="search"
      aria-label="Filtros del catálogo"
      method="get"
      onSubmit={submit}
      className="sticky top-0 z-20 border-b border-border-subtle bg-surface-1 px-gutter py-3 shadow-sm"
    >
      <div className="mx-auto grid max-w-[100rem] grid-cols-2 gap-2 sm:grid-cols-[minmax(0,1fr)_13rem] lg:flex lg:items-center lg:gap-3">
        <div className="relative col-span-2 min-w-0 sm:col-span-1 lg:max-w-96 lg:flex-1">
          <label htmlFor={`${id}-q`} className="sr-only">
            Buscar en el catálogo
          </label>
          <SearchIcon
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-muted"
          />
          <input
            ref={searchRef}
            id={`${id}-q`}
            type="search"
            name={CATALOG_PARAMS.query}
            value={filters.query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Modelo, versión o año"
            maxLength={CATALOG_QUERY_MAX_LENGTH}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="search"
            className={cn(
              fieldClassName,
              "pr-10 pl-9 placeholder:text-text-muted [&::-webkit-search-cancel-button]:appearance-none",
            )}
          />
          {filters.query !== "" ? (
            <button
              type="button"
              aria-label="Borrar la búsqueda"
              onClick={() => {
                onQueryChange("");
                searchRef.current?.focus();
              }}
              className="absolute top-1/2 right-1.5 flex size-7 -translate-y-1/2 items-center justify-center rounded-sm text-text-muted transition-colors hover:bg-surface-2 hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring"
            >
              <CloseIcon className="size-4" />
            </button>
          ) : null}
        </div>

        <SelectField
          id={`${id}-status`}
          label="Estado"
          value={filters.status}
          display={CATALOG_STATUS_FILTER_LABELS[filters.status]}
          onChange={(value) => {
            const status = CATALOG_STATUS_FILTERS.find((s) => s === value);
            if (status) onStatusChange(status);
          }}
          className="sm:hidden"
        >
          {CATALOG_STATUS_FILTERS.map((status) => (
            <option key={status} value={status}>
              {CATALOG_STATUS_FILTER_LABELS[status]} ({statusCounts[status]})
            </option>
          ))}
        </SelectField>

        <SelectField
          id={`${id}-brand`}
          label="Marca"
          name={CATALOG_PARAMS.brand}
          value={filters.brand ?? ""}
          display={
            selectedBrand ? (
              selectedBrand.label
            ) : (
              <>
                <span className="sm:hidden">Todas</span>
                <span className="max-sm:hidden">Todas las marcas</span>
              </>
            )
          }
          onChange={(value) => onBrandChange(value === "" ? null : value)}
          className="lg:order-3 lg:w-52 lg:flex-none"
        >
          <option value="">Todas las marcas</option>
          {brands.map((brand) => (
            <option key={brand.key} value={brand.key}>
              {brand.label} ({brand.count})
            </option>
          ))}
        </SelectField>

        <fieldset className="col-span-2 hidden min-w-0 sm:block lg:order-2 lg:shrink-0">
          <legend className="sr-only">Estado</legend>
          <div className="flex w-fit max-w-full [scrollbar-width:none] gap-0.5 overflow-x-auto rounded-md bg-surface-3 p-0.5">
            {CATALOG_STATUS_FILTERS.map((status) => (
              <label key={status} className="shrink-0">
                <input
                  type="radio"
                  name={CATALOG_PARAMS.status}
                  value={status}
                  checked={filters.status === status}
                  onChange={() => onStatusChange(status)}
                  className="peer sr-only"
                />
                <span className="flex h-8 cursor-pointer items-center gap-1.5 rounded-sm px-3 text-label text-text-muted transition-colors peer-checked:bg-surface-1 peer-checked:font-semibold peer-checked:text-text-primary peer-checked:shadow-sm peer-focus-visible:outline-2 peer-focus-visible:outline-offset-1 peer-focus-visible:outline-focus-ring hover:text-text-primary">
                  {status === "all" ? null : (
                    <span
                      aria-hidden="true"
                      className={cn(
                        "size-1.5 rounded-full",
                        STATUS_DOT[status],
                      )}
                    />
                  )}
                  {CATALOG_STATUS_FILTER_LABELS[status]}
                  <span className="text-caption font-medium text-text-muted tabular-nums">
                    {statusCounts[status]}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      </div>
    </form>
  );
}

/**
 * Select nativo con su etiqueta, su chevron y un valor corto a la vista.
 * El select es el control real (teclado, lector y selector del sistema); su
 * texto queda transparente y `display` muestra el valor elegido. En el
 * teléfono la etiqueta se ve arriba; desde sm queda para el lector. Con
 * colores forzados (alto contraste) se ve el texto nativo.
 */
function SelectField({
  id,
  label,
  name,
  value,
  display,
  onChange,
  className,
  children,
}: {
  id: string;
  label: string;
  name?: string;
  value: string;
  display: ReactNode;
  onChange: (value: string) => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("relative min-w-0", className)}>
      <label
        htmlFor={id}
        className="pointer-events-none absolute top-1 left-2.5 text-caption text-text-muted sm:sr-only sm:left-3"
      >
        {label}
      </label>
      <select
        id={id}
        name={name}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={cn(
          fieldClassName,
          "cursor-pointer appearance-none pt-3.5 pr-8 pl-2.5 text-transparent sm:pt-0 sm:pr-9 sm:pl-3 forced-colors:text-[CanvasText] [&>option]:text-text-primary",
        )}
      >
        {children}
      </select>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute right-8 bottom-1.5 left-2.5 truncate text-[1rem] text-text-primary sm:top-1/2 sm:right-9 sm:bottom-auto sm:left-3 sm:-translate-y-1/2 sm:text-body forced-colors:hidden"
      >
        {display}
      </span>
      <ChevronDownIcon
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-text-muted sm:right-3"
      />
    </div>
  );
}

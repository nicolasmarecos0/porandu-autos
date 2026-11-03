"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import {
  CATALOG_PAGE_SIZE,
  catalogSearch,
  DEFAULT_CATALOG_FILTERS,
  parseCatalogFilters,
  parseCatalogUnit,
  resolveCatalogFilters,
  type CatalogFilters,
  type CatalogIndex,
  type CatalogStatusFilter,
} from "@/domains/vehicles/catalog";
import { STOCK_CATALOG_PATH } from "@/lib/vehicles/paths";

/*
 * Estado del catálogo (propuesta DEC-049): los filtros, la unidad abierta y
 * cuántas tarjetas se dibujan. Los filtros cambian al instante, en el
 * navegador; la URL es su espejo, para compartir, recargar y volver atrás.
 *
 * - El estado sale de la URL (useSearchParams) al montar, en el servidor y
 *   en el navegador por igual, y cada vez que llegan datos nuevos del
 *   servidor (una navegación al catálogo, aunque sea con otros filtros).
 *   Al volver de otra página, el catálogo se rearma con la URL de esa
 *   entrada del historial.
 * - Cada cambio de filtro reemplaza la entrada actual (History API, que
 *   Next integra con su router) sin pedirle nada al servidor, después de
 *   una pausa corta: no hay una entrada por tecla y Safari no corta por
 *   exceso de llamadas.
 * - Abrir una unidad suma una entrada (`unit=`): el gesto "atrás" del
 *   teléfono cierra la hoja en vez de salir del catálogo. Cerrarla con el
 *   botón vuelve esa entrada; si la hoja vino en el enlace, la reemplaza.
 * - Atrás y adelante (popstate) rearman el estado con la URL de la entrada.
 */

/** Pausa antes de escribir la URL (la grilla no espera: es inmediata). */
const URL_SYNC_DELAY_MS = 250;

export type CatalogState = Readonly<{
  filters: CatalogFilters;
  /** Unidad abierta en la vista de detalle, si existe en el catálogo. */
  unitId: string | null;
  /** Tarjetas que se dibujan: una o más tandas de CATALOG_PAGE_SIZE. */
  visible: number;
}>;

/** Estado de una query string ("status=sold&q=hilux"), contra el índice. */
export function readCatalogState(
  index: CatalogIndex,
  search: string,
): CatalogState {
  const source = Object.fromEntries(new URLSearchParams(search).entries());
  const unit = parseCatalogUnit(source);
  return {
    filters: resolveCatalogFilters(index, parseCatalogFilters(source)),
    unitId: unit !== null && index.byId.has(unit) ? unit : null,
    visible: CATALOG_PAGE_SIZE,
  };
}

/**
 * Escribe la URL del estado: suma una entrada (`push`) o reemplaza la
 * actual si cambió (`replace`).
 */
function writeUrl(
  mode: "push" | "replace",
  filters: CatalogFilters,
  unitId: string | null,
): void {
  const href = `${STOCK_CATALOG_PATH}${catalogSearch(filters, unitId)}`;
  if (mode === "push") {
    window.history.pushState(null, "", href);
    return;
  }
  const current = `${window.location.pathname}${window.location.search}`;
  if (current !== href) window.history.replaceState(null, "", href);
}

export function useCatalogState(index: CatalogIndex) {
  const search = useSearchParams().toString();
  const [state, setState] = useState<CatalogState>(() =>
    readCatalogState(index, search),
  );
  // Datos nuevos del servidor (otro índice): el estado vuelve a salir de la
  // URL de esa respuesta. Se ajusta durante el render, sin un efecto.
  const [indexSeen, setIndexSeen] = useState(index);
  if (index !== indexSeen) {
    setIndexSeen(index);
    setState(readCatalogState(index, search));
  }
  /** La entrada actual del historial la sumó el catálogo al abrir una unidad. */
  const pushedRef = useRef(false);

  // Espejo de la URL: después de una pausa, la entrada actual refleja el
  // estado (incluida la limpieza de un parámetro inválido al llegar).
  const { filters, unitId } = state;
  useEffect(() => {
    const handle = window.setTimeout(
      () => writeUrl("replace", filters, unitId),
      URL_SYNC_DELAY_MS,
    );
    return () => window.clearTimeout(handle);
  }, [filters, unitId]);

  // Atrás y adelante: la URL de la entrada manda (cierra o reabre la hoja).
  useEffect(() => {
    function onPopState() {
      pushedRef.current = false;
      setState(readCatalogState(index, window.location.search));
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [index]);

  function update(next: CatalogFilters): void {
    setState((current) => ({
      ...current,
      filters: next,
      visible: CATALOG_PAGE_SIZE,
    }));
  }

  return {
    ...state,
    setStatus(status: CatalogStatusFilter) {
      update({ ...filters, status });
    },
    setBrand(brand: string | null) {
      update({ ...filters, brand });
    },
    setQuery(query: string) {
      update({ ...filters, query });
    },
    clearFilters() {
      update(DEFAULT_CATALOG_FILTERS);
    },
    showMore() {
      setState((current) => ({
        ...current,
        visible: current.visible + CATALOG_PAGE_SIZE,
      }));
    },
    openUnit(id: string) {
      if (!index.byId.has(id)) return;
      // La entrada actual queda con los filtros al día antes de sumar otra:
      // volver atrás nunca revierte un filtro recién elegido.
      writeUrl("replace", filters, null);
      writeUrl("push", filters, id);
      pushedRef.current = true;
      setState({ ...state, unitId: id });
    },
    closeUnit() {
      setState((current) => ({ ...current, unitId: null }));
      if (pushedRef.current) {
        pushedRef.current = false;
        window.history.back();
      }
    },
  };
}

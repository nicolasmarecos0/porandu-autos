import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import CalendarLoading from "@/app/(app)/calendar/loading";
import CockpitLoading from "@/app/(app)/cockpit/(feed)/loading";
import CockpitMetricsLoading from "@/app/(app)/cockpit/metrics/loading";
import ConversationsLoading from "@/app/(app)/conversations/loading";
import IntelligenceLoading from "@/app/(app)/intelligence/loading";
import OpportunitiesLoading from "@/app/(app)/opportunities/(queue)/loading";
import OpportunityDetailLoading from "@/app/(app)/opportunities/[id]/loading";
import PipelineLoading from "@/app/(app)/opportunities/pipeline/loading";
import OpportunitiesTableLoading from "@/app/(app)/opportunities/table/loading";
import RecoveryLoading from "@/app/(app)/recovery/loading";
import SettingsLoading from "@/app/(app)/settings/loading";
import StockLoading from "@/app/(app)/stock/(list)/loading";
import CatalogLoading from "@/app/(app)/stock/catalog/loading";
import { NAV_ITEMS } from "@/components/shell/navigation";

/*
 * Estados de carga del panel (DEC-058). Sin Cache Components, Next solo
 * prefetchea una ruta dinámica hasta su primer loading.js: sin él, tocar el
 * rail esperaba el render completo del servidor.
 *
 * Prueba que cada ruta del panel tiene su boundary (y que el de una ruta
 * padre no tapa el de sus subrutas), que cada skeleton anuncia la carga una
 * sola vez y que no muestra datos: ningún número, nombre ni estado
 * comercial, solo el nombre de la sección.
 */

const APP_DIR = join(process.cwd(), "app", "(app)");

const LOADINGS: Array<
  [route: string, Component: ComponentType, title: string | null]
> = [
  ["/cockpit", CockpitLoading, "Cockpit"],
  ["/cockpit/metrics", CockpitMetricsLoading, "Métricas del salón"],
  ["/opportunities", OpportunitiesLoading, null],
  ["/opportunities/table", OpportunitiesTableLoading, null],
  ["/opportunities/pipeline", PipelineLoading, "Embudo de ventas"],
  ["/opportunities/[id]", OpportunityDetailLoading, null],
  ["/stock", StockLoading, "Stock"],
  ["/stock/catalog", CatalogLoading, "Catálogo"],
  ["/conversations", ConversationsLoading, "Conversaciones"],
  ["/calendar", CalendarLoading, "Calendario"],
  ["/intelligence", IntelligenceLoading, "Inteligencia"],
  ["/settings", SettingsLoading, null],
];

function render(Component: ComponentType): string {
  return renderToStaticMarkup(createElement(Component));
}

/** El texto visible, sin etiquetas ni lo que es solo para lectores. */
function visibleText(html: string): string {
  return html
    .replace(/<[^>]+class="[^"]*sr-only[^"]*"[^>]*>[^<]*<\/[^>]+>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Las carpetas de app/(app) que tienen un page.tsx, como rutas. */
function pageRoutes(dir = APP_DIR): string[] {
  const routes: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (!statSync(path).isDirectory()) continue;
    routes.push(...pageRoutes(path));
  }
  if (existsSync(join(dir, "page.tsx"))) {
    const segments = relative(APP_DIR, dir)
      .split(/[\\/]/)
      .filter((segment) => segment !== "" && !/^\(.+\)$/.test(segment));
    routes.push(`/${segments.join("/")}`);
  }
  return routes;
}

describe("loading.tsx del panel", () => {
  it("cada ítem del rail tiene su estado de carga", () => {
    for (const item of NAV_ITEMS) {
      const folder = join(APP_DIR, item.href.slice(1));
      const direct = existsSync(join(folder, "loading.tsx"));
      const grouped = readdirSync(folder).some(
        (entry) =>
          /^\(.+\)$/.test(entry) &&
          existsSync(join(folder, entry, "loading.tsx")),
      );
      expect(direct || grouped, item.href).toBe(true);
    }
  });

  it("el boundary de una ruta padre no envuelve a sus subrutas", () => {
    // Una ruta con subrutas lleva su page y su loading en un grupo: el
    // prefetch de la subruta llega a su propio loading, no al del padre.
    for (const parent of ["cockpit", "opportunities", "stock"]) {
      const folder = join(APP_DIR, parent);
      expect(existsSync(join(folder, "loading.tsx")), parent).toBe(false);
      expect(existsSync(join(folder, "page.tsx")), parent).toBe(false);
    }
    expect(existsSync(join(APP_DIR, "loading.tsx"))).toBe(false);
  });

  it("las rutas no cambian con los grupos", () => {
    expect(pageRoutes().sort()).toEqual(
      [
        "/calendar",
        "/cockpit",
        "/cockpit/metrics",
        "/conversations",
        "/intelligence",
        "/opportunities",
        "/opportunities/[id]",
        "/opportunities/[id]/quotes/[quoteId]",
        "/opportunities/pipeline",
        "/opportunities/table",
        "/recovery",
        "/settings",
        "/settings/team",
        "/stock",
        "/stock/catalog",
      ].sort(),
    );
  });

  it.each(LOADINGS)(
    "%s anuncia la carga una vez y no muestra datos",
    (_route, Component, title) => {
      const html = render(Component);
      expect(html.match(/role="status"/g)).toHaveLength(1);
      expect(html).toContain('aria-busy="true"');
      expect(html).toMatch(/role="status"[^>]*>Cargando [^<]+…</);
      const text = visibleText(html);
      // Ningún dato: ni números ni montos, solo el título de la sección.
      expect(text).not.toMatch(/\d/);
      expect(text).toBe(title ?? "");
      if (title)
        expect(html).toContain(
          `<h1 class="text-title text-text-primary">${title}</h1>`,
        );
    },
  );

  it("los bloques son decorativos y se quedan quietos con reduced motion", () => {
    const html = render(OpportunitiesLoading);
    const blocks = html.match(/<span aria-hidden="true" class="[^"]*"/g) ?? [];
    expect(blocks.length).toBeGreaterThan(10);
    for (const block of blocks) {
      expect(block).toContain("motion-safe:animate-pulse");
    }
  });

  it("Recuperación muestra la misma pantalla que la página", () => {
    expect(visibleText(render(RecoveryLoading))).toContain("Recuperación");
  });
});

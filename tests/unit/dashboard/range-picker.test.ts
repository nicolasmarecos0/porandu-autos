import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { Drawer } from "@/components/ui/drawer";
import type { DashboardRangeView } from "@/domains/dashboard/metrics";
import { DASHBOARD_RANGE_PRESETS } from "@/domains/dashboard/range";

/*
 * Selector del rango de /intelligence (DEC-043 §6 y §9): los presets son
 * enlaces de navegación con `aria-current` y sin prefetch (un hover no
 * dispara las lecturas agregadas), y "Personalizado" abre un drawer con un
 * formulario GET de dos fechas.
 *
 * next/link se reemplaza por un <a> que expone `prefetch` y `scroll`: en el
 * HTML de Next no quedan como atributos.
 */

vi.mock("next/link", () => ({
  default: ({
    href,
    prefetch,
    scroll,
    children,
    ...props
  }: {
    href: string;
    prefetch?: boolean | null;
    scroll?: boolean;
    children: ReactNode;
  }) =>
    createElement(
      "a",
      {
        ...props,
        href,
        "data-prefetch": String(prefetch),
        "data-scroll": String(scroll),
      },
      children,
    ),
}));

const { CustomRangeForm, presetHref, RangePicker } =
  await import("@/components/dashboard/range-picker");

const MONTH: DashboardRangeView = {
  kind: "month",
  from: "2026-10-01",
  to: "2026-10-31",
  days: 31,
  label: "Mes en curso: octubre de 2026",
  isDefault: true,
};

const CUSTOM: DashboardRangeView = {
  kind: "custom",
  from: "2026-09-15",
  to: "2026-10-05",
  days: 21,
  label: "Personalizado: 15 sept – 5 oct 2026",
  isDefault: false,
};

const TODAY = "2026-10-14";

function renderPicker(range: DashboardRangeView = MONTH): string {
  return renderToStaticMarkup(
    createElement(RangePicker, { range, today: TODAY }),
  );
}

/** El formulario vive dentro del drawer: "Cancelar" lo cierra (DrawerClose). */
function renderForm(range: DashboardRangeView = MONTH): string {
  return renderToStaticMarkup(
    createElement(
      Drawer,
      { open: true },
      createElement(CustomRangeForm, { range, today: TODAY }),
    ),
  );
}

type Anchor = { attributes: string; label: string };

function anchors(html: string): Anchor[] {
  return [...html.matchAll(/<a ([^>]*)>([^<]*)<\/a>/g)].map((match) => ({
    attributes: match[1]!,
    label: match[2]!,
  }));
}

describe("presetHref: el enlace canónico de cada preset", () => {
  it("el mes en curso no lleva parámetros; el resto, solo `range`", () => {
    expect(DASHBOARD_RANGE_PRESETS.map(presetHref)).toEqual([
      "/intelligence",
      "/intelligence?range=previous_month",
      "/intelligence?range=last_30_days",
      "/intelligence?range=quarter",
      "/intelligence?range=year",
    ]);
  });
});

describe("RangePicker", () => {
  it("una navegación con un enlace por preset, en orden, y el botón Personalizado", () => {
    const html = renderPicker();

    expect(html).toMatch(/^<nav aria-label="Rango de fechas"/);
    expect(anchors(html).map((anchor) => anchor.label)).toEqual([
      "Mes en curso",
      "Mes anterior",
      "Últimos 30 días",
      "Trimestre en curso",
      "Año en curso",
    ]);
    expect(html).toMatch(
      /<button type="button"[^>]*aria-haspopup="dialog"[^>]*>Personalizado<\/button>/,
    );
  });

  it("ningún preset hace prefetch (DEC-043 §6)", () => {
    for (const anchor of anchors(renderPicker())) {
      expect(anchor.attributes).toContain('data-prefetch="false"');
      expect(anchor.attributes).toContain('data-scroll="false"');
    }
  });

  it("solo el preset activo lleva aria-current", () => {
    const html = renderPicker({
      ...MONTH,
      kind: "quarter",
      label: "Trimestre en curso: 1 oct – 31 dic 2026",
      isDefault: false,
    });
    const current = anchors(html).filter((anchor) =>
      anchor.attributes.includes('aria-current="page"'),
    );
    expect(current.map((anchor) => anchor.label)).toEqual([
      "Trimestre en curso",
    ]);
    expect(current[0]?.attributes).toContain(
      'href="/intelligence?range=quarter"',
    );
    expect(html).not.toMatch(/<button[^>]*aria-current/);
  });

  it("con un rango personalizado, el activo es el botón y ningún preset", () => {
    const html = renderPicker(CUSTOM);
    expect(html).not.toContain('aria-current="page"');
    expect(html).toMatch(/<button[^>]*aria-current="true"[^>]*>Personalizado/);
  });

  it("el drawer arranca cerrado: el formulario no se renderiza hasta abrirlo", () => {
    const html = renderPicker();
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("<form");
  });

  it("sin colores fijos: solo clases de tokens", () => {
    const html = renderPicker(CUSTOM);
    expect(html).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(html).not.toMatch(/rgb\(|hsl\(|style="/);
  });
});

describe("CustomRangeForm: formulario GET de dos fechas", () => {
  it("navega a /intelligence?range=custom&from=…&to=…", () => {
    const html = renderForm();
    expect(html).toMatch(/^<form [^>]*action="\/intelligence" method="get">/);
    expect(html).toContain(
      '<input type="hidden" name="range" value="custom"/>',
    );
    for (const [id, name] of [
      ["dashboard-range-from", "from"],
      ["dashboard-range-to", "to"],
    ] as const) {
      const input = new RegExp(`<input id="${id}"[^>]*/>`).exec(html)?.[0];
      expect(input).toContain('type="date"');
      expect(input).toContain(`name="${name}"`);
      expect(html).toContain(`<label for="${id}"`);
    }
    expect(html).toMatch(/<button type="submit"[^>]*>Aplicar rango<\/button>/);
    expect(html).toMatch(/<button type="button"[^>]*>Cancelar<\/button>/);
  });

  it("los dos días son obligatorios y van de 2000-01-01 a hoy", () => {
    const html = renderForm();
    for (const id of ["dashboard-range-from", "dashboard-range-to"]) {
      const input = new RegExp(`<input id="${id}"[^>]*/>`).exec(html)?.[0];
      expect(input).toContain("required");
      expect(input).toContain('min="2000-01-01"');
      expect(input).toContain(`max="${TODAY}"`);
    }
  });

  it("arranca con el rango actual y recorta a hoy un último día futuro", () => {
    const month = renderForm();
    expect(month).toMatch(/id="dashboard-range-from"[^>]*value="2026-10-01"/);
    expect(month).toMatch(/id="dashboard-range-to"[^>]*value="2026-10-14"/);

    const custom = renderForm(CUSTOM);
    expect(custom).toMatch(/id="dashboard-range-from"[^>]*value="2026-09-15"/);
    expect(custom).toMatch(/id="dashboard-range-to"[^>]*value="2026-10-05"/);
  });

  it("la ayuda del último día está enlazada al campo", () => {
    const html = renderForm();
    expect(html).toMatch(
      /id="dashboard-range-to"[^>]*aria-describedby="dashboard-range-to-hint"/,
    );
    expect(html).toContain(
      '<p id="dashboard-range-to-hint" class="text-caption text-text-muted">Incluido. Un día posterior a hoy se recorta a hoy.</p>',
    );
  });
});

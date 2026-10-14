import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ExecutiveDashboardView } from "@/components/dashboard/executive-dashboard";
import type {
  AtRiskOpportunity,
  ExecutiveDashboard,
} from "@/domains/dashboard/metrics";

/*
 * Dashboard Directivo de /intelligence (Hito 5, DEC-037 §12), renderizado en
 * el servidor sin DOM: los tres bloques de indicadores en su grilla, los
 * valores con formato es-PY, "Sin dato" sin cierres (DEC-005), los tonos de
 * atención junto a su texto y la lista de oportunidades en riesgo con enlace
 * al detalle.
 */

const id = (n: number) =>
  `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function atRiskItem(
  n: number,
  overrides: Partial<AtRiskOpportunity> = {},
): AtRiskOpportunity {
  return {
    id: id(n),
    contactName: `Cliente ${n}`,
    initials: "CL",
    stage: "qualifying",
    daysInactive: 6,
    ...overrides,
  };
}

const DASHBOARD: ExecutiveDashboard = {
  periodLabel: "octubre de 2026",
  pipeline: { open: 1234, won: 2, lost: 1, winRate: 66.7 },
  inventory: { inStock: 18, reserved: 3, sold: 2 },
  attention: { warning: 2, stale: 1 },
  atRisk: {
    items: [
      atRiskItem(1, {
        contactName: "Lucía Ferreira",
        initials: "LF",
        stage: "new",
        daysInactive: 30,
      }),
      atRiskItem(2, {
        contactName: "Óscar Brítez",
        initials: "OB",
        stage: "negotiating",
        daysInactive: 5,
      }),
    ],
    total: 2,
  },
};

function render(dashboard: ExecutiveDashboard = DASHBOARD): string {
  return renderToStaticMarkup(
    createElement(ExecutiveDashboardView, { title: "Inteligencia", dashboard }),
  );
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** El HTML de una sección por el id de su encabezado. */
function section(html: string, headingId: string): string {
  const start = html.indexOf(`aria-labelledby="${headingId}"`);
  if (start === -1) throw new Error(`section ${headingId} not rendered`);
  return html.slice(start, html.indexOf("</section>", start));
}

type Kpi = {
  edge: string | undefined;
  valueClasses: string;
  value: string;
  hint: string;
};

/** Una tarjeta de indicador por su rótulo. */
function kpi(html: string, label: string): Kpi {
  const match = new RegExp(
    `<div class="([^"]*)"><dt class="[^"]*">${escape(label)}</dt><dd class="([^"]*)">([^<]*)</dd><dd class="[^"]*">(.*?)</dd></div>`,
  ).exec(html);
  if (!match) throw new Error(`kpi "${label}" not rendered`);
  const edge = /before:bg-(warning|danger)/.exec(match[1]!);
  return {
    edge: edge?.[0],
    valueClasses: match[2]!,
    value: match[3]!,
    hint: match[4]!.replace(/<[^>]+>/g, ""),
  };
}

describe("ExecutiveDashboardView: estructura", () => {
  it("encabezado con el mes en curso y un solo h1", () => {
    const html = render();
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain(">Inteligencia</h1>");
    expect(html).toContain("Dashboard directivo");
    expect(html).toMatch(/Mes en curso:\s*<span[^>]*>octubre de 2026<\/span>/);
  });

  it("tres bloques de indicadores, cada uno con su grilla de tarjetas", () => {
    const html = render();
    for (const [headingId, title, columns] of [
      ["pipeline-heading", "Pipeline comercial", "sm:grid-cols-3"],
      ["inventory-heading", "Salud del inventario", "sm:grid-cols-3"],
      ["attention-heading", "Atención", "sm:grid-cols-2"],
    ] as const) {
      const block = section(html, headingId);
      expect(block).toContain(`<h2 id="${headingId}"`);
      expect(block).toContain(`>${title}</h2>`);
      expect(block).toMatch(new RegExp(`<dl class="grid [^"]*${columns}`));
    }
    // El rail contextual lleva la lista en riesgo.
    expect(html).toMatch(
      /<aside aria-label="Panel contextual"[^>]*><section aria-labelledby="at-risk-heading"/,
    );
  });

  it("el orden de lectura: pipeline, inventario, atención y después el riesgo", () => {
    const html = render();
    const positions = [
      "pipeline-heading",
      "inventory-heading",
      "attention-heading",
      "at-risk-heading",
    ].map((headingId) => html.indexOf(`id="${headingId}"`));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });
});

describe("indicadores con formato es-PY", () => {
  it("pipeline: activas con separador de miles, ganadas con sus perdidas y win rate", () => {
    const html = section(render(), "pipeline-heading");

    expect(kpi(html, "Oportunidades activas")).toMatchObject({
      value: "1.234",
      hint: "Nuevas, en calificación y en negociación",
    });
    expect(kpi(html, "Ganadas en el mes")).toMatchObject({
      value: "2",
      hint: "1 perdida en el mes",
    });
    expect(kpi(html, "Win rate")).toMatchObject({
      value: "66,7%",
      hint: "Ganadas sobre cerradas en el mes",
    });
    // El medidor: decorativo, de la rampa de marca, con el ancho del valor.
    expect(html).toContain(
      '<span aria-hidden="true" class="block h-1.5 w-full overflow-hidden rounded-full bg-brand-soft"><span class="block h-full rounded-full bg-brand" style="width:66.7%"></span></span>',
    );
  });

  it("inventario: en stock, reservadas y vendidas en el mes", () => {
    const html = section(render(), "inventory-heading");

    expect(kpi(html, "En stock")).toMatchObject({
      value: "18",
      hint: "Unidades sin reserva ni venta",
    });
    expect(kpi(html, "Reservadas")).toMatchObject({
      value: "3",
      hint: "Vinculadas a una oportunidad en negociación",
    });
    expect(kpi(html, "Vendidas en el mes")).toMatchObject({
      value: "2",
      hint: "Unidades de oportunidades ganadas en el mes",
    });
  });

  it("los valores usan cifras tabulares y la tipografía de métricas", () => {
    const html = render();
    for (const label of ["Oportunidades activas", "En stock", "Inactivas"]) {
      expect(kpi(html, label).valueClasses).toContain("text-metric");
      expect(kpi(html, label).valueClasses).toContain("tabular-nums");
    }
  });

  it("plural de las perdidas", () => {
    const html = render({
      ...DASHBOARD,
      pipeline: { open: 4, won: 1, lost: 3, winRate: 25 },
    });
    expect(kpi(html, "Ganadas en el mes").hint).toBe("3 perdidas en el mes");
    expect(kpi(html, "Win rate").value).toBe("25%");
  });
});

describe("win rate sin cierres (DEC-005)", () => {
  const html = render({
    ...DASHBOARD,
    pipeline: { open: 3, won: 0, lost: 0, winRate: null },
  });

  it("dice Sin dato, atenuado, y explica por qué", () => {
    expect(kpi(html, "Win rate")).toMatchObject({
      value: "Sin dato",
      hint: "Sin dato: no hubo cierres en el mes",
    });
    expect(kpi(html, "Win rate").valueClasses).toContain("text-text-muted");
  });

  it("no dibuja un 0 % inventado ni el medidor", () => {
    expect(html).not.toContain("0%");
    expect(html).not.toContain('style="width:');
  });

  it("con cierres y ninguna ganada sí es 0 %, con el medidor vacío", () => {
    const zero = render({
      ...DASHBOARD,
      pipeline: { open: 3, won: 0, lost: 2, winRate: 0 },
    });
    expect(kpi(zero, "Win rate").value).toBe("0%");
    expect(kpi(zero, "Win rate").valueClasses).not.toContain("text-text-muted");
    expect(zero).toContain('style="width:0%"');
  });
});

describe("atención: el color acompaña al texto", () => {
  it("Enfriándose en ámbar e Inactivas en rojo cuando hay alguna", () => {
    const html = section(render(), "attention-heading");

    expect(kpi(html, "Enfriándose")).toMatchObject({
      value: "2",
      hint: "De 2 a 5 días sin actividad del cliente",
    });
    expect(kpi(html, "Enfriándose").valueClasses).toContain("text-warning");
    expect(kpi(html, "Enfriándose").edge).toBe("before:bg-warning");

    expect(kpi(html, "Inactivas")).toMatchObject({
      value: "1",
      hint: "Más de 5 días sin actividad del cliente",
    });
    expect(kpi(html, "Inactivas").valueClasses).toContain("text-danger");
    expect(kpi(html, "Inactivas").edge).toBe("before:bg-danger");

    expect(html).toContain("3 requieren atención");
  });

  it("en cero no alarma: tono neutro y sin filete", () => {
    const html = section(
      render({
        ...DASHBOARD,
        attention: { warning: 0, stale: 0 },
        atRisk: { items: [], total: 0 },
      }),
      "attention-heading",
    );
    for (const label of ["Enfriándose", "Inactivas"]) {
      expect(kpi(html, label).edge).toBeUndefined();
      expect(kpi(html, label).valueClasses).toContain("text-text-primary");
    }
    expect(html).not.toMatch(/text-warning|text-danger/);
    expect(html).toContain("Ninguna requiere atención");
  });

  it("singular", () => {
    const html = render({
      ...DASHBOARD,
      attention: { warning: 0, stale: 1 },
    });
    expect(section(html, "attention-heading")).toContain("1 requiere atención");
  });

  it("los otros indicadores nunca usan colores de estado", () => {
    const html = render();
    for (const label of [
      "Oportunidades activas",
      "Ganadas en el mes",
      "Win rate",
      "En stock",
      "Reservadas",
      "Vendidas en el mes",
    ]) {
      expect(kpi(html, label).edge).toBeUndefined();
      expect(kpi(html, label).valueClasses).not.toMatch(
        /text-(success|warning|danger)/,
      );
    }
  });
});

describe("oportunidades en riesgo", () => {
  it("cada una enlaza a su detalle, de la más vieja a la más reciente", () => {
    const list = section(render(), "at-risk-heading");

    const hrefs = [...list.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs).toEqual([
      `/opportunities/${id(1)}`,
      `/opportunities/${id(2)}`,
    ]);
    expect(list.indexOf("Lucía Ferreira")).toBeLessThan(
      list.indexOf("Óscar Brítez"),
    );
  });

  it("muestra contacto, iniciales, etapa y días sin actividad en rojo", () => {
    const list = section(render(), "at-risk-heading");

    expect(list).toContain(">LF</span>");
    expect(list).toContain(">Nueva</span>");
    expect(list).toContain(">En negociación</span>");
    expect(list).toMatch(
      /<span class="[^"]*text-danger[^"]*">30 días sin actividad<\/span>/,
    );
    expect(list).toContain("5 días sin actividad");
    // El total, junto al título.
    expect(list).toMatch(/Oportunidades en riesgo<\/h2><span[^>]*>2<\/span>/);
  });

  it("con más de las que lista, dice cuántas muestra y enlaza a la cola", () => {
    const items = Array.from({ length: 10 }, (_, i) => atRiskItem(i + 1));
    const list = section(
      render({ ...DASHBOARD, atRisk: { items, total: 12 } }),
      "at-risk-heading",
    );

    expect(list.match(/<li\b/g)).toHaveLength(10);
    expect(list).toContain("Mostrando 10 de 12.");
    expect(list).toContain('href="/opportunities"');
  });

  it("sin pie cuando la lista está completa", () => {
    const list = section(render(), "at-risk-heading");
    expect(list).not.toContain("Mostrando");
  });

  it("sin oportunidades en riesgo, lo dice", () => {
    const list = section(
      render({ ...DASHBOARD, atRisk: { items: [], total: 0 } }),
      "at-risk-heading",
    );
    expect(list).not.toContain("<ol");
    expect(list).toContain(
      "Ninguna oportunidad abierta lleva más de 5 días sin actividad del cliente.",
    );
  });
});

describe("HTML válido de las listas de definición", () => {
  it("cada grupo de la dl contiene solo su dt y sus dd", () => {
    const html = render();
    const groups = [...html.matchAll(/<dl class="[^"]*">(.*?)<\/dl>/g)].flatMap(
      (dl) => [...dl[1]!.matchAll(/<div class="[^"]*">(.*?)<\/div>/g)],
    );
    expect(groups).toHaveLength(8);
    for (const group of groups) {
      const children = [...group[1]!.matchAll(/<(\w+)[\s>][^]*?<\/\1>/g)].map(
        (child) => child[1],
      );
      expect(children).toEqual(["dt", "dd", "dd"]);
    }
  });
});

describe("tokens de diseño (DEC-013)", () => {
  it("sin colores fijos: solo clases de tokens", () => {
    const html = render();
    expect(html).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(html).not.toMatch(/rgb\(|hsl\(/);
    // El único estilo en línea es el ancho del medidor.
    expect([...html.matchAll(/style="([^"]*)"/g)].map((m) => m[1])).toEqual([
      "width:66.7%",
    ]);
  });
});

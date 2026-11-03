import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CockpitMetricsView } from "@/components/cockpit/metrics/metrics-view";
import {
  buildCockpitMetrics,
  type CockpitMetrics,
} from "@/domains/cockpit/metrics";
import {
  metricsPeriod,
  METRICS_TIME_ZONE,
  type MetricsPeriodKind,
} from "@/domains/cockpit/metrics-period";

/*
 * Métricas del salón (propuesta DEC-050), renderizadas en el servidor sin
 * DOM: el encabezado con el selector Cockpit · Métricas y el del período en
 * la URL, el aviso de un período ignorado, los cuatro bloques en su orden,
 * los números con formato es-PY y su alcance ("Hoy" o el período), "Sin
 * dato" sin base (DEC-005), las monedas por separado, los estados siempre
 * junto a su rótulo y el drill-down de cada número a la cola, el embudo, la
 * agenda o el catálogo.
 */

const DAY = 86_400;
/** 14:30 del martes 3 de noviembre de 2026 en Asunción. */
const NOW = new Date("2026-11-03T17:30:00Z");

function metrics(
  kind: MetricsPeriodKind = "30d",
  overrides: Partial<Parameters<typeof buildCockpitMetrics>[0]> = {},
): CockpitMetrics {
  return buildCockpitMetrics({
    period: metricsPeriod(kind, NOW, METRICS_TIME_ZONE),
    notice: null,
    now: NOW,
    opportunities: {
      byStage: { new: 14, qualifying: 9, negotiating: 6 },
      warning: 5,
      stale: 3,
    },
    closures: [
      { stage: "won", lossReason: null, count: 7, cycleSeconds: 7 * 18 * DAY },
      { stage: "lost", lossReason: "price", count: 4, cycleSeconds: 0 },
      { stage: "lost", lossReason: "ghosted", count: 3, cycleSeconds: 0 },
      { stage: "lost", lossReason: "competitor", count: 3, cycleSeconds: 0 },
    ],
    quotes: [
      { currency: "PYG", status: "sent", count: 3, amount: "1245000000.00" },
      { currency: "USD", status: "approved", count: 1, amount: "32990.50" },
      { currency: "USD", status: "sent", count: 4, amount: "211400.00" },
    ],
    testDrives: {
      completed: 12,
      noShow: 2,
      cancelled: 3,
      overdue: 2,
      upcoming: 3,
    },
    stock: [
      {
        status: "inPreparation",
        currency: null,
        units: 3,
        amount: null,
        ageSeconds: 18 * DAY,
      },
      {
        status: "available",
        currency: "USD",
        units: 18,
        amount: "812400.00",
        ageSeconds: 18 * 41 * DAY,
      },
      {
        status: "available",
        currency: null,
        units: 1,
        amount: null,
        ageSeconds: 12 * DAY,
      },
      {
        status: "reserved",
        currency: "USD",
        units: 4,
        amount: "198000.00",
        ageSeconds: 4 * 55 * DAY,
      },
      {
        status: "sold",
        currency: "USD",
        units: 9,
        amount: "402000.00",
        ageSeconds: 9 * 120 * DAY,
      },
    ],
    ...overrides,
  });
}

const EMPTY = metrics("7d", {
  opportunities: {
    byStage: { new: 0, qualifying: 0, negotiating: 0 },
    warning: 0,
    stale: 0,
  },
  closures: [],
  quotes: [],
  testDrives: {
    completed: 0,
    noShow: 0,
    cancelled: 0,
    overdue: 0,
    upcoming: 0,
  },
  stock: [],
});

function render(view: CockpitMetrics = metrics()): string {
  return renderToStaticMarkup(
    createElement(CockpitMetricsView, {
      title: "Métricas del salón",
      metrics: view,
    }),
  );
}

/** El texto visible, sin etiquetas ni espacios repetidos. */
function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** El HTML de un bloque por el id de su encabezado. */
function band(html: string, id: string): string {
  const start = html.indexOf(`aria-labelledby="${id}-heading"`);
  if (start === -1) throw new Error(`band ${id} not rendered`);
  return html.slice(start, html.indexOf("</section>", start));
}

/** El HTML de una tarjeta por su título (hasta la siguiente). */
function tile(html: string, title: string): string {
  const start = html.indexOf(`>${title}</h3>`);
  if (start === -1) throw new Error(`tile "${title}" not rendered`);
  const next = html.indexOf("</h3>", start + title.length + 6);
  return html.slice(start, next === -1 ? undefined : next);
}

/** Los enlaces de un fragmento: su etiqueta de apertura, su destino y su texto. */
function anchors(html: string) {
  return [...html.matchAll(/(<a\b[^>]*>)([\s\S]*?)<\/a>/g)].map(
    ([, tag = "", inner = ""]) => ({
      tag,
      href: /href="([^"]*)"/.exec(tag)?.[1] ?? "",
      label: text(inner),
    }),
  );
}

/** El enlace a `href` dentro de `html`. */
function link(html: string, href: string) {
  const found = anchors(html).find((anchor) => anchor.href === href);
  if (!found) throw new Error(`missing link ${href}`);
  return found;
}

/** El HTML de un `nav` por su nombre accesible. */
function nav(html: string, label: string): string {
  const start = html.indexOf(`<nav aria-label="${label}"`);
  if (start === -1) throw new Error(`nav ${label} not rendered`);
  return html.slice(start, html.indexOf("</nav>", start));
}

const HEADER_END = "</header>";

describe("encabezado: Cockpit · Métricas y el período en la URL", () => {
  it("un solo h1, el selector de vista con Métricas como página actual y el del período", () => {
    const html = render();
    const header = html.slice(0, html.indexOf(HEADER_END));
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(header).toContain(">Métricas del salón</h1>");
    const views = nav(header, "Vista del Cockpit");
    expect(link(views, "/cockpit")).toMatchObject({ label: "Cockpit" });
    expect(link(views, "/cockpit").tag).not.toContain("aria-current");
    expect(link(views, "/cockpit/metrics").label).toBe("Métricas");
    expect(link(views, "/cockpit/metrics").tag).toContain(
      'aria-current="page"',
    );
  });

  it("cada período es un enlace con su URL canónica; el elegido es la página actual", () => {
    const picker = nav(render(), "Período");
    expect(
      anchors(picker).map(({ href, label, tag }) => [
        href,
        label,
        /aria-label="([^"]*)"/.exec(tag)?.[1],
        tag.includes('aria-current="page"'),
      ]),
    ).toEqual([
      ["/cockpit/metrics?period=7d", "7 días", "Últimos 7 días", false],
      ["/cockpit/metrics", "30 días", "Últimos 30 días", true],
      ["/cockpit/metrics?period=90d", "90 días", "Últimos 90 días", false],
      ["/cockpit/metrics?period=all", "Todo", "Todo el historial", false],
    ]);
    // Con otro período elegido, ese es la página actual.
    const seven = anchors(nav(render(metrics("7d")), "Período"));
    expect(
      seven.filter(({ tag }) => tag.includes('aria-current="page"')),
    ).toMatchObject([{ href: "/cockpit/metrics?period=7d" }]);
  });

  it("el período elegido y la hora de la lectura", () => {
    const visible = text(render().slice(0, render().indexOf(HEADER_END)));
    expect(visible).toContain(
      "Últimos 30 días: 5 oct – 3 nov 2026 Actualizado 14:30",
    );
    const all = text(render(metrics("all")));
    expect(all).toContain("Todo el historial: hasta el 3 nov 2026");
  });

  it("un período ignorado se anuncia con el tono de advertencia junto al texto", () => {
    const html = render({
      ...metrics(),
      notice:
        "El período pedido no es válido. Se muestran los últimos 30 días.",
    });
    expect(html).toMatch(
      /<p role="status" class="[^"]*bg-warning-soft[^"]*">El período pedido no es válido. Se muestran los últimos 30 días.<\/p>/,
    );
    expect(render()).not.toContain('role="status"');
  });
});

describe("estructura: cuatro bloques en orden de lectura", () => {
  it("embudo, valor comercial, pulso operativo y stock, cada uno con su h2", () => {
    const html = render();
    const ids = [
      ["metrics-funnel", "Embudo y conversión"],
      ["metrics-value", "Valor comercial"],
      ["metrics-pulse", "Pulso operativo"],
      ["metrics-stock", "Salud del stock"],
    ] as const;
    for (const [id, title] of ids) {
      expect(band(html, id)).toContain(`<h2 id="${id}-heading"`);
      expect(band(html, id)).toContain(`>${title}</h2>`);
    }
    const positions = ids.map(([id]) => html.indexOf(`id="${id}-heading"`));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("cada número dice a qué tiempo responde: Hoy o el período", () => {
    const html = render();
    for (const title of [
      "Embudo abierto",
      "En juego en guaraníes",
      "Requieren intervención",
      "Distribución del inventario",
      "Valor del stock publicado",
      "Antigüedad promedio",
    ]) {
      expect(tile(html, title)).toContain(">Hoy</span>");
    }
    for (const title of [
      "Tasa de conversión",
      "Ciclo de venta",
      "Motivos de pérdida",
      "Realización de pruebas de manejo",
    ]) {
      expect(tile(html, title)).toContain(
        '<span class="sr-only">Últimos 30 días</span><span aria-hidden="true">30 días</span>',
      );
    }
  });

  it("las barras son figuras: decorativas, con el número escrito al lado", () => {
    const html = render();
    const bars = html.match(
      /<span aria-hidden="true" class="(block|flex) h-2 /g,
    );
    expect(bars?.length).toBeGreaterThan(8);
    expect(html).not.toMatch(/<canvas|<svg[^>]*role="img"/);
  });
});

describe("embudo y conversión", () => {
  it("las abiertas por etapa, con su parte y el enlace a su columna del embudo", () => {
    const html = band(render(), "metrics-funnel");
    const visible = text(tile(html, "Embudo abierto"));
    expect(visible).toContain("29 oportunidades abiertas");
    expect(visible).toContain("Nueva 14 · 48,3%");
    expect(visible).toContain("En calificación 9 · 31%");
    expect(visible).toContain("En negociación 6 · 20,7%");
    for (const [stage, label] of [
      ["new", "Nueva"],
      ["qualifying", "En calificación"],
      ["negotiating", "En negociación"],
    ] as const) {
      expect(
        link(html, `/opportunities/pipeline#pipeline-column-${stage}`).label,
      ).toBe(label);
    }
    expect(link(html, "/opportunities/pipeline").label).toBe("Ver embudo");
  });

  it("la tasa de conversión, el ciclo de venta y los motivos del período", () => {
    const html = band(render(), "metrics-funnel");
    expect(text(tile(html, "Tasa de conversión"))).toContain(
      "41,2% 7 ventas de 17 cierres (ganadas y perdidas)",
    );
    expect(text(tile(html, "Ciclo de venta"))).toContain(
      "18 días Promedio de 7 ventas, del alta de la oportunidad al cierre.",
    );
    const reasons = text(tile(html, "Motivos de pérdida"));
    expect(reasons).toContain("10 oportunidades perdidas");
    // A igual cantidad, en el orden de la lista (DEC-034 §2).
    expect(reasons).toContain(
      "Precio 4 · 40% Compró en la competencia 3 · 30% Dejó de responder 3 · 30%",
    );
  });

  it("sin cierres ni ventas: sin dato atenuado, nunca 0 %; sin pérdidas lo dice", () => {
    const html = band(render(EMPTY), "metrics-funnel");
    expect(tile(html, "Tasa de conversión")).toMatch(
      /<p class="text-display tabular-nums text-text-muted">Sin dato<\/p>/,
    );
    expect(text(tile(html, "Tasa de conversión"))).toContain(
      "Sin cierres en el período: todavía no hay tasa.",
    );
    expect(text(tile(html, "Ciclo de venta"))).toContain(
      "Sin dato Sin ventas en el período.",
    );
    expect(text(tile(html, "Motivos de pérdida"))).toContain(
      "Sin pérdidas en el período",
    );
  });
});

describe("valor comercial: una tarjeta por moneda, sin mezclar", () => {
  it("el monto exacto de cada moneda, su partición y sus cotizaciones", () => {
    const html = band(render(), "metrics-value");
    const pyg = text(tile(html, "En juego en guaraníes"));
    expect(pyg).toContain("Gs. 1.245.000.000 3 cotizaciones");
    expect(pyg).toContain(
      "Enviadas · esperando respuesta Gs. 1.245.000.000 · 3 cotizaciones · 100%",
    );
    const usd = text(tile(html, "En juego en dólares"));
    expect(usd).toContain("USD 244.390,50 5 cotizaciones");
    expect(usd).toContain(
      "Aprobadas · por enviar USD 32.990,50 · 1 cotización · 13,5%",
    );
    expect(usd).toContain(
      "Enviadas · esperando respuesta USD 211.400 · 4 cotizaciones · 86,5%",
    );
    expect(
      link(html, "/opportunities/pipeline#pipeline-column-negotiating").label,
    ).toBe("Ver negociaciones");
  });

  it("una moneda sin cotizaciones en juego se ve en cero, atenuada y sin barra", () => {
    const html = band(render(EMPTY), "metrics-value");
    expect(text(tile(html, "En juego en dólares"))).toContain(
      "USD 0 Ninguna cotización en juego",
    );
    expect(html).not.toContain('class="flex h-2 ');
  });
});

describe("pulso operativo", () => {
  it("la tasa de realización con su base, la leyenda de resultados y la agenda", () => {
    const html = band(render(), "metrics-pulse");
    const visible = text(tile(html, "Realización de pruebas de manejo"));
    expect(visible).toContain("63,2% 12 realizadas de 19 pruebas");
    expect(visible).toContain(
      "Realizadas 12 No asistió 2 Canceladas 3 Vencidas sin resultado 2",
    );
    expect(visible).toContain(
      "3 pruebas todavía en horario hoy: no cuentan en la tasa.",
    );
    expect(link(html, "/calendar").label).toBe("Ver agenda");
  });

  it("las que requieren intervención, con las inactivas destacadas y la cola", () => {
    const html = band(render(), "metrics-pulse");
    const visible = text(tile(html, "Requieren intervención"));
    expect(visible).toContain("8 3 inactivas de 29 oportunidades abiertas");
    expect(visible).toContain("Activas 21 Enfriándose 5 Inactivas 3");
    expect(tile(html, "Requieren intervención")).toContain("bg-danger-soft");
    expect(link(html, "/opportunities").label).toBe("Ver cola");
  });

  it("sin pruebas que se debían, la tasa es sin dato", () => {
    const html = band(render(EMPTY), "metrics-pulse");
    expect(text(tile(html, "Realización de pruebas de manejo"))).toContain(
      "Sin dato Ninguna prueba con su horario cumplido en el período.",
    );
    expect(tile(html, "Requieren intervención")).not.toContain(
      "bg-danger-soft",
    );
  });
});

describe("salud del stock", () => {
  it("la distribución por estado de Stock, con el drill-down al catálogo filtrado", () => {
    const html = band(render(), "metrics-stock");
    const visible = text(tile(html, "Distribución del inventario"));
    expect(visible).toContain("35 unidades en total");
    expect(visible).toContain(
      "En preparación 3 · 8,6% Disponibles 19 · 54,3% Reservadas 4 · 11,4% Vendidas 9 · 25,7%",
    );
    const distribution = tile(html, "Distribución del inventario");
    expect(
      anchors(distribution).map(({ href, label }) => [label, href]),
    ).toEqual([
      // El catálogo no muestra las que están en preparación (DEC-049 §2).
      ["En preparación", "/stock"],
      ["Disponibles", "/stock/catalog"],
      ["Reservadas", "/stock/catalog?status=reserved"],
      ["Vendidas", "/stock/catalog?status=sold"],
    ]);
    expect(
      anchors(html).find(({ label }) => label === "Ver catálogo")?.href,
    ).toBe("/stock/catalog");
  });

  it("el valor del stock publicado por moneda y lo que no suma", () => {
    const visible = text(
      tile(band(render(), "metrics-stock"), "Valor del stock publicado"),
    );
    expect(visible).toContain("Gs. 0 Ninguna unidad con precio en esta moneda");
    expect(visible).toContain("USD 1.010.400 22 unidades con precio publicado");
    expect(visible).toContain(
      "1 unidad sin precio publicado: no suma. Disponibles y reservadas; cada moneda por separado.",
    );
  });

  it("la antigüedad promedio de las publicadas, desde su ingreso a Porandú", () => {
    // (18 × 41 + 12 + 4 × 55) días / 23 unidades = 42,17 → 42 días.
    expect(
      text(tile(band(render(), "metrics-stock"), "Antigüedad promedio")),
    ).toContain(
      "42 días De 23 unidades disponibles o reservadas, desde su ingreso a Porandú.",
    );
  });

  it("sin unidades: ceros y sin dato, sin barras", () => {
    const html = band(render(EMPTY), "metrics-stock");
    expect(text(tile(html, "Distribución del inventario"))).toContain(
      "0 Sin unidades cargadas",
    );
    expect(text(tile(html, "Valor del stock publicado"))).toContain(
      "Sin unidades disponibles ni reservadas.",
    );
    expect(text(tile(html, "Antigüedad promedio"))).toContain("Sin dato");
  });
});

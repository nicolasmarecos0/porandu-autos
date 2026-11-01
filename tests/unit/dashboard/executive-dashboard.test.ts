import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ExecutiveDashboardView } from "@/components/dashboard/executive-dashboard";
import type {
  AtRiskOpportunity,
  ExecutiveDashboard,
} from "@/domains/dashboard/metrics";

/*
 * Dashboard Directivo de /intelligence (Hito 5, DEC-037 §12; DEC-043 §9),
 * renderizado en el servidor sin DOM: el encabezado con el rango y su
 * selector, el aviso de un rango ignorado, la fila de cuatro KPIs con su
 * alcance, los tres bloques de indicadores en su grilla, los valores con
 * formato es-PY, "Sin dato" sin cierres (DEC-005), los tonos de estado
 * junto a su texto y la lista de oportunidades en riesgo con enlace al
 * detalle.
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
  range: {
    kind: "month",
    from: "2026-10-01",
    to: "2026-10-31",
    days: 31,
    label: "Mes en curso: octubre de 2026",
    isDefault: true,
  },
  notice: null,
  today: "2026-10-14",
  conversion: { won: 2, lost: 1, closed: 3, rate: 66.7 },
  pendingQuotes: {
    total: 6,
    awaitingApproval: 2,
    readyToSend: 1,
    awaitingResponse: 3,
    expired: 1,
  },
  weekTestDrives: {
    weekKey: "2026-10-12",
    weekLabel: "12 – 18 oct 2026",
    scheduled: 4,
    pending: 2,
    completed: 1,
    noShow: 1,
    cancelled: 1,
  },
  pipeline: { open: 1234 },
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
const text = (html: string) => html.replace(/<[^>]+>/g, "");

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

/** Una tarjeta de los bloques por su rótulo. */
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
    hint: text(match[4]!),
  };
}

type Headline = {
  valueClasses: string;
  value: string;
  /** HTML del contexto. */
  context: string;
  /** HTML del alcance, al pie. */
  scope: string;
};

/** Una tarjeta de la fila de KPIs por su rótulo (el dt lleva el ícono). */
function headline(html: string, label: string): Headline {
  const match = new RegExp(
    `<div class="[^"]*"><dt class="[^"]*"><span aria-hidden="true"[^>]*><svg[^]*?</svg></span>${escape(label)}</dt><dd class="([^"]*)">([^<]*)</dd><dd class="[^"]*">(.*?)</dd><dd class="[^"]*">(.*?)</dd></div>`,
  ).exec(html);
  if (!match) throw new Error(`headline kpi "${label}" not rendered`);
  return {
    valueClasses: match[1]!,
    value: match[2]!,
    context: match[3]!,
    scope: match[4]!,
  };
}

const HEADER_END = "</header>";

describe("ExecutiveDashboardView: estructura", () => {
  it("encabezado con un solo h1, el rango elegido y su selector", () => {
    const html = render();
    const header = html.slice(0, html.indexOf(HEADER_END));
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(header).toContain(">Inteligencia</h1>");
    expect(header).toContain("Dashboard directivo");
    expect(header).toMatch(
      /<p aria-live="polite"[^>]*>.*<span[^>]*>Mes en curso: octubre de 2026<\/span><\/p>/,
    );
    expect(header).toContain('<nav aria-label="Rango de fechas"');
  });

  it("la fila de KPIs y los tres bloques, cada uno con su grilla de tarjetas", () => {
    const html = render();
    for (const [headingId, title, columns] of [
      ["kpis-heading", "Indicadores clave", "sm:grid-cols-2 xl:grid-cols-4"],
      ["pipeline-heading", "Pipeline comercial", "sm:grid-cols-2"],
      ["inventory-heading", "Salud del inventario", "sm:grid-cols-3"],
      ["attention-heading", "Atención", "sm:grid-cols-2"],
    ] as const) {
      const block = section(html, headingId);
      expect(block).toContain(`<h2 id="${headingId}"`);
      expect(block).toContain(`>${title}</h2>`);
      expect(block).toMatch(
        new RegExp(`<dl class="grid [^"]*${escape(columns)}"`),
      );
    }
    // El rail contextual lleva la lista en riesgo.
    expect(html).toMatch(
      /<aside aria-label="Panel contextual"[^>]*><section aria-labelledby="at-risk-heading"/,
    );
  });

  it("el orden de lectura: KPIs, pipeline, inventario, atención y después el riesgo", () => {
    const html = render();
    const positions = [
      "kpis-heading",
      "pipeline-heading",
      "inventory-heading",
      "attention-heading",
      "at-risk-heading",
    ].map((headingId) => html.indexOf(`id="${headingId}"`));
    expect(positions.every((position) => position > 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });
});

describe("aviso de un rango ignorado (DEC-043 §2)", () => {
  it("se anuncia sobre los KPIs, con el tono de advertencia junto al texto", () => {
    const notice = "El rango pedido no es válido. Se muestra el mes en curso.";
    const html = render({ ...DASHBOARD, notice });

    expect(html).toContain(
      `<p role="status" class="rounded-lg border border-warning-border bg-warning-soft px-4 py-2.5 text-label text-warning">${notice}</p>`,
    );
    expect(html.indexOf(notice)).toBeLessThan(
      html.indexOf('id="kpis-heading"'),
    );
  });

  it("sin aviso no hay mensaje de estado", () => {
    expect(render()).not.toContain('role="status"');
  });
});

describe("fila de KPIs (DEC-043 §9)", () => {
  it("ventas cerradas del rango", () => {
    const tile = headline(section(render(), "kpis-heading"), "Ventas cerradas");
    expect(tile.value).toBe("2");
    expect(text(tile.context)).toBe(
      "Oportunidades ganadas con cierre en el rango",
    );
    expect(text(tile.scope)).toBe("En el rango elegido");
  });

  it("tasa de conversión con su medidor y su base", () => {
    const tile = headline(
      section(render(), "kpis-heading"),
      "Tasa de conversión",
    );
    expect(tile.value).toBe("66,7%");
    expect(tile.valueClasses).toContain("text-text-primary");
    expect(text(tile.context)).toBe("2 ventas de 3 cierres");
    // El medidor: decorativo, de la rampa de marca, con el ancho del valor.
    expect(tile.context).toContain(
      '<span aria-hidden="true" class="block h-1.5 w-full overflow-hidden rounded-full bg-brand-soft"><span class="block h-full rounded-full bg-brand" style="width:66.7%"></span></span>',
    );
    expect(text(tile.scope)).toBe("En el rango elegido");
  });

  it("cotizaciones pendientes con el desglose y las vencidas aparte, en advertencia", () => {
    const tile = headline(
      section(render(), "kpis-heading"),
      "Cotizaciones pendientes",
    );
    expect(tile.value).toBe("6");
    expect(tile.context).toContain(
      "<span>2 por aprobar · 1 por enviar · 3 esperando respuesta</span>",
    );
    expect(tile.context).toMatch(
      /<span class="[^"]*border-warning-border bg-warning-soft text-warning[^"]*">1 vencida sin cerrar<\/span>/,
    );
    expect(text(tile.scope)).toBe("Estado de hoy");
  });

  it("sin vencidas no hay advertencia", () => {
    const tile = headline(
      section(
        render({
          ...DASHBOARD,
          pendingQuotes: { ...DASHBOARD.pendingQuotes, expired: 0 },
        }),
        "kpis-heading",
      ),
      "Cotizaciones pendientes",
    );
    expect(tile.context).not.toContain("vencida");
    expect(tile.context).not.toContain("text-warning");
  });

  it("varias vencidas, en plural", () => {
    const tile = headline(
      section(
        render({
          ...DASHBOARD,
          pendingQuotes: { ...DASHBOARD.pendingQuotes, expired: 4 },
        }),
        "kpis-heading",
      ),
      "Cotizaciones pendientes",
    );
    expect(tile.context).toContain(">4 vencidas sin cerrar</span>");
  });

  it("test drives de la semana con el desglose, las canceladas aparte y el enlace a esa semana de la agenda", () => {
    const tile = headline(
      section(render(), "kpis-heading"),
      "Test drives de la semana",
    );
    expect(tile.value).toBe("4");
    expect(tile.context).toContain(
      "<span>2 por realizar · 1 realizada · 1 no asistió</span>",
    );
    expect(tile.context).toContain(
      "<span>1 cancelada fuera de la agenda</span>",
    );
    expect(tile.scope).toContain("12 – 18 oct 2026");
    expect(tile.scope).toMatch(
      /<a [^>]*href="\/calendar\?w=2026-10-12">Ver agenda/,
    );
  });

  it("sin canceladas no se mencionan", () => {
    const tile = headline(
      section(
        render({
          ...DASHBOARD,
          weekTestDrives: { ...DASHBOARD.weekTestDrives, cancelled: 0 },
        }),
        "kpis-heading",
      ),
      "Test drives de la semana",
    );
    expect(tile.context).not.toContain("cancelada");
  });

  it("los valores usan cifras tabulares y la tipografía destacada", () => {
    const html = section(render(), "kpis-heading");
    for (const label of [
      "Ventas cerradas",
      "Tasa de conversión",
      "Cotizaciones pendientes",
      "Test drives de la semana",
    ]) {
      expect(headline(html, label).valueClasses).toContain("text-display");
      expect(headline(html, label).valueClasses).toContain("tabular-nums");
    }
  });
});

describe("tasa de conversión sin cierres (DEC-005)", () => {
  const html = render({
    ...DASHBOARD,
    conversion: { won: 0, lost: 0, closed: 0, rate: null },
  });
  const tile = headline(section(html, "kpis-heading"), "Tasa de conversión");

  it("dice Sin dato, atenuado, y explica por qué", () => {
    expect(tile.value).toBe("Sin dato");
    expect(tile.valueClasses).toContain("text-text-muted");
    expect(text(tile.context)).toBe("Sin dato: no hubo cierres en el rango");
  });

  it("no dibuja un 0 % inventado ni el medidor", () => {
    expect(html).not.toContain("0%");
    expect(html).not.toContain('style="width:');
  });

  it("con cierres y ninguna venta sí es 0 %, con el medidor vacío", () => {
    const zero = render({
      ...DASHBOARD,
      conversion: { won: 0, lost: 2, closed: 2, rate: 0 },
    });
    const zeroTile = headline(
      section(zero, "kpis-heading"),
      "Tasa de conversión",
    );
    expect(zeroTile.value).toBe("0%");
    expect(zeroTile.valueClasses).not.toContain("text-text-muted");
    expect(text(zeroTile.context)).toBe("0 ventas de 2 cierres");
    expect(zero).toContain('style="width:0%"');
  });
});

describe("bloques con formato es-PY", () => {
  it("pipeline: activas de hoy con separador de miles y perdidas del rango", () => {
    const html = section(render(), "pipeline-heading");

    expect(kpi(html, "Oportunidades activas")).toMatchObject({
      value: "1.234",
      hint: "Nuevas, en calificación y en negociación, hoy",
    });
    expect(kpi(html, "Perdidas")).toMatchObject({
      value: "1",
      hint: "Cerradas sin venta en el rango",
    });
  });

  it("un número, un nombre: las ventas y la tasa solo están en la fila de KPIs", () => {
    const html = render();
    for (const headingId of [
      "pipeline-heading",
      "inventory-heading",
      "attention-heading",
    ]) {
      const block = section(html, headingId);
      expect(block).not.toContain("Win rate");
      expect(block).not.toContain("Ganadas");
      expect(block).not.toContain("Tasa de conversión");
    }
  });

  it("inventario: en stock y reservadas de hoy, vendidas en el rango", () => {
    const html = section(render(), "inventory-heading");

    expect(kpi(html, "En stock")).toMatchObject({
      value: "18",
      hint: "Unidades sin reserva ni venta, hoy",
    });
    expect(kpi(html, "Reservadas")).toMatchObject({
      value: "3",
      hint: "Vinculadas a una oportunidad en negociación, hoy",
    });
    expect(kpi(html, "Vendidas en el rango")).toMatchObject({
      value: "2",
      hint: "Unidades de las ventas cerradas en el rango",
    });
  });

  it("los valores usan cifras tabulares y la tipografía de métricas", () => {
    const html = render();
    for (const label of ["Oportunidades activas", "En stock", "Inactivas"]) {
      expect(kpi(html, label).valueClasses).toContain("text-metric");
      expect(kpi(html, label).valueClasses).toContain("tabular-nums");
    }
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
      "Perdidas",
      "En stock",
      "Reservadas",
      "Vendidas en el rango",
    ]) {
      expect(kpi(html, label).edge).toBeUndefined();
      expect(kpi(html, label).valueClasses).not.toMatch(
        /text-(success|warning|danger)/,
      );
    }
    const row = section(html, "kpis-heading");
    for (const label of [
      "Ventas cerradas",
      "Tasa de conversión",
      "Cotizaciones pendientes",
      "Test drives de la semana",
    ]) {
      expect(headline(row, label).valueClasses).not.toMatch(
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
    // El total del encabezado es el de todas las Inactivas, no el de la lista.
    expect(list).toMatch(/Oportunidades en riesgo<\/h2><span[^>]*>12<\/span>/);
    // Dentro de la frase, el enlace se distingue también por el subrayado,
    // siempre y no solo al pasar el mouse.
    const queueLink = /<a class="([^"]*)" href="\/opportunities">/.exec(list);
    expect(queueLink?.[1]?.split(" ")).toContain("underline");
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
    const groups = [...html.matchAll(/<dl class="[^"]*">(.*?)<\/dl>/g)].map(
      (dl) => dl[1]!,
    );
    // Fila de KPIs, pipeline, inventario y atención.
    expect(groups).toHaveLength(4);
    const children = groups.flatMap((dl) =>
      [...dl.matchAll(/<div class="[^"]*">(.*?)<\/div>/g)].map((group) =>
        [...group[1]!.matchAll(/<(\w+)[\s>][^]*?<\/\1>/g)].map(
          (child) => child[1],
        ),
      ),
    );
    expect(children).toEqual([
      ...Array.from({ length: 4 }, () => ["dt", "dd", "dd", "dd"]),
      ...Array.from({ length: 7 }, () => ["dt", "dd", "dd"]),
    ]);
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

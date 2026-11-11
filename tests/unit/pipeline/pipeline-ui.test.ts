import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { OpportunitiesViewSwitch } from "@/components/opportunities/opportunities-view-switch";
import { PipelineView } from "@/components/pipeline/pipeline-view";
import {
  pipelineBoard,
  pipelineWindow,
  type PipelineRow,
} from "@/domains/opportunities/pipeline";
import type { Stage } from "@/domains/opportunities/stages";

import { human, id as factId } from "../support/demand-rows";

/*
 * Embudo de ventas (propuesta DEC-048), renderizado en el servidor sin DOM:
 * el encabezado con el selector de vista, la tira de etapas, las cinco
 * columnas con sus cantidades, cada tarjeta (enlace al workspace, lo que
 * busca o la unidad, score, inactividad, acción pendiente y "Cambiar
 * etapa"), las cerradas con su cierre y sin pases, los estados vacíos y el
 * aviso como región viva. El arrastre, el estado optimista y las
 * confirmaciones corren en el navegador; sus reglas se prueban en
 * tests/unit/domains/opportunities/pipeline-moves.test.ts y las Server
 * Actions en tests/unit/opportunities/.
 */

vi.mock("@/lib/opportunities/actions", () => ({
  changeOpportunityStage: vi.fn(),
  closeOpportunity: vi.fn(),
  createOpportunity: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

// Miércoles 4 de noviembre de 2026, 10:00 en Asunción (UTC-3).
const NOW = new Date("2026-11-04T13:00:00Z");
const DAY = 24 * 60;

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const minutesAgo = (minutes: number) =>
  new Date(NOW.getTime() - minutes * 60_000);

function row(
  n: number,
  stage: Stage,
  name: string,
  overrides: Partial<PipelineRow> = {},
): PipelineRow {
  return {
    id: id(n),
    stage,
    contactName: name,
    interestModel: null,
    interestVersion: null,
    lastActivityAt: minutesAgo(30),
    updatedAt: minutesAgo(30),
    lossReason: null,
    vehicle: null,
    ...overrides,
  };
}

const HILUX = {
  id: id(900),
  brand: "Toyota",
  model: "Hilux",
  version: "SRV 2.8 4x4 AT",
  year: 2025,
  status: "available" as const,
};

const BOARD = pipelineBoard(
  {
    open: [
      row(1, "new", "María González", {
        lastActivityAt: minutesAgo(6 * DAY),
      }),
      row(2, "qualifying", "Ramón Benítez"),
      row(3, "negotiating", "Fátima Giménez", { vehicle: HILUX }),
    ],
    won: {
      rows: [
        row(4, "won", "Óscar Brítez", {
          vehicle: HILUX,
          updatedAt: minutesAgo(60),
        }),
      ],
      total: 3,
    },
    lost: { rows: [], total: 0 },
    demand: new Map([
      [
        id(1),
        [
          human(factId("h1"), "desired_vehicle", "confirmed", {
            brand: "Toyota",
            model: "Hilux",
          }),
          human(factId("h2"), "year_range", "confirmed", {
            min: 2022,
            max: 2024,
          }),
        ],
      ],
    ]),
    stock: [],
    lastNotes: new Map(),
    quotes: new Map([
      [id(2), { toApprove: 1, latestDraftId: id(50), accepted: null }],
    ]),
    testDrives: new Map(),
    tradeIns: new Map(),
  },
  pipelineWindow(NOW),
);

const html = renderToStaticMarkup(
  createElement(PipelineView, { title: "Embudo de ventas", board: BOARD }),
);

/** Texto visible de un fragmento, sin etiquetas. */
const text = (fragment: string) =>
  fragment
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** La etiqueta de apertura del enlace a `href` (Link deja `href` al final). */
function anchorTag(markup: string, href: string): string {
  const tag = [...markup.matchAll(/<a\b[^>]*>/g)]
    .map((match) => match[0])
    .find((candidate) => candidate.includes(`href="${href}"`));
  if (!tag) throw new Error(`missing link ${href}`);
  return tag;
}

/** La sección de la columna de `stage`. */
function column(stage: Stage): string {
  const match = html.match(
    new RegExp(
      `<section[^>]*id="pipeline-column-${stage}"[\\s\\S]*?</section>`,
    ),
  );
  if (!match) throw new Error(`missing column ${stage}`);
  return match[0];
}

/** El artículo de la tarjeta de la oportunidad `n`. */
function card(n: number): string {
  const match = html.match(
    new RegExp(
      `<article[^>]*aria-labelledby="pipeline-card-${id(n)}"[\\s\\S]*?</article>`,
    ),
  );
  if (!match) throw new Error(`missing card ${n}`);
  return match[0];
}

describe("PipelineView", () => {
  it("encabezado: título, selector de vista y lectura rápida", () => {
    expect(html).toContain(
      '<h1 class="text-title text-text-primary">Embudo de ventas</h1>',
    );
    expect(anchorTag(html, "/opportunities/pipeline")).toContain(
      'aria-current="page"',
    );
    expect(text(html)).toContain("3 abiertas");
    expect(text(html)).toContain("1 inactiva");
    // La cotización por aprobar; la negociación ya tiene su unidad.
    expect(text(html)).toContain("1 con acciones pendientes");
    expect(html).toContain(
      '<time dateTime="2026-11-04T13:00:00.000Z">10:00</time>',
    );
    expect(text(html)).toContain("Nueva oportunidad");
  });

  it("cinco columnas en el orden del flujo, con su cantidad", () => {
    const headings = [...html.matchAll(/<h2[^>]*>([^<]*)<\/h2>/g)].map(
      (match) => match[1],
    );
    expect(headings).toEqual([
      "Nueva",
      "En calificación",
      "En negociación",
      "Ganada",
      "Perdida",
    ]);
    expect(text(column("new"))).toContain("Nueva 1 oportunidad");
    expect(text(column("won"))).toContain("Ganada 3 oportunidades");
    expect(text(column("new"))).toContain("1 inactiva");
  });

  it("la tira de etapas lleva a cada columna, con su cantidad", () => {
    const nav = html.match(
      /<nav aria-label="Etapas del embudo"[\s\S]*?<\/nav>/,
    )?.[0];
    expect(nav).toBeDefined();
    expect(nav).toContain('aria-controls="pipeline-column-qualifying"');
    expect(text(nav!)).toBe(
      "Nueva 1 En calificación 1 En negociación 1 Ganada 3 Perdida 0",
    );
  });

  it("tarjeta abierta: nombre al workspace, lo que busca, score, inactividad y Cambiar etapa", () => {
    const html1 = card(1);
    expect(html1).toMatch(
      new RegExp(
        `<a[^>]*href="/opportunities/${id(1)}"[^>]*>María González</a>`,
      ),
    );
    expect(text(html1)).toContain("Busca: Toyota Hilux · 2022 a 2024");
    // Nueva, inactiva: 20 − 40 → 0.
    expect(text(html1)).toContain("Porandú Score 0");
    expect(text(html1)).toContain("Inactiva · 6 d");
    expect(html1).toContain('aria-label="Cambiar la etapa de María González"');
  });

  it("una acción pendiente es un enlace adonde se resuelve", () => {
    const html2 = card(2);
    expect(
      anchorTag(html2, `/opportunities/${id(2)}/quotes/${id(50)}`),
    ).toContain(
      'title="Falta la aprobación humana antes de entregarla al cliente."',
    );
    expect(text(html2)).toContain("Cotización por aprobar");
  });

  it("en negociación con unidad: la unidad es la primera línea", () => {
    expect(text(card(3))).toContain(
      "Unidad: Toyota Hilux · SRV 2.8 4x4 AT · 2025",
    );
  });

  it("cerrada: su cierre con fecha y sin «Cambiar etapa»", () => {
    const html4 = card(4);
    expect(text(html4)).toContain("Ganada · hoy");
    expect(html4).toContain(
      `<time dateTime="${minutesAgo(60).toISOString()}">hoy</time>`,
    );
    expect(html4).not.toContain("Cambiar la etapa");
    expect(html4).not.toContain("Porandú Score");
  });

  it("estados vacíos y tope: dice cuántas no muestra", () => {
    expect(text(column("lost"))).toContain(
      "Sin cierres en los últimos 30 días",
    );
    expect(text(column("won"))).toContain(
      "Se muestran 1 de 3: las más recientes.",
    );
  });

  it("el aviso es una región viva, vacía al empezar", () => {
    expect(html).toMatch(/<div[^>]*role="status"[^>]*><\/div>/);
  });
});

describe("OpportunitiesViewSwitch", () => {
  it("dos enlaces, Cola y Embudo, con la vista actual marcada", () => {
    const markup = renderToStaticMarkup(
      createElement(OpportunitiesViewSwitch, { current: "queue" }),
    );
    expect(markup).toContain('aria-label="Vista de oportunidades"');
    expect(anchorTag(markup, "/opportunities")).toContain(
      'aria-current="page"',
    );
    expect(anchorTag(markup, "/opportunities/pipeline")).not.toContain(
      "aria-current",
    );
    expect(text(markup)).toBe("Cola Embudo");
  });
});

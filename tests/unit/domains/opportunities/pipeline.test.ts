import { describe, expect, it } from "vitest";

import { cockpitWindow } from "@/domains/cockpit/window";
import type { MatchableVehicle } from "@/domains/match/types";
import {
  CLOSED_COLUMN_LIMIT,
  CLOSED_WINDOW_DAYS,
  closedWhen,
  elapsedShort,
  OPEN_COLUMN_LIMIT,
  pipelineBoard,
  pipelineWindow,
  type PipelineCard,
  type PipelineRow,
  type PipelineSource,
} from "@/domains/opportunities/pipeline";
import type { Stage } from "@/domains/opportunities/stages";

import { human, id as factId } from "../../support/demand-rows";

/*
 * Tablero de oportunidades (embudo de ventas, propuesta DEC-048), puro: la
 * ventana, las cinco columnas con su orden y sus conteos, cada tarjeta
 * (primera línea, inactividad, acciones pendientes y cierre) y los topes.
 * Las reglas de movimiento y el reductor optimista se prueban en
 * pipeline-moves.test.ts; las lecturas, contra PostgreSQL, en
 * tests/db/pipeline.test.ts.
 */

// Miércoles 4 de noviembre de 2026, 10:00 en Asunción (UTC-3).
const NOW = new Date("2026-11-04T13:00:00Z");
const WINDOW = pipelineWindow(NOW);
const MINUTES_PER_DAY = 24 * 60;

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const minutesAgo = (minutes: number) =>
  new Date(NOW.getTime() - minutes * 60_000);

function row(
  n: number,
  stage: Stage,
  overrides: Partial<PipelineRow> = {},
): PipelineRow {
  return {
    id: id(n),
    stage,
    contactName: `Cliente ${n}`,
    interestModel: null,
    interestVersion: null,
    lastActivityAt: minutesAgo(30),
    updatedAt: minutesAgo(30),
    lossReason: null,
    vehicle: null,
    ...overrides,
  };
}

function source(overrides: Partial<PipelineSource> = {}): PipelineSource {
  return {
    open: [],
    won: { rows: [], total: 0 },
    lost: { rows: [], total: 0 },
    demand: new Map(),
    stock: [],
    lastNotes: new Map(),
    quotes: new Map(),
    testDrives: new Map(),
    ...overrides,
  };
}

const HILUX = {
  id: id(900),
  brand: "Toyota",
  model: "Hilux",
  version: "SRV 2.8 4x4 AT",
  year: 2025,
  status: "available",
} as const;

function board(overrides: Partial<PipelineSource> = {}) {
  return pipelineBoard(source(overrides), WINDOW);
}

function column(stage: Stage, overrides: Partial<PipelineSource> = {}) {
  const found = board(overrides).columns.find((item) => item.stage === stage);
  if (!found) throw new Error(`missing column ${stage}`);
  return found;
}

function card(stage: Stage, target: PipelineRow, extra = {}): PipelineCard {
  const open = stage === "won" || stage === "lost" ? [] : [target];
  const closed =
    stage === "won" || stage === "lost"
      ? { [stage]: { rows: [target], total: 1 } }
      : {};
  const found = column(stage, { open, ...closed, ...extra }).cards[0];
  if (!found) throw new Error("missing card");
  return found;
}

describe("pipelineWindow", () => {
  it("cerradas: hoy y los 29 días anteriores de Asunción, desde el primer instante", () => {
    expect(WINDOW.today).toBe("2026-11-04");
    // 6 de octubre, 00:00 en Asunción.
    expect(WINDOW.closedFrom.toISOString()).toBe("2026-10-06T03:00:00.000Z");
    expect(CLOSED_WINDOW_DAYS).toBe(30);
  });

  it("pruebas vencidas: la misma ventana que el Cockpit (DEC-047 §3.3)", () => {
    const cockpit = cockpitWindow(NOW);
    expect(WINDOW.overdueFrom).toEqual(cockpit.recentFrom);
    expect(WINDOW.overdueUntil).toEqual(cockpit.upcomingFrom);
  });
});

describe("pipelineBoard: columnas", () => {
  it("cinco columnas en el orden del flujo, con su copy", () => {
    const { columns } = board();
    expect(columns.map((item) => [item.stage, item.label])).toEqual([
      ["new", "Nueva"],
      ["qualifying", "En calificación"],
      ["negotiating", "En negociación"],
      ["won", "Ganada"],
      ["lost", "Perdida"],
    ]);
    expect(columns.map((item) => item.hint)).toEqual([
      "Consulta nueva, sin calificar",
      "Relevando qué busca el cliente",
      "Propuesta activa",
      "Últimos 30 días",
      "Últimos 30 días",
    ]);
    expect(columns.every((item) => item.cards.length === 0)).toBe(true);
  });

  it("cada abierta va a la columna de su etapa, ordenada por Porandú Score", () => {
    const qualifying = column("qualifying", {
      open: [
        // Inactiva: 45 − 40 = 5.
        row(1, "qualifying", {
          lastActivityAt: minutesAgo(6 * MINUTES_PER_DAY),
        }),
        // Activa: 45.
        row(2, "qualifying", { lastActivityAt: minutesAgo(10) }),
        // Enfriándose: 45 − 15 = 30.
        row(3, "qualifying", {
          lastActivityAt: minutesAgo(3 * MINUTES_PER_DAY),
        }),
        row(4, "new"),
      ],
    });
    expect(qualifying.cards.map((item) => [item.id, item.score])).toEqual([
      [id(2), 45],
      [id(3), 30],
      [id(1), 5],
    ]);
    expect(qualifying.total).toBe(3);
    expect(qualifying.stale).toBe(1);
  });

  it("a igual score, primero la de actividad más reciente, y el id desempata", () => {
    const fresh = column("new", {
      open: [
        row(3, "new", { lastActivityAt: minutesAgo(20) }),
        row(1, "new", { lastActivityAt: minutesAgo(40) }),
        row(2, "new", { lastActivityAt: minutesAgo(20) }),
      ],
    });
    expect(fresh.cards.map((item) => item.id)).toEqual([id(2), id(3), id(1)]);
  });

  it(`una columna abierta muestra a lo sumo ${OPEN_COLUMN_LIMIT} y cuenta todas`, () => {
    const open = Array.from({ length: OPEN_COLUMN_LIMIT + 5 }, (_, n) =>
      row(n + 1, "new"),
    );
    const fresh = column("new", { open });
    expect(fresh.cards).toHaveLength(OPEN_COLUMN_LIMIT);
    expect(fresh.total).toBe(OPEN_COLUMN_LIMIT + 5);
    expect(fresh.limit).toBe(OPEN_COLUMN_LIMIT);
  });

  it("las cerradas conservan el orden de la lectura y el total de la ventana", () => {
    const won = column("won", {
      won: {
        rows: [
          row(1, "won", { vehicle: HILUX }),
          row(2, "won", { vehicle: HILUX }),
        ],
        total: 42,
      },
    });
    expect(won.cards.map((item) => item.id)).toEqual([id(1), id(2)]);
    expect(won.total).toBe(42);
    expect(won.limit).toBe(CLOSED_COLUMN_LIMIT);
    expect(won.stale).toBe(0);
  });

  it("una fila abierta con etapa cerrada no se cuela en el tablero", () => {
    const result = board({ open: [row(1, "won")] });
    expect(result.columns.every((item) => item.cards.length === 0)).toBe(true);
    expect(result.summary.open).toBe(0);
  });

  it("resumen: abiertas, inactivas y con acciones pendientes", () => {
    const result = board({
      open: [
        row(1, "new", { lastActivityAt: minutesAgo(6 * MINUTES_PER_DAY) }),
        row(2, "negotiating"),
        row(3, "qualifying"),
      ],
      won: { rows: [row(4, "won", { vehicle: HILUX })], total: 1 },
    });
    // La negociación sin unidad tiene "Vincular unidad" pendiente.
    expect(result.summary).toEqual({ open: 3, stale: 1, pending: 1 });
    expect(result.closedWindowDays).toBe(30);
    expect(result.generatedAt).toBe(NOW.toISOString());
    expect(result.generatedLabel).toBe("10:00");
  });
});

describe("pipelineBoard: tarjeta abierta", () => {
  it("identidad y lo que busca: vehículo y años", () => {
    const demand = new Map([
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
    ]);
    const result = card(
      "new",
      row(1, "new", { contactName: "María González" }),
      {
        demand,
      },
    );
    expect(result).toMatchObject({
      name: "María González",
      initials: "MG",
      headline: "Toyota Hilux",
      headlineSource: "demand",
      detail: "2022 a 2024",
      closure: null,
      saleVehicle: null,
      acceptedQuoteTotal: null,
    });
  });

  it("sin demanda: el interés legado, o «Vehículo sin definir»", () => {
    expect(
      card(
        "new",
        row(1, "new", { interestModel: "Hilux", interestVersion: "SRV" }),
      ),
    ).toMatchObject({ headline: "Hilux SRV", headlineSource: "legacy" });
    expect(card("new", row(1, "new"))).toMatchObject({
      headline: "Vehículo sin definir",
      headlineSource: "none",
      detail: null,
    });
  });

  it("en negociación con unidad: la unidad es la primera línea y la que se vende", () => {
    const result = card(
      "negotiating",
      row(1, "negotiating", { vehicle: HILUX }),
      {
        quotes: new Map([
          [
            id(1),
            {
              toApprove: 0,
              latestDraftId: null,
              accepted: { amount: "47500.00", currency: "USD" as const },
            },
          ],
        ]),
      },
    );
    expect(result).toMatchObject({
      headline: "Toyota Hilux",
      headlineSource: "unit",
      detail: "SRV 2.8 4x4 AT · 2025",
      saleVehicle: { name: "Toyota Hilux", detail: "SRV 2.8 4x4 AT · 2025" },
      acceptedQuoteTotal: { amount: "47500.00", currency: "USD" },
      pending: [],
    });
    // Unidad vinculada: Vehicle Fit 100; con En negociación (75) → 88.
    expect(result.score).toBe(88);
  });

  it.each([
    [
      10,
      "active",
      "Activa",
      "10 min",
      "Última actividad del cliente hace 10 minutos",
    ],
    [
      125,
      "active",
      "Activa",
      "2 h",
      "Última actividad del cliente hace 2 horas",
    ],
    [
      3 * MINUTES_PER_DAY,
      "warning",
      "Enfriándose",
      "3 d",
      "Última actividad del cliente hace 3 días",
    ],
    [
      6 * MINUTES_PER_DAY,
      "stale",
      "Inactiva",
      "6 d",
      "Última actividad del cliente hace 6 días",
    ],
  ] as const)(
    "inactividad a los %i minutos: %s",
    (minutes, state, label, elapsed, description) => {
      const result = card(
        "new",
        row(1, "new", { lastActivityAt: minutesAgo(minutes) }),
      );
      expect(result.recency).toEqual({
        state,
        label,
        minutes,
        elapsed,
        description,
      });
    },
  );

  it("una cotización por aprobar lleva directo a revisarla", () => {
    const result = card("qualifying", row(1, "qualifying"), {
      quotes: new Map([
        [id(1), { toApprove: 1, latestDraftId: id(50), accepted: null }],
      ]),
    });
    expect(result.pending).toEqual([
      {
        kind: "quote_approval",
        label: "Cotización por aprobar",
        description:
          "Falta la aprobación humana antes de entregarla al cliente.",
        tone: "brand",
        target: { kind: "quote", opportunityId: id(1), quoteId: id(50) },
      },
    ]);
  });

  it("varias por aprobar llevan a la oportunidad, que las lista", () => {
    const result = card("qualifying", row(1, "qualifying"), {
      quotes: new Map([
        [id(1), { toApprove: 2, latestDraftId: id(50), accepted: null }],
      ]),
    });
    expect(result.pending[0]).toMatchObject({
      label: "2 cotizaciones por aprobar",
      target: { kind: "opportunity", opportunityId: id(1) },
    });
  });

  it("una prueba vencida abre la agenda en su día de Asunción", () => {
    const result = card("qualifying", row(1, "qualifying"), {
      // 3 nov 23:30 en Asunción = 4 nov 02:30 UTC.
      testDrives: new Map([
        [id(1), { overdue: 1, latestAt: new Date("2026-11-04T02:30:00Z") }],
      ]),
    });
    expect(result.pending).toEqual([
      {
        kind: "test_drive_result",
        label: "Prueba sin resultado",
        description:
          "La prueba de manejo ya pasó: falta registrar si se realizó.",
        tone: "warning",
        target: { kind: "calendar_day", day: "2026-11-03" },
      },
    ]);
  });

  it("en negociación sin unidad: «Vincular unidad», con el porqué del motor", () => {
    const stock: MatchableVehicle[] = [];
    const result = card("negotiating", row(1, "negotiating"), { stock });
    expect(result.pending).toHaveLength(1);
    expect(result.pending[0]).toMatchObject({
      kind: "link_vehicle",
      label: "Vincular unidad",
      tone: "brand",
      target: { kind: "opportunity", opportunityId: id(1) },
    });
    expect(result.pending[0]?.description).not.toBe("");
  });

  it("inactiva y sin unidad: «Vincular unidad» sigue pendiente aunque la NBA sea recuperar", () => {
    const result = card(
      "negotiating",
      row(1, "negotiating", {
        lastActivityAt: minutesAgo(8 * MINUTES_PER_DAY),
      }),
    );
    expect(result.recency?.state).toBe("stale");
    expect(result.pending.map((item) => item.kind)).toEqual(["link_vehicle"]);
    expect(result.pending[0]?.description).toBe(
      "En negociación sin una unidad del stock vinculada.",
    );
  });

  it("varias pendientes: aprobar, después registrar la prueba, después vincular", () => {
    const result = card("negotiating", row(1, "negotiating"), {
      quotes: new Map([
        [id(1), { toApprove: 1, latestDraftId: id(50), accepted: null }],
      ]),
      testDrives: new Map([
        [id(1), { overdue: 2, latestAt: minutesAgo(3 * 60) }],
      ]),
    });
    expect(result.pending.map((item) => [item.kind, item.label])).toEqual([
      ["quote_approval", "Cotización por aprobar"],
      ["test_drive_result", "2 pruebas sin resultado"],
      ["link_vehicle", "Vincular unidad"],
    ]);
  });
});

describe("pipelineBoard: tarjeta cerrada", () => {
  it("ganada: la unidad vendida y cuándo se cerró, sin score ni alertas", () => {
    const result = card(
      "won",
      row(1, "won", { vehicle: HILUX, updatedAt: minutesAgo(60) }),
    );
    expect(result).toMatchObject({
      stage: "won",
      headline: "Toyota Hilux",
      headlineSource: "unit",
      score: null,
      recency: null,
      pending: [],
      saleVehicle: null,
      closure: {
        label: "Ganada",
        reason: null,
        when: "hoy",
        at: minutesAgo(60).toISOString(),
      },
    });
  });

  it("perdida: el motivo, con lo que buscaba si no tenía unidad", () => {
    const result = card(
      "lost",
      row(1, "lost", {
        lossReason: "competitor",
        interestModel: "Corolla",
        // Lunes 2 de noviembre, 10:00 en Asunción.
        updatedAt: new Date("2026-11-02T13:00:00Z"),
      }),
    );
    expect(result).toMatchObject({
      headline: "Corolla",
      headlineSource: "legacy",
      closure: {
        label: "Perdida",
        reason: "Compró en la competencia",
        when: "lunes",
      },
    });
  });
});

describe("helpers de copy", () => {
  it.each([
    [0, "ahora"],
    [59, "59 min"],
    [60, "1 h"],
    [23 * 60 + 59, "23 h"],
    [24 * 60, "1 d"],
  ])("elapsedShort(%i) = %s", (minutes, expected) => {
    expect(elapsedShort(minutes)).toBe(expected);
  });

  it.each([
    ["2026-11-04T03:00:00Z", "hoy"],
    ["2026-11-04T02:59:59Z", "ayer"],
    ["2026-11-02T13:00:00Z", "lunes"],
    ["2026-10-06T13:00:00Z", "6 oct"],
    ["2025-12-30T13:00:00Z", "30 dic 2025"],
  ])("closedWhen(%s) = %s", (at, expected) => {
    expect(closedWhen(new Date(at), NOW)).toBe(expected);
  });
});

import { describe, expect, it } from "vitest";

import type {
  PipelineCard,
  PipelineColumn,
} from "@/domains/opportunities/pipeline";
import {
  compareOpenCards,
  dropZone,
  moveCard,
  moveTargets,
  planBoardMove,
  type BoardMove,
} from "@/domains/opportunities/pipeline-moves";
import {
  canTransition,
  OPPORTUNITY_STAGES,
  type Stage,
} from "@/domains/opportunities/stages";

/*
 * Reglas de movimiento del tablero (propuesta DEC-048) y reductor del
 * estado optimista. Las reglas son la máquina de DEC-032 (stages.test.ts
 * la cruza con el trigger de la base): acá se prueba qué pide soltar una
 * tarjeta en cada columna y cómo se ve el tablero mientras se guarda.
 */

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function openCard(
  n: number,
  stage: Stage,
  score: number | null,
  minutes = 30,
  overrides: Partial<PipelineCard> = {},
): PipelineCard {
  return {
    id: id(n),
    stage,
    name: `Cliente ${n}`,
    initials: "CL",
    headline: "Toyota Hilux",
    headlineSource: "demand",
    detail: null,
    score,
    recency: {
      state: minutes > 5 * 24 * 60 ? "stale" : "active",
      label: minutes > 5 * 24 * 60 ? "Inactiva" : "Activa",
      minutes,
      elapsed: `${minutes} min`,
      description: "",
    },
    pending: [],
    closure: null,
    saleVehicle: null,
    acceptedQuoteTotal: null,
    ...overrides,
  };
}

function columnOf(
  stage: Stage,
  cards: readonly PipelineCard[],
  extra: Partial<PipelineColumn> = {},
): PipelineColumn {
  return {
    stage,
    label: stage,
    hint: "",
    cards,
    total: cards.length,
    stale: cards.filter((card) => card.recency?.state === "stale").length,
    limit: 100,
    ...extra,
  };
}

function columns(byStage: Partial<Record<Stage, readonly PipelineCard[]>>) {
  return OPPORTUNITY_STAGES.map((stage) =>
    columnOf(stage, byStage[stage] ?? []),
  );
}

function ids(cols: readonly PipelineColumn[], stage: Stage) {
  return cols.find((column) => column.stage === stage)!.cards.map((c) => c.id);
}

function find(cols: readonly PipelineColumn[], stage: Stage) {
  return cols.find((column) => column.stage === stage)!;
}

describe("planBoardMove: la matriz de DEC-032 con su porqué", () => {
  const expected: Record<Stage, Record<Stage, BoardMove["kind"] | string>> = {
    new: {
      new: "none",
      qualifying: "advance",
      negotiating: "skip",
      won: "skip",
      lost: "close",
    },
    qualifying: {
      new: "backward",
      qualifying: "none",
      negotiating: "advance",
      won: "skip",
      lost: "close",
    },
    negotiating: {
      new: "backward",
      qualifying: "backward",
      negotiating: "none",
      won: "close",
      lost: "close",
    },
    won: {
      new: "terminal",
      qualifying: "terminal",
      negotiating: "terminal",
      won: "none",
      lost: "terminal",
    },
    lost: {
      new: "terminal",
      qualifying: "terminal",
      negotiating: "terminal",
      won: "terminal",
      lost: "none",
    },
  };

  const pairs = OPPORTUNITY_STAGES.flatMap((from) =>
    OPPORTUNITY_STAGES.map((to) => [from, to] as const),
  );

  it.each(pairs)("%s → %s", (from, to) => {
    const move = planBoardMove(from, to);
    const kind = move.kind === "blocked" ? move.reason : move.kind;
    expect(kind).toBe(expected[from][to]);
    // Solo pide escribir lo que la máquina permite.
    expect(move.kind === "advance" || move.kind === "close").toBe(
      canTransition(from, to),
    );
  });

  it("explica cada bloqueo en es-PY", () => {
    expect(planBoardMove("new", "negotiating")).toMatchObject({
      message: "Sin saltos: de Nueva se pasa a En calificación.",
    });
    expect(planBoardMove("qualifying", "won")).toMatchObject({
      message: "Sin saltos: de En calificación se pasa a En negociación.",
    });
    expect(planBoardMove("negotiating", "new")).toMatchObject({
      message: "Una oportunidad no vuelve a una etapa anterior.",
    });
    expect(planBoardMove("won", "lost")).toMatchObject({
      message: "Ganada es una etapa final: no admite cambios.",
    });
  });
});

describe("moveTargets: el menú «Mover a…»", () => {
  it.each([
    [
      "new",
      [
        ["qualifying", "Pasar a calificación", false],
        ["lost", "Marcar como perdida", true],
      ],
    ],
    [
      "qualifying",
      [
        ["negotiating", "Pasar a negociación", false],
        ["lost", "Marcar como perdida", true],
      ],
    ],
    [
      "negotiating",
      [
        ["won", "Marcar como ganada", true],
        ["lost", "Marcar como perdida", true],
      ],
    ],
    ["won", []],
    ["lost", []],
  ] as const)("%s", (stage, expected) => {
    expect(
      moveTargets(stage).map((target) => [
        target.to,
        target.label,
        target.closes,
      ]),
    ).toEqual(expected);
  });
});

describe("dropZone: cómo se ve cada columna al arrastrar", () => {
  it("desde Nueva", () => {
    expect(OPPORTUNITY_STAGES.map((to) => dropZone("new", to).state)).toEqual([
      "source",
      "advance",
      "blocked",
      "blocked",
      "close",
    ]);
    expect(dropZone("new", "qualifying").hint).toBe(
      "Soltá para pasar a En calificación",
    );
    expect(dropZone("new", "lost").hint).toBe(
      "Soltá para marcarla perdida: pide el motivo",
    );
  });

  it("desde En negociación, ganar pide los datos de la venta", () => {
    expect(dropZone("negotiating", "won")).toEqual({
      state: "close",
      hint: "Soltá para marcarla ganada: pide los datos de la venta",
    });
  });
});

describe("compareOpenCards", () => {
  it("score descendente, sin dato al final, recencia y id desempatan", () => {
    const cards = [
      openCard(4, "new", null, 5),
      openCard(3, "new", 20, 50),
      openCard(2, "new", 45, 10),
      openCard(5, "new", 20, 10),
      openCard(1, "new", 20, 10),
    ];
    expect(cards.toSorted(compareOpenCards).map((card) => card.id)).toEqual([
      id(2),
      id(1),
      id(5),
      id(3),
      id(4),
    ]);
  });
});

describe("moveCard: el estado optimista", () => {
  it("un avance saca la tarjeta de su columna y la ubica por prioridad", () => {
    const before = columns({
      new: [openCard(1, "new", 20), openCard(2, "new", 10)],
      qualifying: [openCard(3, "qualifying", 45), openCard(4, "qualifying", 5)],
    });
    const after = moveCard(before, { opportunityId: id(1), to: "qualifying" });

    expect(ids(after, "new")).toEqual([id(2)]);
    expect(ids(after, "qualifying")).toEqual([id(3), id(1), id(4)]);
    expect(find(after, "qualifying").cards[1]?.stage).toBe("qualifying");
    expect(find(after, "new").total).toBe(1);
    expect(find(after, "qualifying").total).toBe(3);
    // No toca el resto ni muta la entrada.
    expect(find(after, "won")).toBe(find(before, "won"));
    expect(ids(before, "new")).toEqual([id(1), id(2)]);
  });

  it("la cuenta de inactivas viaja con la tarjeta", () => {
    const stale = openCard(1, "new", 0, 8 * 24 * 60);
    const before = columns({ new: [stale] });
    const after = moveCard(before, { opportunityId: id(1), to: "qualifying" });
    expect(find(after, "new").stale).toBe(0);
    expect(find(after, "qualifying").stale).toBe(1);
  });

  it("ganada: primera de su columna, con la unidad vendida y el cierre de hoy", () => {
    const negotiating = openCard(1, "negotiating", 88, 30, {
      saleVehicle: { name: "Toyota Hilux", detail: "SRV · 2025" },
      pending: [
        {
          kind: "quote_approval",
          label: "Cotización por aprobar",
          description: "",
          tone: "brand",
          target: { kind: "opportunity", opportunityId: id(1) },
        },
      ],
    });
    const earlier = openCard(9, "won", null, 30, {
      recency: null,
      closure: { label: "Ganada", reason: null, when: "ayer", at: null },
    });
    const before = columns({ negotiating: [negotiating], won: [earlier] });
    const after = moveCard(before, { opportunityId: id(1), to: "won" });

    expect(ids(after, "won")).toEqual([id(1), id(9)]);
    expect(find(after, "won").cards[0]).toMatchObject({
      stage: "won",
      headline: "Toyota Hilux",
      headlineSource: "unit",
      detail: "SRV · 2025",
      score: null,
      recency: null,
      pending: [],
      closure: { label: "Ganada", reason: null, when: "hoy", at: null },
    });
    expect(find(after, "negotiating").total).toBe(0);
    expect(find(after, "won").total).toBe(2);
  });

  it("perdida: muestra el motivo elegido mientras se guarda", () => {
    const before = columns({ qualifying: [openCard(1, "qualifying", 45)] });
    const after = moveCard(before, {
      opportunityId: id(1),
      to: "lost",
      lossReason: "price",
    });
    expect(find(after, "lost").cards[0]?.closure).toEqual({
      label: "Perdida",
      reason: "Precio",
      when: "hoy",
      at: null,
    });
    // Sin unidad vinculada, la primera línea sigue siendo lo que buscaba.
    expect(find(after, "lost").cards[0]?.headline).toBe("Toyota Hilux");
  });

  it("si la tarjeta no está o ya está en esa etapa, no cambia nada", () => {
    const before = columns({ new: [openCard(1, "new", 20)] });
    expect(moveCard(before, { opportunityId: id(7), to: "lost" })).toBe(before);
    expect(moveCard(before, { opportunityId: id(1), to: "new" })).toBe(before);
  });
});

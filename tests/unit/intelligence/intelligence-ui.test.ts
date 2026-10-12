import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { NextBestActionCard } from "@/components/intelligence/next-best-action";
import {
  RECENCY_TONES,
  RecencyStatus,
} from "@/components/intelligence/recency-status";
import { ScoreBreakdown } from "@/components/intelligence/score-breakdown";
import { ScoreStrip } from "@/components/intelligence/score-strip";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { NextBestAction } from "@/domains/opportunities/types";
import {
  evaluateOpportunity,
  PORANDU_SCORE_COMPOSITION,
  type ScoringInput,
} from "@/domains/scoring/engine";
import type { RecencyState } from "@/domains/scoring/types";

/*
 * Componentes de components/intelligence/ con la salida real del motor
 * (Hito 3, DEC-035), renderizados en el servidor sin DOM:
 * - la recencia: verde activa, ámbar enfriándose, rojo inactiva, siempre con
 *   texto;
 * - "¿Qué hacer?": la NBA urgente (riesgo de pérdida) en rojo, la normal con
 *   el color de marca; las secundarias solo si existen;
 * - el desglose explica cada sub-score, la penalización y el resultado;
 * - el strip muestra el Porandú Score, la penalización y las lecturas.
 * Los tooltips de Radix no se abren en el servidor: el desglose se prueba
 * por separado.
 */

const NOW = new Date("2026-10-12T15:00:00Z");
const DAY = 24 * 60 * 60_000;

function intelligence(overrides: Partial<ScoringInput> = {}) {
  return evaluateOpportunity(
    {
      stage: "negotiating",
      lastActivityAt: new Date(NOW.getTime() - 3 * 60 * 60_000),
      lastNoteAt: NOW,
      hasLinkedVehicle: true,
      stockFit: { kind: "match", score: 85 },
      ...overrides,
    },
    NOW,
  );
}

const render = (element: ReactElement) => renderToStaticMarkup(element);

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Clases del badge de recencia cuyo texto empieza con `label`. */
function badgeClasses(html: string, label: string): string {
  const match = new RegExp(
    `<span class="([^"]*)"><span aria-hidden="true" class="[^"]*"></span>${escape(label)}`,
  ).exec(html);
  if (!match) throw new Error(`badge "${label}" not rendered`);
  return match[1]!;
}

/** Clases del título "¿Qué hacer?" de la tarjeta. */
function headingClasses(html: string): string {
  const match = /<h2 class="([^"]*)">¿Qué hacer\?/.exec(html);
  if (!match) throw new Error("heading not rendered");
  return match[1]!;
}

describe("RecencyStatus: el color sigue al estado", () => {
  it.each([
    ["active", "Activa", "text-success", "bg-success-soft"],
    ["warning", "Enfriándose", "text-warning", "bg-warning-soft"],
    ["stale", "Inactiva", "text-danger", "bg-danger-soft"],
  ] as const)("%s → %s (%s)", (state, label, text, background) => {
    const html = render(
      createElement(RecencyStatus, { state, elapsed: "3 d" }),
    );
    expect(html).toContain(label);
    expect(html).toContain("· 3 d");
    const classes = badgeClasses(html, label);
    expect(classes).toContain(text);
    expect(classes).toContain(background);
  });

  it("verde para activa y rojo para inactiva, nunca al revés", () => {
    const active = render(createElement(RecencyStatus, { state: "active" }));
    const stale = render(createElement(RecencyStatus, { state: "stale" }));
    expect(active).toContain("text-success");
    expect(active).not.toMatch(/text-danger|text-warning/);
    expect(stale).toContain("text-danger");
    expect(stale).not.toMatch(/text-success|text-warning/);
  });

  it("cada estado tiene un tono semántico propio", () => {
    expect(RECENCY_TONES).toEqual({
      active: "success",
      warning: "warning",
      stale: "danger",
    });
  });

  it("sin tiempo transcurrido, solo el estado", () => {
    const html = render(createElement(RecencyStatus, { state: "warning" }));
    expect(html).toContain("Enfriándose");
    expect(html).not.toContain("·");
  });
});

function card(nba: NextBestAction, state?: RecencyState) {
  return render(
    createElement(NextBestActionCard, {
      nba,
      done: false,
      onToggleDone: () => {},
      ...(state ? { recency: { state, elapsed: "6 d" } } : {}),
    }),
  );
}

describe("NextBestActionCard con la NBA del motor", () => {
  it("inactiva: retomar contacto urgente, en rojo, con la recencia y las secundarias", () => {
    const { nba } = intelligence({
      lastActivityAt: new Date(NOW.getTime() - 6 * DAY),
      hasLinkedVehicle: false,
      lastNoteAt: null,
    });
    const html = card(nba!, "stale");

    expect(html).toContain("Retomar contacto urgente");
    expect(html).toContain(
      "Sin actividad del cliente hace 6 días: riesgo de pérdida.",
    );
    expect(html).toContain('<span class="sr-only"> Urgente.</span>');
    expect(html).toContain("absolute inset-y-0 left-0 w-1 bg-danger");
    expect(headingClasses(html)).toContain("text-danger");
    expect(badgeClasses(html, "Inactiva")).toContain("text-danger");
    expect(html).not.toContain("bg-brand");
    expect(html).toContain("Después");
    expect(html).toContain(
      "Vincular unidad de stock · Registrar actualización de contacto",
    );
  });

  it("activa y al día: color de marca y recencia en verde, sin secundarias", () => {
    const { nba } = intelligence();
    const html = card(nba!, "active");

    expect(html).toContain("Sostener el seguimiento");
    expect(html).toContain("absolute inset-y-0 left-0 w-1 bg-brand");
    expect(headingClasses(html)).toContain("text-brand");
    expect(badgeClasses(html, "Activa")).toContain("text-success");
    expect(html).not.toContain("bg-danger");
    expect(html).not.toContain("Urgente");
    expect(html).not.toContain("Después");
  });

  it("En negociación sin unidad: vincular, sin tono de urgencia", () => {
    const { nba } = intelligence({ hasLinkedVehicle: false });
    const html = card(nba!, "active");

    expect(html).toContain("Vincular unidad de stock");
    expect(html).toContain(
      "En negociación sin una unidad vinculada. El Top Match del stock suma 85 pts.",
    );
    expect(html).not.toContain("bg-danger");
  });

  it("enfriándose: la recencia en ámbar", () => {
    const { nba, recency } = intelligence({
      lastActivityAt: new Date(NOW.getTime() - 3 * DAY),
    });
    expect(recency.state).toBe("warning");
    const html = card(nba!, recency.state);
    expect(html).toContain("Hacer seguimiento");
    expect(badgeClasses(html, "Enfriándose")).toContain("text-warning");
  });

  it("sin recencia (fixtures de B1), la tarjeta sigue funcionando", () => {
    const html = card({
      kind: "call",
      action: "Llamar ahora",
      reason: "Pidió la cuota",
      secondary: ["Reservar la unidad"],
    });
    expect(html).toContain("Llamar ahora");
    expect(html).not.toMatch(/Activa|Enfriándose|Inactiva/);
    expect(html).toContain("Después");
  });

  it("ninguna NBA del motor requiere aprobación: ofrece marcarla como hecha", () => {
    const html = card(intelligence({ lastNoteAt: null }).nba!, "active");
    expect(html).toContain("Registrar actualización de contacto");
    expect(html).toContain("Marcar como hecha");
    expect(html).not.toContain("Requiere aprobación");
  });
});

describe("ScoreBreakdown con la explicación del motor", () => {
  it("cada sub-score con su peso, valor y motivo, y la penalización", () => {
    const { scores, explanation } = intelligence({
      lastActivityAt: new Date(NOW.getTime() - 8 * DAY),
    });
    const html = render(
      createElement(ScoreBreakdown, {
        scores,
        composition: PORANDU_SCORE_COMPOSITION,
        explanation,
      }),
    );

    expect(scores.porandu).toBe(48);
    expect(html).toContain("Porandú Score");
    expect(html).toContain(">48<");
    expect(html).toContain("Intent · 40%");
    expect(html).toContain("Sin dato: llega con las conversaciones");
    expect(html).toContain("Vehicle Fit · 30%");
    expect(html).toContain("Unidad del stock vinculada");
    expect(html).toContain("Deal Readiness · 30%");
    expect(html).toContain("Etapa En negociación");
    expect(html).toContain("Inactiva hace 8 días · riesgo de pérdida");
    expect(html).toContain("−40");
    expect(html).toContain("Cobertura 60% · el dato faltante no penaliza");
  });

  it("activa: sin penalización", () => {
    const { scores, explanation } = intelligence();
    const html = render(
      createElement(ScoreBreakdown, {
        scores,
        composition: PORANDU_SCORE_COMPOSITION,
        explanation,
      }),
    );
    expect(html).toContain(">88<");
    expect(html).not.toContain("−");
  });

  it("cerrada: muestra el resultado", () => {
    const { scores, explanation } = intelligence({ stage: "won" });
    const html = render(
      createElement(ScoreBreakdown, {
        scores,
        composition: PORANDU_SCORE_COMPOSITION,
        explanation,
      }),
    );
    expect(html).toContain(">100<");
    expect(html).toContain("Ganada: la venta se concretó");
  });
});

function strip(overrides: Partial<ScoringInput> = {}) {
  const { scores, explanation } = intelligence(overrides);
  return render(
    createElement(
      TooltipProvider,
      null,
      createElement(ScoreStrip, {
        scores,
        composition: PORANDU_SCORE_COMPOSITION,
        explanation,
      }),
    ),
  );
}

describe("ScoreStrip con los scores reales", () => {
  it("el Porandú Score, la cobertura y las lecturas del motor", () => {
    const html = strip();
    expect(html).toContain(">88<");
    expect(html).toContain("Cobertura 60%");
    expect(html).toContain("Unidad del stock vinculada");
    expect(html).toContain("Etapa En negociación");
    // Intent sin dato: guion y "Sin dato", sin inventar un valor.
    expect(html).toContain(">—<");
    expect(html).toContain("Sin dato");
    expect(html).not.toContain("Inactividad");
  });

  it("inactiva: el tile del Porandú dice cuánto restó la inactividad", () => {
    const html = strip({ lastActivityAt: new Date(NOW.getTime() - 8 * DAY) });
    expect(html).toContain(">48<");
    expect(html).toContain("Inactividad −40");
  });

  it("enfriándose: −15", () => {
    const html = strip({ lastActivityAt: new Date(NOW.getTime() - 3 * DAY) });
    expect(html).toContain(">73<");
    expect(html).toContain("Inactividad −15");
  });
});

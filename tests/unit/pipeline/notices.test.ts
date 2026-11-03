import { describe, expect, it } from "vitest";

import { advanceOutcome, closeOutcome } from "@/components/pipeline/notices";

/*
 * Avisos del embudo (propuesta DEC-048): qué dice el tablero después de cada
 * respuesta de changeOpportunityStage() y closeOpportunity(), y cuándo
 * vuelve a leer el tablero porque la respuesta no lo revalidó y la etapa
 * real puede ser otra.
 */

const ID = "00000000-0000-4000-8000-000000000001";

describe("advanceOutcome()", () => {
  it.each([
    [
      { status: "changed", opportunityId: ID, from: "new", to: "qualifying" },
      "info",
      "María pasó a En calificación.",
      false,
    ],
    [
      { status: "unchanged", opportunityId: ID, stage: "qualifying" },
      "info",
      "María ya estaba en En calificación.",
      true,
    ],
    [
      { status: "invalid_transition", opportunityId: ID, current: "lost" },
      "error",
      "No se movió: María está en Perdida y desde ahí no se puede hacer ese pase.",
      false,
    ],
    [
      { status: "not_found" },
      "error",
      "No encontramos la oportunidad. Actualizamos el tablero.",
      true,
    ],
    [
      { status: "failed" },
      "error",
      "No pudimos mover a María. No se hizo ningún cambio: intentá de nuevo.",
      false,
    ],
    [
      null,
      "error",
      "No pudimos mover a María. No se hizo ningún cambio: intentá de nuevo.",
      false,
    ],
    [
      { status: "invalid" },
      "error",
      "No pudimos interpretar el pedido.",
      false,
    ],
  ] as const)("%o", (state, tone, text, refresh) => {
    expect(advanceOutcome("María", "qualifying", state)).toEqual({
      notice: { tone, text },
      refresh,
    });
  });
});

describe("closeOutcome()", () => {
  it.each([
    [
      { status: "closed", opportunityId: ID, from: "negotiating", to: "won" },
      "info",
      "Oportunidad de María cerrada: Ganada.",
      false,
    ],
    [
      { status: "unchanged", opportunityId: ID, stage: "lost" },
      "info",
      "La oportunidad de María ya estaba Perdida.",
      true,
    ],
    [
      { status: "invalid_transition", opportunityId: ID, current: "won" },
      "error",
      "No se cerró: la oportunidad de María está en Ganada.",
      false,
    ],
    [
      { status: "not_found" },
      "error",
      "No encontramos la oportunidad. Actualizamos el tablero.",
      true,
    ],
    [
      { status: "invalid_outcome" },
      "error",
      "No pudimos interpretar el pedido.",
      false,
    ],
  ] as const)("%o", (state, tone, text, refresh) => {
    expect(closeOutcome("María", state)).toEqual({
      notice: { tone, text },
      refresh,
    });
  });
});

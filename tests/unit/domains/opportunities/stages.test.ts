import { describe, expect, it } from "vitest";

import {
  STAGE_ACTION_LABELS,
  STAGES,
  stageLabel,
} from "@/domains/opportunities/labels";
import {
  canTransition,
  INITIAL_STAGE,
  isStage,
  isTerminalStage,
  nextStages,
  OPPORTUNITY_STAGES,
  planStageChange,
  sourceStagesOf,
  STAGE_CHANGE_FIELDS,
  TERMINAL_STAGES,
  type Stage,
} from "@/domains/opportunities/stages";

/*
 * Máquina de estados de las etapas comerciales (H1.6, DEC-032): dominio puro,
 * sin base. La misma matriz la exige el trigger de la base; el cruce entre
 * las dos está en tests/db/opportunity-stages.test.ts.
 */

/** La matriz de DEC-032 §2, escrita aparte de la implementación. */
const ALLOWED: ReadonlyArray<readonly [Stage, Stage]> = [
  ["new", "qualifying"],
  ["new", "lost"],
  ["qualifying", "negotiating"],
  ["qualifying", "lost"],
  ["negotiating", "won"],
  ["negotiating", "lost"],
];

describe("etapas", () => {
  it("son las cinco de DEC-032 §1, en el orden del flujo", () => {
    expect(OPPORTUNITY_STAGES).toEqual([
      "new",
      "qualifying",
      "negotiating",
      "won",
      "lost",
    ]);
    expect(INITIAL_STAGE).toBe("new");
    expect(TERMINAL_STAGES).toEqual(["won", "lost"]);
  });

  it("isStage() solo reconoce etapas", () => {
    for (const stage of OPPORTUNITY_STAGES) expect(isStage(stage)).toBe(true);
    for (const value of [
      "qualified",
      "test_drive",
      "negotiation",
      "NEW",
      " new",
      "",
      null,
      undefined,
      1,
      {},
    ]) {
      expect(isStage(value)).toBe(false);
    }
  });

  it("solo won y lost son terminales", () => {
    expect(OPPORTUNITY_STAGES.filter(isTerminalStage)).toEqual(["won", "lost"]);
  });
});

describe("transiciones", () => {
  it("canTransition() es exactamente la matriz, sobre los 25 pares", () => {
    for (const from of OPPORTUNITY_STAGES) {
      for (const to of OPPORTUNITY_STAGES) {
        const expected = ALLOWED.some(([f, t]) => f === from && t === to);
        expect(canTransition(from, to), `${from} → ${to}`).toBe(expected);
      }
    }
  });

  it("no hay saltos ni vuelta atrás", () => {
    expect(canTransition("new", "negotiating")).toBe(false);
    expect(canTransition("new", "won")).toBe(false);
    expect(canTransition("qualifying", "won")).toBe(false);
    expect(canTransition("qualifying", "new")).toBe(false);
    expect(canTransition("negotiating", "qualifying")).toBe(false);
    expect(canTransition("negotiating", "new")).toBe(false);
  });

  it("una etapa terminal no sale: ni entre sí, ni hacia atrás, ni a sí misma", () => {
    for (const from of TERMINAL_STAGES) {
      expect(nextStages(from)).toEqual([]);
      for (const to of OPPORTUNITY_STAGES) {
        expect(canTransition(from, to), `${from} → ${to}`).toBe(false);
      }
    }
    expect(canTransition("won", "lost")).toBe(false);
    expect(canTransition("lost", "won")).toBe(false);
  });

  it("perder es posible desde cualquier etapa abierta", () => {
    for (const from of ["new", "qualifying", "negotiating"] as const) {
      expect(nextStages(from)).toContain("lost");
    }
  });

  it("nextStages() ofrece primero el avance y al final la pérdida", () => {
    expect(nextStages("new")).toEqual(["qualifying", "lost"]);
    expect(nextStages("qualifying")).toEqual(["negotiating", "lost"]);
    expect(nextStages("negotiating")).toEqual(["won", "lost"]);
  });

  it("sourceStagesOf() es la inversa de nextStages()", () => {
    expect(sourceStagesOf("new")).toEqual([]);
    expect(sourceStagesOf("qualifying")).toEqual(["new"]);
    expect(sourceStagesOf("negotiating")).toEqual(["qualifying"]);
    expect(sourceStagesOf("won")).toEqual(["negotiating"]);
    expect(sourceStagesOf("lost")).toEqual([
      "new",
      "qualifying",
      "negotiating",
    ]);
  });
});

describe("planStageChange()", () => {
  it("un avance válido escribe", () => {
    expect(planStageChange("new", { to: "qualifying" })).toEqual({
      kind: "change",
      from: "new",
      to: "qualifying",
    });
    expect(planStageChange("qualifying", { to: "negotiating" })).toEqual({
      kind: "change",
      from: "qualifying",
      to: "negotiating",
    });
  });

  it("un cierre válido no se escribe acá: closure_required (DEC-034 §1)", () => {
    for (const from of ["new", "qualifying", "negotiating"] as const) {
      expect(planStageChange(from, { to: "lost" })).toEqual({
        kind: "closure_required",
        from,
        to: "lost",
      });
    }
    expect(planStageChange("negotiating", { to: "won" })).toEqual({
      kind: "closure_required",
      from: "negotiating",
      to: "won",
    });
  });

  it("un par que la máquina no permite es invalid_transition", () => {
    expect(planStageChange("new", { to: "negotiating" })).toEqual({
      kind: "invalid_transition",
      from: "new",
      to: "negotiating",
    });
    expect(planStageChange("won", { to: "lost" })).toEqual({
      kind: "invalid_transition",
      from: "won",
      to: "lost",
    });
    expect(planStageChange("lost", { to: "won" })).toEqual({
      kind: "invalid_transition",
      from: "lost",
      to: "won",
    });
    expect(planStageChange("qualifying", { to: "won" })).toMatchObject({
      kind: "invalid_transition",
    });
  });

  it("pedir la etapa actual es idempotente (unchanged), también en una terminal", () => {
    for (const stage of OPPORTUNITY_STAGES) {
      expect(planStageChange(stage, { to: stage })).toEqual({
        kind: "unchanged",
        stage,
      });
    }
  });

  it("los 25 pares: change solo para un avance de la matriz que no cierra", () => {
    for (const from of OPPORTUNITY_STAGES) {
      for (const to of OPPORTUNITY_STAGES) {
        const expected =
          from === to
            ? "unchanged"
            : !canTransition(from, to)
              ? "invalid_transition"
              : isTerminalStage(to)
                ? "closure_required"
                : "change";
        expect(planStageChange(from, { to }).kind, `${from} → ${to}`).toBe(
          expected,
        );
      }
    }
  });

  it("el pedido solo lleva la oportunidad y la etapa: el motivo viaja con el cierre", () => {
    expect(STAGE_CHANGE_FIELDS).toEqual({
      opportunityId: "opportunityId",
      stage: "stage",
    });
  });
});

describe("copy es-PY", () => {
  it("cada etapa tiene etiqueta y descripción", () => {
    expect(STAGES.map((s) => s.id)).toEqual([...OPPORTUNITY_STAGES]);
    expect(STAGES.map((s) => stageLabel(s.id))).toEqual([
      "Nueva",
      "En calificación",
      "En negociación",
      "Ganada",
      "Perdida",
    ]);
    for (const stage of STAGES) expect(stage.hint.length).toBeGreaterThan(0);
  });

  it("cada etapa de destino tiene su acción", () => {
    expect(Object.keys(STAGE_ACTION_LABELS)).toEqual([
      "qualifying",
      "negotiating",
      "won",
      "lost",
    ]);
  });
});

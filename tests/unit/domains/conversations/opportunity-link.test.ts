import { describe, expect, it } from "vitest";

import {
  conversationOpportunity,
  LINKABLE_STAGES,
  OPPORTUNITY_LINK_LIMIT,
  opportunityHref,
  type LinkCandidateRow,
} from "@/domains/conversations/opportunity-link";
import {
  isTerminalStage,
  OPPORTUNITY_STAGES,
} from "@/domains/opportunities/stages";

/*
 * Oportunidad de una conversación (Hito 12, DEC-044 §4): la regla con la que
 * la base asocia cada mensaje (DEC-039 §9), una sola abierta o ninguna
 * asociación, contada al vendedor.
 */

const OPPORTUNITY = "00000000-0000-4000-8000-0000000000e1";

function candidate(overrides: Partial<LinkCandidateRow>): LinkCandidateRow {
  return {
    id: OPPORTUNITY,
    stage: "qualifying",
    lastActivityAt: new Date("2026-10-29T15:32:00Z"),
    ...overrides,
  };
}

describe("LINKABLE_STAGES", () => {
  it("son las etapas no terminales, como en las funciones de ingesta y envío", () => {
    expect([...LINKABLE_STAGES]).toEqual(
      OPPORTUNITY_STAGES.filter((stage) => !isTerminalStage(stage)),
    );
  });
});

describe("conversationOpportunity", () => {
  it("sin abiertas: los mensajes quedan solo en la conversación", () => {
    expect(conversationOpportunity([], 0)).toEqual({ kind: "none" });
  });

  it("una sola abierta: se asocia, con su etapa, su actividad y su enlace", () => {
    expect(conversationOpportunity([candidate({})], 1)).toEqual({
      kind: "linked",
      opportunity: {
        id: OPPORTUNITY,
        href: `/opportunities/${OPPORTUNITY}`,
        stage: "En calificación",
        lastActivity: "29 oct 2026 12:32",
      },
    });
  });

  it("varias abiertas: no se asocia a ninguna y se listan por actividad más reciente", () => {
    const result = conversationOpportunity(
      [
        candidate({
          id: "b",
          lastActivityAt: new Date("2026-10-20T12:00:00Z"),
        }),
        candidate({
          id: "a",
          stage: "negotiating",
          lastActivityAt: new Date("2026-10-29T12:00:00Z"),
        }),
      ],
      2,
    );
    expect(result).toMatchObject({ kind: "ambiguous", total: 2 });
    if (result.kind !== "ambiguous") throw new Error("ambiguous");
    expect(result.opportunities.map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("el total cuenta también las que no se listan", () => {
    const rows = Array.from({ length: OPPORTUNITY_LINK_LIMIT }, (_, index) =>
      candidate({ id: `o${index}` }),
    );
    const result = conversationOpportunity(rows, 8);
    expect(result).toMatchObject({ kind: "ambiguous", total: 8 });
    if (result.kind !== "ambiguous") throw new Error("ambiguous");
    expect(result.opportunities).toHaveLength(OPPORTUNITY_LINK_LIMIT);
  });

  it("una cerrada se ignora: no se adivina ni se asocia", () => {
    expect(
      conversationOpportunity(
        [candidate({ id: "won", stage: "won" }), candidate({})],
        1,
      ),
    ).toMatchObject({ kind: "linked", opportunity: { id: OPPORTUNITY } });
    expect(conversationOpportunity([candidate({ stage: "lost" })], 1)).toEqual({
      kind: "none",
    });
  });
});

describe("opportunityHref", () => {
  it("lleva al workspace de la oportunidad", () => {
    expect(opportunityHref(OPPORTUNITY)).toBe(`/opportunities/${OPPORTUNITY}`);
  });
});

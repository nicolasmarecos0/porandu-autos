import { describe, expect, it } from "vitest";

import {
  OPPORTUNITY_STAGES as STAGES,
  type Stage,
} from "@/domains/opportunities/stages";
import {
  EXPORTABLE_QUOTE_STATUSES,
  isQuoteExportBlock,
  QUOTE_EXPORT_BLOCK_LABELS,
  QUOTE_EXPORT_BLOCKS,
  QUOTE_PREVIEW_STAMPS,
  quoteExportability,
} from "@/domains/quotes/exportability";
import { QUOTE_STATUSES, type QuoteStatus } from "@/domains/quotes/statuses";

/*
 * ¿Se descarga el PDF? (Hito 14, DEC-046 §2). La matriz completa: los seis
 * estados × vigente o vencida × las cinco etapas de la oportunidad.
 */

const TODAY = "2026-11-02";
const VALID = "2026-11-02"; // último día, inclusive
const EXPIRED = "2026-11-01";

function decide(status: QuoteStatus, validUntil: string, stage: Stage) {
  return quoteExportability(
    { status, validUntil, opportunityStage: stage },
    TODAY,
  );
}

describe("quoteExportability()", () => {
  it("un borrador nunca se descarga: falta la aprobación humana", () => {
    for (const stage of STAGES) {
      for (const validUntil of [VALID, EXPIRED]) {
        expect(decide("draft", validUntil, stage)).toEqual({
          exportable: false,
          reason: "draft",
        });
      }
    }
  });

  it("aprobada o enviada: solo vigente y con la oportunidad en calificación o negociación", () => {
    for (const status of ["approved", "sent"] as const) {
      expect(decide(status, VALID, "qualifying")).toEqual({
        exportable: true,
      });
      expect(decide(status, VALID, "negotiating")).toEqual({
        exportable: true,
      });
      for (const stage of ["new", "won", "lost"] as const) {
        expect(decide(status, VALID, stage)).toEqual({
          exportable: false,
          reason: "opportunity_closed",
        });
      }
      // La validez se mira primero: vencida aunque la oportunidad esté cerrada.
      for (const stage of STAGES) {
        expect(decide(status, EXPIRED, stage)).toEqual({
          exportable: false,
          reason: "expired",
        });
      }
    }
  });

  it("el último día de validez todavía se descarga", () => {
    expect(
      quoteExportability(
        {
          status: "approved",
          validUntil: TODAY,
          opportunityStage: "negotiating",
        },
        TODAY,
      ),
    ).toEqual({ exportable: true });
  });

  it("una aceptada se descarga siempre: es la constancia de lo aceptado", () => {
    for (const stage of STAGES) {
      for (const validUntil of [VALID, EXPIRED]) {
        expect(decide("accepted", validUntil, stage)).toEqual({
          exportable: true,
        });
      }
    }
  });

  it("rechazada y anulada no se descargan", () => {
    for (const status of ["rejected", "withdrawn"] as const) {
      for (const stage of STAGES) {
        expect(decide(status, VALID, stage)).toEqual({
          exportable: false,
          reason: status,
        });
      }
    }
  });

  it("los estados exportables son exactamente los que alguna vez dan sí", () => {
    const yes = QUOTE_STATUSES.filter((status) =>
      STAGES.some((stage) => decide(status, VALID, stage).exportable),
    );
    expect(yes).toEqual([...EXPORTABLE_QUOTE_STATUSES]);
  });

  it("cada motivo tiene su copy y su sello, y se reconoce", () => {
    for (const reason of QUOTE_EXPORT_BLOCKS) {
      expect(QUOTE_EXPORT_BLOCK_LABELS[reason]).toMatch(/PDF/);
      expect(QUOTE_PREVIEW_STAMPS[reason]).not.toBe("");
      expect(isQuoteExportBlock(reason)).toBe(true);
    }
    expect(isQuoteExportBlock("approved")).toBe(false);
    expect(isQuoteExportBlock(undefined)).toBe(false);
  });
});

import { describe, expect, it } from "vitest";

import { parseStageChange } from "@/lib/opportunities/stage-change";

/*
 * Lectura del pedido de la Server Action changeOpportunityStage() (H1.6): es
 * input no confiable. Solo importan la oportunidad y la etapa de destino; el
 * resto (también un motivo de pérdida: el cierre va por closeOpportunity(),
 * DEC-034) no tiene adónde ir.
 */

const ID = "10000000-0000-4000-8000-000000000101";

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.append(name, value);
  return data;
}

describe("parseStageChange()", () => {
  it("lee la oportunidad y la etapa", () => {
    expect(
      parseStageChange(form({ opportunityId: ID, stage: "qualifying" })),
    ).toEqual({ kind: "ok", opportunityId: ID, to: "qualifying" });
    // Un cierre se lee igual: el dominio responde closure_required.
    expect(
      parseStageChange(
        form({ opportunityId: ID, stage: "lost", lossReason: "price" }),
      ),
    ).toEqual({ kind: "ok", opportunityId: ID, to: "lost" });
  });

  it("normaliza el id (espacios y mayúsculas)", () => {
    expect(
      parseStageChange(
        form({ opportunityId: ` ${ID.toUpperCase()} `, stage: "won" }),
      ),
    ).toMatchObject({ kind: "ok", opportunityId: ID });
  });

  it.each([
    ["sin id", {}],
    ["un id que no es UUID", { opportunityId: "123", stage: "won" }],
    [
      "un id con una inyección",
      { opportunityId: `${ID}' OR 1=1`, stage: "won" },
    ],
    ["un id vacío", { opportunityId: "  ", stage: "won" }],
  ])("%s es not_found y no llega a la base", (_, fields) => {
    expect(parseStageChange(form(fields))).toEqual({ kind: "not_found" });
  });

  it("un archivo en lugar de un texto es como si faltara", () => {
    const data = new FormData();
    data.append("opportunityId", new Blob([ID]), "id.txt");
    expect(parseStageChange(data)).toEqual({ kind: "not_found" });
  });

  it.each(["", "qualified", "test_drive", "negotiation", "WON", "won;"])(
    "la etapa %j no existe: invalid",
    (stage) => {
      expect(parseStageChange(form({ opportunityId: ID, stage }))).toEqual({
        kind: "invalid",
      });
    },
  );

  it("organización, usuario, origen, estado, metadatos de cierre y reloj del pedido se ignoran", () => {
    const parsed = parseStageChange(
      form({
        opportunityId: ID,
        stage: "qualifying",
        organizationId: "00000000-0000-4000-8000-000000000002",
        organization_id: "00000000-0000-4000-8000-000000000002",
        from: "negotiating",
        updated_at: "2020-01-01",
        userId: "x",
        lossReason: "price",
        salePrice: "47.500",
      }),
    );
    expect(parsed).toEqual({ kind: "ok", opportunityId: ID, to: "qualifying" });
  });
});

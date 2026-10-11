import { describe, expect, it } from "vitest";

import { parseCloseRequest } from "@/lib/opportunities/closure";

/*
 * Lectura del pedido de la Server Action closeOpportunity() (DEC-034): es
 * input no confiable. Solo importan la oportunidad, el resultado y los
 * campos de ese resultado; el resto no tiene adónde ir.
 */

const ID = "10000000-0000-4000-8000-000000000101";
const TODAY = "2026-10-11";

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.append(name, value);
  return data;
}

describe("parseCloseRequest()", () => {
  it("normaliza el id y devuelve el cierre validado con el eco de lo cargado", () => {
    expect(
      parseCloseRequest(
        form({
          opportunityId: ` ${ID.toUpperCase()} `,
          outcome: "lost",
          lossReason: "ghosted",
          lossNotes: "",
        }),
        TODAY,
      ),
    ).toEqual({
      kind: "ok",
      opportunityId: ID,
      closure: { outcome: "lost", lossReason: "ghosted", lossNotes: null },
      values: {
        salePrice: "",
        saleCurrency: "",
        paymentMethod: "",
        deliveryStatus: "",
        deliveryDate: "",
        lossReason: "ghosted",
        lossNotes: "",
      },
    });
  });

  it.each([
    ["sin id", {}],
    ["un id vacío", { opportunityId: "  ", outcome: "won" }],
    ["un id que no es UUID", { opportunityId: "123", outcome: "won" }],
  ])("%s es not_found y no llega a la base", (_, fields) => {
    expect(parseCloseRequest(form(fields), TODAY)).toEqual({
      kind: "not_found",
    });
  });

  it("un archivo en lugar de un texto es como si faltara", () => {
    const data = form({ outcome: "lost", lossReason: "price" });
    data.append("opportunityId", new Blob([ID]), "id.txt");
    expect(parseCloseRequest(data, TODAY)).toEqual({ kind: "not_found" });

    const notes = form({ opportunityId: ID, outcome: "lost" });
    notes.append("lossReason", new Blob(["price"]), "reason.txt");
    expect(parseCloseRequest(notes, TODAY)).toMatchObject({
      kind: "invalid",
      errors: { lossReason: "required" },
    });
  });

  it.each(["", "negotiating", "Won", "lost "])(
    "el resultado %j se lee recortado; si no es won o lost, invalid_outcome",
    (outcome) => {
      const parsed = parseCloseRequest(
        form({ opportunityId: ID, outcome, lossReason: "price" }),
        TODAY,
      );
      if (outcome === "lost ") {
        expect(parsed).toMatchObject({ kind: "ok" });
      } else {
        expect(parsed).toEqual({ kind: "invalid_outcome" });
      }
    },
  );

  it("los campos del otro resultado ni se validan ni vuelven", () => {
    expect(
      parseCloseRequest(
        form({
          opportunityId: ID,
          outcome: "lost",
          lossReason: "price",
          salePrice: "no es un monto",
          saleCurrency: "EUR",
        }),
        TODAY,
      ),
    ).toMatchObject({
      kind: "ok",
      values: { salePrice: "", saleCurrency: "", lossReason: "price" },
    });
  });

  it("valida lo que llegó completo, aunque el eco se acote", () => {
    const parsed = parseCloseRequest(
      form({
        opportunityId: ID,
        outcome: "won",
        salePrice: `${"1".repeat(300)}`,
        saleCurrency: "USD",
        paymentMethod: "cash",
        deliveryStatus: "scheduled",
        deliveryDate: TODAY,
      }),
      TODAY,
    );
    expect(parsed).toMatchObject({
      kind: "invalid",
      errors: { salePrice: "invalid_amount" },
    });
    expect(
      (parsed as { values: { salePrice: string } }).values.salePrice,
    ).toHaveLength(256);
  });
});

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  closureErrorMessage,
  ClosureFields,
} from "@/components/opportunities/closure-fields";
import {
  ClosureAlert,
  StageCloseDialog,
} from "@/components/opportunities/stage-close-dialog";
import {
  CLOSURE_FIELD_ERRORS,
  OUTCOME_FIELDS,
  type ClosureErrors,
  type ClosureOutcome,
  type ClosureValues,
} from "@/domains/opportunities/closure";
import type { CloseOpportunityState } from "@/lib/opportunities/closure";

/*
 * Formulario de cierre (DEC-034 §11), renderizado en el servidor sin DOM:
 * qué campos ofrece cada resultado, cómo enlaza cada error a su control y
 * qué hace sin unidad vinculada. La validación es la del dominio
 * (closure.test.ts) y la Server Action se prueba en close-action.test.ts y
 * contra la base en tests/db/opportunity-closure.test.ts.
 */

vi.mock("@/lib/opportunities/actions", () => ({
  closeOpportunity: vi.fn(),
}));

const TODAY = "2026-10-11";
const SALE_VEHICLE = { name: "Toyota Hilux", detail: "SRV 2.8 4x4 AT · 2025" };

function render(
  outcome: ClosureOutcome,
  {
    errors = {},
    values,
    saleVehicle = SALE_VEHICLE,
  }: {
    errors?: ClosureErrors;
    values?: Partial<ClosureValues>;
    saleVehicle?: typeof SALE_VEHICLE | null;
  } = {},
): string {
  return renderToStaticMarkup(
    createElement(ClosureFields, {
      outcome,
      today: TODAY,
      errors,
      values,
      saleVehicle,
      disabled: false,
    }),
  );
}

/** Los `name` de los controles, en orden. */
function names(html: string): string[] {
  return [...html.matchAll(/<(?:input|select|textarea)[^>]*name="(\w+)"/g)].map(
    (match) => match[1]!,
  );
}

/** Las opciones de un select por su name (sin el placeholder). */
function options(html: string, name: string): [string, string][] {
  const start = html.indexOf(`name="${name}"`);
  const select = html.slice(start, html.indexOf("</select>", start));
  return [...select.matchAll(/<option value="([^"]+)"[^>]*>([^<]+)</g)].map(
    (match) => [match[1]!, match[2]!],
  );
}

/** El tag de apertura del control `name`. */
function control(html: string, name: string): string {
  return html.match(new RegExp(`<[a-z]+[^>]*name="${name}"[^>]*>`))?.[0] ?? "";
}

describe("Ganada", () => {
  it("muestra la unidad vendida y pide precio, moneda, forma de pago y entrega", () => {
    const html = render("won");
    expect(html).toContain("Unidad vendida");
    expect(html).toContain("Toyota Hilux");
    expect(html).toContain("SRV 2.8 4x4 AT · 2025");
    expect(names(html)).toEqual([...OUTCOME_FIELDS.won]);
    expect(control(html, "salePrice")).toContain('inputMode="decimal"');
    expect(options(html, "saleCurrency")).toEqual([
      ["PYG", "Gs. (guaraníes)"],
      ["USD", "USD (dólares)"],
    ]);
    expect(options(html, "paymentMethod")).toEqual([
      ["cash", "Contado"],
      ["financing", "Financiación"],
      ["trade_in", "Usado como parte de pago"],
      ["mixed", "Mixto"],
    ]);
    expect(options(html, "deliveryStatus")).toEqual([
      ["scheduled", "Entrega programada"],
      ["delivered", "Entregada"],
    ]);
    expect(control(html, "deliveryDate")).toContain('type="date"');
    expect(html).toContain(
      "Lo acordado con el cliente, no el precio publicado.",
    );
    expect(html).toContain("Elegí primero el estado.");
  });

  it("la fecha se acota a hoy según el estado de la entrega", () => {
    const delivered = render("won", {
      values: { deliveryStatus: "delivered" },
    });
    expect(control(delivered, "deliveryDate")).toContain(`max="${TODAY}"`);
    expect(control(delivered, "deliveryDate")).not.toContain("min=");
    expect(delivered).toContain("Hoy o antes.");

    const scheduled = render("won", {
      values: { deliveryStatus: "scheduled" },
    });
    expect(control(scheduled, "deliveryDate")).toContain(`min="${TODAY}"`);
    expect(control(scheduled, "deliveryDate")).not.toContain("max=");
    expect(scheduled).toContain("Hoy o después.");
  });

  it("con guaraníes, la ayuda del precio avisa que va sin decimales", () => {
    expect(render("won", { values: { saleCurrency: "PYG" } })).toContain(
      "En guaraníes, sin decimales.",
    );
  });

  it("vuelve con lo cargado (eco del servidor)", () => {
    const html = render("won", {
      values: {
        salePrice: "47.500",
        saleCurrency: "USD",
        paymentMethod: "mixed",
        deliveryStatus: "scheduled",
        deliveryDate: "2026-10-20",
      },
    });
    expect(control(html, "salePrice")).toContain('value="47.500"');
    expect(control(html, "deliveryDate")).toContain('value="2026-10-20"');
    expect(html).toMatch(/<option value="mixed" selected="">/);
    expect(html).toMatch(/<option value="USD" selected="">/);
  });

  it("cada error se muestra y se enlaza a su control", () => {
    const html = render("won", {
      errors: {
        salePrice: "pyg_decimals",
        deliveryDate: "delivered_in_future",
      },
    });
    for (const [name, text] of [
      ["salePrice", "En guaraníes, el monto va sin decimales."],
      ["deliveryDate", "Una entrega hecha no puede tener una fecha futura."],
    ] as const) {
      const tag = control(html, name);
      expect(tag).toContain('aria-invalid="true"');
      const errorId = tag.match(/aria-describedby="[^"]*?(\S+-error)"/)?.[1];
      expect(errorId, name).toBeDefined();
      expect(html).toContain(
        `<p id="${errorId}" class="text-caption text-danger">${text}</p>`,
      );
    }
    expect(control(html, "paymentMethod")).not.toContain('aria-invalid="true"');
  });

  it("sin unidad vinculada no pide nada: avisa que hay que vincularla", () => {
    const html = render("won", { saleVehicle: null });
    expect(html).toContain('role="alert"');
    expect(html).toContain(
      "primero vinculá la unidad que se vende desde los matches en stock",
    );
    expect(names(html)).toEqual([]);
  });
});

describe("Perdida", () => {
  it("pide el motivo (lista nueva) y notas opcionales con contador", () => {
    const html = render("lost");
    expect(names(html)).toEqual([...OUTCOME_FIELDS.lost]);
    expect(options(html, "lossReason")).toEqual([
      ["price", "Precio"],
      ["vehicle_unavailable", "Unidad no disponible"],
      ["competitor", "Compró en la competencia"],
      ["financing_rejected", "Financiación rechazada"],
      ["ghosted", "Dejó de responder"],
      ["other", "Otro motivo"],
    ]);
    expect(html).toMatch(/<textarea[^>]*name="lossNotes"/);
    expect(html).toContain("(opcional)");
    expect(html).toContain("0 / 500");
    expect(html).not.toContain("Unidad vendida");
  });

  it("el contador cuenta las notas como las guarda el servidor (normalizadas)", () => {
    expect(
      render("lost", { values: { lossNotes: "  hola    che  " } }),
    ).toContain("8 / 500");
  });

  it("sin motivo: el error se enlaza al select", () => {
    const html = render("lost", { errors: { lossReason: "required" } });
    expect(control(html, "lossReason")).toContain('aria-invalid="true"');
    expect(html).toContain("Elegí un motivo para cerrarla.");
  });

  it("notas demasiado largas: el textarea queda inválido", () => {
    const html = render("lost", {
      errors: { lossNotes: "too_long" },
      values: { lossNotes: "x".repeat(501) },
    });
    expect(control(html, "lossNotes")).toContain('aria-invalid="true"');
    expect(html).toContain("Las notas pueden tener hasta 500 caracteres.");
    expect(html).toContain("501 / 500");
  });
});

describe("copy de los errores", () => {
  it("cada error de cada campo tiene su mensaje es-PY", () => {
    for (const field of [...OUTCOME_FIELDS.won, ...OUTCOME_FIELDS.lost]) {
      for (const error of CLOSURE_FIELD_ERRORS) {
        expect(closureErrorMessage(field, error).length).toBeGreaterThan(0);
      }
    }
  });
});

describe("StageCloseDialog", () => {
  it.each([
    ["won", "Marcar como ganada"],
    ["lost", "Marcar como perdida"],
  ] as const)("cerrado (%s), solo dibuja su botón", (to, label) => {
    const html = renderToStaticMarkup(
      createElement(StageCloseDialog, {
        to,
        opportunityId: "10000000-0000-4000-8000-000000000101",
        stage: "negotiating",
        saleVehicle: SALE_VEHICLE,
        open: false,
        onOpenChange: () => {},
        onSettled: () => {},
        onCloseAutoFocus: () => {},
      }),
    );
    expect(html).toMatch(new RegExp(`<button[^>]*>${label}</button>`));
    expect(html).not.toContain("<form");
  });

  it.each<[CloseOpportunityState, string | null]>([
    [
      { status: "failed", outcome: "won", values: {} as ClosureValues },
      "No pudimos cerrar la oportunidad",
    ],
    [
      { status: "vehicle_required", opportunityId: "x" },
      "ya no tiene una unidad vinculada",
    ],
    [
      {
        status: "invalid",
        outcome: "lost",
        errors: {},
        values: {} as ClosureValues,
      },
      "Revisá los datos marcados",
    ],
    [null, null],
    [
      { status: "closed", opportunityId: "x", from: "negotiating", to: "won" },
      null,
    ],
  ])("el aviso dentro del diálogo (%j)", (state, text) => {
    const html = renderToStaticMarkup(createElement(ClosureAlert, { state }));
    if (text === null) expect(html).toBe("");
    else {
      expect(html).toContain('role="alert"');
      expect(html).toContain(text);
    }
  });
});

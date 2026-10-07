import { describe, expect, it, vi } from "vitest";

import { opportunitySources } from "@/db/schema";
import { SOURCE_LABELS, SOURCES } from "@/domains/opportunities/labels";
import {
  DEMAND_FORM_FIELDS,
  EMPTY_DEMAND_FORM_VALUES,
} from "@/domains/demand/form";
import {
  NEW_OPPORTUNITY_FIELDS,
  NEW_OPPORTUNITY_MAX_LENGTH,
} from "@/domains/opportunities/new-opportunity";
import { MAX_PHONE_INPUT_LENGTH } from "@/lib/contacts/phone";
import { parseNewOpportunityForm } from "@/lib/opportunities/new-opportunity";

/*
 * Validación server-side del alta manual (H1.2, H1.4): qué acepta realmente
 * el servidor del formulario, sin base de datos. "Lo que busca" reemplaza a
 * "Modelo buscado" y "Versión" (C-4): todo opcional.
 */

vi.mock("server-only", () => ({}));

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.append(name, value);
  return data;
}

const VALID = {
  name: "Lucía Ortiz",
  phone: "0981 555 214",
  city: "Luque",
  source: "showroom",
  brand: "Toyota",
  model: "Corolla Cross",
};

/** El eco de todos los campos: los de la demanda que no vinieron, vacíos. */
const ECHO = { ...EMPTY_DEMAND_FORM_VALUES, ...VALID };

describe("contrato del formulario", () => {
  it("los orígenes son exactamente los del CHECK de la base, sin `manual`", () => {
    expect([...SOURCES].sort()).toEqual([...opportunitySources].sort());
    expect(SOURCES).not.toContain("manual");
    expect(Object.keys(SOURCE_LABELS).sort()).toEqual([...SOURCES].sort());
  });

  it("el largo máximo del teléfono es la cota del normalizador", () => {
    expect(NEW_OPPORTUNITY_MAX_LENGTH.phone).toBe(MAX_PHONE_INPUT_LENGTH);
  });

  it("los campos son solo datos del contacto, el origen y lo que busca (sin Versión, C-4)", () => {
    expect(NEW_OPPORTUNITY_FIELDS).toEqual([
      "name",
      "phone",
      "city",
      "source",
      ...DEMAND_FORM_FIELDS,
    ]);
    expect(NEW_OPPORTUNITY_FIELDS).not.toContain("interestModel");
    expect(NEW_OPPORTUNITY_FIELDS).not.toContain("interestVersion");
  });
});

describe("parseNewOpportunityForm", () => {
  it("un formulario válido da el input normalizado, con E.164 y sin nada más", () => {
    const parsed = parseNewOpportunityForm(form(VALID));
    expect(parsed).toEqual({
      ok: true,
      input: {
        contact: {
          name: "Lucía Ortiz",
          phone: "0981 555 214",
          phoneNormalized: "+595981555214",
          city: "Luque",
        },
        source: "showroom",
        demand: {
          desired_vehicle: { brand: "Toyota", model: "Corolla Cross" },
        },
      },
      values: ECHO,
    });
  });

  it("organización, usuario, contacto, etapa, timestamps y scores del payload se ignoran", () => {
    const parsed = parseNewOpportunityForm(
      form({
        ...VALID,
        organizationId: "00000000-0000-4000-8000-000000000002",
        organization_id: "00000000-0000-4000-8000-000000000002",
        userId: "00000000-0000-4000-8000-00000000000b",
        contactId: "10000000-0000-4000-8000-000000000003",
        stage: "negotiation",
        createdAt: "2020-01-01T00:00:00Z",
        lastActivityAt: "2020-01-01T00:00:00Z",
        porandu: "99",
      }),
    );
    if (!parsed.ok) throw new Error("expected ok");
    expect(Object.keys(parsed.input).sort()).toEqual([
      "contact",
      "demand",
      "source",
    ]);
    expect(Object.keys(parsed.input.contact).sort()).toEqual([
      "city",
      "name",
      "phone",
      "phoneNormalized",
    ]);
    expect(Object.keys(parsed.values).sort()).toEqual(
      [...NEW_OPPORTUNITY_FIELDS].sort(),
    );
  });

  it("normaliza textos de una línea: NFC, espacios y caracteres de control", () => {
    const parsed = parseNewOpportunityForm(
      form({
        ...VALID,
        // "Lucía" con la tilde combinada (NFD).
        name: "  Lucía \t\n Ortiz\u0000 ",
        phone: " (0981)  555-214 ",
        city: "San\u0007Lorenzo",
      }),
    );
    if (!parsed.ok) throw new Error("expected ok");
    expect(parsed.input.contact).toEqual({
      name: "Lucía Ortiz",
      phone: "(0981) 555-214",
      phoneNormalized: "+595981555214",
      city: "San Lorenzo",
    });
  });

  it("los opcionales vacíos son sin dato (null)", () => {
    const parsed = parseNewOpportunityForm(
      form({ name: "Lucía", phone: "+595 981 555 214", source: "web" }),
    );
    if (!parsed.ok) throw new Error("expected ok");
    expect(parsed.input).toEqual({
      contact: expect.objectContaining({ city: null }),
      source: "web",
      // Sin "Lo que busca": ningún fact (U1).
      demand: {},
    });
  });

  it("lo que busca: solo los facts con dato, en su forma canónica (T26: entrega 0)", () => {
    const parsed = parseNewOpportunityForm(
      form({
        ...VALID,
        brand: "",
        model: "Hilux",
        purchaseType: "financed",
        downPaymentAmount: "0",
        downPaymentCurrency: "PYG",
        tradeIn: "yes",
        budgetAmount: "250.000.000",
        budgetCurrency: "PYG",
        yearMin: "2018",
        yearMax: "2021",
      }),
    );
    if (!parsed.ok) throw new Error("expected ok");
    expect(parsed.input.demand).toEqual({
      desired_vehicle: { model: "Hilux" },
      year_range: { min: 2018, max: 2021 },
      budget_max: { amount: "250000000.00", currency: "PYG" },
      purchase_type: "financed",
      trade_in_intent: true,
      down_payment: { amount: "0.00", currency: "PYG" },
    });
  });

  it("un dato inválido de lo que busca vuelve con su error y no crea nada", () => {
    expect(
      parseNewOpportunityForm(
        form({
          ...VALID,
          budgetAmount: "150.000.000,5",
          budgetCurrency: "PYG",
          yearMin: "18",
        }),
      ),
    ).toMatchObject({
      ok: false,
      errors: { budgetAmount: "pyg_decimals", yearMin: "invalid_year" },
    });
  });

  it("nombre, teléfono y origen son obligatorios", () => {
    expect(
      parseNewOpportunityForm(
        form({ name: " ", phone: "", source: "", city: "Luque" }),
      ),
    ).toEqual({
      ok: false,
      errors: { name: "required", phone: "required", source: "required" },
      values: {
        ...EMPTY_DEMAND_FORM_VALUES,
        name: "",
        phone: "",
        city: "Luque",
        source: "",
      },
    });
    expect(parseNewOpportunityForm(new FormData())).toMatchObject({
      ok: false,
      errors: { name: "required", phone: "required", source: "required" },
    });
  });

  it.each(["0981 1", "0981 555 2140", "abc", "0981 555 214 ext 3"])(
    "un teléfono inválido (%s) se rechaza",
    (phone) => {
      expect(parseNewOpportunityForm(form({ ...VALID, phone }))).toMatchObject({
        ok: false,
        errors: { phone: "invalid_phone" },
      });
    },
  );

  it.each(["manual", "WhatsApp", "instagram", "meta ads", "web,showroom"])(
    "solo se acepta un origen de la lista: %j",
    (source) => {
      expect(parseNewOpportunityForm(form({ ...VALID, source }))).toMatchObject(
        { ok: false, errors: { source: "invalid_source" } },
      );
    },
  );

  it("cada origen de la lista se acepta (con espacios alrededor recortados)", () => {
    for (const source of SOURCES) {
      const parsed = parseNewOpportunityForm(
        form({ ...VALID, source: ` ${source} ` }),
      );
      expect(parsed.ok && parsed.input.source).toBe(source);
    }
  });

  it("cada texto tiene un largo máximo razonable", () => {
    const tooLong = Object.fromEntries(
      Object.entries(NEW_OPPORTUNITY_MAX_LENGTH).map(([field, max]) => [
        field,
        "x".repeat(max + 1),
      ]),
    );
    expect(
      parseNewOpportunityForm(
        form({
          ...VALID,
          ...tooLong,
          brand: "x".repeat(41),
          model: "y".repeat(81),
        }),
      ),
    ).toMatchObject({
      ok: false,
      errors: {
        name: "too_long",
        phone: "too_long",
        city: "too_long",
        brand: "too_long",
        model: "too_long",
      },
    });
    const atLimit = {
      ...Object.fromEntries(
        (["name", "city"] as const).map((field) => [
          field,
          "x".repeat(NEW_OPPORTUNITY_MAX_LENGTH[field]),
        ]),
      ),
      brand: "x".repeat(40),
      model: "y".repeat(80),
    };
    expect(parseNewOpportunityForm(form({ ...VALID, ...atLimit })).ok).toBe(
      true,
    );
  });

  it("el eco de un error está acotado", () => {
    const parsed = parseNewOpportunityForm(
      form({ ...VALID, model: "x".repeat(10_000) }),
    );
    expect(parsed.ok).toBe(false);
    expect(parsed.values.model).toHaveLength(256);
  });

  it("un archivo en lugar de texto cuenta como vacío", () => {
    const data = form(VALID);
    data.set("name", new Blob(["Lucía"]), "name.txt");
    expect(parseNewOpportunityForm(data)).toMatchObject({
      ok: false,
      errors: { name: "required" },
    });
  });
});

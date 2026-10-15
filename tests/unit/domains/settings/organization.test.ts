import { describe, expect, it } from "vitest";

import { organizationCurrencies } from "@/db/schema/organizations";
import {
  DEFAULT_CURRENCIES,
  normalizeOrganizationName,
  ORGANIZATION_FIELDS,
  ORGANIZATION_NAME_MAX_LENGTH,
  organizationNameLength,
  parseOrganizationSettings,
} from "@/domains/settings/organization";

/*
 * Configuración general del concesionario (Hito 6, DEC-038 §2 y §7):
 * normalización del nombre y validación del pedido con Zod. La base exige
 * lo esencial con sus CHECKs (tests/db/team-settings.test.ts).
 */

describe("listas y campos", () => {
  it("la moneda por defecto espeja el CHECK de organizations (PYG y USD)", () => {
    expect(DEFAULT_CURRENCIES).toEqual(["PYG", "USD"]);
    expect([...organizationCurrencies]).toEqual([...DEFAULT_CURRENCIES]);
  });

  it("el pedido solo trae nombre y moneda (la organización sale del contexto)", () => {
    expect(Object.values(ORGANIZATION_FIELDS)).toEqual([
      "name",
      "defaultCurrency",
    ]);
  });
});

describe("normalizeOrganizationName", () => {
  it.each([
    ["recorta los bordes", "  Porandú Autos  ", "Porandú Autos"],
    ["colapsa espacios y tabs", "Porandú \t  Autos", "Porandú Autos"],
    ["una sola línea", "Porandú\r\nAutos", "Porandú Autos"],
    ["sin caracteres de control", "Porandú\u0007Autos", "Porandú Autos"],
    ["NFC", "Porandú", "Porandú"],
  ])("%s", (_case, raw, expected) => {
    expect(normalizeOrganizationName(raw)).toBe(expected);
  });

  it("cuenta code points, como char_length", () => {
    expect(organizationNameLength("Ñandutí 🚗")).toBe(9);
  });
});

describe("parseOrganizationSettings (Zod)", () => {
  it("acepta un nombre y una moneda válidos, normalizados", () => {
    expect(
      parseOrganizationSettings({
        name: "  Automotor   Asunción ",
        defaultCurrency: " USD ",
      }),
    ).toEqual({
      ok: true,
      settings: { name: "Automotor Asunción", defaultCurrency: "USD" },
    });
  });

  it("el nombre es obligatorio (solo espacios no cuenta)", () => {
    expect(
      parseOrganizationSettings({ name: " \t ", defaultCurrency: "PYG" }),
    ).toEqual({ ok: false, errors: { name: "required" } });
  });

  it(`el nombre admite hasta ${ORGANIZATION_NAME_MAX_LENGTH} caracteres`, () => {
    const max = "a".repeat(ORGANIZATION_NAME_MAX_LENGTH);
    expect(
      parseOrganizationSettings({ name: max, defaultCurrency: "PYG" }).ok,
    ).toBe(true);
    expect(
      parseOrganizationSettings({ name: `${max}a`, defaultCurrency: "PYG" }),
    ).toEqual({ ok: false, errors: { name: "too_long" } });
  });

  it.each([
    ["", "required"],
    ["EUR", "invalid_option"],
    ["pyg", "invalid_option"],
  ])("moneda %j → %s", (defaultCurrency, error) => {
    expect(
      parseOrganizationSettings({ name: "Porandú", defaultCurrency }),
    ).toEqual({ ok: false, errors: { defaultCurrency: error } });
  });

  it("devuelve el primer error de cada campo inválido", () => {
    expect(
      parseOrganizationSettings({ name: "", defaultCurrency: "ARS" }),
    ).toEqual({
      ok: false,
      errors: { name: "required", defaultCurrency: "invalid_option" },
    });
  });
});

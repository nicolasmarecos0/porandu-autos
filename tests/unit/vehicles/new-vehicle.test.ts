import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { vehicleCurrencies, vehicles } from "@/db/schema";
import {
  CURRENCIES,
  CURRENCY_LABELS,
  MAX_KM,
  NEW_VEHICLE_FIELDS,
  NEW_VEHICLE_MAX_LENGTH,
  VEHICLE_YEAR_RANGE,
} from "@/domains/vehicles/new-vehicle";
import { parseNewVehicleForm } from "@/lib/vehicles/new-vehicle";

/*
 * Validación server-side del alta rápida (H1.3B): qué acepta realmente el
 * servidor del formulario, sin base de datos. Las mismas reglas las exigen
 * los CHECK de la base (tests/db/schema.test.ts); acá se prueba que un
 * payload inválido no llega a escribirse.
 */

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.append(name, value);
  return data;
}

const EMPTY = {
  brand: "",
  model: "",
  version: "",
  year: "",
  km: "",
  price: "",
  currency: "",
};

const VALID = {
  brand: "Toyota",
  model: "Hilux",
  version: "SRV 2.8 4x4 AT",
  year: "2021",
  km: "142.000",
  price: "31.500",
  currency: "USD",
};

function checkSql(name: string): string | undefined {
  const check = getTableConfig(vehicles).checks.find((c) => c.name === name);
  return check && new PgDialect().sqlToQuery(check.value).sql;
}

describe("contrato del formulario", () => {
  it("los campos son solo datos de la unidad: ni organización ni estado", () => {
    expect(NEW_VEHICLE_FIELDS).toEqual([
      "brand",
      "model",
      "version",
      "year",
      "km",
      "price",
      "currency",
    ]);
  });

  it("las monedas son exactamente las del CHECK de la base, con su copy", () => {
    expect([...CURRENCIES].sort()).toEqual([...vehicleCurrencies].sort());
    expect(Object.keys(CURRENCY_LABELS).sort()).toEqual([...CURRENCIES].sort());
  });

  it("el rango del año es el del CHECK de la base", () => {
    expect(checkSql("vehicles_year_check")).toBe(
      `"vehicles"."year" BETWEEN ${VEHICLE_YEAR_RANGE.min} AND ${VEHICLE_YEAR_RANGE.max}`,
    );
  });

  it("el kilometraje máximo es el de un integer de PostgreSQL", () => {
    expect(MAX_KM).toBe(2 ** 31 - 1);
  });
});

describe("parseNewVehicleForm: lo válido", () => {
  it("un formulario completo da el input normalizado, sin nada más", () => {
    expect(parseNewVehicleForm(form(VALID))).toEqual({
      ok: true,
      input: {
        brand: "Toyota",
        model: "Hilux",
        version: "SRV 2.8 4x4 AT",
        year: 2021,
        km: 142000,
        price: { amount: "31500.00", currency: "USD" },
      },
      values: VALID,
    });
  });

  it("solo marca, modelo y año: el resto queda sin dato (null)", () => {
    const parsed = parseNewVehicleForm(
      form({ brand: "Hyundai", model: "HB20", year: "2019" }),
    );
    expect(parsed).toEqual({
      ok: true,
      input: {
        brand: "Hyundai",
        model: "HB20",
        version: null,
        year: 2019,
        km: null,
        price: null,
      },
      values: { ...EMPTY, brand: "Hyundai", model: "HB20", year: "2019" },
    });
  });

  it("textos de una línea: NFC, sin caracteres de control, un solo espacio", () => {
    const parsed = parseNewVehicleForm(
      form({
        ...VALID,
        // "e" + diéresis combinante: NFC la compone en "ë".
        brand: "  Citroën ",
        model: "C3\tAircross",
        version: "Feel\u0000  1.2\nPureTech ",
      }),
    );
    expect(parsed.ok && parsed.input).toMatchObject({
      brand: "Citroën",
      model: "C3 Aircross",
      version: "Feel 1.2 PureTech",
    });
    expect(parsed.ok && parsed.input.brand).toBe("Citroën");
  });

  it.each([
    ["1900", 1900],
    ["2100", 2100],
    [" 2025 ", 2025],
  ])("año %j → %d (rango del CHECK, extremos incluidos)", (year, expected) => {
    const parsed = parseNewVehicleForm(form({ ...VALID, year }));
    expect(parsed.ok && parsed.input.year).toBe(expected);
  });

  it.each([
    ["0", 0],
    ["142000", 142000],
    ["142.000", 142000],
    [String(MAX_KM), MAX_KM],
  ])("km %j → %d (0 es una unidad 0 km, no sin dato)", (km, expected) => {
    const parsed = parseNewVehicleForm(form({ ...VALID, km }));
    expect(parsed.ok && parsed.input.km).toBe(expected);
  });

  it.each([
    ["31.500", "USD", "31500.00"],
    ["32.990,50", "USD", "32990.50"],
    ["32990,5", "USD", "32990.50"],
    ["0,01", "USD", "0.01"],
    ["999.999.999.999,99", "USD", "999999999999.99"],
    ["150.000.000", "PYG", "150000000.00"],
    ["150000000", "PYG", "150000000.00"],
    // El valor es entero: en guaraníes ",00" no es un decimal.
    ["150.000.000,00", "PYG", "150000000.00"],
  ])("precio %j %s → %s, exacto", (price, currency, amount) => {
    const parsed = parseNewVehicleForm(form({ ...VALID, price, currency }));
    expect(parsed.ok && parsed.input.price).toEqual({ amount, currency });
  });

  it("sin precio ni moneda, el precio queda sin dato", () => {
    const parsed = parseNewVehicleForm(
      form({ ...VALID, price: "", currency: "" }),
    );
    expect(parsed.ok && parsed.input.price).toBeNull();
  });

  it("organización, estado, id, timestamps y fotos del payload se ignoran", () => {
    const parsed = parseNewVehicleForm(
      form({
        ...VALID,
        organizationId: "00000000-0000-4000-8000-000000000002",
        organization_id: "00000000-0000-4000-8000-000000000002",
        status: "available",
        id: "20000000-0000-4000-8000-000000000999",
        createdAt: "2020-01-01T00:00:00Z",
        created_at: "2020-01-01T00:00:00Z",
        updated_at: "2020-01-01T00:00:00Z",
        photos: "https://example.test/hilux.jpg",
      }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(Object.keys(parsed.input).sort()).toEqual([
      "brand",
      "km",
      "model",
      "price",
      "version",
      "year",
    ]);
    expect(Object.keys(parsed.values).sort()).toEqual(
      [...NEW_VEHICLE_FIELDS].sort(),
    );
    expect(JSON.stringify(parsed)).not.toMatch(
      /000000000002|000000000999|available|2020-01-01|example\.test/,
    );
  });
});

describe("parseNewVehicleForm: lo inválido no llega a la escritura", () => {
  it("sin nada: marca, modelo y año son obligatorios", () => {
    expect(parseNewVehicleForm(form({}))).toEqual({
      ok: false,
      errors: { brand: "required", model: "required", year: "required" },
      values: EMPTY,
    });
  });

  it("solo espacios o caracteres de control cuentan como vacío", () => {
    const parsed = parseNewVehicleForm(
      form({ ...VALID, brand: "   ", model: "\u0000\t" }),
    );
    expect(parsed).toMatchObject({
      ok: false,
      errors: { brand: "required", model: "required" },
    });
  });

  it.each([
    ["brand", NEW_VEHICLE_MAX_LENGTH.brand],
    ["model", NEW_VEHICLE_MAX_LENGTH.model],
    ["version", NEW_VEHICLE_MAX_LENGTH.version],
  ] as const)("%s más largo que %d caracteres", (field, max) => {
    expect(
      parseNewVehicleForm(form({ ...VALID, [field]: "x".repeat(max) })).ok,
    ).toBe(true);
    expect(
      parseNewVehicleForm(form({ ...VALID, [field]: "x".repeat(max + 1) })),
    ).toMatchObject({ ok: false, errors: { [field]: "too_long" } });
  });

  it.each([
    ["1899"],
    ["2101"],
    ["0000"],
    ["21"],
    ["20211"],
    ["2021.0"],
    ["2.021"],
    ["-2021"],
    ["+2021"],
    ["2021a"],
    ["abcd"],
    ["２０２１"],
  ])("año %j fuera del rango del schema o no entero", (year) => {
    expect(parseNewVehicleForm(form({ ...VALID, year }))).toMatchObject({
      ok: false,
      errors: { year: "invalid_year" },
    });
  });

  it.each([
    ["-1"],
    ["-0"],
    ["12,5"],
    ["1.5"],
    ["12.50"],
    ["1 000"],
    ["abc"],
    ["1e3"],
    [String(MAX_KM + 1)],
    ["2.147.483.648"],
  ])("km %j: no es un entero ≥ 0 (o no entra en la base)", (km) => {
    expect(parseNewVehicleForm(form({ ...VALID, km }))).toMatchObject({
      ok: false,
      errors: { km: "invalid_km" },
    });
  });

  it.each([
    ["0"],
    ["0,00"],
    ["000"],
    ["-5"],
    ["abc"],
    // Punto decimal: ambiguo en es-PY, nunca se lee como decimal.
    ["49900.50"],
    ["1.5"],
    ["12,345"],
    ["USD 31.500"],
    // numeric(14, 2): más de 12 dígitos enteros no entra.
    ["1.000.000.000.000"],
  ])("precio %j: no es un monto > 0 válido", (price) => {
    expect(parseNewVehicleForm(form({ ...VALID, price }))).toMatchObject({
      ok: false,
      errors: { price: "invalid_price" },
    });
  });

  it.each([["150.000.000,50"], ["150000000,01"], ["1,5"]])(
    "PYG %j: en guaraníes no hay decimales",
    (price) => {
      expect(
        parseNewVehicleForm(form({ ...VALID, price, currency: "PYG" })),
      ).toMatchObject({ ok: false, errors: { price: "pyg_decimals" } });
      // El mismo monto en dólares sí es válido.
      expect(
        parseNewVehicleForm(form({ ...VALID, price, currency: "USD" })).ok,
      ).toBe(true);
    },
  );

  it.each([["EUR"], ["usd"], ["Gs."], ["guaraníes"], ["PYG,USD"]])(
    "moneda %j: solo PYG o USD",
    (currency) => {
      expect(parseNewVehicleForm(form({ ...VALID, currency }))).toMatchObject({
        ok: false,
        errors: { currency: "invalid_currency" },
      });
    },
  );

  it("precio sin moneda: falta la moneda", () => {
    expect(parseNewVehicleForm(form({ ...VALID, currency: "" }))).toMatchObject(
      { ok: false, errors: { currency: "required" } },
    );
  });

  it("moneda sin precio: falta el precio", () => {
    expect(parseNewVehicleForm(form({ ...VALID, price: "" }))).toMatchObject({
      ok: false,
      errors: { price: "required" },
    });
  });

  it("precio inválido y sin moneda: los dos errores, a la vez", () => {
    expect(
      parseNewVehicleForm(form({ ...VALID, price: "abc", currency: "" })),
    ).toEqual({
      ok: false,
      errors: { price: "invalid_price", currency: "required" },
      values: { ...VALID, price: "abc", currency: "" },
    });
  });

  it("todos los errores juntos vuelven con lo cargado, para corregir", () => {
    const parsed = parseNewVehicleForm(
      form({
        brand: "",
        model: "Hilux",
        version: "x".repeat(81),
        year: "1899",
        km: "-5",
        price: "0",
        currency: "EUR",
      }),
    );
    expect(parsed).toEqual({
      ok: false,
      errors: {
        brand: "required",
        version: "too_long",
        year: "invalid_year",
        km: "invalid_km",
        price: "invalid_price",
        currency: "invalid_currency",
      },
      values: {
        brand: "",
        model: "Hilux",
        version: "x".repeat(81),
        year: "1899",
        km: "-5",
        price: "0",
        currency: "EUR",
      },
    });
  });

  it("el eco de lo cargado tiene una cota, aunque el payload sea enorme", () => {
    const parsed = parseNewVehicleForm(
      form({ ...VALID, brand: "x".repeat(10_000), price: "9".repeat(10_000) }),
    );
    expect(parsed).toMatchObject({
      ok: false,
      errors: { brand: "too_long", price: "invalid_price" },
    });
    expect(parsed.values.brand).toHaveLength(256);
    expect(parsed.values.price).toHaveLength(256);
  });

  it("un archivo en lugar de texto cuenta como vacío", () => {
    const data = form({ ...VALID });
    data.set("brand", new Blob(["Toyota"]), "brand.txt");
    expect(parseNewVehicleForm(data)).toMatchObject({
      ok: false,
      errors: { brand: "required" },
    });
  });
});

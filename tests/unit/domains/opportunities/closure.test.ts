import { describe, expect, it } from "vitest";

import {
  CLOSURE_FIELDS,
  CLOSURE_OUTCOMES,
  closureFromRow,
  closureSummary,
  DELIVERY_STATUS_OPTIONS,
  DELIVERY_STATUSES,
  formatCalendarDate,
  isCalendarDate,
  isClosureOutcome,
  isLossReason,
  LOSS_NOTES_MAX_LENGTH,
  LOSS_REASON_OPTIONS,
  LOSS_REASONS,
  OUTCOME_FIELDS,
  parseClosure,
  PAYMENT_METHOD_OPTIONS,
  PAYMENT_METHODS,
  planOpportunityClosure,
  todayInAsuncion,
  type Closure,
  type ClosureRow,
  type ClosureValues,
} from "@/domains/opportunities/closure";
import {
  DELIVERY_STATUS_LABELS,
  LOSS_REASON_LABELS,
  PAYMENT_METHOD_LABELS,
} from "@/domains/opportunities/labels";
import {
  canTransition,
  OPPORTUNITY_STAGES,
  type Stage,
} from "@/domains/opportunities/stages";

/*
 * Cierre comercial (DEC-034): listas, validación con Zod del pedido, plan
 * sobre la fila bloqueada y resumen. Dominio puro, sin base: la base lo
 * vuelve a exigir con sus CHECKs y su trigger (tests/db/opportunity-closure).
 */

const TODAY = "2026-10-11";

const EMPTY: ClosureValues = {
  salePrice: "",
  saleCurrency: "",
  paymentMethod: "",
  deliveryStatus: "",
  deliveryDate: "",
  lossReason: "",
  lossNotes: "",
};

/** Una venta válida, con lo que se quiera pisar. */
function won(overrides: Partial<ClosureValues> = {}) {
  return parseClosure(
    "won",
    {
      ...EMPTY,
      salePrice: "47.500",
      saleCurrency: "USD",
      paymentMethod: "financing",
      deliveryStatus: "scheduled",
      deliveryDate: "2026-10-15",
      ...overrides,
    },
    TODAY,
  );
}

function lost(overrides: Partial<ClosureValues> = {}) {
  return parseClosure(
    "lost",
    { ...EMPTY, lossReason: "competitor", ...overrides },
    TODAY,
  );
}

describe("listas (DEC-034 §2 y §3)", () => {
  it("los resultados son las etapas terminales", () => {
    expect(CLOSURE_OUTCOMES).toEqual(["won", "lost"]);
    expect(isClosureOutcome("won")).toBe(true);
    expect(isClosureOutcome("lost")).toBe(true);
    for (const value of ["negotiating", "WON", "", null, 1]) {
      expect(isClosureOutcome(value)).toBe(false);
    }
  });

  it("los motivos de pérdida son los seis del pedido, en este orden", () => {
    expect(LOSS_REASONS).toEqual([
      "price",
      "vehicle_unavailable",
      "competitor",
      "financing_rejected",
      "ghosted",
      "other",
    ]);
    for (const reason of LOSS_REASONS) expect(isLossReason(reason)).toBe(true);
    // Los de DEC-032 §3 que no siguen ya no existen.
    for (const value of [
      "vehicle_not_available",
      "bought_elsewhere",
      "no_response",
      "unqualified",
      "Price",
      "",
      null,
    ]) {
      expect(isLossReason(value)).toBe(false);
    }
  });

  it("formas de pago y estados de entrega", () => {
    expect(PAYMENT_METHODS).toEqual(["cash", "financing", "trade_in", "mixed"]);
    expect(DELIVERY_STATUSES).toEqual(["scheduled", "delivered"]);
  });

  it("cada valor tiene su copy es-PY y las opciones siguen el orden de la lista", () => {
    expect(LOSS_REASON_OPTIONS).toEqual(
      LOSS_REASONS.map((id) => ({ id, label: LOSS_REASON_LABELS[id] })),
    );
    expect(LOSS_REASON_OPTIONS.map((o) => o.label)).toEqual([
      "Precio",
      "Unidad no disponible",
      "Compró en la competencia",
      "Financiación rechazada",
      "Dejó de responder",
      "Otro motivo",
    ]);
    expect(PAYMENT_METHOD_OPTIONS.map((o) => [o.id, o.label])).toEqual([
      ["cash", "Contado"],
      ["financing", "Financiación"],
      ["trade_in", "Usado como parte de pago"],
      ["mixed", "Mixto"],
    ]);
    expect(DELIVERY_STATUS_OPTIONS.map((o) => [o.id, o.label])).toEqual([
      ["scheduled", "Entrega programada"],
      ["delivered", "Entregada"],
    ]);
    expect(Object.keys(PAYMENT_METHOD_LABELS)).toEqual([...PAYMENT_METHODS]);
    expect(Object.keys(DELIVERY_STATUS_LABELS)).toEqual([...DELIVERY_STATUSES]);
  });

  it("el pedido trae la oportunidad, el resultado y los campos de cada resultado", () => {
    expect(Object.values(CLOSURE_FIELDS)).toEqual([
      "opportunityId",
      "outcome",
      "lossReason",
      "lossNotes",
      "salePrice",
      "saleCurrency",
      "paymentMethod",
      "deliveryStatus",
      "deliveryDate",
    ]);
    expect(OUTCOME_FIELDS).toEqual({
      won: [
        "salePrice",
        "saleCurrency",
        "paymentMethod",
        "deliveryStatus",
        "deliveryDate",
      ],
      lost: ["lossReason", "lossNotes"],
    });
  });
});

describe("parseClosure(): pérdida", () => {
  it("motivo obligatorio de la lista; sin notas, null", () => {
    expect(lost()).toEqual({
      ok: true,
      closure: { outcome: "lost", lossReason: "competitor", lossNotes: null },
    });
    expect(lost({ lossReason: "" })).toEqual({
      ok: false,
      errors: { lossReason: "required" },
    });
    expect(lost({ lossReason: "   " })).toEqual({
      ok: false,
      errors: { lossReason: "required" },
    });
    for (const reason of ["caro", "bought_elsewhere", "PRICE"]) {
      expect(lost({ lossReason: reason })).toEqual({
        ok: false,
        errors: { lossReason: "invalid_option" },
      });
    }
  });

  it("las notas se normalizan como la bitácora: NFC, saltos y espacios", () => {
    expect(
      lost({ lossNotes: "  Le ofrecieron   otra\r\n\r\n\r\n tasación\t " }),
    ).toMatchObject({
      ok: true,
      closure: { lossNotes: "Le ofrecieron otra\n\ntasación" },
    });
    // "é" descompuesta (e + acento) se guarda compuesta.
    expect(lost({ lossNotes: "Café" })).toMatchObject({
      closure: { lossNotes: "Café" },
    });
    // Solo espacios o saltos: no hay notas.
    expect(lost({ lossNotes: " \n \r\n\t" })).toMatchObject({
      ok: true,
      closure: { lossNotes: null },
    });
  });

  it("hasta 500 caracteres (code points, como char_length), contados después de normalizar", () => {
    const limit = "a".repeat(LOSS_NOTES_MAX_LENGTH);
    expect(lost({ lossNotes: limit })).toMatchObject({
      ok: true,
      closure: { lossNotes: limit },
    });
    expect(lost({ lossNotes: `${limit}b` })).toEqual({
      ok: false,
      errors: { lossNotes: "too_long" },
    });
    // Un emoji es un carácter, aunque en UTF-16 ocupe dos.
    expect(lost({ lossNotes: "🚗".repeat(500) })).toMatchObject({ ok: true });
    // Los espacios sobrantes no cuentan.
    expect(lost({ lossNotes: `   ${limit}   ` })).toMatchObject({ ok: true });
  });

  it("motivo y notas inválidos se informan juntos", () => {
    expect(lost({ lossReason: "", lossNotes: "x".repeat(501) })).toEqual({
      ok: false,
      errors: { lossReason: "required", lossNotes: "too_long" },
    });
  });

  it("los campos de la venta se ignoran", () => {
    expect(
      lost({ salePrice: "abc", saleCurrency: "EUR", deliveryDate: "ayer" }),
    ).toEqual({
      ok: true,
      closure: { outcome: "lost", lossReason: "competitor", lossNotes: null },
    });
  });
});

describe("parseClosure(): venta", () => {
  it("una venta válida: monto exacto es-PY con su moneda (domains/money.ts)", () => {
    expect(won()).toEqual({
      ok: true,
      closure: {
        outcome: "won",
        salePrice: { amount: "47500.00", currency: "USD" },
        paymentMethod: "financing",
        deliveryStatus: "scheduled",
        deliveryDate: "2026-10-15",
      },
    });
    expect(won({ salePrice: "32.990,5" })).toMatchObject({
      closure: { salePrice: { amount: "32990.50", currency: "USD" } },
    });
    expect(
      won({ salePrice: "245.000.000", saleCurrency: "PYG" }),
    ).toMatchObject({
      closure: { salePrice: { amount: "245000000.00", currency: "PYG" } },
    });
  });

  it.each([
    ["", "required"],
    ["  ", "required"],
    ["abc", "invalid_amount"],
    ["-1", "invalid_amount"],
    ["49900.50", "invalid_amount"],
    ["1,234", "invalid_amount"],
    ["1.5", "invalid_amount"],
    ["1234567890123", "invalid_amount"],
    ["0", "not_positive"],
    ["0,00", "not_positive"],
  ])("el precio %j es %s", (salePrice, error) => {
    expect(won({ salePrice })).toEqual({
      ok: false,
      errors: { salePrice: error },
    });
  });

  it("el mayor monto de numeric(14,2) pasa", () => {
    expect(won({ salePrice: "999.999.999.999,99" })).toMatchObject({
      closure: { salePrice: { amount: "999999999999.99" } },
    });
  });

  it("guaraníes sin decimales (DEC-025 §6); con decimales en cero sí", () => {
    expect(won({ salePrice: "150.000,50", saleCurrency: "PYG" })).toEqual({
      ok: false,
      errors: { salePrice: "pyg_decimals" },
    });
    expect(won({ salePrice: "150.000,00", saleCurrency: "PYG" })).toMatchObject(
      { ok: true },
    );
  });

  it.each([
    ["saleCurrency", "", "required"],
    ["saleCurrency", "EUR", "invalid_option"],
    ["saleCurrency", "usd", "invalid_option"],
    ["paymentMethod", "", "required"],
    ["paymentMethod", "credit", "invalid_option"],
    ["deliveryStatus", "", "required"],
    ["deliveryStatus", "pending", "invalid_option"],
    ["deliveryDate", "", "required"],
    ["deliveryDate", "15/10/2026", "invalid_date"],
    ["deliveryDate", "2026-02-29", "invalid_date"],
    ["deliveryDate", "2026-13-01", "invalid_date"],
    ["deliveryDate", "2026-10-15T10:00", "invalid_date"],
  ] as const)("%s = %j es %s", (field, value, error) => {
    expect(won({ [field]: value })).toEqual({
      ok: false,
      errors: { [field]: error },
    });
  });

  it("la fecha queda entre 2000-01-01 y 2100-12-31 (CHECK de la base)", () => {
    expect(
      won({ deliveryStatus: "delivered", deliveryDate: "2000-01-01" }),
    ).toMatchObject({ ok: true });
    expect(
      won({ deliveryStatus: "delivered", deliveryDate: "1999-12-31" }),
    ).toEqual({ ok: false, errors: { deliveryDate: "invalid_date" } });
    expect(
      parseClosure(
        "won",
        {
          ...EMPTY,
          salePrice: "1",
          saleCurrency: "USD",
          paymentMethod: "cash",
          deliveryStatus: "scheduled",
          deliveryDate: "2101-01-01",
        },
        TODAY,
      ),
    ).toEqual({ ok: false, errors: { deliveryDate: "invalid_date" } });
  });

  it("entregada: hoy o antes; programada: hoy o después (día de Asunción)", () => {
    expect(
      won({ deliveryStatus: "delivered", deliveryDate: TODAY }),
    ).toMatchObject({ ok: true });
    expect(
      won({ deliveryStatus: "delivered", deliveryDate: "2026-10-12" }),
    ).toEqual({ ok: false, errors: { deliveryDate: "delivered_in_future" } });
    expect(
      won({ deliveryStatus: "scheduled", deliveryDate: TODAY }),
    ).toMatchObject({ ok: true });
    expect(
      won({ deliveryStatus: "scheduled", deliveryDate: "2026-10-10" }),
    ).toEqual({ ok: false, errors: { deliveryDate: "scheduled_in_past" } });
  });

  it("informa todos los errores a la vez, también los cruzados", () => {
    expect(
      won({
        salePrice: "1.000,50",
        saleCurrency: "PYG",
        paymentMethod: "",
        deliveryStatus: "delivered",
        deliveryDate: "2027-01-01",
      }),
    ).toEqual({
      ok: false,
      errors: {
        paymentMethod: "required",
        salePrice: "pyg_decimals",
        deliveryDate: "delivered_in_future",
      },
    });
  });

  it("una regla cruzada no se evalúa con su otro campo inválido", () => {
    // Sin moneda no se sabe si los decimales sobran; sin estado, qué fecha vale.
    expect(
      won({ salePrice: "1.000,50", saleCurrency: "", deliveryStatus: "" }),
    ).toEqual({
      ok: false,
      errors: { saleCurrency: "required", deliveryStatus: "required" },
    });
  });

  it("los campos de la pérdida se ignoran", () => {
    expect(
      won({ lossReason: "caro", lossNotes: "x".repeat(900) }),
    ).toMatchObject({ ok: true, closure: { outcome: "won" } });
  });
});

describe("fechas", () => {
  it("isCalendarDate() solo acepta días que existen", () => {
    for (const value of ["2026-10-11", "2028-02-29", "2000-01-01"]) {
      expect(isCalendarDate(value)).toBe(true);
    }
    for (const value of [
      "2026-02-29",
      "2026-04-31",
      "2026-00-10",
      "2026-1-1",
      "20261011",
      "",
    ]) {
      expect(isCalendarDate(value)).toBe(false);
    }
  });

  it("todayInAsuncion(): el día de Asunción (UTC-3), no el de UTC", () => {
    expect(todayInAsuncion(new Date("2026-10-12T02:30:00Z"))).toBe(
      "2026-10-11",
    );
    expect(todayInAsuncion(new Date("2026-10-12T03:30:00Z"))).toBe(
      "2026-10-12",
    );
  });

  it("formatCalendarDate() muestra el día sin hora ni corrimiento de zona", () => {
    expect(formatCalendarDate("2026-10-11")).toBe("11 oct 2026");
    expect(formatCalendarDate("2027-01-01")).toBe("1 ene 2027");
    expect(() => formatCalendarDate("11/10/2026")).toThrow();
  });
});

describe("planOpportunityClosure()", () => {
  const LOST: Closure = {
    outcome: "lost",
    lossReason: "price",
    lossNotes: null,
  };
  const WON: Closure = {
    outcome: "won",
    salePrice: { amount: "47500.00", currency: "USD" },
    paymentMethod: "cash",
    deliveryStatus: "delivered",
    deliveryDate: TODAY,
  };
  const VEHICLE = "20000000-0000-4000-8000-000000000101";

  it("ganar desde En negociación con la unidad vinculada cierra", () => {
    expect(
      planOpportunityClosure({ stage: "negotiating", vehicleId: VEHICLE }, WON),
    ).toEqual({ kind: "close", from: "negotiating", closure: WON });
  });

  it("ganar sin unidad vinculada es vehicle_required", () => {
    expect(
      planOpportunityClosure({ stage: "negotiating", vehicleId: null }, WON),
    ).toEqual({ kind: "vehicle_required", from: "negotiating" });
  });

  it("perder desde cualquier etapa abierta cierra, con o sin unidad", () => {
    for (const stage of ["new", "qualifying", "negotiating"] as const) {
      expect(planOpportunityClosure({ stage, vehicleId: null }, LOST)).toEqual({
        kind: "close",
        from: stage,
        closure: LOST,
      });
    }
    expect(
      planOpportunityClosure(
        { stage: "negotiating", vehicleId: VEHICLE },
        LOST,
      ),
    ).toMatchObject({ kind: "close" });
  });

  it("pedir el cierre que ya tiene es unchanged: los metadatos no se reescriben", () => {
    expect(
      planOpportunityClosure({ stage: "won", vehicleId: VEHICLE }, WON),
    ).toEqual({ kind: "unchanged", stage: "won" });
    expect(
      planOpportunityClosure(
        { stage: "lost", vehicleId: null },
        { ...LOST, lossReason: "other", lossNotes: "Otra cosa" },
      ),
    ).toEqual({ kind: "unchanged", stage: "lost" });
  });

  it("una cerrada no cambia de cierre y no se gana sin negociar", () => {
    expect(
      planOpportunityClosure({ stage: "won", vehicleId: VEHICLE }, LOST),
    ).toEqual({ kind: "invalid_transition", from: "won", to: "lost" });
    expect(
      planOpportunityClosure({ stage: "lost", vehicleId: VEHICLE }, WON),
    ).toEqual({ kind: "invalid_transition", from: "lost", to: "won" });
    for (const stage of ["new", "qualifying"] as const) {
      expect(planOpportunityClosure({ stage, vehicleId: null }, WON)).toEqual({
        kind: "invalid_transition",
        from: stage,
        to: "won",
      });
    }
  });

  it("las 5 etapas × 2 resultados × con y sin unidad siguen la máquina", () => {
    for (const stage of OPPORTUNITY_STAGES) {
      for (const closure of [WON, LOST]) {
        for (const vehicleId of [null, VEHICLE]) {
          const to = closure.outcome;
          const expected =
            stage === to
              ? "unchanged"
              : !canTransition(stage as Stage, to)
                ? "invalid_transition"
                : to === "won" && vehicleId === null
                  ? "vehicle_required"
                  : "close";
          expect(
            planOpportunityClosure({ stage, vehicleId }, closure).kind,
            `${stage} → ${to} (${vehicleId})`,
          ).toBe(expected);
        }
      }
    }
  });
});

describe("resumen del cierre", () => {
  const OPEN: ClosureRow = {
    stage: "negotiating",
    lossReason: null,
    lossNotes: null,
    salePrice: null,
    saleCurrency: null,
    paymentMethod: null,
    deliveryStatus: null,
    deliveryDate: null,
  };

  it("una abierta no tiene cierre", () => {
    for (const stage of ["new", "qualifying", "negotiating"] as const) {
      expect(closureFromRow({ ...OPEN, stage })).toBeNull();
    }
  });

  it("una venta: precio con su moneda, forma de pago y entrega", () => {
    const closure = closureFromRow({
      ...OPEN,
      stage: "won",
      salePrice: "47500.00",
      saleCurrency: "USD",
      paymentMethod: "trade_in",
      deliveryStatus: "delivered",
      deliveryDate: "2026-10-11",
    });
    expect(closure).toEqual({
      outcome: "won",
      salePrice: { amount: "47500.00", currency: "USD" },
      paymentMethod: "trade_in",
      deliveryStatus: "delivered",
      deliveryDate: "2026-10-11",
    });
    expect(closureSummary(closure!)).toEqual({
      outcome: "won",
      salePrice: "USD 47.500",
      paymentMethod: "Usado como parte de pago",
      delivery: "Entregada el 11 oct 2026",
    });
    expect(
      closureSummary({
        ...(closure as Extract<Closure, { outcome: "won" }>),
        salePrice: { amount: "245000000.00", currency: "PYG" },
        deliveryStatus: "scheduled",
        deliveryDate: "2026-11-02",
      }),
    ).toMatchObject({
      salePrice: "Gs. 245.000.000",
      delivery: "Programada para el 2 nov 2026",
    });
  });

  it("una pérdida: motivo y notas", () => {
    const closure = closureFromRow({
      ...OPEN,
      stage: "lost",
      lossReason: "financing_rejected",
      lossNotes: "El banco no aprobó",
    });
    expect(closureSummary(closure!)).toEqual({
      outcome: "lost",
      reason: "Financiación rechazada",
      notes: "El banco no aprobó",
    });
  });

  it("una fila cerrada sin sus metadatos no inventa un cierre", () => {
    expect(closureFromRow({ ...OPEN, stage: "won" })).toBeNull();
    expect(
      closureFromRow({ ...OPEN, stage: "won", salePrice: "1.00" }),
    ).toBeNull();
    expect(closureFromRow({ ...OPEN, stage: "lost" })).toBeNull();
  });
});

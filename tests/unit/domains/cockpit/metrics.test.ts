import { describe, expect, it } from "vitest";

import {
  averageDays,
  buildAttention,
  buildCockpitMetrics,
  buildFunnel,
  buildLossReasons,
  buildPeriodConversion,
  buildQuoteValue,
  buildSalesCycle,
  buildStockHealth,
  buildTestDrivePulse,
  FUNNEL_STAGES,
  overdueTestDriveCutoff,
  shareOf,
  type ClosureGroupRow,
  type OpenOpportunityCounts,
  type QuoteValueRow,
  type StockGroupRow,
  type TestDriveOutcomeCounts,
} from "@/domains/cockpit/metrics";
import {
  averageDaysLabel,
  quotesLabel,
  salesCycleBasis,
  STOCK_STATUS_TITLES,
  testDriveRateBasis,
  unitsCountLabel,
} from "@/domains/cockpit/metrics-presentation";
import {
  metricsPeriod,
  METRICS_TIME_ZONE,
} from "@/domains/cockpit/metrics-period";
import { testDrivePhase } from "@/domains/cockpit/window";
import { buildConversion } from "@/domains/dashboard/commercial";
import { OPEN_STAGES } from "@/domains/dashboard/metrics";

/*
 * Métricas del salón (propuesta DEC-050): reglas puras sobre lo que agrega
 * la base. Proporciones exactas sobre enteros, dinero en centavos (BigInt)
 * y nunca mezclado entre monedas, promedios de días redondeados la mitad
 * hacia arriba, y las mismas reglas de los módulos de origen (conversión
 * del Dashboard, franja de las pruebas del Cockpit, recencia de DEC-035).
 */

const DAY = 24 * 60 * 60;
/** 14:30 del martes 3 de noviembre de 2026 en Asunción. */
const NOW = new Date("2026-11-03T17:30:00Z");

const counts = (
  byStage: Partial<OpenOpportunityCounts["byStage"]> = {},
  warning = 0,
  stale = 0,
): OpenOpportunityCounts => ({
  byStage: { new: 0, qualifying: 0, negotiating: 0, ...byStage },
  warning,
  stale,
});

const won = (count: number, cycleSeconds: number): ClosureGroupRow => ({
  stage: "won",
  lossReason: null,
  count,
  cycleSeconds,
});

const lost = (
  lossReason: NonNullable<ClosureGroupRow["lossReason"]>,
  count: number,
  cycleSeconds = 0,
): ClosureGroupRow => ({ stage: "lost", lossReason, count, cycleSeconds });

const NO_TEST_DRIVES: TestDriveOutcomeCounts = {
  completed: 0,
  noShow: 0,
  cancelled: 0,
  overdue: 0,
  upcoming: 0,
};

describe("reglas exactas", () => {
  it("las etapas del embudo son las abiertas del Dashboard: una sola regla", () => {
    expect([...FUNNEL_STAGES]).toEqual([...OPEN_STAGES]);
  });

  it.each([
    [1, 3, 33.3],
    [2, 3, 66.7],
    [1, 8, 12.5],
    // 6,25 → 6,3: la mitad hacia arriba, sin errores de float.
    [1, 16, 6.3],
    [0, 5, 0],
    [5, 5, 100],
  ])("shareOf(%i, %i) = %d", (part, total, expected) => {
    expect(shareOf(part, total)).toBe(expected);
  });

  it("sin total no hay proporción (DEC-005): null, nunca 0 %", () => {
    expect(shareOf(0, 0)).toBeNull();
  });

  it("una parte mayor al total, negativa o no entera falla", () => {
    expect(() => shareOf(4, 3)).toThrow(RangeError);
    expect(() => shareOf(-1, 3)).toThrow(RangeError);
    expect(() => shareOf(1.5, 3)).toThrow(RangeError);
  });

  it.each([
    [3 * DAY, 1, 3],
    // Un día y medio redondea a 2; un poco menos, a 1.
    [DAY + DAY / 2, 1, 2],
    [DAY + DAY / 2 - 1, 1, 1],
    // Medio día exacto ya es 1; menos, 0.
    [DAY / 2, 1, 1],
    [DAY / 2 - 1, 1, 0],
    // 10 + 20 + 31 días → 20,33 → 20.
    [61 * DAY, 3, 20],
  ])("averageDays(%i s, %i) = %i días", (seconds, count, expected) => {
    expect(averageDays(seconds, count)).toBe(expected);
  });

  it("averageDays() sin filas es null (sin dato) y no acepta segundos negativos", () => {
    expect(averageDays(0, 0)).toBeNull();
    expect(() => averageDays(-1, 1)).toThrow(RangeError);
  });

  it("la frontera de vencidas es la de la franja del Cockpit (testDrivePhase())", () => {
    const cutoff = overdueTestDriveCutoff(NOW);
    expect(cutoff).toStrictEqual(new Date("2026-11-03T16:30:00.000Z"));
    expect(testDrivePhase(cutoff, NOW)).toBe("overdue");
    expect(testDrivePhase(new Date(cutoff.getTime() + 1), NOW)).toBe(
      "in_progress",
    );
    expect(() => overdueTestDriveCutoff(new Date(Number.NaN))).toThrow(
      RangeError,
    );
  });
});

describe("embudo y atención (estado de hoy)", () => {
  it("cada etapa abierta con su parte de las abiertas, en el orden del flujo", () => {
    expect(
      buildFunnel(counts({ new: 12, qualifying: 8, negotiating: 5 })),
    ).toEqual({
      open: 25,
      stages: [
        { stage: "new", count: 12, share: 48 },
        { stage: "qualifying", count: 8, share: 32 },
        { stage: "negotiating", count: 5, share: 20 },
      ],
    });
  });

  it("sin abiertas, cada etapa en cero y sin proporción", () => {
    expect(buildFunnel(counts()).stages.map((s) => s.share)).toEqual([
      null,
      null,
      null,
    ]);
  });

  it("atención: Enfriándose + Inactivas, y el resto activas", () => {
    expect(
      buildAttention(counts({ new: 6, qualifying: 3, negotiating: 1 }, 3, 2)),
    ).toEqual({ open: 10, active: 5, warning: 3, stale: 2, needsAttention: 5 });
  });

  it("más oportunidades en atención que abiertas es un error de la lectura", () => {
    expect(() => buildAttention(counts({ new: 1 }, 1, 1))).toThrow(RangeError);
  });
});

describe("cierres del período", () => {
  const rows: ClosureGroupRow[] = [
    won(4, 4 * 10 * DAY),
    lost("price", 3, 99 * DAY),
    lost("ghosted", 3),
    lost("competitor", 1),
    lost("other", 5),
  ];

  it("la tasa de conversión es la del Dashboard (DEC-043 §3.2): ventas sobre cierres", () => {
    expect(buildPeriodConversion(rows)).toEqual(buildConversion(4, 12));
    expect(buildPeriodConversion(rows)).toEqual({
      won: 4,
      lost: 12,
      closed: 16,
      rate: 25,
    });
  });

  it("sin cierres, la tasa es sin dato (null), nunca 0 %", () => {
    expect(buildPeriodConversion([]).rate).toBeNull();
  });

  it("ciclo de venta: días promedio de alta a cierre, solo de las ganadas", () => {
    expect(buildSalesCycle(rows)).toEqual({ won: 4, averageDays: 10 });
    expect(buildSalesCycle([lost("price", 2, 50 * DAY)])).toEqual({
      won: 0,
      averageDays: null,
    });
  });

  it("motivos de pérdida: del más frecuente al menos y, a igual cantidad, en el orden de la lista", () => {
    expect(buildLossReasons(rows)).toEqual({
      lost: 12,
      reasons: [
        { reason: "other", count: 5, share: 41.7 },
        { reason: "price", count: 3, share: 25 },
        { reason: "ghosted", count: 3, share: 25 },
        { reason: "competitor", count: 1, share: 8.3 },
      ],
    });
  });

  it("sin perdidas, sin motivos", () => {
    expect(buildLossReasons([won(2, DAY)])).toEqual({ lost: 0, reasons: [] });
  });

  it("filas que contradicen los CHECKs de cierre fallan", () => {
    expect(() =>
      buildLossReasons([{ ...lost("price", 1), lossReason: null }]),
    ).toThrow(RangeError);
    expect(() =>
      buildSalesCycle([{ ...won(1, DAY), lossReason: "price" }]),
    ).toThrow(RangeError);
    expect(() => buildPeriodConversion([won(-1, 0)])).toThrow(RangeError);
  });
});

describe("plata en juego: cotizaciones por moneda, sin mezclar", () => {
  const quote = (
    currency: QuoteValueRow["currency"],
    status: QuoteValueRow["status"],
    count: number,
    amount: string,
  ): QuoteValueRow => ({ currency, status, count, amount });

  it("suma exacta en centavos, por moneda y estado, con las dos monedas de P1", () => {
    expect(
      buildQuoteValue([
        quote("USD", "approved", 1, "32990.50"),
        quote("USD", "sent", 2, "96000.00"),
        quote("PYG", "sent", 1, "245000000.00"),
      ]),
    ).toEqual([
      {
        currency: "PYG",
        total: { count: 1, amount: "245000000.00" },
        approved: { count: 0, amount: "0.00", share: 0 },
        sent: { count: 1, amount: "245000000.00", share: 100 },
      },
      {
        currency: "USD",
        total: { count: 3, amount: "128990.50" },
        approved: { count: 1, amount: "32990.50", share: 25.6 },
        sent: { count: 2, amount: "96000.00", share: 74.4 },
      },
    ]);
  });

  it("montos que un float no representa se suman exactos", () => {
    const [, usd] = buildQuoteValue([
      quote("USD", "sent", 1, "999999999999.99"),
      quote("USD", "sent", 1, "999999999999.99"),
      quote("USD", "approved", 1, "0.01"),
    ]);
    expect(usd?.total.amount).toBe("1999999999999.99");
  });

  it("sin cotizaciones en juego, las dos monedas en cero y sin proporción", () => {
    expect(buildQuoteValue([])).toEqual(
      ["PYG", "USD"].map((currency) => ({
        currency,
        total: { count: 0, amount: "0.00" },
        approved: { count: 0, amount: "0.00", share: null },
        sent: { count: 0, amount: "0.00", share: null },
      })),
    );
  });

  it("un monto que no es decimal canónico, una moneda o un estado desconocidos fallan", () => {
    expect(() => buildQuoteValue([quote("USD", "sent", 1, "1e3")])).toThrow();
    expect(() => buildQuoteValue([quote("USD", "sent", 1, "10.5")])).toThrow();
    expect(() =>
      buildQuoteValue([
        { ...quote("USD", "sent", 1, "10.00"), currency: "EUR" as "USD" },
      ]),
    ).toThrow(RangeError);
    expect(() =>
      buildQuoteValue([
        { ...quote("USD", "sent", 1, "10.00"), status: "draft" as "sent" },
      ]),
    ).toThrow(RangeError);
  });
});

describe("pulso de las pruebas de manejo", () => {
  it("realizadas sobre las que ya se debían; las que siguen en horario no cuentan", () => {
    expect(
      buildTestDrivePulse({
        completed: 5,
        noShow: 1,
        cancelled: 1,
        overdue: 1,
        upcoming: 4,
      }),
    ).toEqual({
      completed: 5,
      noShow: 1,
      cancelled: 1,
      overdue: 1,
      upcoming: 4,
      due: 8,
      rate: 62.5,
    });
  });

  it("sin pruebas que se debían, la tasa es sin dato", () => {
    expect(buildTestDrivePulse({ ...NO_TEST_DRIVES, upcoming: 2 })).toEqual({
      ...NO_TEST_DRIVES,
      upcoming: 2,
      due: 0,
      rate: null,
    });
  });
});

describe("salud del stock", () => {
  const group = (
    status: StockGroupRow["status"],
    currency: StockGroupRow["currency"],
    units: number,
    amount: string | null,
    ageSeconds: number,
  ): StockGroupRow => ({ status, currency, units, amount, ageSeconds });

  const ROWS: StockGroupRow[] = [
    group("inPreparation", null, 2, null, 400 * DAY),
    group("available", "USD", 3, "149700.00", 60 * DAY),
    group("available", "PYG", 1, "245000000.00", 40 * DAY),
    group("available", null, 1, null, 20 * DAY),
    group("reserved", "USD", 1, "32990.50", 30 * DAY),
    group("sold", "USD", 4, "180000.00", 900 * DAY),
  ];

  it("distribución por estado en el orden del ciclo de la unidad", () => {
    expect(buildStockHealth(ROWS).statuses).toEqual([
      { status: "inPreparation", count: 2, share: 16.7 },
      { status: "available", count: 5, share: 41.7 },
      { status: "reserved", count: 1, share: 8.3 },
      { status: "sold", count: 4, share: 33.3 },
    ]);
  });

  it("valorización del stock publicado (disponibles y reservadas) por moneda, sin vendidas ni en preparación", () => {
    const stock = buildStockHealth(ROWS);
    expect(stock.total).toBe(12);
    expect(stock.published).toBe(6);
    expect(stock.valuation).toEqual([
      { currency: "PYG", units: 1, amount: "245000000.00" },
      { currency: "USD", units: 4, amount: "182690.50" },
    ]);
    // La publicada sin precio no suma: se dice aparte (DEC-005).
    expect(stock.unpriced).toBe(1);
  });

  it("antigüedad promedio de las publicadas, desde el ingreso a Porandú", () => {
    // (60 + 40 + 20 + 30) días / 6 unidades = 25 días.
    expect(buildStockHealth(ROWS).averageAgeDays).toBe(25);
  });

  it("sin unidades: todo en cero, sin proporciones ni antigüedad", () => {
    expect(buildStockHealth([])).toEqual({
      total: 0,
      statuses: ["inPreparation", "available", "reserved", "sold"].map(
        (status) => ({ status, count: 0, share: null }),
      ),
      published: 0,
      valuation: [
        { currency: "PYG", units: 0, amount: "0.00" },
        { currency: "USD", units: 0, amount: "0.00" },
      ],
      unpriced: 0,
      averageAgeDays: null,
    });
  });

  it("precio sin moneda, un estado o una moneda desconocidos fallan", () => {
    expect(() =>
      buildStockHealth([group("available", "USD", 1, null, 0)]),
    ).toThrow(RangeError);
    expect(() =>
      buildStockHealth([group("archived" as "sold", null, 1, null, 0)]),
    ).toThrow(RangeError);
    expect(() =>
      buildStockHealth([group("available", "EUR" as "USD", 1, "1.00", 0)]),
    ).toThrow(RangeError);
  });
});

describe("buildCockpitMetrics()", () => {
  it("arma la vista con el período, el aviso y la hora de la lectura", () => {
    const metrics = buildCockpitMetrics({
      period: metricsPeriod("7d", NOW, METRICS_TIME_ZONE),
      notice: "invalid_period",
      now: NOW,
      opportunities: counts({ new: 2, qualifying: 1 }, 1, 0),
      closures: [won(1, 3 * DAY), lost("price", 1)],
      quotes: [],
      testDrives: NO_TEST_DRIVES,
      stock: [],
    });
    expect(metrics.period).toEqual({
      kind: "7d",
      from: "2026-10-28",
      to: "2026-11-03",
      days: 7,
      label: "Últimos 7 días: 28 oct – 3 nov 2026",
      isDefault: false,
    });
    expect(metrics.notice).toBe(
      "El período pedido no es válido. Se muestran los últimos 30 días.",
    );
    expect(metrics.generatedAt).toBe("2026-11-03T17:30:00.000Z");
    expect(metrics.generatedLabel).toBe("14:30");
    expect(metrics.funnel.open).toBe(3);
    expect(metrics.conversion.rate).toBe(50);
    expect(metrics.salesCycle).toEqual({ won: 1, averageDays: 3 });
    expect(metrics.attention.needsAttention).toBe(1);
    // El período de la vista no lleva los instantes de la base.
    expect(metrics.period).not.toHaveProperty("start");
  });

  it("un `now` inválido falla", () => {
    expect(() =>
      buildCockpitMetrics({
        period: metricsPeriod("7d", NOW, METRICS_TIME_ZONE),
        notice: null,
        now: new Date(Number.NaN),
        opportunities: counts(),
        closures: [],
        quotes: [],
        testDrives: NO_TEST_DRIVES,
        stock: [],
      }),
    ).toThrow(RangeError);
  });
});

describe("copy es-PY", () => {
  it.each([
    [null, "Sin dato"],
    [0, "Menos de 1 día"],
    [1, "1 día"],
    [34, "34 días"],
    [1234, "1.234 días"],
  ])("averageDaysLabel(%j) = %s", (days, label) => {
    expect(averageDaysLabel(days)).toBe(label);
  });

  it("bases y conteos", () => {
    expect(testDriveRateBasis(5, 8)).toBe("5 realizadas de 8 pruebas");
    expect(testDriveRateBasis(1, 1)).toBe("1 realizada de 1 prueba");
    expect(salesCycleBasis(1)).toBe("Promedio de 1 venta");
    expect(quotesLabel(3)).toBe("3 cotizaciones");
    expect(unitsCountLabel(1)).toBe("1 unidad");
  });

  it("los estados de stock en plural, como los grupos de la Stock List", () => {
    expect(STOCK_STATUS_TITLES).toEqual({
      available: "Disponibles",
      inPreparation: "En preparación",
      reserved: "Reservadas",
      sold: "Vendidas",
    });
  });
});

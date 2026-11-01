import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  buildConversion,
  buildPendingQuotes,
  buildWeekTestDrives,
} from "@/domains/dashboard/commercial";
import {
  AT_RISK_LIST_LIMIT,
  buildExecutiveDashboard,
  OPEN_STAGES,
  toAtRiskOpportunity,
  toRangeView,
  winRate,
  type AtRiskRow,
  type InventoryCounts,
  type OpportunityCounts,
} from "@/domains/dashboard/metrics";
import { DASHBOARD_TIME_ZONE } from "@/domains/dashboard/period";
import {
  conversionBasis,
  countLabel,
  formatCount,
  formatPercent,
  inactivityLabel,
  NO_DATA,
  pendingQuotesBreakdown,
  weekTestDrivesBreakdown,
} from "@/domains/dashboard/presentation";
import {
  presetRange,
  RANGE_NOTICE_LABELS,
  resolveDashboardRange,
} from "@/domains/dashboard/range";

/*
 * Métricas del Dashboard Directivo (Hito 5, DEC-037; DEC-043), lógica pura:
 * win rate exacto, "sin dato" sin cierres (DEC-005), la lista de
 * oportunidades en riesgo, el ViewModel con el rango y los KPIs comerciales
 * y el formato es-PY.
 */

const NOW = new Date("2026-10-14T13:30:00Z");
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

const COUNTS: OpportunityCounts = { open: 6, warning: 2, stale: 2 };

const INVENTORY: InventoryCounts = { inStock: 3, reserved: 1, soldInRange: 2 };

const RANGE = presetRange("month", NOW, DASHBOARD_TIME_ZONE);

const COMMERCIAL = {
  conversion: buildConversion(2, 1),
  pendingQuotes: buildPendingQuotes({
    awaitingApproval: 2,
    readyToSend: 1,
    awaitingResponse: 3,
    expired: 1,
  }),
  weekTestDrives: buildWeekTestDrives(
    { pending: 2, completed: 1, noShow: 1, cancelled: 1 },
    { key: "2026-10-12", label: "12 – 18 oct 2026" },
  ),
};

function row(n: number, daysAgo: number): AtRiskRow {
  return {
    id: `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    contactName: `Cliente ${n}`,
    stage: "qualifying",
    lastActivityAt: new Date(NOW.getTime() - daysAgo * DAY),
  };
}

function build(
  overrides: Partial<Parameters<typeof buildExecutiveDashboard>[0]> = {},
) {
  return buildExecutiveDashboard({
    range: RANGE,
    notice: null,
    today: "2026-10-14",
    ...COMMERCIAL,
    opportunities: COUNTS,
    inventory: INVENTORY,
    atRisk: { rows: [row(1, 30), row(2, 6)], total: 2 },
    now: NOW,
    ...overrides,
  });
}

describe("OPEN_STAGES", () => {
  it("son las etapas que no cierran la oportunidad (DEC-032 §1)", () => {
    expect(OPEN_STAGES).toEqual(["new", "qualifying", "negotiating"]);
  });
});

describe("winRate: ganadas sobre cerradas en el rango", () => {
  it.each([
    [2, 1, 66.7],
    [1, 2, 33.3],
    [3, 0, 100],
    [0, 3, 0],
    [1, 7, 12.5],
    // 6,25 % → 6,3 %: se redondea sobre milésimas enteras.
    [1, 15, 6.3],
    [1, 1, 50],
    [999, 1, 99.9],
  ])("%i ganadas y %i perdidas → %d %", (won, lost, expected) => {
    expect(winRate(won, lost)).toBe(expected);
  });

  it("sin cierres no hay tasa: sin dato, nunca 0 % (DEC-005)", () => {
    expect(winRate(0, 0)).toBeNull();
  });

  it("un conteo inválido falla en vez de inventar una tasa", () => {
    expect(() => winRate(-1, 2)).toThrow(RangeError);
    expect(() => winRate(1.5, 2)).toThrow(RangeError);
    expect(() => winRate(Number.NaN, 2)).toThrow(RangeError);
  });
});

describe("toAtRiskOpportunity", () => {
  it("presenta el contacto, la etapa y los días enteros sin actividad", () => {
    expect(
      toAtRiskOpportunity(
        {
          id: "o-1",
          contactName: "Óscar Brítez",
          stage: "negotiating",
          lastActivityAt: new Date(NOW.getTime() - 5 * DAY - MINUTE),
        },
        NOW,
      ),
    ).toEqual({
      id: "o-1",
      contactName: "Óscar Brítez",
      initials: "OB",
      stage: "negotiating",
      daysInactive: 5,
    });
  });
});

describe("toRangeView", () => {
  it("deja lo que muestra la vista, sin los instantes de la base", () => {
    expect(toRangeView(RANGE)).toEqual({
      kind: "month",
      from: "2026-10-01",
      to: "2026-10-31",
      days: 31,
      label: "Mes en curso: octubre de 2026",
      isDefault: true,
    });
    expect(toRangeView(RANGE)).not.toHaveProperty("start");
    expect(toRangeView(RANGE)).not.toHaveProperty("end");
  });
});

describe("buildExecutiveDashboard", () => {
  it("arma el rango, los KPIs comerciales, el pipeline, el inventario, la atención y la lista", () => {
    expect(build()).toEqual({
      range: toRangeView(RANGE),
      notice: null,
      today: "2026-10-14",
      conversion: { won: 2, lost: 1, closed: 3, rate: 66.7 },
      pendingQuotes: {
        total: 6,
        awaitingApproval: 2,
        readyToSend: 1,
        awaitingResponse: 3,
        expired: 1,
      },
      weekTestDrives: {
        weekKey: "2026-10-12",
        weekLabel: "12 – 18 oct 2026",
        scheduled: 4,
        pending: 2,
        completed: 1,
        noShow: 1,
        cancelled: 1,
      },
      pipeline: { open: 6 },
      inventory: { inStock: 3, reserved: 1, sold: 2 },
      attention: { warning: 2, stale: 2 },
      atRisk: {
        items: [
          expect.objectContaining({
            contactName: "Cliente 1",
            daysInactive: 30,
          }),
          expect.objectContaining({
            contactName: "Cliente 2",
            daysInactive: 6,
          }),
        ],
        total: 2,
      },
    });
  });

  it("un rango ignorado llega como el aviso visible, en es-PY", () => {
    const { range, notice } = resolveDashboardRange(
      { range: "custom", from: "2026-10-20", to: "2026-10-01" },
      NOW,
      DASHBOARD_TIME_ZONE,
    );
    const dashboard = build({ range, notice });
    expect(dashboard.notice).toBe(RANGE_NOTICE_LABELS.invalid_range);
    expect(dashboard.range.kind).toBe("month");
  });

  it(`lista a lo sumo ${AT_RISK_LIST_LIMIT} y conserva el total`, () => {
    const rows = Array.from({ length: 12 }, (_, i) => row(i + 1, 20 - i));
    const { atRisk } = build({
      opportunities: { ...COUNTS, stale: 12 },
      atRisk: { rows, total: 12 },
    });
    expect(atRisk.items).toHaveLength(AT_RISK_LIST_LIMIT);
    expect(atRisk.total).toBe(12);
  });

  it("el total nunca es menor que lo listado", () => {
    const { atRisk } = build({
      atRisk: { rows: [row(1, 9), row(2, 8)], total: 0 },
    });
    expect(atRisk.total).toBe(2);
  });

  it("un conteo inválido de la base falla en vez de mostrarse", () => {
    expect(() => build({ opportunities: { ...COUNTS, open: -1 } })).toThrow(
      RangeError,
    );
    expect(() =>
      build({ inventory: { ...INVENTORY, reserved: Number.NaN } }),
    ).toThrow(RangeError);
    expect(() =>
      build({ inventory: { ...INVENTORY, soldInRange: 1.5 } }),
    ).toThrow(RangeError);
  });

  it("un día de hoy mal formado falla", () => {
    expect(() => build({ today: "14/10/2026" })).toThrow(RangeError);
  });
});

describe("copy de los KPIs comerciales (DEC-043 §4 y §5)", () => {
  it("desglose de las cotizaciones pendientes", () => {
    expect(
      pendingQuotesBreakdown({
        awaitingApproval: 3,
        readyToSend: 1,
        awaitingResponse: 1200,
      }),
    ).toBe("3 por aprobar · 1 por enviar · 1.200 esperando respuesta");
  });

  it("desglose de las pruebas de la semana, con el plural de las realizadas", () => {
    expect(
      weekTestDrivesBreakdown({ pending: 2, completed: 1, noShow: 0 }),
    ).toBe("2 por realizar · 1 realizada · 0 no asistió");
    expect(
      weekTestDrivesBreakdown({ pending: 0, completed: 3, noShow: 2 }),
    ).toBe("0 por realizar · 3 realizadas · 2 no asistió");
  });

  it("base de la tasa de conversión", () => {
    expect(conversionBasis(2, 3)).toBe("2 ventas de 3 cierres");
    expect(conversionBasis(1, 1)).toBe("1 venta de 1 cierre");
    expect(conversionBasis(0, 2)).toBe("0 ventas de 2 cierres");
  });
});

describe("formato es-PY", () => {
  it("conteos con separador de miles", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(1234)).toBe("1.234");
    expect(formatCount(1234567)).toBe("1.234.567");
  });

  it("porcentajes con coma decimal y sin espacio, como la cobertura", () => {
    expect(formatPercent(66.7)).toBe("66,7%");
    expect(formatPercent(100)).toBe("100%");
    expect(formatPercent(0)).toBe("0%");
    expect(formatPercent(12.5)).toBe("12,5%");
  });

  it("un porcentaje sin dato se dice, no se dibuja como 0 %", () => {
    expect(formatPercent(null)).toBe(NO_DATA);
    expect(NO_DATA).toBe("Sin dato");
  });

  it("singular y plural", () => {
    expect(countLabel(1, "oportunidad", "oportunidades")).toBe("1 oportunidad");
    // Cero es plural: "0 perdidas", el estado de cada principio de mes.
    expect(countLabel(0, "perdida", "perdidas")).toBe("0 perdidas");
    expect(countLabel(1500, "oportunidad", "oportunidades")).toBe(
      "1.500 oportunidades",
    );
    expect(inactivityLabel(1)).toBe("1 día sin actividad");
    expect(inactivityLabel(12)).toBe("12 días sin actividad");
  });
});

describe("pureza del dominio dashboard (DEC-016, DEC-037)", () => {
  const dir = fileURLToPath(
    new URL("../../../../domains/dashboard/", import.meta.url),
  );
  const sources = readdirSync(dir).filter((file) => file.endsWith(".ts"));

  it("tiene los módulos del bloque", () => {
    expect(sources.sort()).toEqual([
      "commercial.ts",
      "metrics.ts",
      "period.ts",
      "presentation.ts",
      "range.ts",
    ]);
  });

  it.each(sources)(
    "%s solo importa del propio dominio o de domains/",
    (file) => {
      const code = readFileSync(`${dir}${file}`, "utf8");
      const specifiers = [...code.matchAll(/from\s+"([^"]+)"/g)].map(
        (match) => match[1],
      );
      for (const specifier of specifiers) {
        expect(specifier).toMatch(/^(\.\/|@\/domains\/)/);
      }
      expect(code).not.toMatch(/\bimport\s*\(/);
      expect(code).not.toMatch(/\brequire\s*\(/);
    },
  );
});

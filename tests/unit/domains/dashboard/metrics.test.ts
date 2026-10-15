import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  AT_RISK_LIST_LIMIT,
  buildExecutiveDashboard,
  OPEN_STAGES,
  toAtRiskOpportunity,
  winRate,
  type AtRiskRow,
  type InventoryCounts,
  type OpportunityCounts,
} from "@/domains/dashboard/metrics";
import {
  countLabel,
  formatCount,
  formatPercent,
  inactivityLabel,
  NO_DATA,
} from "@/domains/dashboard/presentation";

/*
 * Métricas del Dashboard Directivo (Hito 5, DEC-037), lógica pura: win rate
 * exacto, "sin dato" sin cierres (DEC-005), la lista de oportunidades en
 * riesgo y el formato es-PY.
 */

const NOW = new Date("2026-10-14T13:30:00Z");
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

const COUNTS: OpportunityCounts = {
  open: 6,
  wonInMonth: 2,
  lostInMonth: 1,
  warning: 2,
  stale: 2,
};

const INVENTORY: InventoryCounts = { inStock: 3, reserved: 1, soldInMonth: 2 };

function row(n: number, daysAgo: number): AtRiskRow {
  return {
    id: `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    contactName: `Cliente ${n}`,
    stage: "qualifying",
    lastActivityAt: new Date(NOW.getTime() - daysAgo * DAY),
  };
}

describe("OPEN_STAGES", () => {
  it("son las etapas que no cierran la oportunidad (DEC-032 §1)", () => {
    expect(OPEN_STAGES).toEqual(["new", "qualifying", "negotiating"]);
  });
});

describe("winRate: ganadas sobre cerradas en el mes", () => {
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

describe("buildExecutiveDashboard", () => {
  it("arma el pipeline con su win rate, el inventario, la atención y la lista", () => {
    expect(
      buildExecutiveDashboard({
        periodLabel: "octubre de 2026",
        opportunities: COUNTS,
        inventory: INVENTORY,
        atRisk: { rows: [row(1, 30), row(2, 6)], total: 2 },
        now: NOW,
      }),
    ).toEqual({
      periodLabel: "octubre de 2026",
      pipeline: { open: 6, won: 2, lost: 1, winRate: 66.7 },
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

  it(`lista a lo sumo ${AT_RISK_LIST_LIMIT} y conserva el total`, () => {
    const rows = Array.from({ length: 12 }, (_, i) => row(i + 1, 20 - i));
    const { atRisk } = buildExecutiveDashboard({
      periodLabel: "octubre de 2026",
      opportunities: { ...COUNTS, stale: 12 },
      inventory: INVENTORY,
      atRisk: { rows, total: 12 },
      now: NOW,
    });
    expect(atRisk.items).toHaveLength(AT_RISK_LIST_LIMIT);
    expect(atRisk.total).toBe(12);
  });

  it("el total nunca es menor que lo listado", () => {
    const { atRisk } = buildExecutiveDashboard({
      periodLabel: "octubre de 2026",
      opportunities: COUNTS,
      inventory: INVENTORY,
      atRisk: { rows: [row(1, 9), row(2, 8)], total: 0 },
      now: NOW,
    });
    expect(atRisk.total).toBe(2);
  });

  it("un conteo inválido de la base falla en vez de mostrarse", () => {
    expect(() =>
      buildExecutiveDashboard({
        periodLabel: "octubre de 2026",
        opportunities: { ...COUNTS, open: -1 },
        inventory: INVENTORY,
        atRisk: { rows: [], total: 0 },
        now: NOW,
      }),
    ).toThrow(RangeError);
    expect(() =>
      buildExecutiveDashboard({
        periodLabel: "octubre de 2026",
        opportunities: COUNTS,
        inventory: { ...INVENTORY, reserved: Number.NaN },
        atRisk: { rows: [], total: 0 },
        now: NOW,
      }),
    ).toThrow(RangeError);
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
      "metrics.ts",
      "period.ts",
      "presentation.ts",
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

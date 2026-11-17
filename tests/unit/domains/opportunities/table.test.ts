import { describe, expect, it } from "vitest";

import { demandSummary } from "@/domains/demand/presentation";
import { resolveDemand, type DemandRow } from "@/domains/demand/resolver";
import { bucketFromRecency } from "@/domains/opportunities/queue";
import {
  DEFAULT_TABLE_SORT,
  matchesTableQuery,
  nextTableSort,
  paginate,
  sortTableRows,
  tablePayment,
  tableSignals,
  tableVehicle,
} from "@/domains/opportunities/table";
import type { Opportunity } from "@/domains/opportunities/types";
import { UNSCORED, type ScoreSet } from "@/domains/scoring/types";
import { human } from "@/tests/unit/support/demand-rows";

/*
 * Vista Tabla de Opportunities (DEC-055): orden por columna con "sin dato"
 * al final, búsqueda sin tildes dentro de lo leído, paginación acotada y
 * lectura de pago y señales desde el ViewModel real.
 */

function opportunity(
  id: string,
  options: Readonly<{
    minutes?: number;
    scores?: Partial<ScoreSet>;
    name?: string;
    owner?: string;
    live?: boolean;
    urgent?: boolean;
    rows?: readonly DemandRow[];
    legacyModel?: string;
  }> = {},
): Opportunity {
  const minutes = options.minutes ?? 10;
  return {
    id,
    prospect: {
      name: options.name ?? id,
      initials: "X",
      channel: "WhatsApp",
      live: options.live ?? false,
    },
    demand: options.rows
      ? demandSummary(resolveDemand(options.rows))
      : undefined,
    interest: options.legacyModel ? { model: options.legacyModel } : {},
    scores: { ...UNSCORED, ...options.scores },
    lastActivity: { minutes },
    owner: options.owner
      ? { id: `adv-${id}`, name: options.owner, initials: "AA" }
      : undefined,
    stage: "new",
    bucket: bucketFromRecency(minutes),
    nba: options.urgent
      ? {
          kind: "call",
          action: "Retomar contacto urgente",
          reason: "Sin actividad",
          secondary: [],
          urgent: true,
        }
      : undefined,
    drivers: [],
  };
}

const ids = (rows: readonly Opportunity[]) => rows.map((row) => row.id);

describe("nextTableSort", () => {
  it("empieza por Porandú de mayor a menor", () => {
    expect(DEFAULT_TABLE_SORT).toEqual({ key: "porandu", direction: "desc" });
  });

  it("la misma columna invierte la dirección", () => {
    expect(nextTableSort(DEFAULT_TABLE_SORT, "porandu")).toEqual({
      key: "porandu",
      direction: "asc",
    });
  });

  it("otra columna empieza por su dirección natural", () => {
    expect(nextTableSort(DEFAULT_TABLE_SORT, "deal")).toEqual({
      key: "deal",
      direction: "desc",
    });
    expect(nextTableSort(DEFAULT_TABLE_SORT, "activity")).toEqual({
      key: "activity",
      direction: "asc",
    });
  });
});

describe("sortTableRows", () => {
  const rows = [
    opportunity("a", { scores: { porandu: 70 }, minutes: 50 }),
    opportunity("b", { scores: { porandu: null }, minutes: 5 }),
    opportunity("c", { scores: { porandu: 92 }, minutes: 30 }),
    opportunity("d", { scores: { porandu: 70 }, minutes: 2 }),
  ];

  it("ordena por score y desempata por la actividad más reciente", () => {
    expect(ids(sortTableRows(rows, DEFAULT_TABLE_SORT))).toEqual([
      "c",
      "d",
      "a",
      "b",
    ]);
  });

  it("el sin dato queda al final también en orden ascendente (DEC-005)", () => {
    expect(
      ids(sortTableRows(rows, { key: "porandu", direction: "asc" })),
    ).toEqual(["d", "a", "c", "b"]);
  });

  it("ordena por actividad: la más reciente primero", () => {
    expect(
      ids(sortTableRows(rows, { key: "activity", direction: "asc" })),
    ).toEqual(["d", "b", "c", "a"]);
  });

  it("no modifica la lista de entrada", () => {
    const before = ids(rows);
    sortTableRows(rows, DEFAULT_TABLE_SORT);
    expect(ids(rows)).toEqual(before);
  });
});

describe("matchesTableQuery", () => {
  const row = opportunity("a", {
    name: "Ramón Benítez",
    owner: "Lorena Vera",
    rows: [
      human("v", "desired_vehicle", "confirmed", {
        brand: "Toyota",
        model: "Hilux",
      }),
    ],
  });

  it.each(["", "  ", "ramon", "BENÍTEZ", "hilux", "lorena"])(
    "«%s» coincide",
    (query) => {
      expect(matchesTableQuery(row, query)).toBe(true);
    },
  );

  it("una búsqueda que no está en ningún campo no coincide", () => {
    expect(matchesTableQuery(row, "tucson")).toBe(false);
  });
});

describe("tableVehicle", () => {
  it("usa la demanda cuando existe", () => {
    const row = opportunity("a", {
      rows: [
        human("v", "desired_vehicle", "confirmed", {
          brand: "Kia",
          model: "Sportage",
        }),
      ],
    });
    expect(tableVehicle(row)).toBe("Kia Sportage");
  });

  it("sin demanda cargada usa el legado; sin nada, sin dato", () => {
    expect(tableVehicle(opportunity("a", { legacyModel: "Tucson" }))).toBe(
      "Tucson",
    );
    expect(tableVehicle(opportunity("b"))).toBeNull();
  });
});

describe("tablePayment y tableSignals", () => {
  it("leen el pago y el usado de la demanda tipada", () => {
    const row = opportunity("a", {
      live: true,
      urgent: true,
      rows: [
        human("p", "purchase_type", "confirmed", "financed"),
        human("t", "trade_in_intent", "confirmed", true),
      ],
    });
    expect(tablePayment(row)).toBe("financed");
    expect(tableSignals(row)).toEqual(["live", "tradeIn", "urgent"]);
  });

  it("sin datos no inventa señales ni forma de pago", () => {
    const row = opportunity("a", {
      rows: [human("t", "trade_in_intent", "confirmed", false)],
    });
    expect(tablePayment(row)).toBeNull();
    expect(tableSignals(row)).toEqual([]);
  });
});

describe("paginate", () => {
  const rows = Array.from({ length: 23 }, (_, index) => index + 1);

  it("recorta la página pedida con sus posiciones", () => {
    expect(paginate(rows, 2, 10)).toMatchObject({
      items: [11, 12, 13, 14, 15, 16, 17, 18, 19, 20],
      page: 2,
      pageCount: 3,
      from: 11,
      to: 20,
      total: 23,
    });
  });

  it("acota una página fuera de rango", () => {
    expect(paginate(rows, 9, 10)).toMatchObject({ page: 3, from: 21, to: 23 });
    expect(paginate(rows, 0, 10)).toMatchObject({ page: 1, from: 1 });
  });

  it("sin filas hay una sola página vacía", () => {
    expect(paginate([], 1, 10)).toEqual({
      items: [],
      page: 1,
      pageCount: 1,
      from: 0,
      to: 0,
      total: 0,
    });
  });

  it("rechaza un tamaño de página inválido", () => {
    expect(() => paginate(rows, 1, 0)).toThrow("invalid page size");
  });
});

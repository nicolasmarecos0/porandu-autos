import { drizzle } from "drizzle-orm/postgres-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getExecutiveDashboard } from "@/db/queries/dashboard";
import { RANGE_NOTICE_LABELS } from "@/domains/dashboard/range";

/*
 * Loader del Dashboard Directivo (Hito 5, DEC-037; DEC-043), sin base de
 * datos:
 * - la cadena requireTenant() → withTenant() con ese mismo contexto, en una
 *   sola transacción con seis lecturas (DEC-043 §7);
 * - el filtro explícito por organización en cada lectura (RLS no alcanza
 *   para detectar si falta: tests/db/dashboard.test.ts lo prueba con un
 *   usuario de varias organizaciones). Dentro del agregado de vínculos el
 *   filtro no cambia ningún resultado, porque la FK compuesta ya ata cada
 *   vínculo a la organización de su unidad: lo vigilan solo las aserciones
 *   sobre el SQL de este archivo;
 * - el rango de la URL, la semana de Asunción y los cortes de recencia
 *   ligados como timestamptz, y el día de validez como `YYYY-MM-DD`;
 * - la memoización por request con `cache()` (DEC-043 §6): una request, una
 *   transacción; otra request, otra lectura;
 * - el mapping de los conteos al ViewModel.
 */

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  calls: [] as string[],
  queries: [] as { sql: string; params: unknown[] }[],
  results: [] as unknown[][],
  /** Request simulada: `cache()` memoriza dentro de la misma. */
  request: 0,
  requireTenant: vi.fn(),
  withTenant: vi.fn(),
}));

/*
 * `cache()` de React solo memoriza dentro de un render de Server Components.
 * Este doble memoriza por request simulada (`mocks.request`), con la misma
 * semántica: compara los argumentos por valor y no sobrevive a la request.
 */
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  cache: <A extends unknown[], R>(fn: (...args: A) => R) => {
    const memo = new Map<string, R>();
    return (...args: A): R => {
      const key = JSON.stringify([mocks.request, ...args]);
      if (!memo.has(key)) memo.set(key, fn(...args));
      return memo.get(key) as R;
    };
  },
}));

vi.mock("@/lib/tenant/session", () => ({
  requireTenant: mocks.requireTenant,
}));
vi.mock("@/db/tenant", () => ({ withTenant: mocks.withTenant }));

const ORG = "00000000-0000-4000-8000-000000000001";
const CTX = Object.freeze({ organizationId: ORG, marker: "tenant-context" });
/** 10:30 del miércoles 14 de octubre de 2026 en Asunción. */
const NOW = new Date("2026-10-14T13:30:00Z");

/** Orden de las lecturas dentro de la transacción. */
const READS = [
  "closed",
  "quotes",
  "testDrives",
  "opportunityCounts",
  "inventory",
  "atRisk",
] as const;

type Read = (typeof READS)[number];

/**
 * Transacción falsa: cada `select … from` que se espera devuelve el
 * siguiente resultado y registra el SQL que habría mandado Drizzle. Un
 * subquery (`.as()`) se arma pero no se espera: no consume resultados.
 */
function fakeTransaction(results: unknown[][]) {
  const db = drizzle.mock();
  return {
    select: (fields?: Parameters<typeof db.select>[0]) => {
      const builder = fields ? db.select(fields) : db.select();
      return {
        from: (table: Parameters<typeof builder.from>[0]) => {
          const query = builder.from(table);
          Object.defineProperty(query, "then", {
            value: (
              resolve: (value: unknown) => unknown,
              reject: (error: unknown) => unknown,
            ) => {
              mocks.queries.push(query.toSQL());
              return Promise.resolve(results.shift() ?? []).then(
                resolve,
                reject,
              );
            },
          });
          return query;
        },
      };
    },
  };
}

function query(read: Read) {
  const found = mocks.queries[READS.indexOf(read)];
  if (!found) throw new Error(`${read} not queried`);
  return found;
}

function defaultResults(): unknown[][] {
  return [
    [{ won: 2, lost: 1 }],
    [{ awaitingApproval: 2, readyToSend: 1, awaitingResponse: 3, expired: 1 }],
    [{ pending: 2, completed: 1, noShow: 1, cancelled: 1 }],
    [{ open: 6, warning: 2, stale: 2 }],
    [{ inStock: 3, reserved: 1, soldInRange: 2 }],
    [
      {
        id: "o-1",
        contactName: "Lucía Ferreira",
        stage: "new",
        lastActivityAt: new Date(NOW.getTime() - 30 * 86_400_000),
        total: 2,
      },
      {
        id: "o-2",
        contactName: "Óscar Brítez",
        stage: "negotiating",
        lastActivityAt: new Date(NOW.getTime() - 7201 * 60_000),
        total: 2,
      },
    ],
  ];
}

beforeEach(() => {
  mocks.calls.length = 0;
  mocks.queries.length = 0;
  mocks.results = defaultResults();
  // Cada test es una request nueva.
  mocks.request += 1;
  mocks.requireTenant.mockReset();
  mocks.requireTenant.mockImplementation(async () => {
    mocks.calls.push("requireTenant");
    return CTX;
  });
  mocks.withTenant.mockReset();
  mocks.withTenant.mockImplementation(
    async (_ctx: unknown, fn: (tx: unknown) => Promise<unknown>) => {
      mocks.calls.push("withTenant");
      return fn(fakeTransaction(mocks.results));
    },
  );
});

describe("getExecutiveDashboard: requireTenant() → withTenant()", () => {
  it("obtiene el contexto con requireTenant() y lo pasa tal cual a una sola withTenant() con seis lecturas", async () => {
    await getExecutiveDashboard({}, NOW);

    expect(mocks.calls).toEqual(["requireTenant", "withTenant"]);
    expect(mocks.withTenant).toHaveBeenCalledTimes(1);
    expect(mocks.withTenant.mock.calls[0]?.[0]).toBe(CTX);
    expect(mocks.queries).toHaveLength(READS.length);
  });

  it("si requireTenant() redirige (sin sesión, sin acceso), no consulta", async () => {
    mocks.requireTenant.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));

    await expect(getExecutiveDashboard({}, NOW)).rejects.toThrow(
      "NEXT_REDIRECT",
    );
    expect(mocks.withTenant).not.toHaveBeenCalled();
  });

  it("un `now` inválido falla antes de pedir el contexto", async () => {
    await expect(
      getExecutiveDashboard({}, new Date(Number.NaN)),
    ).rejects.toThrow(RangeError);
    expect(mocks.requireTenant).not.toHaveBeenCalled();
  });
});

describe("cada lectura filtra por la organización del contexto", () => {
  it("cierres del rango: won y lost de la organización activa, por updated_at", async () => {
    await getExecutiveDashboard({}, NOW);
    const closed = query("closed");

    expect(closed.sql).toContain("count(*) filter (where");
    expect(closed.sql).toContain(
      'from "opportunities" where ("opportunities"."organization_id" = $3 and "opportunities"."stage" in ($4, $5) and "opportunities"."updated_at" >= $6 and "opportunities"."updated_at" < $7)',
    );
    expect(closed.params.slice(2)).toEqual([
      ORG,
      "won",
      "lost",
      "2026-10-01T03:00:00.000Z",
      "2026-11-01T03:00:00.000Z",
    ]);
  });

  it("cotizaciones: abiertas de la organización activa, unidas a su oportunidad por organización e id", async () => {
    await getExecutiveDashboard({}, NOW);
    const quotes = query("quotes");

    expect(quotes.sql).toContain(
      'inner join "opportunities" on ("opportunities"."organization_id" = "quotes"."organization_id" and "opportunities"."id" = "quotes"."opportunity_id")',
    );
    expect(quotes.sql).toMatch(
      /where \("quotes"\."organization_id" = \$\d+ and "quotes"\."status" in \(\$\d+, \$\d+, \$\d+\) and "opportunities"\."stage" in \(\$\d+, \$\d+\)\)$/,
    );
    expect(quotes.params.slice(-6)).toEqual([
      ORG,
      "draft",
      "approved",
      "sent",
      "qualifying",
      "negotiating",
    ]);
    // Vigente = valid_until no anterior al día de Asunción (DEC-042 §4).
    expect(quotes.sql).toContain('"quotes"."valid_until" >= $');
    expect(quotes.sql).toContain('"quotes"."valid_until" < $');
    expect(quotes.params).toContain("2026-10-14");
  });

  it("pruebas de manejo: la semana de lunes a domingo de Asunción, de la organización activa", async () => {
    await getExecutiveDashboard({}, NOW);
    const testDrives = query("testDrives");

    expect(testDrives.sql).toMatch(
      /from "test_drives" where \("test_drives"\."organization_id" = \$\d+ and "test_drives"\."scheduled_at" >= \$\d+ and "test_drives"\."scheduled_at" < \$\d+\)$/,
    );
    expect(testDrives.params.slice(-3)).toEqual([
      ORG,
      "2026-10-12T03:00:00.000Z",
      "2026-10-19T03:00:00.000Z",
    ]);
  });

  it("estado de hoy de las oportunidades: COUNT(*) FILTER sobre la organización activa", async () => {
    await getExecutiveDashboard({}, NOW);
    const counts = query("opportunityCounts");

    expect(counts.sql).toContain("count(*) filter (where");
    expect(counts.sql).toMatch(
      /from "opportunities" where "opportunities"\."organization_id" = \$\d+$/,
    );
    expect(counts.params.at(-1)).toBe(ORG);
    // Los cierres ya no se cuentan acá: tienen su lectura con índice.
    expect(counts.sql).not.toContain('"updated_at"');
  });

  it("inventario: las unidades y el agregado de sus vínculos, los dos de la organización activa", async () => {
    await getExecutiveDashboard({}, NOW);
    const inventory = query("inventory");

    expect(inventory.sql).toContain("bool_or(");
    expect(inventory.sql).toContain(
      'left join (select "organization_id", "vehicle_id"',
    );
    // Único guardián del filtro dentro del agregado: ver el encabezado.
    expect(inventory.sql).toMatch(
      /where \("opportunities"\."organization_id" = \$\d+ and "opportunities"\."vehicle_id" is not null\) group by "opportunities"\."organization_id", "opportunities"\."vehicle_id"/,
    );
    // El join iguala organización y unidad, como la FK compuesta.
    expect(inventory.sql).toContain(
      'on ("vehicle_links"."organization_id" = "vehicles"."organization_id" and "vehicle_links"."vehicle_id" = "vehicles"."id")',
    );
    expect(inventory.sql).toMatch(
      /where "vehicles"\."organization_id" = \$\d+$/,
    );
    expect(inventory.params.filter((param) => param === ORG)).toHaveLength(2);
    // El estado de la unidad no se consulta (DEC-037 §7).
    expect(inventory.sql).not.toContain('"status"');
  });

  it("en riesgo: abiertas e Inactivas de la organización activa, de la más vieja a la más reciente", async () => {
    await getExecutiveDashboard({}, NOW);
    const atRisk = query("atRisk");

    expect(atRisk.sql).toContain(
      'where ("opportunities"."organization_id" = $1 and "opportunities"."stage" in ($2, $3, $4) and "opportunities"."last_activity_at" < $5)',
    );
    expect(atRisk.sql).toContain(
      'order by "opportunities"."last_activity_at" asc, "opportunities"."id" asc limit $6',
    );
    expect(atRisk.sql).toContain("count(*) over ()");
    expect(atRisk.params).toEqual([
      ORG,
      "new",
      "qualifying",
      "negotiating",
      // Antes de 5 días y 1 minuto, con el límite exclusivo 1 ms después.
      "2026-10-09T13:29:00.001Z",
      10,
    ]);
  });
});

describe("el rango, la semana y la recencia llegan a la base como instantes", () => {
  it("sin parámetros, el mes de Asunción en los cierres y en las vendidas", async () => {
    await getExecutiveDashboard({}, NOW);

    for (const read of ["closed", "inventory"] as const) {
      expect(query(read).params).toContain("2026-10-01T03:00:00.000Z");
      expect(query(read).params).toContain("2026-11-01T03:00:00.000Z");
    }
  });

  it("los cortes de recencia, con límites exclusivos", async () => {
    await getExecutiveDashboard({}, NOW);
    const counts = query("opportunityCounts");

    // Enfriándose desde 2 días exactos; Inactiva desde 5 días y 1 minuto
    // (límites exclusivos, 1 ms después: DEC-037 §8).
    expect(counts.params).toContain("2026-10-12T13:30:00.001Z");
    expect(counts.params).toContain("2026-10-09T13:29:00.001Z");
    expect(counts.sql).toContain('"opportunities"."last_activity_at" < $');
    expect(counts.sql).not.toMatch(/last_activity_at" (<=|>) /);
  });

  it("ningún Date crudo: el driver no lo serializaría (ver el loader)", async () => {
    await getExecutiveDashboard({ range: "year" }, NOW);
    expect(
      mocks.queries.flatMap((q) => q.params).some((p) => p instanceof Date),
    ).toBe(false);
  });

  it("un preset de la URL cambia los flujos, no el estado de hoy ni la semana", async () => {
    const dashboard = await getExecutiveDashboard(
      { range: "previous_month" },
      NOW,
    );

    expect(dashboard.range).toMatchObject({
      kind: "previous_month",
      from: "2026-09-01",
      to: "2026-09-30",
      label: "Mes anterior: septiembre de 2026",
      isDefault: false,
    });
    for (const read of ["closed", "inventory"] as const) {
      expect(query(read).params).toContain("2026-09-01T03:00:00.000Z");
      expect(query(read).params).toContain("2026-10-01T03:00:00.000Z");
    }
    // La semana y la vigencia de las cotizaciones siguen siendo las de hoy.
    expect(query("testDrives").params).toContain("2026-10-12T03:00:00.000Z");
    expect(query("quotes").params).toContain("2026-10-14");
  });

  it("un rango personalizado: del primer instante de `from` al del día siguiente a `to`", async () => {
    const dashboard = await getExecutiveDashboard(
      { range: "custom", from: "2026-08-15", to: "2026-09-10" },
      NOW,
    );

    expect(dashboard.range).toMatchObject({
      kind: "custom",
      from: "2026-08-15",
      to: "2026-09-10",
      days: 27,
    });
    expect(dashboard.notice).toBeNull();
    // Paraguay usa UTC−3 todo el año desde octubre de 2024.
    expect(query("closed").params.slice(-2)).toEqual([
      "2026-08-15T03:00:00.000Z",
      "2026-09-11T03:00:00.000Z",
    ]);
  });

  it("un rango inválido de la URL cae al mes en curso con el aviso, sin romper", async () => {
    const dashboard = await getExecutiveDashboard(
      { range: "custom", from: "2026-02-30", to: "2026-03-10" },
      NOW,
    );

    expect(dashboard.range.kind).toBe("month");
    expect(dashboard.notice).toBe(RANGE_NOTICE_LABELS.invalid_range);
    expect(query("closed").params).toContain("2026-10-01T03:00:00.000Z");
  });

  it("a las 23:00 del 30 de septiembre en Asunción (octubre en UTC), el mes es septiembre", async () => {
    const dashboard = await getExecutiveDashboard(
      {},
      new Date("2026-10-01T02:00:00Z"),
    );
    expect(dashboard.range.label).toBe("Mes en curso: septiembre de 2026");
    expect(dashboard.today).toBe("2026-09-30");
    expect(query("closed").params).toContain("2026-09-01T03:00:00.000Z");
    expect(query("closed").params).toContain("2026-10-01T03:00:00.000Z");
  });
});

describe("memoización por request (DEC-043 §6)", () => {
  it("dos pedidos del mismo rango en la misma request comparten una sola transacción", async () => {
    const [first, second] = await Promise.all([
      getExecutiveDashboard({}),
      getExecutiveDashboard({ range: "month" }),
    ]);

    expect(mocks.withTenant).toHaveBeenCalledTimes(1);
    expect(mocks.queries).toHaveLength(READS.length);
    expect(second).toBe(first);
  });

  it("otro rango en la misma request es otra lectura", async () => {
    await getExecutiveDashboard({});
    mocks.results = defaultResults();
    await getExecutiveDashboard({ range: "year" });

    expect(mocks.withTenant).toHaveBeenCalledTimes(2);
  });

  it("una request nueva vuelve a leer: nada se comparte entre requests", async () => {
    await getExecutiveDashboard({});
    mocks.request += 1;
    mocks.results = defaultResults();
    await getExecutiveDashboard({});

    expect(mocks.requireTenant).toHaveBeenCalledTimes(2);
    expect(mocks.withTenant).toHaveBeenCalledTimes(2);
  });
});

describe("conteos → ViewModel", () => {
  it("arma el dashboard con el rango, los KPIs comerciales y los bloques", async () => {
    expect(await getExecutiveDashboard({}, NOW)).toEqual({
      range: {
        kind: "month",
        from: "2026-10-01",
        to: "2026-10-31",
        days: 31,
        label: "Mes en curso: octubre de 2026",
        isDefault: true,
      },
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
          {
            id: "o-1",
            contactName: "Lucía Ferreira",
            initials: "LF",
            stage: "new",
            daysInactive: 30,
          },
          {
            id: "o-2",
            contactName: "Óscar Brítez",
            initials: "OB",
            stage: "negotiating",
            daysInactive: 5,
          },
        ],
        total: 2,
      },
    });
  });

  it("sin filas (organización vacía) son ceros y la tasa sin dato", async () => {
    mocks.results = [[], [], [], [], [], []];
    const dashboard = await getExecutiveDashboard({}, NOW);

    expect(dashboard.conversion).toEqual({
      won: 0,
      lost: 0,
      closed: 0,
      rate: null,
    });
    expect(dashboard.pendingQuotes).toEqual({
      total: 0,
      awaitingApproval: 0,
      readyToSend: 0,
      awaitingResponse: 0,
      expired: 0,
    });
    expect(dashboard.weekTestDrives).toMatchObject({
      scheduled: 0,
      cancelled: 0,
    });
    expect(dashboard.pipeline).toEqual({ open: 0 });
    expect(dashboard.inventory).toEqual({ inStock: 0, reserved: 0, sold: 0 });
    expect(dashboard.attention).toEqual({ warning: 0, stale: 0 });
    expect(dashboard.atRisk).toEqual({ items: [], total: 0 });
  });
});

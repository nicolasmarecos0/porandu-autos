import { drizzle } from "drizzle-orm/postgres-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getCockpitMetrics } from "@/db/queries/cockpit-metrics";

/*
 * Loader de las Métricas del salón (propuesta DEC-050), sin base de datos:
 * - la cadena requireTenant() → withTenant() con ese mismo contexto, en una
 *   sola transacción con cinco lecturas agregadas;
 * - el filtro explícito por organización en cada lectura (RLS no alcanza
 *   para detectar si falta: tests/db/cockpit-metrics.test.ts lo prueba con
 *   un usuario de varias organizaciones);
 * - las agrupaciones acotadas (etapa y motivo, moneda y estado, estado y
 *   moneda) y las sumas exactas;
 * - el período de la URL, los cortes de recencia y la frontera de vencidas
 *   ligados como timestamptz, el día de validez como `YYYY-MM-DD`, y "Todo"
 *   sin piso;
 * - el mapping de las filas al ViewModel.
 */

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  calls: [] as string[],
  queries: [] as { sql: string; params: unknown[] }[],
  results: [] as unknown[][],
  requireTenant: vi.fn(),
  withTenant: vi.fn(),
}));

vi.mock("@/lib/tenant/session", () => ({
  requireTenant: mocks.requireTenant,
}));
vi.mock("@/db/tenant", () => ({ withTenant: mocks.withTenant }));

const ORG = "00000000-0000-4000-8000-000000000001";
const CTX = Object.freeze({ organizationId: ORG, marker: "tenant-context" });
/** 14:30 del martes 3 de noviembre de 2026 en Asunción. */
const NOW = new Date("2026-11-03T17:30:00Z");

/** Orden de las lecturas dentro de la transacción. */
const READS = [
  "opportunities",
  "closures",
  "quotes",
  "testDrives",
  "stock",
] as const;

type Read = (typeof READS)[number];

/**
 * Transacción falsa: cada `select … from` que se espera devuelve el
 * siguiente resultado y registra el SQL que habría mandado Drizzle.
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
    [{ fresh: 2, qualifying: 1, negotiating: 2, warning: 2, stale: 1 }],
    [
      { stage: "lost", lossReason: "ghosted", count: 1, cycleSeconds: 0 },
      { stage: "lost", lossReason: "price", count: 2, cycleSeconds: 0 },
      { stage: "won", lossReason: null, count: 2, cycleSeconds: 30 * 86_400 },
    ],
    [
      { currency: "PYG", status: "sent", count: 1, amount: "245000000.00" },
      { currency: "USD", status: "approved", count: 1, amount: "32990.50" },
      { currency: "USD", status: "sent", count: 2, amount: "111400.00" },
    ],
    [{ completed: 2, noShow: 1, cancelled: 1, overdue: 2, upcoming: 2 }],
    [
      {
        status: "available",
        currency: "USD",
        units: 2,
        amount: "82890.50",
        ageSeconds: 30 * 86_400,
      },
      {
        status: "in_preparation",
        currency: null,
        units: 1,
        amount: null,
        ageSeconds: 5 * 86_400,
      },
      {
        status: "reserved",
        currency: "USD",
        units: 1,
        amount: "61000.00",
        ageSeconds: 30 * 86_400,
      },
      {
        status: "sold",
        currency: "USD",
        units: 1,
        amount: "45000.00",
        ageSeconds: 200 * 86_400,
      },
    ],
  ];
}

beforeEach(() => {
  mocks.calls.length = 0;
  mocks.queries.length = 0;
  mocks.results = defaultResults();
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

describe("getCockpitMetrics: requireTenant() → withTenant()", () => {
  it("obtiene el contexto con requireTenant() y lo pasa tal cual a una sola withTenant() con cinco lecturas", async () => {
    await getCockpitMetrics({}, NOW);

    expect(mocks.calls).toEqual(["requireTenant", "withTenant"]);
    expect(mocks.withTenant).toHaveBeenCalledTimes(1);
    expect(mocks.withTenant.mock.calls[0]?.[0]).toBe(CTX);
    expect(mocks.queries).toHaveLength(READS.length);
  });

  it("si requireTenant() redirige (sin sesión, sin acceso), no consulta", async () => {
    mocks.requireTenant.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));

    await expect(getCockpitMetrics({}, NOW)).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.withTenant).not.toHaveBeenCalled();
  });

  it("un `now` inválido falla antes de pedir el contexto", async () => {
    await expect(getCockpitMetrics({}, new Date(Number.NaN))).rejects.toThrow(
      RangeError,
    );
    expect(mocks.requireTenant).not.toHaveBeenCalled();
  });
});

describe("cada lectura filtra por la organización del contexto", () => {
  it("oportunidades abiertas: COUNT(*) FILTER por etapa y recencia, solo abiertas de la organización activa", async () => {
    await getCockpitMetrics({}, NOW);
    const { sql, params } = query("opportunities");

    expect(sql).toContain("count(*) filter (where");
    expect(sql).toMatch(
      /from "opportunities" where \("opportunities"\."organization_id" = \$\d+ and "opportunities"\."stage" in \(\$\d+, \$\d+, \$\d+\)\)$/,
    );
    expect(params.slice(-4)).toEqual([ORG, "new", "qualifying", "negotiating"]);
    // Enfriándose desde 2 días exactos; Inactiva desde 5 días y 1 minuto
    // (límites exclusivos, 1 ms después: DEC-037 §8).
    expect(params).toContain("2026-11-01T17:30:00.001Z");
    expect(params).toContain("2026-10-29T17:29:00.001Z");
    expect(sql).not.toContain('"updated_at"');
  });

  it("cierres: GROUP BY etapa y motivo, de la organización activa, en el período por updated_at", async () => {
    await getCockpitMetrics({}, NOW);
    const { sql, params } = query("closures");

    expect(sql).toContain(
      'where ("opportunities"."organization_id" = $1 and "opportunities"."stage" in ($2, $3) and "opportunities"."updated_at" >= $4 and "opportunities"."updated_at" < $5)',
    );
    expect(sql).toContain(
      'group by "opportunities"."stage", "opportunities"."loss_reason"',
    );
    expect(sql).toContain(
      'extract(epoch from ("opportunities"."updated_at" - "opportunities"."created_at"))',
    );
    expect(params).toEqual([
      ORG,
      "won",
      "lost",
      "2026-10-05T03:00:00.000Z",
      "2026-11-04T03:00:00.000Z",
    ]);
  });

  it("cotizaciones: SUM(total_price) por moneda y estado, aprobadas o enviadas vigentes, unidas a su oportunidad por organización e id", async () => {
    await getCockpitMetrics({}, NOW);
    const { sql, params } = query("quotes");

    expect(sql).toContain('sum("quotes"."total_price")');
    expect(sql).toContain(
      'inner join "opportunities" on ("opportunities"."organization_id" = "quotes"."organization_id" and "opportunities"."id" = "quotes"."opportunity_id")',
    );
    expect(sql).toContain(
      'where ("quotes"."organization_id" = $1 and "quotes"."status" in ($2, $3) and "quotes"."valid_until" >= $4 and "opportunities"."stage" in ($5, $6))',
    );
    expect(sql).toContain('group by "quotes"."currency", "quotes"."status"');
    expect(params).toEqual([
      ORG,
      "approved",
      "sent",
      // Hoy en Asunción: el último día de validez, inclusive (DEC-042 §4).
      "2026-11-03",
      "qualifying",
      "negotiating",
    ]);
  });

  it("pruebas de manejo: una fila por resultado, del período por scheduled_at, con la frontera de vencidas", async () => {
    await getCockpitMetrics({}, NOW);
    const { sql, params } = query("testDrives");

    expect(sql).toMatch(
      /from "test_drives" where \("test_drives"\."organization_id" = \$\d+ and "test_drives"\."scheduled_at" >= \$\d+ and "test_drives"\."scheduled_at" < \$\d+\)$/,
    );
    expect(sql).toContain('"test_drives"."scheduled_at" <= $');
    expect(sql).toContain('"test_drives"."scheduled_at" > $');
    // Ahora menos la franja de 60 minutos (DEC-047 §3.3).
    expect(params.filter((p) => p === "2026-11-03T16:30:00.000Z")).toHaveLength(
      2,
    );
    expect(params.slice(-3)).toEqual([
      ORG,
      "2026-10-05T03:00:00.000Z",
      "2026-11-04T03:00:00.000Z",
    ]);
  });

  it("stock: GROUP BY estado y moneda de las unidades de la organización activa, con SUM(price) y la antigüedad hasta `now`", async () => {
    await getCockpitMetrics({}, NOW);
    const { sql, params } = query("stock");

    // Una sola tabla: Drizzle no califica las columnas de la proyección.
    expect(sql).toContain('sum("price")');
    expect(sql).toContain(
      'extract(epoch from ($1::timestamptz - "vehicles"."created_at"))',
    );
    expect(sql).toMatch(
      /from "vehicles" where "vehicles"\."organization_id" = \$\d+ group by "vehicles"\."status", "vehicles"\."currency"/,
    );
    expect(params).toEqual(["2026-11-03T17:30:00.000Z", ORG]);
  });

  it("ningún Date crudo: el driver no lo serializaría (ver el loader)", async () => {
    await getCockpitMetrics({ period: "7d" }, NOW);
    expect(
      mocks.queries.flatMap((q) => q.params).some((p) => p instanceof Date),
    ).toBe(false);
  });
});

describe("el período de la URL llega a la base como instantes", () => {
  it("los últimos 7 días mueven el piso de cierres y pruebas; el estado de hoy no cambia", async () => {
    await getCockpitMetrics({ period: "7d" }, NOW);

    for (const read of ["closures", "testDrives"] as const) {
      expect(query(read).params).toContain("2026-10-28T03:00:00.000Z");
      expect(query(read).params).toContain("2026-11-04T03:00:00.000Z");
    }
    expect(query("quotes").params).toContain("2026-11-03");
    expect(query("opportunities").sql).not.toContain('"updated_at"');
  });

  it("todo el historial no tiene piso: solo el fin del período", async () => {
    await getCockpitMetrics({ period: "all" }, NOW);

    expect(query("closures").sql).toContain(
      '"opportunities"."stage" in ($2, $3) and "opportunities"."updated_at" < $4)',
    );
    expect(query("closures").sql).not.toContain('"updated_at" >=');
    expect(query("testDrives").sql).not.toContain('"scheduled_at" >=');
    expect(query("closures").params.at(-1)).toBe("2026-11-04T03:00:00.000Z");
  });

  it("un período inválido cae a los últimos 30 días con el aviso", async () => {
    const metrics = await getCockpitMetrics({ period: "1y" }, NOW);

    expect(metrics.period.kind).toBe("30d");
    expect(metrics.notice).toBe(
      "El período pedido no es válido. Se muestran los últimos 30 días.",
    );
    expect(query("closures").params).toContain("2026-10-05T03:00:00.000Z");
  });
});

describe("filas de la base → ViewModel", () => {
  it("arma cada bloque con las reglas del dominio", async () => {
    const metrics = await getCockpitMetrics({}, NOW);

    expect(metrics.funnel).toEqual({
      open: 5,
      stages: [
        { stage: "new", count: 2, share: 40 },
        { stage: "qualifying", count: 1, share: 20 },
        { stage: "negotiating", count: 2, share: 40 },
      ],
    });
    expect(metrics.conversion).toEqual({
      won: 2,
      lost: 3,
      closed: 5,
      rate: 40,
    });
    expect(metrics.salesCycle).toEqual({ won: 2, averageDays: 15 });
    expect(metrics.lossReasons.reasons.map((r) => r.reason)).toEqual([
      "price",
      "ghosted",
    ]);
    expect(metrics.quoteValue[1]?.total).toEqual({
      count: 3,
      amount: "144390.50",
    });
    expect(metrics.testDrives).toMatchObject({ due: 6, rate: 33.3 });
    expect(metrics.attention).toEqual({
      open: 5,
      active: 2,
      warning: 2,
      stale: 1,
      needsAttention: 3,
    });
    // El estado de la base (in_preparation) llega como el del dominio.
    expect(metrics.stock.statuses.map((s) => [s.status, s.count])).toEqual([
      ["inPreparation", 1],
      ["available", 2],
      ["reserved", 1],
      ["sold", 1],
    ]);
    expect(metrics.stock.valuation).toEqual([
      { currency: "PYG", units: 0, amount: "0.00" },
      { currency: "USD", units: 3, amount: "143890.50" },
    ]);
    // (30 + 30) días de las 3 publicadas → 20 días.
    expect(metrics.stock.averageAgeDays).toBe(20);
  });

  it("una fila que contradice la lectura falla en vez de mostrar números falsos", async () => {
    mocks.results[1] = [
      { stage: "negotiating", lossReason: null, count: 1, cycleSeconds: 0 },
    ];
    await expect(getCockpitMetrics({}, NOW)).rejects.toThrow(
      "unexpected closure stage",
    );
  });
});

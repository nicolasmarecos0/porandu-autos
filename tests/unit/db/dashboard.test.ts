import { drizzle } from "drizzle-orm/postgres-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getExecutiveDashboard } from "@/db/queries/dashboard";

/*
 * Loader del Dashboard Directivo (Hito 5, DEC-037), sin base de datos:
 * - la cadena requireTenant() → withTenant() con ese mismo contexto, en una
 *   sola transacción;
 * - el filtro explícito por organización en cada lectura (RLS no alcanza
 *   para detectar si falta: tests/db/dashboard.test.ts lo prueba con un
 *   usuario de varias organizaciones para los conteos de oportunidades, las
 *   unidades y la lista en riesgo). Dentro del agregado de vínculos el filtro
 *   no cambia ningún resultado, porque la FK compuesta ya ata cada vínculo a
 *   la organización de su unidad: lo vigilan solo las aserciones sobre el SQL
 *   de este archivo;
 * - el mes de Asunción y los cortes de recencia ligados como timestamptz;
 * - el mapping de los conteos al ViewModel.
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
/** 10:30 del 14 de octubre de 2026 en Asunción. */
const NOW = new Date("2026-10-14T13:30:00Z");

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

beforeEach(() => {
  mocks.calls.length = 0;
  mocks.queries.length = 0;
  mocks.results = [
    [{ open: 6, wonInMonth: 2, lostInMonth: 1, warning: 2, stale: 2 }],
    [{ inStock: 3, reserved: 1, soldInMonth: 2 }],
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
  it("obtiene el contexto con requireTenant() y lo pasa tal cual a una sola withTenant()", async () => {
    await getExecutiveDashboard(NOW);

    expect(mocks.calls).toEqual(["requireTenant", "withTenant"]);
    expect(mocks.withTenant).toHaveBeenCalledTimes(1);
    expect(mocks.withTenant.mock.calls[0]?.[0]).toBe(CTX);
    // Conteos de oportunidades, conteos del inventario y lista en riesgo.
    expect(mocks.queries).toHaveLength(3);
  });

  it("si requireTenant() redirige (sin sesión, sin acceso), no consulta", async () => {
    mocks.requireTenant.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));

    await expect(getExecutiveDashboard(NOW)).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.withTenant).not.toHaveBeenCalled();
  });
});

describe("cada lectura filtra por la organización del contexto", () => {
  it("conteos de oportunidades: COUNT(*) FILTER sobre la organización activa", async () => {
    await getExecutiveDashboard(NOW);
    const [counts] = mocks.queries;

    expect(counts?.sql).toContain("count(*) filter (where");
    expect(counts?.sql).toMatch(
      /from "opportunities" where "opportunities"\."organization_id" = \$\d+$/,
    );
    expect(counts?.params.at(-1)).toBe(ORG);
  });

  it("inventario: las unidades y el agregado de sus vínculos, los dos de la organización activa", async () => {
    await getExecutiveDashboard(NOW);
    const inventory = mocks.queries[1];

    expect(inventory?.sql).toContain("bool_or(");
    expect(inventory?.sql).toContain(
      'left join (select "organization_id", "vehicle_id"',
    );
    // Único guardián del filtro dentro del agregado: ver el encabezado.
    expect(inventory?.sql).toMatch(
      /where \("opportunities"\."organization_id" = \$\d+ and "opportunities"\."vehicle_id" is not null\) group by "opportunities"\."organization_id", "opportunities"\."vehicle_id"/,
    );
    // El join iguala organización y unidad, como la FK compuesta.
    expect(inventory?.sql).toContain(
      'on ("vehicle_links"."organization_id" = "vehicles"."organization_id" and "vehicle_links"."vehicle_id" = "vehicles"."id")',
    );
    expect(inventory?.sql).toMatch(
      /where "vehicles"\."organization_id" = \$\d+$/,
    );
    expect(inventory?.params.filter((param) => param === ORG)).toHaveLength(2);
    // El estado de la unidad no se consulta (DEC-037 §7).
    expect(inventory?.sql).not.toContain('"status"');
  });

  it("en riesgo: abiertas e Inactivas de la organización activa, de la más vieja a la más reciente", async () => {
    await getExecutiveDashboard(NOW);
    const atRisk = mocks.queries[2];

    expect(atRisk?.sql).toContain(
      'where ("opportunities"."organization_id" = $1 and "opportunities"."stage" in ($2, $3, $4) and "opportunities"."last_activity_at" < $5)',
    );
    expect(atRisk?.sql).toContain(
      'order by "opportunities"."last_activity_at" asc, "opportunities"."id" asc limit $6',
    );
    expect(atRisk?.sql).toContain("count(*) over ()");
    expect(atRisk?.params).toEqual([
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

describe("el mes y la recencia llegan a la base como instantes", () => {
  it("el mes de Asunción y los cortes se ligan como timestamptz ISO", async () => {
    await getExecutiveDashboard(NOW);
    const [counts, inventory] = mocks.queries;

    for (const query of [counts, inventory]) {
      expect(query?.params).toContain("2026-10-01T03:00:00.000Z");
      expect(query?.params).toContain("2026-11-01T03:00:00.000Z");
    }
    // Enfriándose desde 2 días exactos; Inactiva desde 5 días y 1 minuto
    // (límites exclusivos, 1 ms después: DEC-037 §8).
    expect(counts?.params).toContain("2026-10-12T13:30:00.001Z");
    expect(counts?.params).toContain("2026-10-09T13:29:00.001Z");
    expect(counts?.sql).toContain('"opportunities"."last_activity_at" < $');
    expect(counts?.sql).not.toMatch(/last_activity_at" (<=|>) /);
    // Ningún Date crudo: el driver no lo serializaría (ver el loader).
    expect(
      mocks.queries.flatMap((q) => q.params).some((p) => p instanceof Date),
    ).toBe(false);
  });
});

describe("conteos → ViewModel", () => {
  it("arma el dashboard con el win rate y los días sin actividad", async () => {
    expect(await getExecutiveDashboard(NOW)).toEqual({
      periodLabel: "octubre de 2026",
      pipeline: { open: 6, won: 2, lost: 1, winRate: 66.7 },
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

  it("sin filas (organización vacía) son ceros y win rate sin dato", async () => {
    mocks.results = [[], [], []];
    expect(await getExecutiveDashboard(NOW)).toEqual({
      periodLabel: "octubre de 2026",
      pipeline: { open: 0, won: 0, lost: 0, winRate: null },
      inventory: { inStock: 0, reserved: 0, sold: 0 },
      attention: { warning: 0, stale: 0 },
      atRisk: { items: [], total: 0 },
    });
  });
});

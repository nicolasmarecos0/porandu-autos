import { drizzle } from "drizzle-orm/postgres-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getOpportunityDetail } from "@/db/queries/opportunity-detail";
import type { opportunityDemandFacts } from "@/db/schema";

/*
 * Loader de /opportunities/[id] (H1.4, DEC-030 §10), sin base de datos:
 * - la cadena requireTenant() → withTenant() con ese mismo contexto;
 * - un id que no es UUID no llega a la base (U7: notFound sin consultar);
 * - el filtro explícito por organización y por id sobre el SQL generado
 *   (el aislamiento real lo prueba tests/db/opportunity-detail.test.ts);
 * - oportunidad y ledger en la misma transacción; sin oportunidad, no se
 *   lee el ledger;
 * - el ViewModel: autor "Vos" contra el usuario de la request y ningún id
 *   de usuario hacia la página.
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
const USER = "00000000-0000-4000-8000-00000000000a";
const OTHER_USER = "00000000-0000-4000-8000-00000000000c";
const OPPORTUNITY = "30000000-0000-4000-8000-000000000001";
const CTX = Object.freeze({
  organizationId: ORG,
  userId: USER,
  marker: "tenant-context",
});
const CREATED_AT = new Date("2026-10-06T14:05:00Z");

beforeEach(() => {
  mocks.calls.length = 0;
  mocks.queries.length = 0;
  mocks.results = [];
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

/**
 * Transacción falsa: cada `select … from` devuelve el siguiente resultado y
 * registra el SQL que habría mandado Drizzle.
 */
function fakeTransaction(results: unknown[][]) {
  const db = drizzle.mock();
  return {
    select: (fields?: Parameters<typeof db.select>[0]) => {
      const builder = fields ? db.select(fields) : db.select();
      return {
        from: (table: Parameters<typeof builder.from>[0]) => {
          const query = builder.from(table);
          const result = results.shift() ?? [];
          // Drizzle encadena innerJoin/where/limit sobre el mismo builder.
          Object.defineProperty(query, "then", {
            value: (
              resolve: (value: unknown) => unknown,
              reject: (error: unknown) => unknown,
            ) => {
              mocks.queries.push(query.toSQL());
              return Promise.resolve(result).then(resolve, reject);
            },
          });
          return query;
        },
      };
    },
  };
}

const OPPORTUNITY_ROW = {
  id: OPPORTUNITY,
  stage: "qualifying",
  lossReason: null,
  createdAt: CREATED_AT,
  interestModel: " Hilux ",
  interestVersion: null,
  contactName: "Ana Benítez",
};

type DemandRecord = typeof opportunityDemandFacts.$inferSelect;

/** Fila del ledger como la devuelve la base. */
function record(
  fields: Partial<DemandRecord> & Pick<DemandRecord, "id" | "fact">,
): DemandRecord {
  return {
    organizationId: ORG,
    opportunityId: OPPORTUNITY,
    status: "confirmed",
    sourceKind: "member",
    recordedBy: USER,
    recordedAt: CREATED_AT,
    targetFactId: null,
    previousMemberFactId: null,
    brand: null,
    model: null,
    yearMin: null,
    yearMax: null,
    amount: null,
    currency: null,
    purchaseType: null,
    tradeIn: null,
    evidenceText: null,
    ...fields,
  };
}

describe("getOpportunityDetail: requireTenant() → withTenant()", () => {
  it("obtiene el contexto con requireTenant() y lo pasa tal cual a withTenant()", async () => {
    await getOpportunityDetail(OPPORTUNITY);

    expect(mocks.calls).toEqual(["requireTenant", "withTenant"]);
    expect(mocks.withTenant.mock.calls[0]?.[0]).toBe(CTX);
  });

  it("si requireTenant() redirige, no consulta", async () => {
    mocks.requireTenant.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));

    await expect(getOpportunityDetail(OPPORTUNITY)).rejects.toThrow(
      "NEXT_REDIRECT",
    );
    expect(mocks.withTenant).not.toHaveBeenCalled();
  });

  it.each(["", "abc", "1; drop table opportunities", `${OPPORTUNITY}x`])(
    "U7: un id que no es UUID (%j) da null sin consultar",
    async (id) => {
      expect(await getOpportunityDetail(id)).toBeNull();
      // La sesión se valida igual: el id no se mira antes del tenant.
      expect(mocks.calls).toEqual(["requireTenant"]);
    },
  );

  it("filtra por la organización del contexto y por el id (normalizado)", async () => {
    await getOpportunityDetail(OPPORTUNITY.toUpperCase());

    const [query] = mocks.queries;
    expect(query?.sql).toMatch(
      /^select "opportunities"\."id", "opportunities"\."stage", "opportunities"\."loss_reason", "opportunities"\."created_at", "opportunities"\."interest_model", "opportunities"\."interest_version", "contacts"\."name" from "opportunities"/,
    );
    expect(query?.sql).toContain(
      'inner join "contacts" on ("contacts"."organization_id" = "opportunities"."organization_id" and "contacts"."id" = "opportunities"."contact_id")',
    );
    expect(query?.sql).toContain(
      'where ("opportunities"."organization_id" = $1 and "opportunities"."id" = $2) limit $3',
    );
    expect(query?.params).toEqual([ORG, OPPORTUNITY, 1]);
  });

  it("U7: sin oportunidad visible (ajena o inexistente), null y sin leer el ledger", async () => {
    mocks.results = [[]];

    expect(await getOpportunityDetail(OPPORTUNITY)).toBeNull();
    expect(mocks.queries).toHaveLength(1);
  });

  it("lee el ledger en la misma transacción, filtrado por organización", async () => {
    mocks.results = [[OPPORTUNITY_ROW], []];

    await getOpportunityDetail(OPPORTUNITY);

    expect(mocks.withTenant).toHaveBeenCalledTimes(1);
    const [, demand] = mocks.queries;
    expect(demand?.sql).toMatch(
      /from "opportunity_demand_facts" where \("opportunity_demand_facts"\."organization_id" = \$1 and "opportunity_demand_facts"\."opportunity_id" in \(\$2\)\)$/,
    );
    expect(demand?.params).toEqual([ORG, OPPORTUNITY]);
  });
});

describe("getOpportunityDetail: ViewModel", () => {
  it("sin facts: encabezado, estado vacío y el legado de solo lectura", async () => {
    mocks.results = [[OPPORTUNITY_ROW], []];

    const detail = await getOpportunityDetail(OPPORTUNITY);

    expect(detail).toMatchObject({
      id: OPPORTUNITY,
      contactName: "Ana Benítez",
      stage: "qualifying",
      lossReason: null,
      demand: { empty: true, legacy: "Hilux" },
      summary: { vehicle: { title: "Hilux", source: "legacy" } },
    });
  });

  it("U5: explica cada fact contra el usuario de la request, sin ids de usuario", async () => {
    const h1 = "10000000-0000-4000-8000-000000000001";
    const h2 = "10000000-0000-4000-8000-000000000002";
    mocks.results = [
      [OPPORTUNITY_ROW],
      [
        record({ id: h1, fact: "desired_vehicle", model: "Corolla" }),
        record({
          id: h2,
          fact: "budget_max",
          amount: "250000000.00",
          currency: "PYG",
          recordedBy: OTHER_USER,
          recordedAt: new Date("2026-10-06T17:32:00Z"),
          evidenceText: "Lo dijo en el showroom",
        }),
      ],
    ];

    const detail = await getOpportunityDetail(OPPORTUNITY);

    const facts = new Map(detail!.demand.facts.map((f) => [f.fact, f]));
    expect(detail!.demand).toMatchObject({ empty: false, legacy: null });
    expect(facts.get("desired_vehicle")).toMatchObject({
      display: "Corolla",
      statusLabel: "Confirmado",
      explanation: [
        "Cargado al crear la oportunidad por Vos · 6 oct 2026 11:05",
      ],
    });
    expect(facts.get("budget_max")).toMatchObject({
      display: "Hasta Gs. 250.000.000",
      explanation: [
        "Confirmado por Otro miembro · 6 oct 2026 14:32",
        "Nota de la edición: Lo dijo en el showroom",
      ],
    });
    expect(detail!.summary.vehicle).toEqual({
      title: "Corolla",
      source: "demand",
    });
    const serialized = JSON.stringify(detail);
    expect(serialized).not.toContain(USER);
    expect(serialized).not.toContain(OTHER_USER);
    expect(serialized).not.toContain(ORG);
  });
});

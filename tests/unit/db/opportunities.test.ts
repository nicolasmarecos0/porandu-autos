import { drizzle } from "drizzle-orm/postgres-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  channelFromDb,
  getOpportunityQueue,
  stageFromDb,
  toOpportunity,
  type OpportunityQueueRow,
} from "@/db/queries/opportunities";
import { opportunitySources, opportunityStages } from "@/db/schema";
import { bucketFromRecency } from "@/domains/opportunities/queue";
import type { Opportunity } from "@/domains/opportunities/types";
import { UNSCORED } from "@/domains/scoring/types";
import { OPPORTUNITY_FIXTURES } from "@/mocks/opportunities";

/*
 * Loader de la cola de Opportunities (H1.1), sin base de datos:
 * - la cadena requireTenant() → withTenant() con ese mismo contexto;
 * - el filtro explícito por organización sobre el SQL generado (RLS no
 *   alcanza para detectar si falta: lo prueba tests/db/opportunities.test.ts
 *   con un usuario de varias organizaciones);
 * - el mapping fila → ViewModel contra el contrato visual de B1
 *   (mocks/opportunities.ts): lo persistido y lo derivado conservan
 *   exactamente su forma; la inteligencia sin fuente queda "sin dato".
 */

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  calls: [] as string[],
  queries: [] as { sql: string; params: unknown[] }[],
  rows: [] as unknown[],
  requireTenant: vi.fn(),
  withTenant: vi.fn(),
}));

vi.mock("@/lib/tenant/session", () => ({
  requireTenant: mocks.requireTenant,
}));
vi.mock("@/db/tenant", () => ({ withTenant: mocks.withTenant }));

const ORG = "00000000-0000-4000-8000-000000000001";
const CTX = Object.freeze({ organizationId: ORG, marker: "tenant-context" });
const NOW = new Date("2026-09-28T13:30:00Z"); // 10:30 en Asunción

beforeEach(() => {
  mocks.calls.length = 0;
  mocks.queries.length = 0;
  mocks.rows = [];
  mocks.requireTenant.mockReset();
  mocks.requireTenant.mockImplementation(async () => {
    mocks.calls.push("requireTenant");
    return CTX;
  });
  mocks.withTenant.mockReset();
  mocks.withTenant.mockImplementation(
    async (
      _ctx: unknown,
      fn: (tx: unknown) => { toSQL(): { sql: string; params: unknown[] } },
    ) => {
      mocks.calls.push("withTenant");
      mocks.queries.push(fn(drizzle.mock()).toSQL());
      return mocks.rows;
    },
  );
});

describe("getOpportunityQueue: requireTenant() → withTenant()", () => {
  it("obtiene el contexto con requireTenant() y lo pasa tal cual a withTenant()", async () => {
    await getOpportunityQueue(NOW);

    expect(mocks.calls).toEqual(["requireTenant", "withTenant"]);
    expect(mocks.withTenant).toHaveBeenCalledTimes(1);
    expect(mocks.withTenant.mock.calls[0]?.[0]).toBe(CTX);
  });

  it("si requireTenant() redirige (sin sesión, sin acceso), no consulta", async () => {
    mocks.requireTenant.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));

    await expect(getOpportunityQueue(NOW)).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.withTenant).not.toHaveBeenCalled();
  });

  it("filtra explícitamente por la organización del contexto", async () => {
    await getOpportunityQueue(NOW);

    const [query] = mocks.queries;
    expect(query?.sql).toContain(
      'where "opportunities"."organization_id" = $1',
    );
    expect(query?.params).toEqual([ORG]);
  });

  it("une cada oportunidad con su contacto de la misma organización", async () => {
    await getOpportunityQueue(NOW);

    const [query] = mocks.queries;
    expect(query?.sql).toContain(
      'inner join "contacts" on ("contacts"."organization_id" = "opportunities"."organization_id" and "contacts"."id" = "opportunities"."contact_id")',
    );
    expect(query?.sql).toContain(
      'order by "opportunities"."last_activity_at" desc, "opportunities"."id" asc',
    );
  });

  it("solo selecciona lo persistido que muestra la cola", async () => {
    await getOpportunityQueue(NOW);

    const [query] = mocks.queries;
    expect(query?.sql).toMatch(
      /^select "opportunities"\."id", "opportunities"\."stage", "opportunities"\."source", "opportunities"\."interest_model", "opportunities"\."interest_version", "opportunities"\."last_activity_at", "contacts"\."name", "contacts"\."phone", "contacts"\."city" from "opportunities"/,
    );
  });

  it("0 filas: cola vacía válida, con hora de referencia y composición", async () => {
    expect(await getOpportunityQueue(NOW)).toEqual({
      opportunities: [],
      referenceMinuteOfDay: 10 * 60 + 30,
      scoreComposition: [
        { key: "intent", weight: 0.4 },
        { key: "fit", weight: 0.3 },
        { key: "deal", weight: 0.3 },
      ],
    });
  });
});

/** La fila que guardaría la base para un fixture de B1. */
function rowOf(fixture: Opportunity): OpportunityQueueRow {
  const stage = opportunityStages.find((s) => stageFromDb[s] === fixture.stage);
  const source = opportunitySources.find(
    (s) => channelFromDb[s] === fixture.prospect.channel,
  );
  if (!stage || !source) throw new Error(`unmapped fixture ${fixture.id}`);
  return {
    id: fixture.id,
    stage,
    source,
    interestModel: fixture.interest.model ?? null,
    interestVersion: fixture.interest.version ?? null,
    lastActivityAt: new Date(
      NOW.getTime() - fixture.lastActivity.minutes * 60_000,
    ),
    contactName: fixture.prospect.name,
    // El fixture ya viene enmascarado: la base guarda el número completo.
    contactPhone: fixture.prospect.phone?.replace(" ··· ", " 555 ") ?? null,
    contactCity: fixture.prospect.city ?? null,
  };
}

describe("toOpportunity: contrato visual de B1", () => {
  it.each(OPPORTUNITY_FIXTURES.map((f) => [f.id, f] as const))(
    "%s: lo persistido y lo derivado son exactamente los del fixture",
    (_, fixture) => {
      const mapped = toOpportunity(rowOf(fixture), NOW);
      const { prospect, interest, lastActivity } = fixture;

      expect(mapped).toStrictEqual({
        id: fixture.id,
        prospect: {
          name: prospect.name,
          initials: prospect.initials,
          phone: prospect.phone,
          city: prospect.city,
          channel: prospect.channel,
          live: false,
        },
        interest: { model: interest.model, version: interest.version },
        scores: UNSCORED,
        lastActivity: { minutes: lastActivity.minutes },
        stage: fixture.stage,
        bucket: bucketFromRecency(lastActivity.minutes),
        drivers: [],
      });
    },
  );

  it("la inteligencia sin fuente queda sin dato, nunca inventada", () => {
    const fixture = OPPORTUNITY_FIXTURES[0]!;
    const mapped = toOpportunity(rowOf(fixture), NOW);

    expect(mapped.scores).toEqual({
      porandu: null,
      coverage: 0,
      intent: null,
      fit: null,
      deal: null,
    });
    expect(mapped.prospect.live).toBe(false);
    expect(mapped.drivers).toEqual([]);
    for (const key of [
      "nba",
      "topMatch",
      "alternative",
      "tradeIn",
      "owner",
    ] as const) {
      expect(mapped).not.toHaveProperty(key);
    }
    expect(mapped.lastActivity).not.toHaveProperty("summary");
    expect(mapped.prospect).not.toHaveProperty("company");
  });

  it("teléfono, ciudad e interés vacíos o en blanco son sin dato", () => {
    const mapped = toOpportunity(
      {
        ...rowOf(OPPORTUNITY_FIXTURES[0]!),
        contactPhone: null,
        contactCity: "  ",
        interestModel: "",
        interestVersion: null,
      },
      NOW,
    );
    expect(mapped.prospect).not.toHaveProperty("phone");
    expect(mapped.prospect).not.toHaveProperty("city");
    expect(mapped.interest).toStrictEqual({});
  });

  it("cada etapa y cada origen de la base tiene su valor en el dominio", () => {
    expect(Object.keys(stageFromDb).sort()).toEqual(
      [...opportunityStages].sort(),
    );
    expect(Object.keys(channelFromDb).sort()).toEqual(
      [...opportunitySources].sort(),
    );
    expect(Object.values(stageFromDb)).toEqual([
      "new",
      "qualified",
      "testDrive",
      "negotiation",
    ]);
    expect(Object.values(channelFromDb)).toEqual([
      "WhatsApp",
      "Meta Ads",
      "Web",
      "Showroom",
      "Referido",
    ]);
  });
});

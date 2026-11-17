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
import { resolveDemand } from "@/domains/demand/resolver";
import type { MatchableVehicle } from "@/domains/match";
import { bucketFromRecency } from "@/domains/opportunities/queue";
import type { Opportunity } from "@/domains/opportunities/types";
import { demandSnapshot } from "@/domains/demand/snapshot";
import { prospectAvatar } from "@/domains/opportunities/prospect";
import { deriveOpportunityDrivers } from "@/domains/scoring/drivers";
import {
  evaluateOpportunity,
  PORANDU_SCORE_COMPOSITION,
} from "@/domains/scoring/engine";
import { NO_INTENT_SIGNALS } from "@/domains/scoring/signals";
import { OPPORTUNITY_FIXTURES } from "@/mocks/opportunities";

/*
 * Loader de la cola de Opportunities (H1.1), sin base de datos:
 * - la cadena requireTenant() → withTenant() con ese mismo contexto;
 * - el filtro explícito por organización sobre el SQL generado (RLS no
 *   alcanza para detectar si falta: lo prueba tests/db/opportunities.test.ts
 *   con un usuario de varias organizaciones);
 * - el mapping fila → ViewModel contra el contrato visual de B1
 *   (mocks/opportunities.ts): lo persistido y lo derivado conservan
 *   exactamente su forma; la inteligencia sin fuente queda "sin dato";
 * - la demanda (H1.4): el ledger de la cola se lee por lote en la misma
 *   transacción y filtrado por organización; el legado `interest_*` solo
 *   llega como vehículo "Dato anterior" mientras nunca se cargó uno;
 * - la inteligencia (Hito 3, DEC-035): el stock disponible y la última nota
 *   de cada oportunidad se leen por lote en la misma transacción, filtrados
 *   por organización, y el motor deriva recencia, Porandú Score, su
 *   explicación y la NBA;
 * - las señales (DEC-058): pruebas de manejo, cotizaciones, el último mensaje
 *   del cliente y la toma vigente se leen por lote en la misma transacción y
 *   filtradas por organización; con ellas el motor calcula Intent, el
 *   derivador arma "¿Por qué ahora?" y Match v0 hidrata el Top Match y la
 *   alternativa. El responsable y la conversación en vivo siguen sin dato.
 */

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  calls: [] as string[],
  queries: [] as { sql: string; params: unknown[] }[],
  rows: [] as unknown[],
  demandRows: [] as unknown[],
  vehicleRows: [] as unknown[],
  noteRows: [] as unknown[],
  testDriveRows: [] as unknown[],
  quoteRows: [] as unknown[],
  inboundRows: [] as unknown[],
  tradeInRows: [] as unknown[],
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
  mocks.demandRows = [];
  mocks.vehicleRows = [];
  mocks.noteRows = [];
  mocks.testDriveRows = [];
  mocks.quoteRows = [];
  mocks.inboundRows = [];
  mocks.tradeInRows = [];
  mocks.withTenant.mockReset();
  mocks.withTenant.mockImplementation(
    async (_ctx: unknown, fn: (tx: unknown) => Promise<unknown>) => {
      mocks.calls.push("withTenant");
      return fn(
        fakeTransaction([
          mocks.rows,
          mocks.demandRows,
          mocks.vehicleRows,
          mocks.noteRows,
          mocks.testDriveRows,
          mocks.quoteRows,
          mocks.inboundRows,
          mocks.tradeInRows,
        ]),
      );
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
      /^select "opportunities"\."id", "opportunities"\."stage", "opportunities"\."source", "opportunities"\."interest_model", "opportunities"\."interest_version", "opportunities"\."last_activity_at", "opportunities"\."vehicle_id", "contacts"\."id", "contacts"\."name", "contacts"\."phone", "contacts"\."city" from "opportunities"/,
    );
  });

  it("lee la demanda de toda la cola por lote, en la misma transacción y filtrada por organización", async () => {
    mocks.rows = [
      rowOf(OPPORTUNITY_FIXTURES[0]!),
      rowOf(OPPORTUNITY_FIXTURES[1]!),
    ];
    await getOpportunityQueue(NOW);

    expect(mocks.withTenant).toHaveBeenCalledTimes(1);
    const [, demand] = mocks.queries;
    expect(demand?.sql).toMatch(
      /from "opportunity_demand_facts" where \("opportunity_demand_facts"\."organization_id" = \$1 and "opportunity_demand_facts"\."opportunity_id" in \(\$2, \$3\)\)$/,
    );
    expect(demand?.params).toEqual([
      ORG,
      OPPORTUNITY_FIXTURES[0]!.id,
      OPPORTUNITY_FIXTURES[1]!.id,
    ]);
  });

  it("lee el stock disponible de la organización una sola vez, en la misma transacción (DEC-035)", async () => {
    mocks.rows = [
      rowOf(OPPORTUNITY_FIXTURES[0]!),
      rowOf(OPPORTUNITY_FIXTURES[1]!),
    ];
    await getOpportunityQueue(NOW);

    expect(mocks.withTenant).toHaveBeenCalledTimes(1);
    const [, , stock] = mocks.queries;
    expect(stock?.sql).toMatch(
      /from "vehicles" where \("vehicles"\."organization_id" = \$1 and "vehicles"\."status" = \$2\) order by "vehicles"\."created_at" desc, "vehicles"\."id" asc$/,
    );
    expect(stock?.params).toEqual([ORG, "available"]);
  });

  it("lee la última nota de cada oportunidad por lote, sin texto ni autor (DEC-035)", async () => {
    mocks.rows = [
      rowOf(OPPORTUNITY_FIXTURES[0]!),
      rowOf(OPPORTUNITY_FIXTURES[1]!),
    ];
    await getOpportunityQueue(NOW);

    const [, , , notes] = mocks.queries;
    expect(notes?.sql).toBe(
      'select "opportunity_id", max("recorded_at") from "opportunity_notes" where ("opportunity_notes"."organization_id" = $1 and "opportunity_notes"."opportunity_id" in ($2, $3)) group by "opportunity_notes"."opportunity_id"',
    );
    expect(notes?.params).toEqual([
      ORG,
      OPPORTUNITY_FIXTURES[0]!.id,
      OPPORTUNITY_FIXTURES[1]!.id,
    ]);
    expect(notes?.sql).not.toMatch(/"body"|"recorded_by"/);
  });

  it("cruza la cola con el stock y la bitácora: cada oportunidad, con lo suyo", async () => {
    const hilux = rowOf(OPPORTUNITY_FIXTURES[0]!);
    const linked = {
      ...rowOf(OPPORTUNITY_FIXTURES[1]!),
      vehicleId: "20000000-0000-4000-8000-000000000001",
    };
    mocks.rows = [hilux, linked];
    mocks.demandRows = [
      demandRecord(hilux.id, { brand: "Toyota", model: "Hilux" }),
    ];
    mocks.vehicleRows = [
      {
        id: "20000000-0000-4000-8000-000000000002",
        organizationId: ORG,
        brand: "Toyota",
        model: "Hilux",
        version: null,
        year: 2024,
        km: 0,
        price: "40000.00",
        currency: "USD",
        status: "available",
      },
    ];
    mocks.noteRows = [{ opportunityId: linked.id, lastNoteAt: NOW }];

    const { opportunities } = await getOpportunityQueue(NOW);

    // Ramón: Toyota Hilux en stock (marca y modelo, 45 pts), sin notas.
    expect(opportunities[0]?.scores.fit).toBe(45);
    expect(opportunities[0]?.nba?.code).toBe("log_contact_update");
    // La segunda tiene la unidad vinculada y una nota de recién: al día.
    expect(opportunities[1]?.scores.fit).toBe(100);
    expect(opportunities[1]?.nba?.code).toBe("on_track");
  });

  it("lee las señales de la cola por lote, en la misma transacción y filtradas por organización (DEC-058)", async () => {
    mocks.rows = [
      rowOf(OPPORTUNITY_FIXTURES[0]!),
      rowOf(OPPORTUNITY_FIXTURES[1]!),
    ];
    await getOpportunityQueue(NOW);

    expect(mocks.withTenant).toHaveBeenCalledTimes(1);
    const [, , , , drives, quotes, inbound, tradeIns] = mocks.queries;
    const ids = [OPPORTUNITY_FIXTURES[0]!.id, OPPORTUNITY_FIXTURES[1]!.id];
    expect(drives?.sql).toBe(
      'select "opportunity_id", "status", "scheduled_at" from "test_drives" where ("test_drives"."organization_id" = $1 and "test_drives"."opportunity_id" in ($2, $3) and "test_drives"."status" <> $4)',
    );
    expect(drives?.params).toEqual([ORG, ...ids, "cancelled"]);
    expect(quotes?.sql).toBe(
      'select "opportunity_id", "number", "status", "currency", "total_price", "valid_until" from "quotes" where ("quotes"."organization_id" = $1 and "quotes"."opportunity_id" in ($2, $3) and "quotes"."status" <> $4)',
    );
    expect(quotes?.params).toEqual([ORG, ...ids, "withdrawn"]);
    // Del mensaje solo el momento: ni el texto ni el autor.
    expect(inbound?.sql).toBe(
      'select "opportunity_id", max("created_at") from "messages" where ("messages"."organization_id" = $1 and "messages"."opportunity_id" in ($2, $3) and "messages"."direction" = $4) group by "messages"."opportunity_id"',
    );
    expect(inbound?.params).toEqual([ORG, ...ids, "inbound"]);
    expect(inbound?.sql).not.toMatch(/"content"|"recorded_by"/);
    // De la toma, el estado y el usado: ni la chapa ni los importes.
    expect(tradeIns?.sql).toBe(
      'select "opportunity_id", "status", "brand", "model", "year" from "trade_ins" where ("trade_ins"."organization_id" = $1 and "trade_ins"."opportunity_id" in ($2, $3) and "trade_ins"."status" in ($4, $5, $6))',
    );
    expect(tradeIns?.params).toEqual([
      ORG,
      ...ids,
      "pending",
      "appraised",
      "accepted",
    ]);
  });

  it("con las señales calcula Intent, ¿Por qué ahora? y las tarjetas de match (DEC-058)", async () => {
    const hilux = {
      ...rowOf(OPPORTUNITY_FIXTURES[1]!), // En negociación
      lastActivityAt: new Date(NOW.getTime() - 10 * 60_000),
    };
    mocks.rows = [hilux];
    mocks.demandRows = [
      demandRecord(hilux.id, { brand: "Toyota", model: "Hilux" }),
    ];
    mocks.vehicleRows = [
      {
        id: "20000000-0000-4000-8000-000000000002",
        organizationId: ORG,
        brand: "Toyota",
        model: "Hilux",
        version: "SRV",
        year: 2025,
        km: 0,
        price: "49900.00",
        currency: "USD",
        status: "available",
      },
    ];
    mocks.testDriveRows = [
      {
        opportunityId: hilux.id,
        status: "confirmed",
        scheduledAt: new Date(NOW.getTime() + 24 * 3_600_000),
      },
    ];
    mocks.quoteRows = [
      {
        opportunityId: hilux.id,
        number: 12,
        status: "sent",
        currency: "USD",
        totalPrice: "48500.00",
        validUntil: "2026-10-15",
      },
    ];
    mocks.inboundRows = [
      {
        opportunityId: hilux.id,
        lastInboundAt: new Date(NOW.getTime() - 2 * 3_600_000),
      },
    ];
    mocks.tradeInRows = [
      {
        opportunityId: hilux.id,
        status: "pending",
        brand: "Toyota",
        model: "Fortuner",
        year: 2019,
      },
    ];

    const [mapped] = (await getOpportunityQueue(NOW)).opportunities;

    // 45 + 5 (activa) + 15 (escribió hace 2 h) + 15 (prueba) + 15 (cotización).
    expect(mapped?.scores.intent).toBe(95);
    expect(mapped?.scores.coverage).toBe(1);
    expect(mapped?.stockMatches).toMatchObject({
      kind: "matches",
      top: {
        name: "Toyota Hilux",
        condition: "new",
        body: "pickup",
        km: "0 km",
      },
      alternative: null,
    });
    // Fuertes del mayor peso al menor; a validar, la tasación y el match
    // parcial (solo marca y modelo: 45 pts).
    expect(
      mapped?.drivers.map((driver) => [driver.kind, driver.strength]),
    ).toEqual([
      ["testDrive", 92],
      ["quote", 90],
      ["engagement", 90],
      ["tradeIn", 85],
      ["appraisal", 70],
      ["stock", 45],
    ]);
    expect(mapped?.drivers.find((d) => d.kind === "tradeIn")?.detail).toBe(
      "Ofrece su Toyota Fortuner 2019 en parte de pago: reduce el saldo a pagar.",
    );
  });

  it("sin oportunidades no lee la demanda, el stock ni la bitácora", async () => {
    await getOpportunityQueue(NOW);
    expect(mocks.queries).toHaveLength(1);
  });

  it("0 filas: cola vacía válida, con hora de referencia y la composición del motor", async () => {
    expect(await getOpportunityQueue(NOW)).toEqual({
      opportunities: [],
      referenceMinuteOfDay: 10 * 60 + 30,
      scoreComposition: [
        { key: "intent", weight: 0.4 },
        { key: "fit", weight: 0.3 },
        { key: "deal", weight: 0.3 },
      ],
    });
    expect(PORANDU_SCORE_COMPOSITION).toEqual(
      (await getOpportunityQueue(NOW)).scoreComposition,
    );
  });
});

/** Registro del ledger (como lo lee Drizzle) con el vehículo buscado. */
function demandRecord(
  opportunityId: string,
  value: { brand?: string; model?: string },
) {
  return {
    id: `40000000-0000-4000-8000-${opportunityId.slice(-12)}`,
    organizationId: ORG,
    opportunityId,
    fact: "desired_vehicle",
    status: "confirmed",
    sourceKind: "member",
    recordedBy: "00000000-0000-4000-8000-00000000000a",
    recordedAt: NOW,
    targetFactId: null,
    previousMemberFactId: null,
    brand: value.brand ?? null,
    model: value.model ?? null,
    yearMin: null,
    yearMax: null,
    amount: null,
    currency: null,
    purchaseType: null,
    tradeIn: null,
    evidenceText: null,
  };
}

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
    vehicleId: null,
    contactId: `30000000-0000-4000-8000-${fixture.id.replace(/\D/g, "").padStart(12, "0")}`,
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
      const row = rowOf(fixture);
      const mapped = toOpportunity(row, NOW);
      const { prospect, interest, lastActivity } = fixture;
      const legacy = [interest.model, interest.version]
        .filter(Boolean)
        .join(" ");
      // El motor recibe lo que la fila dice: etapa, última actividad, sin
      // unidad, sin notas y sin demanda evaluable (el legado no cuenta).
      const intelligence = evaluateOpportunity(
        {
          stage: fixture.stage,
          lastActivityAt: row.lastActivityAt,
          lastNoteAt: null,
          hasLinkedVehicle: false,
          stockFit: { kind: "no_demand" },
          signals: NO_INTENT_SIGNALS,
        },
        NOW,
      );
      const drivers = deriveOpportunityDrivers(
        {
          stage: fixture.stage,
          demand: demandSnapshot(resolveDemand([])),
          rail: { kind: "empty", reason: "no_demand" },
          hasLinkedVehicle: false,
          recency: intelligence.recency,
          signals: NO_INTENT_SIGNALS,
          tradeIn: null,
        },
        NOW,
      );

      expect(mapped.demand?.vehicle).toEqual(
        legacy ? { title: legacy, source: "legacy" } : null,
      );
      expect(mapped).toStrictEqual({
        id: fixture.id,
        prospect: {
          name: prospect.name,
          initials: prospect.initials,
          phone: prospect.phone,
          city: prospect.city,
          channel: prospect.channel,
          live: false,
          avatar: prospectAvatar(row.contactId),
        },
        demand: mapped.demand,
        // El legado no es fuente de verdad: solo el vehículo "Dato anterior".
        interest: {},
        scores: intelligence.scores,
        scoreExplanation: intelligence.explanation,
        lastActivity: {
          minutes: lastActivity.minutes,
          state: intelligence.recency.state,
        },
        stage: fixture.stage,
        bucket: bucketFromRecency(lastActivity.minutes),
        nba: intelligence.nba,
        drivers,
        stockMatches: { kind: "empty", reason: "no_demand" },
      });
    },
  );

  it("lo que no tiene fuente sigue sin dato, nunca inventado", () => {
    const fixture = OPPORTUNITY_FIXTURES[0]!;
    const mapped = toOpportunity(rowOf(fixture), NOW);

    // Sin demanda evaluable: Vehicle Fit sin dato y la cobertura dice que se
    // evaluaron Intent (etapa y recencia, DEC-058) y Deal Readiness (DEC-005).
    // Intent 35 + 5; (40·40 + 30·45) / 70 = 42.
    expect(mapped.scores).toEqual({
      porandu: 42,
      coverage: 0.7,
      intent: 40,
      fit: null,
      deal: 45,
    });
    expect(mapped.prospect.live).toBe(false);
    // Sin demanda, sin señales y activa: ninguna señal que mostrar.
    expect(mapped.drivers).toEqual([]);
    expect(mapped.stockMatches).toEqual({
      kind: "empty",
      reason: "no_demand",
    });
    for (const key of [
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

  it("deriva recencia, Porandú Score, explicación y NBA del motor (DEC-035)", () => {
    const fixture = OPPORTUNITY_FIXTURES[1]!; // En negociación
    const stale = {
      ...rowOf(fixture),
      lastActivityAt: new Date(NOW.getTime() - 6 * 24 * 60 * 60_000),
    };
    const hilux: MatchableVehicle = {
      id: "20000000-0000-4000-8000-000000000001",
      organizationId: ORG,
      status: "available",
      brand: "Toyota",
      model: "Hilux",
      year: 2024,
      price: { amount: "40000.00", currency: "USD" },
    };
    const demand = resolveDemand([
      {
        id: "40000000-0000-4000-8000-000000000001",
        fact: "desired_vehicle",
        status: "confirmed",
        sourceKind: "member",
        recordedBy: "00000000-0000-4000-8000-00000000000a",
        recordedAt: NOW,
        observedAt: null,
        targetFactId: null,
        previousMemberFactId: null,
        value: { brand: "Toyota", model: "Hilux" },
        evidenceText: null,
      },
    ]);

    const mapped = toOpportunity(stale, NOW, demand, {
      stock: [hilux],
      lastNoteAt: null,
    });

    expect(mapped.lastActivity).toEqual({
      minutes: 6 * 24 * 60,
      state: "stale",
    });
    // Intent 30 (45 − 15), Fit 45 (marca y modelo) y Deal 75: base 48,
    // menos 40 por inactividad.
    expect(mapped.scores).toEqual({
      porandu: 8,
      coverage: 1,
      intent: 30,
      fit: 45,
      deal: 75,
    });
    expect(mapped.scoreExplanation?.penalties).toEqual([
      {
        kind: "inactivity",
        label: "Inactiva hace 6 días · riesgo de pérdida",
        points: -40,
      },
    ]);
    expect(mapped.nba).toMatchObject({
      code: "recover_stale",
      action: "Retomar contacto urgente",
      urgent: true,
      secondary: [
        "Vincular unidad de stock",
        "Registrar actualización de contacto",
      ],
    });
  });

  it("con la unidad vinculada, Vehicle Fit es 100 y la NBA no pide vincular", () => {
    const mapped = toOpportunity(
      {
        ...rowOf(OPPORTUNITY_FIXTURES[1]!),
        vehicleId: "20000000-0000-4000-8000-000000000001",
      },
      NOW,
      resolveDemand([]),
      { stock: [], lastNoteAt: NOW },
    );
    expect(mapped.scores.fit).toBe(100);
    expect(mapped.nba?.code).toBe("on_track");
  });

  it("una oportunidad cerrada no tiene NBA: el campo no llega", () => {
    const mapped = toOpportunity(
      { ...rowOf(OPPORTUNITY_FIXTURES[0]!), stage: "lost" },
      NOW,
    );
    expect(mapped).not.toHaveProperty("nba");
    expect(mapped.scores.porandu).toBe(0);
    expect(mapped.scoreExplanation?.outcome).toBe(
      "Perdida: la oportunidad se descartó",
    );
  });

  it("la NBA y la explicación no exponen ids, notas ni la demanda cruda", () => {
    const mapped = toOpportunity(rowOf(OPPORTUNITY_FIXTURES[1]!), NOW);
    expect(JSON.stringify([mapped.nba, mapped.scoreExplanation])).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-|recordedBy|evidence/,
    );
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
    expect(mapped.demand?.vehicle).toBeNull();
  });

  it("con un vehículo cargado, el legado no aparece; quitado, tampoco vuelve (T16)", () => {
    const row = { ...rowOf(OPPORTUNITY_FIXTURES[0]!), interestModel: "Hilux" };
    const loaded = {
      id: "40000000-0000-4000-8000-000000000001",
      fact: "desired_vehicle" as const,
      status: "confirmed" as const,
      sourceKind: "member" as const,
      recordedBy: "00000000-0000-4000-8000-00000000000a",
      recordedAt: NOW,
      observedAt: null,
      targetFactId: null,
      previousMemberFactId: null,
      value: { model: "Ranger" },
      evidenceText: "nota interna",
    };
    expect(
      toOpportunity(row, NOW, resolveDemand([loaded])).demand?.vehicle,
    ).toEqual({ title: "Ranger", source: "demand" });

    const removed = toOpportunity(
      row,
      NOW,
      resolveDemand([
        loaded,
        {
          ...loaded,
          id: "40000000-0000-4000-8000-000000000002",
          status: "rejected",
          value: null,
          targetFactId: loaded.id,
          previousMemberFactId: loaded.id,
          evidenceText: null,
        },
      ]),
    );
    expect(removed.demand?.vehicle).toBeNull();
    expect(removed.demand?.facts.desired_vehicle).toMatchObject({
      status: "unknown",
      unknownReason: "withdrawn",
    });
    // U6: a la cola no llegan evidencia, historial ni ids de usuario.
    expect(JSON.stringify(removed)).not.toMatch(
      /nota interna|00000000000a|history|recordedBy/,
    );
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
      "qualifying",
      "negotiating",
      "won",
      "lost",
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

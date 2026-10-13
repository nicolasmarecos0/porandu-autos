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
  lossReason: null as string | null,
  lossNotes: null as string | null,
  salePrice: null as string | null,
  saleCurrency: null as string | null,
  paymentMethod: null as string | null,
  deliveryStatus: null as string | null,
  deliveryDate: null as string | null,
  vehicleId: null as string | null,
  createdAt: CREATED_AT,
  interestModel: " Hilux ",
  interestVersion: null,
  contactName: "Ana Benítez",
};

const VEHICLE = "20000000-0000-4000-8000-000000000101";

/** Unidad vinculada como la devuelve la base. */
const LINKED_ROW = {
  id: VEHICLE,
  organizationId: ORG,
  brand: "Toyota",
  model: "Hilux",
  version: "SRV 2.8 4x4 AT",
  year: 2025,
  km: 0,
  price: "49900.00",
  currency: "USD",
  status: "available",
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
      /^select "opportunities"\."id", "opportunities"\."stage", "opportunities"\."loss_reason", "opportunities"\."loss_notes", "opportunities"\."sale_price", "opportunities"\."sale_currency", "opportunities"\."payment_method", "opportunities"\."delivery_status", "opportunities"\."delivery_date", "opportunities"\."vehicle_id", "opportunities"\."created_at", "opportunities"\."interest_model", "opportunities"\."interest_version", "contacts"\."name" from "opportunities"/,
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

  it("Hito 2: lee la unidad vinculada y la bitácora en la misma transacción, filtradas por organización", async () => {
    mocks.results = [
      [{ ...OPPORTUNITY_ROW, stage: "negotiating", vehicleId: VEHICLE }],
      [],
      [],
      [LINKED_ROW],
      [],
    ];

    await getOpportunityDetail(OPPORTUNITY);

    expect(mocks.withTenant).toHaveBeenCalledTimes(1);
    const [, , candidates, linked, notes] = mocks.queries;
    expect(candidates?.sql).toContain('from "vehicles"');
    expect(linked?.sql).toMatch(
      /from "vehicles" where \("vehicles"\."organization_id" = \$1 and "vehicles"\."id" = \$2\) limit \$3$/,
    );
    expect(linked?.params).toEqual([ORG, VEHICLE, 1]);
    expect(notes?.sql).toMatch(
      /from "opportunity_notes" where \("opportunity_notes"\."organization_id" = \$1 and "opportunity_notes"\."opportunity_id" = \$2\) order by "opportunity_notes"\."recorded_at" desc, "opportunity_notes"\."id" desc$/,
    );
    expect(notes?.params).toEqual([ORG, OPPORTUNITY]);
  });

  it("Hito 2: sin unidad vinculada no consulta vehicles por id", async () => {
    mocks.results = [[OPPORTUNITY_ROW], [], [], []];

    await getOpportunityDetail(OPPORTUNITY);

    expect(mocks.queries.map((q) => q.sql.match(/from "(\w+)"/)?.[1])).toEqual([
      "opportunities",
      "opportunity_demand_facts",
      "vehicles",
      "opportunity_notes",
      "messages",
    ]);
  });

  it("Hito 4: lee los mensajes de la oportunidad en la misma transacción, filtrados por organización", async () => {
    mocks.results = [[OPPORTUNITY_ROW], [], [], [], []];

    await getOpportunityDetail(OPPORTUNITY);

    expect(mocks.withTenant).toHaveBeenCalledTimes(1);
    const messages = mocks.queries.at(-1);
    expect(messages?.sql).toMatch(
      /^select "id", "channel", "direction", "content", "recorded_by", "created_at" from "messages" where \("messages"\."organization_id" = \$1 and "messages"\."opportunity_id" = \$2\) order by "messages"\."created_at" desc, "messages"\."id" desc$/,
    );
    expect(messages?.params).toEqual([ORG, OPPORTUNITY]);
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
      closure: null,
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

describe("getOpportunityDetail: muro de actividad (Hito 4)", () => {
  it("combina notas y mensajes del más reciente al más viejo, con autor contra el usuario de la request y sin ids de usuario", async () => {
    mocks.results = [
      [OPPORTUNITY_ROW],
      [],
      [],
      [
        {
          id: "40000000-0000-4000-8000-000000000001",
          body: "Primera llamada.",
          recordedBy: USER,
          recordedAt: new Date("2026-10-11T12:00:00Z"),
        },
      ],
      [
        {
          id: "50000000-0000-4000-8000-000000000001",
          channel: "whatsapp",
          direction: "inbound",
          content: "¿Sigue disponible?",
          recordedBy: OTHER_USER,
          createdAt: new Date("2026-10-11T17:32:00Z"),
        },
      ],
    ];

    const detail = await getOpportunityDetail(OPPORTUNITY);

    expect(detail!.activity).toEqual([
      {
        kind: "message",
        id: "50000000-0000-4000-8000-000000000001",
        label: "Mensaje recibido",
        channel: "whatsapp",
        channelLabel: "WhatsApp",
        direction: "inbound",
        body: "¿Sigue disponible?",
        author: "Otro miembro",
        at: "11 oct 2026 14:32",
      },
      {
        kind: "note",
        id: "40000000-0000-4000-8000-000000000001",
        label: "Nota",
        body: "Primera llamada.",
        author: "Vos",
        at: "11 oct 2026 09:00",
      },
    ]);
    const serialized = JSON.stringify(detail);
    expect(serialized).not.toContain(USER);
    expect(serialized).not.toContain(OTHER_USER);
  });
});

describe("getOpportunityDetail: bitácora y unidad vinculada (Hito 2)", () => {
  it("las notas llegan de la más reciente a la más vieja, con autor contra el usuario de la request y sin ids de usuario", async () => {
    mocks.results = [
      [OPPORTUNITY_ROW],
      [],
      [],
      [
        {
          id: "40000000-0000-4000-8000-000000000002",
          body: "Pidió cuota fija.\nVuelve el lunes.",
          recordedBy: OTHER_USER,
          recordedAt: new Date("2026-10-11T17:32:00Z"),
        },
        {
          id: "40000000-0000-4000-8000-000000000001",
          body: "Primera llamada.",
          recordedBy: USER,
          recordedAt: new Date("2026-10-11T12:00:00Z"),
        },
      ],
    ];

    const detail = await getOpportunityDetail(OPPORTUNITY);

    expect(detail!.notes).toEqual([
      {
        id: "40000000-0000-4000-8000-000000000002",
        body: "Pidió cuota fija.\nVuelve el lunes.",
        author: "Otro miembro",
        at: "11 oct 2026 14:32",
      },
      {
        id: "40000000-0000-4000-8000-000000000001",
        body: "Primera llamada.",
        author: "Vos",
        at: "11 oct 2026 09:00",
      },
    ]);
    const serialized = JSON.stringify(detail);
    expect(serialized).not.toContain(USER);
    expect(serialized).not.toContain(OTHER_USER);
  });

  it.each([
    ["new", false],
    ["qualifying", false],
    ["negotiating", true],
    ["won", false],
    ["lost", false],
  ] as const)("en %s, cambiar la unidad: %s", async (stage, canChange) => {
    mocks.results = [[{ ...OPPORTUNITY_ROW, stage }], [], [], []];

    const detail = await getOpportunityDetail(OPPORTUNITY);

    expect(detail!.vehicleLink).toEqual({ canChange, linked: null });
  });

  it("la unidad vinculada llega como tarjeta, en cualquier estado", async () => {
    mocks.results = [
      [{ ...OPPORTUNITY_ROW, stage: "won", vehicleId: VEHICLE }],
      [],
      [],
      [{ ...LINKED_ROW, status: "reserved" }],
      [],
    ];

    const detail = await getOpportunityDetail(OPPORTUNITY);

    expect(detail!.vehicleLink).toEqual({
      // Ganada: es la unidad vendida y queda fija (DEC-034 §4).
      canChange: false,
      linked: {
        vehicleId: VEHICLE,
        name: "Toyota Hilux",
        detail: "SRV 2.8 4x4 AT · 2025",
        price: "USD 49.900",
        km: "0 km",
        status: "reserved",
        statusLabel: "Reservado",
      },
    });
  });
});

describe("getOpportunityDetail: cierre (DEC-034)", () => {
  it("una venta llega como resumen: precio con su moneda, forma de pago y entrega", async () => {
    mocks.results = [
      [
        {
          ...OPPORTUNITY_ROW,
          stage: "won",
          vehicleId: VEHICLE,
          salePrice: "47500.00",
          saleCurrency: "USD",
          paymentMethod: "financing",
          deliveryStatus: "delivered",
          deliveryDate: "2026-10-10",
        },
      ],
      [],
      [],
      [LINKED_ROW],
      [],
    ];

    const detail = await getOpportunityDetail(OPPORTUNITY);

    expect(detail!.closure).toEqual({
      outcome: "won",
      salePrice: "USD 47.500",
      paymentMethod: "Financiación",
      delivery: "Entregada el 10 oct 2026",
    });
  });

  it("una pérdida llega con su motivo y sus notas", async () => {
    mocks.results = [
      [
        {
          ...OPPORTUNITY_ROW,
          stage: "lost",
          lossReason: "ghosted",
          lossNotes: "No contestó más desde el viernes.",
        },
      ],
      [],
      [],
      [],
    ];

    const detail = await getOpportunityDetail(OPPORTUNITY);

    expect(detail!.closure).toEqual({
      outcome: "lost",
      reason: "Dejó de responder",
      notes: "No contestó más desde el viernes.",
    });
  });

  it.each(["new", "qualifying", "negotiating"] as const)(
    "en %s no hay cierre",
    async (stage) => {
      mocks.results = [[{ ...OPPORTUNITY_ROW, stage }], [], [], []];
      expect((await getOpportunityDetail(OPPORTUNITY))!.closure).toBeNull();
    },
  );
});

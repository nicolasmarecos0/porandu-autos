import { randomUUID } from "node:crypto";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  createOpportunityWithContact,
  DemandCaptureError,
  type NewOpportunity,
} from "@/db/queries/create-opportunity";
import { recordDemandCapture } from "@/db/queries/demand-facts";
import type { TenantContext } from "@/db/tenant";
import type { DemandItem } from "@/domains/demand/planner";
import { recordDemand } from "@/lib/opportunities/actions";
import type { RecordDemandState } from "@/lib/opportunities/record-demand";
import { ACTIVE_ORGANIZATION_COOKIE } from "@/lib/tenant/cookie";

import { cookieJar, type CookieJar } from "../unit/support/cookie-jar";
import { OPPORTUNITIES, seedOpportunities } from "./support/opportunities";
import {
  runMigrations,
  startTestServer,
  type TestDatabase,
  type TestServer,
} from "./support/postgres";
import { closeRuntimePool } from "./support/runtime";
import {
  ORG_1,
  ORG_2,
  ORG_3,
  seedTenants,
  tenantContext,
  USER_A,
  USER_B,
  USER_C,
  USER_D,
} from "./support/tenants";

/*
 * Escritura de la demanda (H1.4, DEC-030 §4, §5 y §8) de punta a punta contra
 * PostgreSQL 17: el alta con demanda en una sola transacción y la Server
 * Action recordDemand() sobre el único módulo de escritura.
 *
 *   recordDemand() → requireTenant() → leer los facts modificados →
 *   withTenant() → planner del dominio → INSERT append-only → RLS (WITH
 *   CHECK) → revalidar
 *
 * La acción, el módulo y el planner son los reales, conectados como
 * app_runtime. Supabase Auth (claims ya verificados), la cookie, redirect()
 * y revalidatePath() de Next son simulados. Los datos quedan committeados:
 * cada caso usa una oportunidad nueva.
 */

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => {
  class RedirectSignal extends Error {
    constructor(readonly path: string) {
      super(`redirect(${path})`);
    }
  }
  return {
    RedirectSignal,
    claims: null as Record<string, unknown> | null,
    jar: null as CookieJar | null,
    revalidated: [] as string[],
    redirect: (path: string): never => {
      throw new RedirectSignal(path);
    },
  };
});

vi.mock("@/lib/supabase/server", () => ({
  createAuthClient: async () => ({
    getClaims: async () =>
      mocks.claims
        ? { data: { claims: mocks.claims }, error: null }
        : { data: null, error: null },
  }),
}));
vi.mock("next/headers", () => ({
  cookies: async () => {
    if (!mocks.jar) throw new Error("no cookie jar");
    return mocks.jar.store;
  },
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/cache", () => ({
  revalidatePath: (path: string) => {
    mocks.revalidated.push(path);
  },
}));

let server: TestServer;
let db: TestDatabase;

beforeAll(async () => {
  server = await startTestServer();
  db = await server.createDatabase();
  await runMigrations(db.migrationUrl);
  await seedTenants(db.admin);
  await seedOpportunities(db.admin);
  vi.stubEnv("RUNTIME_DATABASE_URL", await db.runtimeUrl());
});

afterAll(async () => {
  await closeRuntimePool();
  vi.unstubAllEnvs();
  await server?.close();
});

/** Nueva request: usuario autenticado y cookie de organización. */
function request(userId: string, cookie?: string): void {
  mocks.revalidated.length = 0;
  mocks.claims = {
    iss: "https://testref.supabase.co/auth/v1",
    sub: userId,
    aud: "authenticated",
    exp: 1_900_000_000,
    iat: 1_899_996_400,
    role: "authenticated",
    aal: "aal1",
    session_id: "00000000-0000-4000-8000-0000000000e1",
  };
  mocks.jar = cookieJar(
    cookie === undefined ? {} : { [ACTIVE_ORGANIZATION_COOKIE]: cookie },
  );
}

let sequence = 0;

function newOpportunity(demand: NewOpportunity["demand"] = {}): NewOpportunity {
  sequence += 1;
  const subscriber = String(800_000 + sequence);
  return {
    contact: {
      name: "Lucía Ortiz",
      phone: `0981 ${subscriber}`,
      phoneNormalized: `+595981${subscriber}`,
      city: null,
    },
    source: "showroom",
    demand,
  };
}

/** Oportunidad nueva de A en ORG_1, con la demanda del alta. */
async function opportunityWith(
  demand: NewOpportunity["demand"] = {},
  ctx: TenantContext = tenantContext(USER_A, ORG_1),
): Promise<string> {
  const { opportunityId } = await createOpportunityWithContact(
    ctx,
    newOpportunity(demand),
  );
  return opportunityId;
}

type LedgerRow = {
  id: string;
  fact: string;
  status: string;
  recordedBy: string;
  targetFactId: string | null;
  previousMemberFactId: string | null;
  brand: string | null;
  model: string | null;
  amount: string | null;
  currency: string | null;
  purchaseType: string | null;
  tradeIn: boolean | null;
  evidenceText: string | null;
};

/**
 * Ledger de la oportunidad (superusuario): por reloj y, dentro de una misma
 * transacción, en el orden canónico de los facts.
 */
function ledger(opportunityId: string, fact?: string) {
  return db.admin<LedgerRow[]>`
    SELECT id, fact, status, recorded_by AS "recordedBy",
      target_fact_id AS "targetFactId",
      previous_member_fact_id AS "previousMemberFactId",
      brand, model, amount, currency, purchase_type AS "purchaseType",
      trade_in AS "tradeIn", evidence_text AS "evidenceText"
    FROM public.opportunity_demand_facts
    WHERE opportunity_id = ${opportunityId}
      ${fact ? db.admin`AND fact = ${fact}` : db.admin``}
    ORDER BY recorded_at,
      array_position(
        ARRAY['desired_vehicle', 'year_range', 'budget_max', 'purchase_type', 'trade_in_intent', 'down_payment'],
        fact
      ),
      previous_member_fact_id NULLS FIRST, id
  `;
}

/** Head humano actual de un fact (el último acto de la cadena). */
async function head(opportunityId: string, fact: string): Promise<string> {
  const rows = await ledger(opportunityId, fact);
  const previous = new Set(rows.map((row) => row.previousMemberFactId));
  const last = rows.find((row) => !previous.has(row.id));
  if (!last) throw new Error(`no head for ${fact}`);
  return last.id;
}

function editForm(
  opportunityId: string,
  changes: Record<
    string,
    { head: string | null; current?: string; loadError?: boolean }
  >,
  fields: Record<string, string>,
  note?: string,
): FormData {
  const data = new FormData();
  data.append("opportunityId", opportunityId);
  for (const [fact, change] of Object.entries(changes)) {
    data.append("changed", fact);
    data.append(`head.${fact}`, change.head ?? "");
    data.append(`current.${fact}`, change.current ?? "");
    if (change.loadError) data.append(`loadError.${fact}`, "on");
  }
  for (const [name, value] of Object.entries(fields)) data.append(name, value);
  if (note !== undefined) data.append("note", note);
  return data;
}

function record(data: FormData): Promise<RecordDemandState> {
  return recordDemand(null, data);
}

const PYG = (amount: string) => ({ amount, currency: "PYG" as const });

describe("alta con demanda (T27): una sola transacción", () => {
  it("la oportunidad y sus facts se crean juntos, como actos confirmados del vendedor", async () => {
    const opportunityId = await opportunityWith({
      desired_vehicle: { brand: "Toyota", model: "Hilux" },
      purchase_type: "financed",
      down_payment: PYG("0.00"),
    });
    expect(await ledger(opportunityId)).toEqual([
      expect.objectContaining({
        fact: "desired_vehicle",
        status: "confirmed",
        recordedBy: USER_A,
        targetFactId: null,
        previousMemberFactId: null,
        brand: "Toyota",
        model: "Hilux",
      }),
      expect.objectContaining({
        fact: "purchase_type",
        status: "confirmed",
        purchaseType: "financed",
      }),
      // T26: entrega 0 es un valor.
      expect.objectContaining({
        fact: "down_payment",
        status: "confirmed",
        amount: "0.00",
        currency: "PYG",
      }),
    ]);
  });

  it("sin demanda, el alta funciona igual que antes (U1): ningún fact", async () => {
    const opportunityId = await opportunityWith();
    expect(await ledger(opportunityId)).toEqual([]);
  });

  it("si un fact falla, no se crea nada: ni la oportunidad, ni el contacto, ni los demás facts", async () => {
    await db.admin.unsafe(`
      ALTER TABLE public.opportunity_demand_facts ADD CONSTRAINT opportunity_demand_facts_probe_check
      CHECK (model IS DISTINCT FROM 'Falla forzada') NOT VALID
    `);
    const input = newOpportunity({
      desired_vehicle: { model: "Falla forzada" },
      purchase_type: "cash",
    });
    try {
      await expect(
        createOpportunityWithContact(tenantContext(USER_A, ORG_1), input),
      ).rejects.toMatchObject({ cause: { code: "23514" } });
    } finally {
      await db.admin`ALTER TABLE public.opportunity_demand_facts DROP CONSTRAINT opportunity_demand_facts_probe_check`;
    }
    const [row] = await db.admin<{ contacts: number }[]>`
      SELECT count(*)::int AS contacts FROM public.contacts
      WHERE phone_normalized = ${input.contact.phoneNormalized}
    `;
    expect(row?.contacts).toBe(0);
  });

  it("una demanda inválida para el planner revierte el alta (DemandCaptureError)", async () => {
    const input = newOpportunity({
      purchase_type: "mixed" as "cash",
    });
    await expect(
      createOpportunityWithContact(tenantContext(USER_A, ORG_1), input),
    ).rejects.toBeInstanceOf(DemandCaptureError);
    const [row] = await db.admin<{ contacts: number }[]>`
      SELECT count(*)::int AS contacts FROM public.contacts
      WHERE phone_normalized = ${input.contact.phoneNormalized}
    `;
    expect(row?.contacts).toBe(0);
  });

  it("la carga de demanda no modifica last_activity_at", async () => {
    const opportunityId = await opportunityWith({ purchase_type: "cash" });
    const before = await db.admin<{ at: Date }[]>`
      SELECT last_activity_at AS at FROM public.opportunities WHERE id = ${opportunityId}
    `;
    request(USER_A);
    expect(
      await record(
        editForm(
          opportunityId,
          {
            purchase_type: { head: await head(opportunityId, "purchase_type") },
          },
          { purchaseType: "financed" },
        ),
      ),
    ).toMatchObject({ status: "saved" });
    const after = await db.admin<{ at: Date }[]>`
      SELECT last_activity_at AS at FROM public.opportunities WHERE id = ${opportunityId}
    `;
    expect(after).toEqual(before);
  });
});

describe("recordDemand(): actos humanos sobre el ledger", () => {
  it("T1: el cliente sube el presupuesto → confirmed, target = vigente; revalida la cola y el detalle", async () => {
    const opportunityId = await opportunityWith({
      budget_max: PYG("250000000.00"),
    });
    const h1 = await head(opportunityId, "budget_max");
    request(USER_A);
    const state = await record(
      editForm(
        opportunityId,
        { budget_max: { head: h1, current: h1 } },
        { budgetAmount: "270.000.000", budgetCurrency: "PYG" },
        "Subió el presupuesto",
      ),
    );
    expect(state).toEqual({
      status: "saved",
      opportunityId,
      facts: ["budget_max"],
    });
    expect(mocks.revalidated).toEqual([
      "/opportunities",
      `/opportunities/${opportunityId}`,
    ]);
    expect(await ledger(opportunityId)).toEqual([
      expect.objectContaining({ id: h1, status: "confirmed" }),
      expect.objectContaining({
        status: "confirmed",
        recordedBy: USER_A,
        targetFactId: h1,
        previousMemberFactId: h1,
        amount: "270000000.00",
        currency: "PYG",
        evidenceText: "Subió el presupuesto",
      }),
    ]);
  });

  it("T2: error de carga → corrected sobre el valor erróneo (C-2)", async () => {
    const opportunityId = await opportunityWith({
      budget_max: PYG("2500000000.00"),
    });
    const h1 = await head(opportunityId, "budget_max");
    request(USER_A);
    await record(
      editForm(
        opportunityId,
        { budget_max: { head: h1, current: h1, loadError: true } },
        { budgetAmount: "250.000.000", budgetCurrency: "PYG" },
      ),
    );
    expect(await ledger(opportunityId)).toEqual([
      expect.objectContaining({ id: h1 }),
      expect.objectContaining({
        status: "corrected",
        targetFactId: h1,
        amount: "250000000.00",
      }),
    ]);
  });

  it("T8: vaciar un campo es Quitar (error de carga) → rejected sin valor", async () => {
    const opportunityId = await opportunityWith({ trade_in_intent: true });
    const h1 = await head(opportunityId, "trade_in_intent");
    request(USER_C, ORG_1);
    expect(
      await record(
        editForm(
          opportunityId,
          { trade_in_intent: { head: h1, current: h1 } },
          { tradeIn: "" },
        ),
      ),
    ).toMatchObject({ status: "saved" });
    expect(await ledger(opportunityId)).toEqual([
      expect.objectContaining({ id: h1 }),
      expect.objectContaining({
        status: "rejected",
        recordedBy: USER_C,
        targetFactId: h1,
        previousMemberFactId: h1,
        tradeIn: null,
      }),
    ]);
  });

  it("T12: el cliente pasa de contado a financiado", async () => {
    const opportunityId = await opportunityWith({ purchase_type: "cash" });
    const h1 = await head(opportunityId, "purchase_type");
    request(USER_A);
    await record(
      editForm(
        opportunityId,
        { purchase_type: { head: h1 } },
        { purchaseType: "financed" },
      ),
    );
    expect(await ledger(opportunityId)).toEqual([
      expect.objectContaining({ purchaseType: "cash" }),
      expect.objectContaining({
        status: "confirmed",
        targetFactId: h1,
        purchaseType: "financed",
      }),
    ]);
  });

  it("T26: entrega 0 se guarda como valor", async () => {
    const opportunityId = await opportunityWith();
    request(USER_A);
    await record(
      editForm(
        opportunityId,
        { down_payment: { head: null } },
        { downPaymentAmount: "0", downPaymentCurrency: "PYG" },
      ),
    );
    expect(await ledger(opportunityId)).toEqual([
      expect.objectContaining({
        fact: "down_payment",
        status: "confirmed",
        amount: "0.00",
      }),
    ]);
  });

  it("estado, fuente, autor, reloj y organización del pedido no tienen efecto", async () => {
    const opportunityId = await opportunityWith();
    request(USER_A);
    const data = editForm(
      opportunityId,
      { purchase_type: { head: null } },
      {
        purchaseType: "undecided",
        status: "detected",
        source_kind: "extractor",
        recorded_by: USER_C,
        recordedAt: "2020-01-01T00:00:00Z",
        organizationId: ORG_2,
        organization_id: ORG_2,
      },
    );
    expect(await record(data)).toMatchObject({ status: "saved" });
    expect(await ledger(opportunityId)).toEqual([
      expect.objectContaining({
        status: "confirmed",
        recordedBy: USER_A,
        purchaseType: "undecided",
      }),
    ]);
    const [row] = await db.admin<{ organizationId: string; recent: boolean }[]>`
      SELECT organization_id AS "organizationId",
        recorded_at > now() - interval '1 minute' AS recent
      FROM public.opportunity_demand_facts WHERE opportunity_id = ${opportunityId}
    `;
    expect(row).toEqual({ organizationId: ORG_1, recent: true });
  });

  it("un valor inválido no escribe y vuelve con lo cargado", async () => {
    const opportunityId = await opportunityWith();
    request(USER_A);
    const state = await record(
      editForm(
        opportunityId,
        { budget_max: { head: null }, year_range: { head: null } },
        {
          budgetAmount: "150.000.000,5",
          budgetCurrency: "PYG",
          yearMin: "2023",
          yearMax: "2020",
        },
      ),
    );
    expect(state).toMatchObject({
      status: "invalid",
      errors: { budgetAmount: "pyg_decimals", yearMax: "year_order" },
      values: expect.objectContaining({ budgetAmount: "150.000.000,5" }),
    });
    expect(await ledger(opportunityId)).toEqual([]);
    expect(mocks.revalidated).toEqual([]);
  });

  it("el mismo valor vigente → unchanged, sin escribir ni revalidar", async () => {
    const opportunityId = await opportunityWith({ purchase_type: "cash" });
    const h1 = await head(opportunityId, "purchase_type");
    request(USER_A);
    expect(
      await record(
        editForm(
          opportunityId,
          { purchase_type: { head: h1 } },
          { purchaseType: "cash" },
        ),
      ),
    ).toEqual({ status: "unchanged", opportunityId });
    expect(await ledger(opportunityId)).toHaveLength(1);
  });
});

describe("compare-and-set (HP2)", () => {
  it("T10: doble envío del mismo set con el head h1 → la primera escribe, la segunda es unchanged", async () => {
    const opportunityId = await opportunityWith({
      budget_max: PYG("250000000.00"),
    });
    const h1 = await head(opportunityId, "budget_max");
    const data = () =>
      editForm(
        opportunityId,
        { budget_max: { head: h1, current: h1 } },
        { budgetAmount: "270.000.000", budgetCurrency: "PYG" },
      );
    request(USER_A);
    expect(await record(data())).toMatchObject({ status: "saved" });
    request(USER_A);
    expect(await record(data())).toEqual({
      status: "unchanged",
      opportunityId,
    });
    expect(await ledger(opportunityId)).toHaveLength(2);
  });

  it("doble envío simultáneo: un solo acto escrito; el otro unchanged (23505 → re-planificación)", async () => {
    const opportunityId = await opportunityWith({
      budget_max: PYG("250000000.00"),
    });
    const h1 = await head(opportunityId, "budget_max");
    const ctx = tenantContext(USER_A, ORG_1);
    const item: DemandItem = {
      op: "set",
      fact: "budget_max",
      value: PYG("270000000"),
      basedOnHead: h1,
    };
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        recordDemandCapture(ctx, {
          opportunityId,
          source: { kind: "member", userId: USER_A },
          items: [item],
        }),
      ),
    );
    expect(results.filter((r) => r.kind === "written")).toHaveLength(1);
    expect(results.filter((r) => r.kind === "unchanged")).toHaveLength(3);
    expect(await ledger(opportunityId)).toHaveLength(2);
  });

  /*
   * Carrera determinista: otro miembro ya escribió un acto sobre el mismo
   * head y todavía no confirmó. La escritura no lo ve (no está confirmado):
   * solo el índice único de la cadena la hace esperar.
   */
  async function raceAgainstUncommittedAct(
    rivalAmount: string,
    ownAmount: string,
    commit: boolean,
  ) {
    const opportunityId = await opportunityWith({
      budget_max: PYG("250000000.00"),
    });
    const h1 = await head(opportunityId, "budget_max");
    const holder = postgres(db.migrationUrl, { max: 1, onnotice: () => {} });
    let decide!: (commit: boolean) => void;
    const decision = new Promise<boolean>((resolve) => (decide = resolve));
    let inserted!: () => void;
    const rivalInserted = new Promise<void>((resolve) => (inserted = resolve));
    class Rollback extends Error {}

    const holding = holder
      .begin(async (tx) => {
        await tx`
          INSERT INTO public.opportunity_demand_facts
            (organization_id, opportunity_id, fact, status, source_kind, recorded_by,
             target_fact_id, previous_member_fact_id, amount, currency)
          VALUES (${ORG_1}, ${opportunityId}, 'budget_max', 'confirmed', 'member', ${USER_A},
            ${h1}, ${h1}, ${rivalAmount}, 'PYG')
        `;
        inserted();
        if (!(await decision)) throw new Rollback();
      })
      .catch((error: unknown) => {
        if (!(error instanceof Rollback)) throw error;
      });

    try {
      await rivalInserted;
      const writing = recordDemandCapture(tenantContext(USER_C, ORG_1), {
        opportunityId,
        source: { kind: "member", userId: USER_C },
        items: [
          {
            op: "set",
            fact: "budget_max",
            value: PYG(ownAmount),
            basedOnHead: h1,
          },
        ],
      });
      await waitForLockWait();
      decide(commit);
      await holding;
      return { opportunityId, h1, result: await writing };
    } finally {
      decide(false);
      await holding;
      await holder.end();
    }
  }

  /** Espera a que una conexión de app_runtime quede bloqueada por un lock. */
  async function waitForLockWait(): Promise<void> {
    for (let attempt = 0; attempt < 250; attempt++) {
      const [row] = await db.admin<{ waiting: number }[]>`
        SELECT count(*)::int AS waiting FROM pg_stat_activity
        WHERE datname = current_database() AND usename = 'app_runtime'
          AND wait_event_type = 'Lock'
      `;
      if ((row?.waiting ?? 0) > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error("the write never waited on the conflicting act");
  }

  it("T9: A y B parten de h1; A (260M) confirma primero → B (270M) recibe stale y no se escribe", async () => {
    const { opportunityId, result } = await raceAgainstUncommittedAct(
      "260000000",
      "270000000",
      true,
    );
    expect(result).toEqual({ kind: "stale", facts: ["budget_max"] });
    const rows = await ledger(opportunityId);
    expect(rows.map((row) => row.amount)).toEqual([
      "250000000.00",
      "260000000.00",
    ]);
  });

  it("T9: si A pidió el mismo valor que B, B recibe unchanged", async () => {
    const { result } = await raceAgainstUncommittedAct(
      "270000000",
      "270000000",
      true,
    );
    expect(result).toEqual({ kind: "unchanged" });
  });

  it("T9: si A se revierte, B escribe su acto sobre h1", async () => {
    const { opportunityId, h1, result } = await raceAgainstUncommittedAct(
      "260000000",
      "270000000",
      false,
    );
    expect(result).toEqual({ kind: "written", facts: ["budget_max"] });
    expect((await ledger(opportunityId)).at(-1)).toMatchObject({
      recordedBy: USER_C,
      previousMemberFactId: h1,
      amount: "270000000.00",
    });
  });

  it("T11: ediciones cruzadas de varios facts con un deadlock real (40P01) → la víctima se re-planifica y recibe stale; nada se pierde en silencio", async () => {
    const opportunityId = await opportunityWith({
      year_range: { min: 2018 },
      budget_max: PYG("250000000.00"),
    });
    const yearHead = await head(opportunityId, "year_range");
    const budgetHead = await head(opportunityId, "budget_max");
    const holder = postgres(db.migrationUrl, { max: 1, onnotice: () => {} });
    let budgetHeld!: () => void;
    const held = new Promise<void>((resolve) => (budgetHeld = resolve));
    let proceed!: () => void;
    const go = new Promise<void>((resolve) => (proceed = resolve));

    // El rival toma el sucesor de budget y, cuando B ya escribió year y
    // espera budget, pide el sucesor de year: un ciclo de esperas.
    const rival = holder.begin(async (tx) => {
      await tx`
        INSERT INTO public.opportunity_demand_facts
          (organization_id, opportunity_id, fact, status, source_kind, recorded_by,
           target_fact_id, previous_member_fact_id, amount, currency)
        VALUES (${ORG_1}, ${opportunityId}, 'budget_max', 'confirmed', 'member', ${USER_A},
          ${budgetHead}, ${budgetHead}, '260000000', 'PYG')
      `;
      budgetHeld();
      await go;
      await tx`
        INSERT INTO public.opportunity_demand_facts
          (organization_id, opportunity_id, fact, status, source_kind, recorded_by,
           target_fact_id, previous_member_fact_id, year_min)
        VALUES (${ORG_1}, ${opportunityId}, 'year_range', 'confirmed', 'member', ${USER_A},
          ${yearHead}, ${yearHead}, 2019)
      `;
    });

    try {
      await held;
      const writing = recordDemandCapture(tenantContext(USER_C, ORG_1), {
        opportunityId,
        source: { kind: "member", userId: USER_C },
        items: [
          {
            op: "set",
            fact: "budget_max",
            value: PYG("270000000"),
            basedOnHead: budgetHead,
          },
          {
            op: "set",
            fact: "year_range",
            value: { min: 2020 },
            basedOnHead: yearHead,
          },
        ],
      });
      await waitForLockWait();
      proceed();
      const [result] = await Promise.all([writing, rival]);
      // B esperó primero: su detector encuentra el ciclo y lo aborta.
      expect(result).toEqual({
        kind: "stale",
        facts: ["year_range", "budget_max"],
      });
    } finally {
      proceed();
      await rival.catch(() => {});
      await holder.end();
    }
    const rows = await ledger(opportunityId);
    expect(rows.filter((row) => row.recordedBy === USER_C)).toEqual([]);
    expect(rows).toHaveLength(4);
  });
});

describe("todo o nada (T21)", () => {
  it("budget stale + year válido → stale; year no se escribe", async () => {
    const opportunityId = await opportunityWith({
      budget_max: PYG("250000000.00"),
      year_range: { min: 2018 },
    });
    const budgetHead = await head(opportunityId, "budget_max");
    const yearHead = await head(opportunityId, "year_range");
    // Otro miembro cambia el presupuesto mientras A edita.
    request(USER_C, ORG_1);
    await record(
      editForm(
        opportunityId,
        { budget_max: { head: budgetHead, current: budgetHead } },
        { budgetAmount: "260.000.000", budgetCurrency: "PYG" },
      ),
    );
    request(USER_A);
    const state = await record(
      editForm(
        opportunityId,
        {
          budget_max: { head: budgetHead, current: budgetHead },
          year_range: { head: yearHead, current: yearHead },
        },
        {
          budgetAmount: "270.000.000",
          budgetCurrency: "PYG",
          yearMin: "2020",
        },
      ),
    );
    expect(state).toMatchObject({
      status: "stale",
      facts: ["budget_max"],
      values: expect.objectContaining({
        budgetAmount: "270.000.000",
        yearMin: "2020",
      }),
    });
    // Se revalida para refrescar los valores vigentes.
    expect(mocks.revalidated).toEqual([
      "/opportunities",
      `/opportunities/${opportunityId}`,
    ]);
    expect(
      (await ledger(opportunityId, "year_range")).map((row) => row.id),
    ).toEqual([yearHead]);
  });
});

describe("aislamiento (T17) y autorización (S5)", () => {
  it.each([
    [
      "C con ORG_1 activa, sobre una oportunidad de ORG_3 (también suya)",
      USER_C,
      ORG_1,
      ORG_3,
    ],
    ["A sobre una oportunidad de ORG_2", USER_A, undefined, ORG_2],
    ["B sobre una oportunidad de ORG_1", USER_B, undefined, ORG_1],
  ])(
    "%s → not_found, sin escribir ni leer",
    async (_, userId, cookie, owner) => {
      const opportunityId = OPPORTUNITIES.find(
        (o) => o.organizationId === owner,
      )!.id;
      request(userId, cookie);
      expect(
        await record(
          editForm(
            opportunityId,
            { purchase_type: { head: null } },
            { purchaseType: "cash" },
          ),
        ),
      ).toEqual({ status: "not_found" });
      expect(await ledger(opportunityId)).toEqual([]);
      expect(mocks.revalidated).toEqual([]);
    },
  );

  it("una oportunidad inexistente o un id malformado → not_found", async () => {
    request(USER_A);
    for (const id of [randomUUID(), "no-es-un-uuid", ""]) {
      expect(
        await record(
          editForm(
            id,
            { purchase_type: { head: null } },
            { purchaseType: "cash" },
          ),
        ),
      ).toEqual({ status: "not_found" });
    }
  });

  it("una membership inactiva no llega a la base (D → /no-access)", async () => {
    request(USER_D);
    await expect(
      record(
        editForm(
          OPPORTUNITIES[0]!.id,
          { purchase_type: { head: null } },
          { purchaseType: "cash" },
        ),
      ),
    ).rejects.toBeInstanceOf(mocks.RedirectSignal);
  });

  it("membership_role contiene exactamente admin y seller: los roles que editan la demanda (DEC-027 §4)", async () => {
    const [row] = await db.admin<{ labels: string[] }[]>`
      SELECT array_agg(enumlabel::text ORDER BY enumsortorder) AS labels
      FROM pg_enum WHERE enumtypid = 'public.membership_role'::regtype
    `;
    // Un rol nuevo exige revisar recordDemand(), el alta y la policy
    // opportunity_demand_facts_insert_member.
    expect(row?.labels).toEqual(["admin", "seller"]);
  });

  it("admin (A) y seller (C) de ORG_1 editan la demanda que cargó otro", async () => {
    const opportunityId = await opportunityWith({ purchase_type: "cash" });
    let previous = await head(opportunityId, "purchase_type");
    for (const [userId, value] of [
      [USER_C, "financed"],
      [USER_A, "undecided"],
    ] as const) {
      request(userId, ORG_1);
      expect(
        await record(
          editForm(
            opportunityId,
            { purchase_type: { head: previous } },
            { purchaseType: value },
          ),
        ),
      ).toMatchObject({ status: "saved" });
      previous = await head(opportunityId, "purchase_type");
    }
  });
});

describe("logs sin datos personales (T28)", () => {
  it("un 23514 forzado devuelve failed y el log no contiene la nota ni el valor", async () => {
    const opportunityId = await opportunityWith();
    const note = "Cédula 1.234.567, vive en Lambaré";
    await db.admin.unsafe(`
      ALTER TABLE public.opportunity_demand_facts ADD CONSTRAINT opportunity_demand_facts_probe_check
      CHECK (purchase_type IS DISTINCT FROM 'financed') NOT VALID
    `);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      request(USER_A);
      const state = await record(
        editForm(
          opportunityId,
          { purchase_type: { head: null } },
          { purchaseType: "financed" },
          note,
        ),
      );
      expect(state).toEqual({
        status: "failed",
        values: expect.objectContaining({ purchaseType: "financed" }),
        note,
      });
      expect(errors).toHaveBeenCalledWith(
        "[opportunities] record demand failed",
        {
          name: expect.any(String),
          code: "23514",
          constraint_name: "opportunity_demand_facts_probe_check",
        },
      );
      const logged = JSON.stringify(errors.mock.calls);
      expect(logged).not.toContain("Lambaré");
      expect(logged).not.toContain("1.234.567");
      expect(logged).not.toContain(opportunityId);
    } finally {
      errors.mockRestore();
      await db.admin`ALTER TABLE public.opportunity_demand_facts DROP CONSTRAINT opportunity_demand_facts_probe_check`;
    }
    expect(await ledger(opportunityId)).toEqual([]);
    expect(mocks.revalidated).toEqual([]);
  });
});

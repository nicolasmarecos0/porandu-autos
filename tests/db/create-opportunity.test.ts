import { randomUUID } from "node:crypto";

import { eq, sql } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  createOpportunityWithContact,
  type NewOpportunity,
} from "@/db/queries/create-opportunity";
import { getOpportunityDetail } from "@/db/queries/opportunity-detail";
import { getOpportunityQueue } from "@/db/queries/opportunities";
import { contacts, opportunities } from "@/db/schema";
import { withTenant, type TenantContext } from "@/db/tenant";
import { createOpportunity } from "@/lib/opportunities/actions";
import type { CreateOpportunityState } from "@/lib/opportunities/new-opportunity";
import { ACTIVE_ORGANIZATION_COOKIE } from "@/lib/tenant/cookie";

import { cookieJar, type CookieJar } from "../unit/support/cookie-jar";
import { OPPORTUNITIES, seedOpportunities } from "./support/opportunities";
import {
  runMigrations,
  startTestServer,
  type TestDatabase,
  type TestServer,
} from "./support/postgres";
import { closeRuntimePool, runtimePool } from "./support/runtime";
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
  USER_E,
} from "./support/tenants";

/*
 * Alta de oportunidades (H1.2) de punta a punta contra PostgreSQL 17 con las
 * migraciones aplicadas:
 *
 *   Server Action → requireTenant() → validación → withTenant() → contacto
 *   (resuelto o nuevo) + oportunidad en una transacción → RLS (WITH CHECK)
 *   → aparece en la cola real
 *
 * La acción, la escritura y el loader son los reales, conectados como
 * app_runtime. Supabase Auth (claims ya verificados), la cookie, redirect()
 * y revalidatePath() de Next son simulados.
 *
 * Los datos quedan committeados (withTenant() usa sus propias conexiones):
 * cada caso usa un teléfono nuevo.
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
    /** Simula una Tenant Resolution salteada o con un bug (A-03). */
    forged: null as unknown,
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
// requireTenant() es el real salvo cuando un test fuerza un contexto.
vi.mock("@/lib/tenant/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tenant/session")>();
  return {
    ...actual,
    requireTenant: async () =>
      (mocks.forged as TenantContext | null) ?? actual.requireTenant(),
  };
});

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

/** Nueva request: usuario autenticado (o ninguno) y cookie de organización. */
function request(userId: string | null, cookie?: string): void {
  mocks.forged = null;
  mocks.revalidated.length = 0;
  mocks.claims = userId
    ? {
        iss: "https://testref.supabase.co/auth/v1",
        sub: userId,
        aud: "authenticated",
        exp: 1_900_000_000,
        iat: 1_899_996_400,
        role: "authenticated",
        aal: "aal1",
        session_id: "00000000-0000-4000-8000-0000000000e1",
      }
    : null;
  mocks.jar = cookieJar(
    cookie === undefined ? {} : { [ACTIVE_ORGANIZATION_COOKIE]: cookie },
  );
}

let sequence = 0;

/** Un móvil paraguayo que ningún otro caso usó: en formato local y E.164. */
function freshPhone(): { local: string; e164: string } {
  sequence += 1;
  const subscriber = String(700_000 + sequence);
  return {
    local: `0981 ${subscriber.slice(0, 3)} ${subscriber.slice(3)}`,
    e164: `+595981${subscriber}`,
  };
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.append(name, value);
  return data;
}

function validForm(phone: string, overrides: Record<string, string> = {}) {
  return form({
    name: "Lucía Ortiz",
    phone,
    city: "Luque",
    source: "showroom",
    brand: "Toyota",
    model: "Corolla Cross",
    ...overrides,
  });
}

function newOpportunity(
  phone: { local: string; e164: string },
  overrides: Partial<NewOpportunity> = {},
): NewOpportunity {
  return {
    contact: {
      name: "Lucía Ortiz",
      phone: phone.local,
      phoneNormalized: phone.e164,
      city: "Luque",
    },
    source: "showroom",
    demand: {},
    ...overrides,
  };
}

type ContactRow = {
  id: string;
  organizationId: string;
  name: string;
  phone: string | null;
  phoneNormalized: string | null;
  city: string | null;
};

/** Contactos con ese teléfono normalizado, en cualquier organización. */
function contactsWithPhone(e164: string) {
  return db.admin<ContactRow[]>`
    SELECT id, organization_id AS "organizationId", name, phone,
      phone_normalized AS "phoneNormalized", city
    FROM public.contacts WHERE phone_normalized = ${e164}
    ORDER BY organization_id, created_at
  `;
}

type OpportunityRow = {
  id: string;
  organizationId: string;
  contactId: string;
  stage: string;
  source: string;
  interestModel: string | null;
  interestVersion: string | null;
  recent: boolean;
};

/** Oportunidades de los contactos con ese teléfono normalizado. */
function opportunitiesWithPhone(e164: string) {
  return db.admin<OpportunityRow[]>`
    SELECT o.id, o.organization_id AS "organizationId", o.contact_id AS "contactId",
      o.stage, o.source, o.interest_model AS "interestModel",
      o.interest_version AS "interestVersion",
      o.last_activity_at > now() - interval '1 minute'
        AND o.created_at > now() - interval '1 minute' AS recent
    FROM public.opportunities o
    JOIN public.contacts c
      ON c.organization_id = o.organization_id AND c.id = o.contact_id
    WHERE c.phone_normalized = ${e164}
    ORDER BY o.created_at, o.id
  `;
}

async function create(data: FormData): Promise<CreateOpportunityState> {
  return createOpportunity(null, data);
}

async function created(data: FormData) {
  const state = await create(data);
  if (state?.status !== "created") {
    throw new Error(`expected created, got ${JSON.stringify(state)}`);
  }
  return state;
}

async function redirectOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof mocks.RedirectSignal) return error.path;
    throw error;
  }
  throw new Error("expected a redirect");
}

async function expectSqlError(
  promise: Promise<unknown>,
  code: string,
): Promise<void> {
  // Drizzle envuelve el error del driver: el SQLSTATE queda en `cause`.
  await expect(promise).rejects.toMatchObject({ cause: { code } });
}

/** Ids de la cola real de la request actual. */
async function queueIds(): Promise<string[]> {
  const { opportunities: queue } = await getOpportunityQueue();
  return queue.map((op) => op.id);
}

describe("Server Action: requireTenant() → validación → withTenant()", () => {
  it("un payload válido crea contacto y oportunidad en la organización activa y revalida /opportunities", async () => {
    const phone = freshPhone();
    request(USER_A);
    const state = await created(validForm(phone.local));

    expect(state).toEqual({
      status: "created",
      opportunityId: expect.any(String),
      contactName: "Lucía Ortiz",
      contactReused: false,
    });
    expect(mocks.revalidated).toEqual(["/opportunities"]);

    const [contact] = await contactsWithPhone(phone.e164);
    expect(contact).toEqual({
      id: expect.any(String),
      organizationId: ORG_1,
      name: "Lucía Ortiz",
      phone: phone.local,
      phoneNormalized: phone.e164,
      city: "Luque",
    });
    expect(await opportunitiesWithPhone(phone.e164)).toEqual([
      {
        id: state.opportunityId,
        organizationId: ORG_1,
        contactId: contact!.id,
        stage: "new",
        source: "showroom",
        // H1.4: el interés legado ya no se escribe; lo que busca es demanda.
        interestModel: null,
        interestVersion: null,
        recent: true,
      },
    ]);
    const facts = await db.admin<
      { fact: string; status: string; brand: string; model: string }[]
    >`
      SELECT fact, status, brand, model FROM public.opportunity_demand_facts
      WHERE opportunity_id = ${state.opportunityId}
    `;
    expect(facts).toEqual([
      {
        fact: "desired_vehicle",
        status: "confirmed",
        brand: "Toyota",
        model: "Corolla Cross",
      },
    ]);
  });

  it("la oportunidad aparece en la cola real de su organización, y solo ahí", async () => {
    const phone = freshPhone();
    request(USER_A);
    const { opportunityId } = await created(
      validForm(phone.local, { name: "Rocío Cabral", city: "" }),
    );

    request(USER_A);
    const { opportunities: queue } = await getOpportunityQueue();
    const item = queue.find((op) => op.id === opportunityId);
    expect(item).toMatchObject({
      prospect: {
        name: "Rocío Cabral",
        initials: "RC",
        phone: `0981 ··· ${phone.e164.slice(-3)}`,
        channel: "Showroom",
        live: false,
      },
      demand: {
        vehicle: { title: "Toyota Corolla Cross", source: "demand" },
      },
      interest: {},
      stage: "new",
      bucket: "now",
    });
    expect(item?.prospect).not.toHaveProperty("city");

    request(USER_B);
    expect(await queueIds()).not.toContain(opportunityId);
  });

  it("U5: lo cargado en el alta se explica «Cargado al crear la oportunidad» (mismo now())", async () => {
    const phone = freshPhone();
    request(USER_A);
    const { opportunityId } = await created(
      validForm(phone.local, {
        purchaseType: "financed",
        budgetAmount: "250.000.000",
        budgetCurrency: "PYG",
      }),
    );
    const [times] = await db.admin<{ same: boolean }[]>`
      SELECT bool_and(f.recorded_at = o.created_at) AS same
      FROM public.opportunity_demand_facts f
      JOIN public.opportunities o ON o.id = f.opportunity_id
      WHERE o.id = ${opportunityId}
    `;
    expect(times?.same).toBe(true);

    request(USER_A);
    const detail = (await getOpportunityDetail(opportunityId))!;
    const facts = new Map(detail.demand.facts.map((f) => [f.fact, f]));
    for (const [fact, display] of [
      ["desired_vehicle", "Toyota Corolla Cross"],
      ["purchase_type", "Financiado"],
      ["budget_max", "Hasta Gs. 250.000.000"],
    ] as const) {
      expect(facts.get(fact)).toMatchObject({
        display,
        statusLabel: "Confirmado",
        explanation: [
          expect.stringMatching(
            /^Cargado al crear la oportunidad por Vos · \d{1,2} [a-z]{3} \d{4} \d{2}:\d{2}$/,
          ),
        ],
      });
    }
    expect(facts.get("year_range")!.explanation).toEqual([
      "Todavía no se cargó",
    ]);
    expect(detail.demand).toMatchObject({ empty: false, legacy: null });
  });

  it("los opcionales vacíos quedan sin dato", async () => {
    const phone = freshPhone();
    request(USER_A);
    await created(
      form({
        name: "  Néstor   Villalba ",
        phone: phone.local,
        source: "whatsapp",
        city: " ",
        brand: "",
        model: " ",
      }),
    );
    const [contact] = await contactsWithPhone(phone.e164);
    expect(contact).toMatchObject({ name: "Néstor Villalba", city: null });
    const [opportunity] = await opportunitiesWithPhone(phone.e164);
    expect(opportunity).toMatchObject({
      source: "whatsapp",
      interestModel: null,
      interestVersion: null,
    });
    // U1: sin lo que busca, ningún fact.
    const [facts] = await db.admin<{ count: number }[]>`
      SELECT count(*)::int AS count FROM public.opportunity_demand_facts
      WHERE opportunity_id = ${opportunity!.id}
    `;
    expect(facts?.count).toBe(0);
  });

  it("C crea en la organización activa de su cookie (ORG_3), no en ORG_1", async () => {
    const phone = freshPhone();
    request(USER_C, ORG_3);
    await created(validForm(phone.local));
    expect(
      (await contactsWithPhone(phone.e164)).map((c) => c.organizationId),
    ).toEqual([ORG_3]);
  });

  it("sin sesión o sin membership activa no llega a la base", async () => {
    const phone = freshPhone();
    for (const [userId, path] of [
      [null, "/login"],
      [USER_D, "/no-access"],
      [USER_E, "/no-access"],
    ] as const) {
      request(userId);
      expect(await redirectOf(create(validForm(phone.local)))).toBe(path);
    }
    // Una cookie con una organización donde la membership está inactiva
    // tampoco elige organización.
    request(USER_C, ORG_2);
    expect(await redirectOf(create(validForm(phone.local)))).toBe(
      "/select-organization",
    );
    expect(await contactsWithPhone(phone.e164)).toEqual([]);
    expect(mocks.revalidated).toEqual([]);
  });

  it.each([
    ["sin nombre", { name: "  " }, { name: "required" }],
    ["sin teléfono", { phone: "" }, { phone: "required" }],
    ["teléfono inválido", { phone: "0981 1" }, { phone: "invalid_phone" }],
    ["sin origen", { source: "" }, { source: "required" }],
    ["origen `manual`", { source: "manual" }, { source: "invalid_source" }],
    [
      "origen en mayúsculas",
      { source: "WhatsApp" },
      { source: "invalid_source" },
    ],
    [
      "modelo demasiado largo",
      { model: "x".repeat(81) },
      { model: "too_long" },
    ],
    [
      "presupuesto en guaraníes con decimales",
      { budgetAmount: "150.000.000,5", budgetCurrency: "PYG" },
      { budgetAmount: "pyg_decimals" },
    ],
  ])(
    "un payload inválido (%s) no escribe y vuelve con lo cargado",
    async (_, overrides, errors) => {
      const phone = freshPhone();
      request(USER_A);
      const data = validForm(phone.local, overrides);
      const state = await create(data);
      expect(state).toEqual({
        status: "invalid",
        errors,
        values: expect.objectContaining({
          name: String(data.get("name")).trim(),
          phone: String(data.get("phone")).trim(),
          city: "Luque",
          source: String(data.get("source")),
          model: String(data.get("model")),
        }),
      });
      expect(await contactsWithPhone(phone.e164)).toEqual([]);
      expect(mocks.revalidated).toEqual([]);
    },
  );

  it("organización, etapa, contacto, timestamps y scores del payload no tienen efecto", async () => {
    const phone = freshPhone();
    const foreignContact = OPPORTUNITIES.find(
      (o) => o.organizationId === ORG_2,
    )!.contact.id;
    request(USER_A);
    const state = await created(
      validForm(phone.local, {
        organizationId: ORG_2,
        organization_id: ORG_2,
        userId: USER_B,
        user_id: USER_B,
        contactId: foreignContact,
        contact_id: foreignContact,
        stage: "negotiation",
        createdAt: "2020-01-01T00:00:00Z",
        updated_at: "2020-01-01T00:00:00Z",
        lastActivityAt: "2020-01-01T00:00:00Z",
        last_activity_at: "2020-01-01T00:00:00Z",
        porandu: "99",
        score: "99",
      }),
    );
    const [contact] = await contactsWithPhone(phone.e164);
    expect(contact).toMatchObject({ organizationId: ORG_1 });
    expect(contact!.id).not.toBe(foreignContact);
    expect(await opportunitiesWithPhone(phone.e164)).toEqual([
      expect.objectContaining({
        id: state.opportunityId,
        organizationId: ORG_1,
        contactId: contact!.id,
        stage: "new",
        recent: true,
      }),
    ]);
  });

  it("C (ORG_1 activa) que manda ORG_3 en el payload crea en ORG_1, aunque RLS le permitiría ORG_3", async () => {
    // RLS no distingue entre organizaciones con membership activa: solo
    // tomar la organización del contexto impide elegirla desde el cliente.
    const phone = freshPhone();
    request(USER_C, ORG_1);
    await created(
      validForm(phone.local, { organizationId: ORG_3, organization_id: ORG_3 }),
    );
    expect(
      (await contactsWithPhone(phone.e164)).map((c) => c.organizationId),
    ).toEqual([ORG_1]);
    expect(
      (await opportunitiesWithPhone(phone.e164)).map((o) => o.organizationId),
    ).toEqual([ORG_1]);
  });

  it("un contexto falsificado (A con ORG_2) no escribe: RLS lo rechaza y el formulario queda usable", async () => {
    const phone = freshPhone();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      request(null);
      mocks.forged = tenantContext(USER_A, ORG_2);
      const state = await create(validForm(phone.local));
      expect(state).toEqual({
        status: "failed",
        values: expect.objectContaining({ phone: phone.local }),
      });
      // Solo el tipo de error y el SQLSTATE: ni la query ni los datos.
      expect(errors).toHaveBeenCalledWith("[opportunities] create failed", {
        name: expect.any(String),
        code: "42501",
      });
      expect(JSON.stringify(errors.mock.calls)).not.toContain(phone.local);
    } finally {
      errors.mockRestore();
      mocks.forged = null;
    }
    expect(await contactsWithPhone(phone.e164)).toEqual([]);
    expect(mocks.revalidated).toEqual([]);
  });
});

describe("identidad por teléfono: deduplicación", () => {
  it("el mismo teléfono reutiliza el contacto, sin modificarlo, y crea otra oportunidad", async () => {
    const phone = freshPhone();
    request(USER_A);
    const first = await created(validForm(phone.local));
    request(USER_A);
    const second = await created(
      validForm(phone.local, {
        name: "Otro Nombre",
        city: "Encarnación",
        source: "referral",
        model: "Hilux",
      }),
    );

    expect(second).toEqual({
      status: "created",
      opportunityId: expect.any(String),
      contactName: "Lucía Ortiz",
      contactReused: true,
    });
    const found = await contactsWithPhone(phone.e164);
    expect(found).toEqual([
      expect.objectContaining({ name: "Lucía Ortiz", city: "Luque" }),
    ]);
    const created2 = await opportunitiesWithPhone(phone.e164);
    expect(created2.map((o) => o.id)).toEqual([
      first.opportunityId,
      second.opportunityId,
    ]);
    expect(created2.map((o) => [o.contactId, o.source])).toEqual([
      [found[0]!.id, "showroom"],
      [found[0]!.id, "referral"],
    ]);
  });

  it("formatos equivalentes del mismo teléfono no duplican el contacto", async () => {
    const phone = freshPhone();
    const digits = phone.e164.slice(-6);
    const forms = [
      phone.local,
      `(0981) ${digits.slice(0, 3)}-${digits.slice(3)}`,
      `+595 981 ${digits}`,
      `00595981${digits}`,
    ];
    for (const raw of forms) {
      request(USER_A);
      await created(validForm(raw));
    }
    const found = await contactsWithPhone(phone.e164);
    expect(found).toHaveLength(1);
    // Se conserva el teléfono tal como se cargó la primera vez.
    expect(found[0]?.phone).toBe(phone.local);
    expect(await opportunitiesWithPhone(phone.e164)).toHaveLength(forms.length);
  });

  it("el mismo teléfono en ORG_1 y ORG_2 son contactos distintos", async () => {
    const phone = freshPhone();
    request(USER_A);
    const inA = await created(validForm(phone.local));
    request(USER_B);
    const inB = await created(validForm(phone.local, { name: "Lucía O." }));

    expect([inA.contactReused, inB.contactReused]).toEqual([false, false]);
    const found = await contactsWithPhone(phone.e164);
    expect(found.map((c) => [c.organizationId, c.name])).toEqual([
      [ORG_1, "Lucía Ortiz"],
      [ORG_2, "Lucía O."],
    ]);
    expect(found[0]!.id).not.toBe(found[1]!.id);
  });

  it("un contacto de H1.1 sin teléfono normalizado no se modifica ni se backfillea", async () => {
    // Ramón Benítez (ORG_1) se cargó con "0981 555 214" y sin
    // phone_normalized: la identidad por teléfono no lo alcanza.
    const legacy = OPPORTUNITIES[0]!.contact;
    request(USER_A);
    const state = await created(validForm(legacy.phone!));
    expect(state.contactReused).toBe(false);
    const [row] = await db.admin<
      { name: string; phoneNormalized: string | null }[]
    >`
      SELECT name, phone_normalized AS "phoneNormalized"
      FROM public.contacts WHERE id = ${legacy.id}
    `;
    expect(row).toEqual({ name: legacy.name, phoneNormalized: null });
  });
});

describe("concurrencia: la unicidad de la base es la autoridad", () => {
  it("altas simultáneas con el mismo teléfono terminan en un solo contacto", async () => {
    const phone = freshPhone();
    const ctx = tenantContext(USER_A, ORG_1);
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        createOpportunityWithContact(ctx, newOpportunity(phone)),
      ),
    );
    const found = await contactsWithPhone(phone.e164);
    expect(found).toHaveLength(1);
    expect(new Set(results.map((r) => r.contact.id))).toEqual(
      new Set([found[0]!.id]),
    );
    expect(results.filter((r) => !r.contact.reused)).toHaveLength(1);
    expect(await opportunitiesWithPhone(phone.e164)).toHaveLength(6);
  });

  /*
   * Carrera determinista: otra transacción insertó el mismo teléfono y
   * todavía no confirmó. El alta no lo ve con un SELECT (no está
   * confirmado): solo la unicidad de la base la hace esperar.
   */
  async function raceAgainstUncommittedContact(commit: boolean) {
    const phone = freshPhone();
    const holder = postgres(db.migrationUrl, { max: 1, onnotice: () => {} });
    const rival = randomUUID();
    let decide!: (commit: boolean) => void;
    const decision = new Promise<boolean>((resolve) => (decide = resolve));
    let inserted!: () => void;
    const rivalInserted = new Promise<void>((resolve) => (inserted = resolve));
    class Rollback extends Error {}

    const holding = holder
      .begin(async (tx) => {
        await tx`
          INSERT INTO public.contacts (id, organization_id, name, phone, phone_normalized)
          VALUES (${rival}, ${ORG_1}, 'Contacto rival', ${phone.local}, ${phone.e164})
        `;
        inserted();
        if (!(await decision)) throw new Rollback();
      })
      .catch((error: unknown) => {
        if (!(error instanceof Rollback)) throw error;
      });

    try {
      await rivalInserted;
      const creation = createOpportunityWithContact(
        tenantContext(USER_A, ORG_1),
        newOpportunity(phone),
      );
      await waitForLockWait();
      decide(commit);
      await holding;
      const result = await creation;
      return { phone, rival, result };
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
    throw new Error("the creation never waited on the conflicting insert");
  }

  it("si la otra transacción confirma, el alta reutiliza su contacto", async () => {
    const { phone, rival, result } = await raceAgainstUncommittedContact(true);
    expect(result.contact).toEqual({
      id: rival,
      name: "Contacto rival",
      reused: true,
    });
    expect((await contactsWithPhone(phone.e164)).map((c) => c.id)).toEqual([
      rival,
    ]);
    expect(await opportunitiesWithPhone(phone.e164)).toEqual([
      expect.objectContaining({ contactId: rival, stage: "new" }),
    ]);
  });

  it("si la otra transacción se revierte, el alta crea su propio contacto", async () => {
    const { phone, rival, result } = await raceAgainstUncommittedContact(false);
    expect(result.contact).toMatchObject({
      name: "Lucía Ortiz",
      reused: false,
    });
    expect(result.contact.id).not.toBe(rival);
    expect(await contactsWithPhone(phone.e164)).toHaveLength(1);
  });
});

describe("atomicidad: contacto y oportunidad en una sola transacción", () => {
  /*
   * Falla forzada al insertar la oportunidad: un CHECK de prueba (NOT VALID,
   * no toca las filas existentes) rechaza un origen puntual.
   */
  const FAILING_SOURCE = "meta_ads";

  async function withFailingOpportunityInsert<T>(
    fn: () => Promise<T>,
  ): Promise<T> {
    await db.admin.unsafe(`
      ALTER TABLE public.opportunities ADD CONSTRAINT opportunities_probe_check
      CHECK (source IS DISTINCT FROM '${FAILING_SOURCE}') NOT VALID
    `);
    try {
      return await fn();
    } finally {
      await db.admin`ALTER TABLE public.opportunities DROP CONSTRAINT opportunities_probe_check`;
    }
  }

  it("si falla la oportunidad, no queda el contacto nuevo", async () => {
    const phone = freshPhone();
    await withFailingOpportunityInsert(() =>
      expectSqlError(
        createOpportunityWithContact(
          tenantContext(USER_A, ORG_1),
          newOpportunity(phone, { source: FAILING_SOURCE }),
        ),
        "23514",
      ),
    );
    expect(await contactsWithPhone(phone.e164)).toEqual([]);
  });

  it("por la acción: error recuperable, sin escrituras ni revalidación", async () => {
    const phone = freshPhone();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      request(USER_A);
      const state = await withFailingOpportunityInsert(() =>
        create(validForm(phone.local, { source: FAILING_SOURCE })),
      );
      expect(state).toEqual({
        status: "failed",
        values: expect.objectContaining({
          name: "Lucía Ortiz",
          phone: phone.local,
          source: FAILING_SOURCE,
        }),
      });
      expect(JSON.stringify(state)).not.toMatch(/opportunities_probe|23514/);
      // Solo tipo, SQLSTATE y constraint (DEC-030 §6): ni la query ni los
      // datos.
      expect(errors).toHaveBeenCalledWith("[opportunities] create failed", {
        name: expect.any(String),
        code: "23514",
        constraint_name: "opportunities_probe_check",
      });
    } finally {
      errors.mockRestore();
    }
    expect(await contactsWithPhone(phone.e164)).toEqual([]);
    expect(mocks.revalidated).toEqual([]);

    // El mismo formulario, reintentado, se guarda.
    request(USER_A);
    await created(validForm(phone.local));
    expect(await contactsWithPhone(phone.e164)).toHaveLength(1);
  });

  it("mutación: en dos transacciones separadas, la falla deja un contacto huérfano", async () => {
    // Mutante: la misma escritura partida en dos withTenant().
    async function createInTwoTransactions(
      ctx: TenantContext,
      input: NewOpportunity,
    ) {
      const [contact] = await withTenant(ctx, (tx) =>
        tx
          .insert(contacts)
          .values({ ...input.contact, organizationId: ctx.organizationId })
          .returning({ id: contacts.id }),
      );
      await withTenant(ctx, (tx) =>
        tx.insert(opportunities).values({
          organizationId: ctx.organizationId,
          contactId: contact!.id,
          stage: "new",
          source: input.source,
        }),
      );
    }
    const phone = freshPhone();
    await withFailingOpportunityInsert(() =>
      expectSqlError(
        createInTwoTransactions(
          tenantContext(USER_A, ORG_1),
          newOpportunity(phone, { source: FAILING_SOURCE }),
        ),
        "23514",
      ),
    );
    // El test de atomicidad de arriba lo detectaría: queda un huérfano.
    expect(await contactsWithPhone(phone.e164)).toHaveLength(1);
  });
});

describe("aislamiento de la escritura (RLS WITH CHECK)", () => {
  it.each([
    ["A con ORG_2 (sin membership)", USER_A, ORG_2],
    ["C con ORG_2 (membership inactiva)", USER_C, ORG_2],
    ["D con ORG_1 (solo membership inactiva)", USER_D, ORG_1],
    ["E con ORG_1 (sin memberships)", USER_E, ORG_1],
  ])("un contexto falsificado no escribe: %s", async (_, userId, orgId) => {
    const phone = freshPhone();
    await expectSqlError(
      createOpportunityWithContact(
        tenantContext(userId, orgId),
        newOpportunity(phone),
      ),
      "42501",
    );
    expect(await contactsWithPhone(phone.e164)).toEqual([]);
  });

  it("revocar la membership corta la escritura, aun con un contexto viejo (A-09)", async () => {
    const ctx = tenantContext(USER_A, ORG_1);
    const setActive = (active: boolean) => db.admin`
      UPDATE public.memberships SET active = ${active}
      WHERE organization_id = ${ORG_1} AND user_id = ${USER_A}
    `;
    const phone = freshPhone();
    await setActive(false);
    try {
      await expectSqlError(
        createOpportunityWithContact(ctx, newOpportunity(phone)),
        "42501",
      );
    } finally {
      await setActive(true);
    }
    expect(await contactsWithPhone(phone.e164)).toEqual([]);
    await createOpportunityWithContact(ctx, newOpportunity(phone));
    expect(await contactsWithPhone(phone.e164)).toHaveLength(1);
  });

  it("dentro del boundary, un organization_id ajeno explícito se rechaza", async () => {
    const ctx = tenantContext(USER_A, ORG_1);
    const phone = freshPhone();
    await expectSqlError(
      withTenant(ctx, (tx) =>
        tx.insert(contacts).values({
          organizationId: ORG_2,
          name: "Intruso",
          phone: phone.local,
          phoneNormalized: phone.e164,
        }),
      ),
      "42501",
    );
    const foreignContact = OPPORTUNITIES.find(
      (o) => o.organizationId === ORG_2,
    )!.contact.id;
    await expectSqlError(
      withTenant(ctx, (tx) =>
        tx.insert(opportunities).values({
          organizationId: ORG_2,
          contactId: foreignContact,
          stage: "new",
          source: "web",
        }),
      ),
      "42501",
    );
    // Con la organización propia, la FK compuesta impide usar un contacto
    // de otra organización.
    await expectSqlError(
      withTenant(ctx, (tx) =>
        tx.insert(opportunities).values({
          organizationId: ORG_1,
          contactId: foreignContact,
          stage: "new",
          source: "web",
        }),
      ),
      "23503",
    );
    expect(await contactsWithPhone(phone.e164)).toEqual([]);
  });

  it("una oportunidad creada en ORG_1 no es visible para B, D ni la cola de C en ORG_3", async () => {
    const phone = freshPhone();
    const { opportunityId } = await createOpportunityWithContact(
      tenantContext(USER_A, ORG_1),
      newOpportunity(phone),
    );
    // Por id, sin filtro de organización: solo RLS.
    for (const ctx of [
      tenantContext(USER_B, ORG_2),
      tenantContext(USER_B, ORG_1),
      tenantContext(USER_D, ORG_1),
    ]) {
      const rows = await withTenant(ctx, (tx) =>
        tx
          .select({ id: opportunities.id })
          .from(opportunities)
          .where(eq(opportunities.id, opportunityId)),
      );
      expect(rows).toEqual([]);
    }
    request(USER_C, ORG_3);
    expect(await queueIds()).not.toContain(opportunityId);
  });
});

describe("la policy de alta exige la etapa inicial (WITH CHECK stage = 'new')", () => {
  /** INSERT directo por el boundary, en una organización con membership activa. */
  function insertWithStage(
    ctx: TenantContext,
    stage: "new" | "qualifying" | "negotiating" | "won" | "lost",
  ) {
    return withTenant(ctx, async (tx) => {
      const phone = freshPhone();
      const [contact] = await tx
        .insert(contacts)
        .values({
          organizationId: ctx.organizationId,
          name: "Contacto directo",
          phone: phone.local,
          phoneNormalized: phone.e164,
        })
        .returning({ id: contacts.id });
      const [opportunity] = await tx
        .insert(opportunities)
        .values({
          organizationId: ctx.organizationId,
          contactId: contact!.id,
          stage,
          source: "web",
        })
        .returning({ id: opportunities.id, stage: opportunities.stage });
      return opportunity;
    });
  }

  it("un INSERT directo con stage = 'new' en la organización propia funciona", async () => {
    expect(await insertWithStage(tenantContext(USER_A, ORG_1), "new")).toEqual({
      id: expect.any(String),
      stage: "new",
    });
  });

  it.each(["qualifying", "negotiating", "won", "lost"] as const)(
    "un INSERT directo con stage = '%s' falla por la policy, aunque el usuario pertenezca a la organización",
    async (stage) => {
      const before = await db.admin<{ count: number }[]>`
        SELECT count(*)::int AS count FROM public.opportunities
      `;
      for (const ctx of [
        tenantContext(USER_A, ORG_1),
        tenantContext(USER_C, ORG_3),
      ]) {
        await expectSqlError(insertWithStage(ctx, stage), "42501");
      }
      // La transacción entera se revierte: ni oportunidad ni contacto.
      const after = await db.admin<{ count: number }[]>`
        SELECT count(*)::int AS count FROM public.opportunities
      `;
      expect(after).toEqual(before);
    },
  );

  it("el CHECK general de stage admite todas las etapas aprobadas (H1.6): la base (sin RLS) las acepta", async () => {
    const [row] = await db.admin<{ definition: string }[]>`
      SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
      WHERE conname = 'opportunities_stage_check'
    `;
    expect(row?.definition).toBe(
      "CHECK ((stage = ANY (ARRAY['new'::text, 'qualifying'::text, 'negotiating'::text, 'won'::text, 'lost'::text])))",
    );
  });

  it("createOpportunity() sigue creando en `new`, y la organización ajena sigue rechazada aun con `new`", async () => {
    const phone = freshPhone();
    request(USER_A);
    const { opportunityId } = await created(validForm(phone.local));
    expect(await opportunitiesWithPhone(phone.e164)).toEqual([
      expect.objectContaining({ id: opportunityId, stage: "new" }),
    ]);
    await expectSqlError(
      insertWithStage(tenantContext(USER_A, ORG_2), "new"),
      "42501",
    );
  });

  it("mutación: sin stage = 'new' en el WITH CHECK, un alta en `qualifying` pasaría; el catálogo también lo marca", async () => {
    const policy = async () => {
      const [row] = await db.admin<{ withCheck: string }[]>`
        SELECT with_check AS "withCheck" FROM pg_policies
        WHERE policyname = 'opportunities_insert_member'
      `;
      return row?.withCheck;
    };
    const original = await policy();
    await db.admin.unsafe(`
      ALTER POLICY opportunities_insert_member ON public.opportunities
      WITH CHECK (organization_id IN (SELECT private.user_org_ids()))
    `);
    try {
      // Los tests de arriba lo detectan: el INSERT en `qualifying` ya no falla.
      expect(
        await insertWithStage(tenantContext(USER_A, ORG_1), "qualifying"),
      ).toMatchObject({ stage: "qualifying" });
      expect(await policy()).not.toContain("stage");
    } finally {
      await db.admin.unsafe(`
        ALTER POLICY opportunities_insert_member ON public.opportunities
        WITH CHECK (organization_id IN (SELECT private.user_org_ids()) AND stage = 'new')
      `);
    }
    expect(await policy()).toBe(original);
    await expectSqlError(
      insertWithStage(tenantContext(USER_A, ORG_1), "qualifying"),
      "42501",
    );
  });
});

describe("sin withTenant() o sin privilegios, la escritura falla cerrado", () => {
  it("app_runtime fuera del boundary no inserta contactos ni oportunidades (42501)", async () => {
    const pool = runtimePool();
    await expect(
      pool`INSERT INTO public.contacts (organization_id, name) VALUES (${ORG_1}, 'Intruso')`,
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      pool`INSERT INTO public.opportunities (organization_id, contact_id, stage, source)
        VALUES (${ORG_1}, ${OPPORTUNITIES[0]!.contact.id}, 'new', 'web')`,
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("authenticated sin claims no inserta: el WITH CHECK no encuentra organizaciones", async () => {
    await expect(
      runtimePool().begin(async (tx) => {
        await tx`SELECT set_config('role', 'authenticated', true)`;
        await tx`INSERT INTO public.contacts (organization_id, name) VALUES (${ORG_1}, 'Intruso')`;
      }),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("anon no inserta (sin grants)", async () => {
    await expect(
      db.admin.begin(async (tx) => {
        await tx`SET LOCAL ROLE anon`;
        await tx`INSERT INTO public.contacts (organization_id, name) VALUES (${ORG_1}, 'Intruso')`;
      }),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("UPDATE (salvo el cambio de etapa) y DELETE siguen prohibidos por withTenant(), también en la organización propia", async () => {
    const ctx = tenantContext(USER_A, ORG_1);
    const own = OPPORTUNITIES[0]!;
    await expectSqlError(
      withTenant(ctx, (tx) =>
        tx
          .update(contacts)
          .set({ name: "Renombrado" })
          .where(eq(contacts.id, own.contact.id)),
      ),
      "42501",
    );
    await expectSqlError(
      withTenant(ctx, (tx) =>
        tx.delete(contacts).where(eq(contacts.id, own.contact.id)),
      ),
      "42501",
    );
    await expectSqlError(
      withTenant(ctx, (tx) =>
        tx
          .update(opportunities)
          // Fuera del grant de 0008 (stage, loss_reason, updated_at).
          .set({ source: "web" })
          .where(eq(opportunities.id, own.id)),
      ),
      "42501",
    );
    await expectSqlError(
      withTenant(ctx, (tx) =>
        tx.delete(opportunities).where(eq(opportunities.id, own.id)),
      ),
      "42501",
    );
    // Tampoco por ON CONFLICT DO UPDATE (requiere UPDATE).
    const phone = freshPhone();
    await createOpportunityWithContact(ctx, newOpportunity(phone));
    await expectSqlError(
      withTenant(ctx, (tx) =>
        tx
          .insert(contacts)
          .values({
            organizationId: ORG_1,
            name: "Pisado",
            phone: phone.local,
            phoneNormalized: phone.e164,
          })
          .onConflictDoUpdate({
            target: [contacts.organizationId, contacts.phoneNormalized],
            targetWhere: sql`${contacts.phoneNormalized} IS NOT NULL`,
            set: { name: "Pisado" },
          }),
      ),
      "42501",
    );
    expect((await contactsWithPhone(phone.e164))[0]?.name).toBe("Lucía Ortiz");
  });
});

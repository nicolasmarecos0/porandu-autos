import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import postgres, { type TransactionSql } from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeOpportunityWithMetadata } from "@/db/queries/close-opportunity";
import { setOpportunityVehicle } from "@/db/queries/link-opportunity-vehicle";
import { getOpportunityDetail } from "@/db/queries/opportunity-detail";
import { opportunities } from "@/db/schema";
import { withTenant, type TenantContext } from "@/db/tenant";
import { OPPORTUNITY_STAGES, type Stage } from "@/domains/opportunities/stages";
import {
  canChangeVehicleLink,
  canHoldVehicle,
} from "@/domains/opportunities/vehicle-link";
import {
  closeOpportunity,
  linkOpportunityVehicle,
} from "@/lib/opportunities/actions";
import type { LinkVehicleState } from "@/lib/opportunities/vehicle-link";
import { ACTIVE_ORGANIZATION_COOKIE } from "@/lib/tenant/cookie";

import { cookieJar, type CookieJar } from "../unit/support/cookie-jar";
import { closureColumns } from "./support/closures";
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
 * Unidad vinculada a la negociación (Hito 2, DEC-033 §2 y §3) de punta a
 * punta contra PostgreSQL 17 con las migraciones aplicadas:
 *
 *   Server Action → requireTenant() → leer el pedido → withTenant() →
 *   SELECT … FOR UPDATE → unidad y demanda vigente de la organización
 *   activa → planVehicleLink() → UPDATE → RLS + FK compuesta + CHECK de
 *   etapa + trigger → loader del detalle
 *
 * La acción, la escritura y el loader son los reales, conectados como
 * app_runtime. Supabase Auth, la cookie, redirect() y revalidatePath() de
 * Next son simulados, como en opportunity-stages.test.ts.
 *
 * Tenants (support/tenants.ts): A: admin de ORG_1 · B: admin de ORG_2 · C:
 * seller de ORG_1 y admin de ORG_3, seller inactivo de ORG_2 · D: solo
 * inactiva en ORG_1 · E: sin memberships.
 *
 * Cada caso usa sus propias oportunidades y unidades (insertadas con el
 * superusuario) para no depender del orden de los demás. Por defecto la
 * oportunidad busca una Toyota Hilux y la unidad es una Toyota Hilux 2025
 * disponible: un match de 45 puntos.
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
  vi.stubEnv("RUNTIME_DATABASE_URL", await db.runtimeUrl());
});

afterAll(async () => {
  await closeRuntimePool();
  vi.unstubAllEnvs();
  await server?.close();
});

/** Nueva request: usuario autenticado (o ninguno) y cookie de organización. */
function request(userId: string | null, cookie?: string): void {
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

type VehicleSeed = {
  brand: string;
  model: string;
  status: "in_preparation" | "available" | "reserved" | "sold";
};

/** Una unidad propia del caso; por defecto, una Toyota Hilux disponible. */
async function vehicle(
  organizationId: string,
  overrides: Partial<VehicleSeed> = {},
): Promise<string> {
  const { brand, model, status }: VehicleSeed = {
    brand: "Toyota",
    model: "Hilux",
    status: "available",
    ...overrides,
  };
  const id = randomUUID();
  await db.admin`
    INSERT INTO public.vehicles (id, organization_id, brand, model, year,
      price, currency, status, created_at, updated_at)
    VALUES (${id}, ${organizationId}, ${brand}, ${model}, 2025, 49900, 'USD',
      ${status}, now() - interval '1 day', now() - interval '1 day')
  `;
  return id;
}

let sequence = 0;

/**
 * Una oportunidad propia del caso, en `stage`, que busca `wants` (por
 * defecto una Toyota Hilux; null: sin demanda) y con `vehicleId` vinculada.
 * Creada (y actualizada por última vez) hace un día: así se ve qué cambia.
 * Cerrada, trae metadatos de cierre válidos, y `won`, su unidad (DEC-034).
 */
async function opportunity(
  organizationId: string,
  stage: Stage = "negotiating",
  {
    wants = { brand: "Toyota", model: "Hilux" },
    vehicleId = null,
  }: {
    wants?: { brand: string; model: string } | null;
    vehicleId?: string | null;
  } = {},
): Promise<string> {
  sequence += 1;
  const contactId = randomUUID();
  const id = randomUUID();
  await db.admin`
    INSERT INTO public.contacts (id, organization_id, name)
    VALUES (${contactId}, ${organizationId}, ${`Prueba unidad ${sequence}`})
  `;
  const linked =
    vehicleId ?? (stage === "won" ? await vehicle(organizationId) : null);
  await db.admin`
    INSERT INTO public.opportunities ${db.admin({
      id,
      organization_id: organizationId,
      contact_id: contactId,
      stage,
      vehicle_id: linked,
      source: "web",
      ...closureColumns(stage),
      last_activity_at: new Date(Date.now() - 86_400_000),
      created_at: new Date(Date.now() - 86_400_000),
      updated_at: new Date(Date.now() - 86_400_000),
    })}
  `;
  if (wants) {
    const author =
      organizationId === ORG_2
        ? USER_B
        : organizationId === ORG_3
          ? USER_C
          : USER_A;
    await db.admin`
      INSERT INTO public.opportunity_demand_facts (organization_id,
        opportunity_id, fact, status, source_kind, recorded_by, brand, model)
      VALUES (${organizationId}, ${id}, 'desired_vehicle', 'confirmed',
        'member', ${author}, ${wants.brand}, ${wants.model})
    `;
  }
  return id;
}

type OpportunityRow = {
  organizationId: string;
  stage: Stage;
  vehicleId: string | null;
  lastActivityAt: Date;
  updatedAt: Date;
};

/** La oportunidad tal como está en la base (sin RLS). */
async function row(id: string): Promise<OpportunityRow | undefined> {
  const [found] = await db.admin<OpportunityRow[]>`
    SELECT organization_id AS "organizationId", stage,
      vehicle_id AS "vehicleId", last_activity_at AS "lastActivityAt",
      updated_at AS "updatedAt"
    FROM public.opportunities WHERE id = ${id}
  `;
  return found;
}

/** La unidad tal como está en la base: vincular nunca la cambia. */
async function unit(id: string) {
  const [found] = await db.admin`
    SELECT status, updated_at AS "updatedAt" FROM public.vehicles WHERE id = ${id}
  `;
  return found;
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.append(name, value);
  return data;
}

function link(
  opportunityId: string,
  vehicleId: string | null,
  extra: Record<string, string> = {},
): Promise<LinkVehicleState> {
  return linkOpportunityVehicle(
    null,
    form({ opportunityId, vehicleId: vehicleId ?? "", ...extra }),
  );
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

/** Drizzle envuelve el error del driver: el SQLSTATE queda en `cause`. */
async function expectSqlError(
  promise: Promise<unknown>,
  code: string,
  constraint?: string,
): Promise<void> {
  await expect(promise).rejects.toMatchObject({
    cause: {
      code,
      ...(constraint ? { constraint_name: constraint } : {}),
    },
  });
}

/** UPDATE directo por el boundary, solo por id (sin filtro de organización). */
function directUpdate(
  ctx: TenantContext,
  id: string,
  set: Partial<typeof opportunities.$inferInsert>,
) {
  return withTenant(ctx, (tx) =>
    tx
      .update(opportunities)
      .set(set)
      .where(eq(opportunities.id, id))
      .returning({ id: opportunities.id }),
  );
}

const ctxA = () => tenantContext(USER_A, ORG_1);

describe("Server Action: requireTenant() → validación → withTenant() → UPDATE", () => {
  it("admin (A) vincula una unidad disponible que es match En negociación: cambian vehicle_id y updated_at, y nada más; el stock no cambia", async () => {
    const hilux = await vehicle(ORG_1);
    const id = await opportunity(ORG_1);
    const before = await row(id);
    const unitBefore = await unit(hilux);
    request(USER_A);

    expect(await link(id, hilux)).toEqual({
      status: "linked",
      opportunityId: id,
      vehicleId: hilux,
    });
    // Solo el detalle: la cola no cambia por un vínculo.
    expect(mocks.revalidated).toEqual([`/opportunities/${id}`]);

    const after = await row(id);
    expect(after).toEqual({
      ...before,
      vehicleId: hilux,
      updatedAt: expect.any(Date),
    });
    expect(after!.updatedAt.getTime()).toBeGreaterThan(
      before!.updatedAt.getTime(),
    );
    // DEC-033 §6: la recencia del cliente no es el trabajo del vendedor.
    expect(after!.lastActivityAt).toEqual(before!.lastActivityAt);
    // DEC-033 §2: vincular no reserva ni vende la unidad.
    expect(await unit(hilux)).toEqual(unitBefore);
  });

  it("Ganada: la unidad vendida queda fija, sin marcarla vendida (DEC-034 §4)", async () => {
    const sold = await vehicle(ORG_1);
    const other = await vehicle(ORG_1);
    const id = await opportunity(ORG_1, "won", { vehicleId: sold });
    const before = await row(id);
    request(USER_A);
    for (const next of [other, null]) {
      expect(await link(id, next)).toEqual({
        status: "stage_not_allowed",
        opportunityId: id,
        stage: "won",
      });
    }
    expect(await row(id)).toEqual(before);
    expect((await unit(sold))!.status).toBe("available");
  });

  it("seller (C con ORG_1 activa) cambia la unidad que vinculó otro, y la quita", async () => {
    const first = await vehicle(ORG_1);
    const second = await vehicle(ORG_1);
    const id = await opportunity(ORG_1, "negotiating", { vehicleId: first });
    request(USER_C, ORG_1);
    expect(await link(id, second)).toEqual({
      status: "linked",
      opportunityId: id,
      vehicleId: second,
    });
    expect((await row(id))!.vehicleId).toBe(second);

    request(USER_C, ORG_1);
    expect(await link(id, null)).toEqual({
      status: "unlinked",
      opportunityId: id,
    });
    expect((await row(id))!.vehicleId).toBeNull();
    expect(mocks.revalidated).toEqual([`/opportunities/${id}`]);
  });

  it("C con ORG_3 activa (admin) vincula en ORG_3", async () => {
    const triton = await vehicle(ORG_3);
    const id = await opportunity(ORG_3);
    request(USER_C, ORG_3);
    expect(await link(id, triton)).toMatchObject({ status: "linked" });
  });

  it.each(["new", "qualifying", "won", "lost"] as const)(
    "en %s no se vincula ni se quita nada (stage_not_allowed, con la etapa real)",
    async (stage) => {
      const hilux = await vehicle(ORG_1);
      const id = await opportunity(ORG_1, stage);
      const before = await row(id);
      request(USER_A);
      expect(await link(id, hilux)).toEqual({
        status: "stage_not_allowed",
        opportunityId: id,
        stage,
      });
      expect(await row(id)).toEqual(before);
      // Se revalida para que la página muestre el estado real.
      expect(mocks.revalidated).toEqual([`/opportunities/${id}`]);
    },
  );

  it("Perdida conserva la unidad que se negociaba y no deja quitarla ni cambiarla", async () => {
    const hilux = await vehicle(ORG_1);
    const other = await vehicle(ORG_1);
    const id = await opportunity(ORG_1, "lost", { vehicleId: hilux });
    const before = await row(id);
    request(USER_A);
    expect(await link(id, null)).toMatchObject({
      status: "stage_not_allowed",
      stage: "lost",
    });
    expect(await link(id, other)).toMatchObject({
      status: "stage_not_allowed",
    });
    expect(await row(id)).toEqual(before);
  });

  it("pedir la unidad que ya está es unchanged: no escribe, no toca updated_at, no revalida", async () => {
    const hilux = await vehicle(ORG_1);
    for (const stage of ["negotiating", "won", "lost"] as const) {
      const id = await opportunity(ORG_1, stage, { vehicleId: hilux });
      const before = await row(id);
      request(USER_A);
      expect(await link(id, hilux)).toEqual({
        status: "unchanged",
        opportunityId: id,
        vehicleId: hilux,
      });
      expect(await row(id)).toEqual(before);
      expect(mocks.revalidated).toEqual([]);
    }
    const empty = await opportunity(ORG_1, "new");
    request(USER_A);
    expect(await link(empty, null)).toEqual({
      status: "unchanged",
      opportunityId: empty,
      vehicleId: null,
    });
  });

  it("una unidad de otra organización o inexistente es vehicle_not_found, sin distinguir", async () => {
    const foreign = await vehicle(ORG_2);
    const foreign3 = await vehicle(ORG_3);
    const id = await opportunity(ORG_1);
    const before = await row(id);
    request(USER_A);
    expect(await link(id, foreign)).toEqual({ status: "vehicle_not_found" });
    expect(await link(id, randomUUID())).toEqual({
      status: "vehicle_not_found",
    });
    // C pertenece a ORG_1 y ORG_3: con ORG_1 activa, la unidad de ORG_3 no se ve.
    request(USER_C, ORG_1);
    expect(await link(id, foreign3)).toEqual({ status: "vehicle_not_found" });
    expect(await row(id)).toEqual(before);
    expect(mocks.revalidated).toEqual([]);
  });

  it.each(["in_preparation", "reserved", "sold"] as const)(
    "una unidad %s no se vincula (vehicle_not_available)",
    async (status) => {
      const unavailable = await vehicle(ORG_1, { status });
      const id = await opportunity(ORG_1);
      const before = await row(id);
      request(USER_A);
      expect(await link(id, unavailable)).toEqual({
        status: "vehicle_not_available",
      });
      expect(await row(id)).toEqual(before);
    },
  );

  it("una unidad disponible que no es match de la demanda vigente no se vincula (not_a_match)", async () => {
    const kia = await vehicle(ORG_1, { brand: "Kia", model: "Sportage" });
    const hilux = await vehicle(ORG_1);
    const wantsKia = await opportunity(ORG_1);
    const noDemand = await opportunity(ORG_1, "negotiating", { wants: null });
    request(USER_A);
    // Otra marca descalifica.
    expect(await link(wantsKia, kia)).toEqual({ status: "not_a_match" });
    // Sin demanda evaluable no hay match.
    expect(await link(noDemand, hilux)).toEqual({ status: "not_a_match" });
    expect((await row(wantsKia))!.vehicleId).toBeNull();
    expect((await row(noDemand))!.vehicleId).toBeNull();
  });

  it("el match se evalúa con la demanda vigente, no con la del alta", async () => {
    const kia = await vehicle(ORG_1, { brand: "Kia", model: "Sportage" });
    const id = await opportunity(ORG_1);
    // El cliente cambió de idea: un nuevo confirmado sobre el anterior.
    await db.admin`
      INSERT INTO public.opportunity_demand_facts (organization_id,
        opportunity_id, fact, status, source_kind, recorded_by, brand, model,
        target_fact_id, previous_member_fact_id)
      SELECT organization_id, opportunity_id, fact, 'confirmed', 'member',
        ${USER_A}, 'Kia', 'Sportage', id, id
      FROM public.opportunity_demand_facts WHERE opportunity_id = ${id}
    `;
    request(USER_A);
    expect(await link(id, kia)).toMatchObject({ status: "linked" });
  });

  it("sin sesión o sin membership activa no llega a la base", async () => {
    const hilux = await vehicle(ORG_1);
    const id = await opportunity(ORG_1);
    const before = await row(id);
    for (const [userId, path] of [
      [null, "/login"],
      [USER_D, "/no-access"],
      [USER_E, "/no-access"],
    ] as const) {
      request(userId);
      expect(await redirectOf(link(id, hilux))).toBe(path);
    }
    expect(await row(id)).toEqual(before);
  });

  it("una oportunidad de otra organización es not_found, aun con membership activa en ambas", async () => {
    const foreign = await opportunity(ORG_2);
    const foreign3 = await opportunity(ORG_3);
    const hilux = await vehicle(ORG_1);
    const before = [await row(foreign), await row(foreign3)];

    request(USER_A);
    expect(await link(foreign, hilux)).toEqual({ status: "not_found" });
    request(USER_C, ORG_1);
    expect(await link(foreign3, hilux)).toEqual({ status: "not_found" });
    // Su membership inactiva en ORG_2 no cuenta.
    expect(await link(foreign, null)).toEqual({ status: "not_found" });

    expect([await row(foreign), await row(foreign3)]).toEqual(before);
    expect(mocks.revalidated).toEqual([]);
  });

  it("organización, etapa, estado de la unidad y reloj del pedido no tienen efecto", async () => {
    const hilux = await vehicle(ORG_1);
    const id = await opportunity(ORG_1);
    request(USER_A);
    expect(
      await link(id, hilux, {
        organizationId: ORG_2,
        organization_id: ORG_2,
        stage: "won",
        status: "sold",
        updated_at: "2000-01-01T00:00:00Z",
        lastActivityAt: "2000-01-01T00:00:00Z",
      }),
    ).toMatchObject({ status: "linked" });
    const after = await row(id);
    expect(after).toMatchObject({
      organizationId: ORG_1,
      stage: "negotiating",
      vehicleId: hilux,
    });
    expect(after!.updatedAt.getFullYear()).toBeGreaterThan(2020);
    expect((await unit(hilux))!.status).toBe("available");
  });

  it.each([
    ["sin id", { vehicleId: "" }, { status: "not_found" }],
    [
      "una inyección en el id",
      { opportunityId: "x' OR '1'='1", vehicleId: "" },
      { status: "not_found" },
    ],
    [
      "una unidad que no es UUID",
      { opportunityId: randomUUID(), vehicleId: "x' OR '1'='1" },
      { status: "vehicle_not_found" },
    ],
    [
      "sin el campo de la unidad",
      { opportunityId: randomUUID() },
      { status: "invalid" },
    ],
    [
      "un id UUID inexistente",
      { opportunityId: randomUUID(), vehicleId: "" },
      { status: "not_found" },
    ],
  ])("un pedido con %s no escribe", async (_, fields, expected) => {
    request(USER_A);
    expect(await linkOpportunityVehicle(null, form(fields))).toEqual(expected);
  });
});

describe("el detalle y los pases de etapa con la unidad vinculada", () => {
  it("el detalle trae la unidad vinculada como tarjeta y si se puede cambiar; otra organización no lo ve", async () => {
    const hilux = await vehicle(ORG_1);
    const id = await opportunity(ORG_1);
    request(USER_A);
    expect((await getOpportunityDetail(id))!.vehicleLink).toEqual({
      canChange: true,
      linked: null,
    });
    // El match es el que se ofrece vincular.
    const detail = await getOpportunityDetail(id);
    expect(detail!.matches).toMatchObject({ kind: "matches" });

    request(USER_A);
    await link(id, hilux);
    request(USER_C, ORG_1);
    expect((await getOpportunityDetail(id))!.vehicleLink).toEqual({
      canChange: true,
      linked: expect.objectContaining({
        vehicleId: hilux,
        name: "Toyota Hilux",
        status: "available",
      }),
    });
    request(USER_B);
    expect(await getOpportunityDetail(id)).toBeNull();
  });

  it.each([
    [
      "won",
      {
        salePrice: "47.500",
        saleCurrency: "USD",
        paymentMethod: "cash",
        deliveryStatus: "scheduled",
        deliveryDate: "2100-01-15",
      },
    ],
    ["lost", { lossReason: "price" }],
  ] as const)(
    "cerrar En negociación como %s conserva la unidad vinculada (el cierre no la toca) y la deja fija",
    async (outcome, fields) => {
      const hilux = await vehicle(ORG_1);
      const id = await opportunity(ORG_1);
      request(USER_A);
      await link(id, hilux);
      request(USER_A);
      expect(
        await closeOpportunity(
          null,
          form({ opportunityId: id, outcome, ...fields }),
        ),
      ).toMatchObject({ status: "closed", to: outcome });
      expect(await row(id)).toMatchObject({ stage: outcome, vehicleId: hilux });
      request(USER_A);
      expect((await getOpportunityDetail(id))!.vehicleLink).toMatchObject({
        canChange: false,
        linked: { vehicleId: hilux },
      });
    },
  );
});

/*
 * La regla vive dos veces: en el dominio (planVehicleLink, que decide qué se
 * ofrece y qué se escribe) y en la base (CHECK de etapa y trigger, que la
 * exigen aunque el código falle). Acá se cruzan las cinco etapas con un
 * UPDATE directo por el boundary, sin pasar por la Server Action.
 */
describe("la base espeja la regla del dominio", () => {
  it.each(OPPORTUNITY_STAGES)(
    "cambiar la unidad en %s, por el boundary",
    async (stage) => {
      const hilux = await vehicle(ORG_1);
      const id = await opportunity(ORG_1, stage);
      const before = await row(id);
      const attempt = directUpdate(ctxA(), id, { vehicleId: hilux });
      if (canChangeVehicleLink(stage)) {
        expect(await attempt).toEqual([{ id }]);
        expect((await row(id))!.vehicleId).toBe(hilux);
      } else {
        await expectSqlError(attempt, "23514", "opportunities_vehicle_link");
        expect(await row(id)).toEqual(before);
      }
    },
  );

  it.each(OPPORTUNITY_STAGES)(
    "una unidad existe en %s según el CHECK de etapa",
    async (stage) => {
      const hilux = await vehicle(ORG_1);
      const attempt = opportunity(ORG_1, stage, { vehicleId: hilux });
      if (canHoldVehicle(stage)) {
        expect((await row(await attempt))!.vehicleId).toBe(hilux);
      } else {
        await expect(attempt).rejects.toMatchObject({
          code: "23514",
          constraint_name: "opportunities_vehicle_stage_check",
        });
      }
    },
  );

  it.each([
    ["qualifying", "negotiating", null],
    ["negotiating", "won", null],
    ["negotiating", "lost", "price"],
  ] as const)(
    "un pase de %s a %s no puede cambiar la unidad en la misma UPDATE",
    async (from, to, lossReason) => {
      const hilux = await vehicle(ORG_1);
      const id = await opportunity(ORG_1, from);
      const before = await row(id);
      await expectSqlError(
        directUpdate(ctxA(), id, { stage: to, lossReason, vehicleId: hilux }),
        "23514",
        "opportunities_vehicle_link",
      );
      expect(await row(id)).toEqual(before);
    },
  );

  it("un pase inválido sigue fallando como pase, aunque cambie la unidad", async () => {
    const hilux = await vehicle(ORG_1);
    const id = await opportunity(ORG_1, "new");
    await expectSqlError(
      directUpdate(ctxA(), id, { stage: "won", vehicleId: hilux }),
      "23514",
      "opportunities_stage_transition",
    );
  });

  it("la FK compuesta impide vincular una unidad de otra organización (23503)", async () => {
    const foreign = await vehicle(ORG_2);
    const id = await opportunity(ORG_1);
    await expectSqlError(
      directUpdate(ctxA(), id, { vehicleId: foreign }),
      "23503",
      "opportunities_vehicle_fk",
    );
    expect((await row(id))!.vehicleId).toBeNull();
  });

  it("el alta nace sin unidad: una oportunidad nueva con unidad falla por CHECK", async () => {
    const hilux = await vehicle(ORG_1);
    const [contact] = await db.admin<{ id: string }[]>`
      INSERT INTO public.contacts (organization_id, name)
      VALUES (${ORG_1}, 'Alta con unidad') RETURNING id
    `;
    await expectSqlError(
      withTenant(ctxA(), (tx) =>
        tx.insert(opportunities).values({
          organizationId: ORG_1,
          contactId: contact!.id,
          stage: "new",
          source: "web",
          vehicleId: hilux,
        }),
      ),
      "23514",
      "opportunities_vehicle_stage_check",
    );
  });

  it("updated_at lo fija la base con su reloj, no el pedido", async () => {
    const hilux = await vehicle(ORG_1);
    const id = await opportunity(ORG_1);
    await directUpdate(ctxA(), id, {
      vehicleId: hilux,
      updatedAt: new Date("2000-01-01T00:00:00Z"),
    });
    expect((await row(id))!.updatedAt.getFullYear()).toBeGreaterThan(2020);
  });

  it("ni el rol dueño cambia la unidad fuera de En negociación o Ganada", async () => {
    const hilux = await vehicle(ORG_1);
    const id = await opportunity(ORG_1, "qualifying");
    const owner = postgres(db.migrationUrl, { max: 1, onnotice: () => {} });
    try {
      await expect(
        owner`UPDATE public.opportunities SET vehicle_id = ${hilux} WHERE id = ${id}`,
      ).rejects.toMatchObject({
        code: "23514",
        constraint_name: "opportunities_vehicle_link",
      });
    } finally {
      await owner.end();
    }
    expect((await row(id))!.vehicleId).toBeNull();
  });

  it("una unidad vinculada no se puede borrar (FK RESTRICT)", async () => {
    const hilux = await vehicle(ORG_1);
    await opportunity(ORG_1, "negotiating", { vehicleId: hilux });
    await expect(
      db.admin`DELETE FROM public.vehicles WHERE id = ${hilux}`,
    ).rejects.toMatchObject({
      code: "23503",
      constraint_name: "opportunities_vehicle_fk",
    });
  });
});

describe("privilegios y RLS del UPDATE de la unidad", () => {
  it("una oportunidad de otra organización no se ve para UPDATE: 0 filas", async () => {
    const foreignVehicle = await vehicle(ORG_2);
    const foreign = await opportunity(ORG_2);
    const before = await row(foreign);
    expect(
      await directUpdate(ctxA(), foreign, { vehicleId: foreignVehicle }),
    ).toEqual([]);
    expect(
      await directUpdate(tenantContext(USER_D, ORG_1), foreign, {
        vehicleId: foreignVehicle,
      }),
    ).toEqual([]);
    expect(await row(foreign)).toEqual(before);
  });

  it("el filtro de organización del módulo es defensa en profundidad: con el contexto de otro tenant, not_found", async () => {
    const hilux = await vehicle(ORG_1);
    const id = await opportunity(ORG_1);
    expect(
      await setOpportunityVehicle(tenantContext(USER_B, ORG_2), {
        opportunityId: id,
        vehicleId: hilux,
      }),
    ).toEqual({ outcome: "not_found" });
    expect((await row(id))!.vehicleId).toBeNull();
  });

  it("app_runtime fuera del boundary y anon no actualizan la unidad (42501)", async () => {
    const hilux = await vehicle(ORG_1);
    const id = await opportunity(ORG_1);
    await expect(
      runtimePool()`UPDATE public.opportunities SET vehicle_id = ${hilux} WHERE id = ${id}`,
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      db.admin.begin(async (tx: TransactionSql) => {
        await tx`SET LOCAL ROLE anon`;
        await tx`UPDATE public.opportunities SET vehicle_id = ${hilux} WHERE id = ${id}`;
      }),
    ).rejects.toMatchObject({ code: "42501" });
    expect((await row(id))!.vehicleId).toBeNull();
  });
});

/*
 * Dos pedidos sobre la misma oportunidad casi a la vez. El módulo bloquea la
 * fila (SELECT … FOR UPDATE): el que llega segundo espera, lee la unidad y la
 * etapa ya confirmadas y el dominio decide sobre ellas.
 */
describe("concurrencia: la fila bloqueada serializa los pedidos", () => {
  /** Espera a que `count` conexiones de app_runtime queden esperando un lock. */
  async function waitForLockWaits(count: number): Promise<void> {
    for (let attempt = 0; attempt < 250; attempt++) {
      const [found] = await db.admin<{ waiting: number }[]>`
        SELECT count(*)::int AS waiting FROM pg_stat_activity
        WHERE datname = current_database() AND usename = 'app_runtime'
          AND wait_event_type = 'Lock'
      `;
      if ((found?.waiting ?? 0) >= count) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`expected ${count} requests waiting on the row lock`);
  }

  /**
   * Retiene la fila con otra transacción (como postgres) mientras corre
   * `start`; `hold` decide qué hace esa transacción antes de soltarla.
   */
  async function whileRowIsHeld<T>(
    id: string,
    hold: (tx: TransactionSql) => Promise<void>,
    start: () => Promise<T>,
    waiting: number,
  ): Promise<T> {
    const holder = postgres(db.migrationUrl, { max: 1, onnotice: () => {} });
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const rowLocked = new Promise<void>((resolve) => (locked = resolve));
    const holding = holder.begin(async (tx) => {
      await tx`SELECT id FROM public.opportunities WHERE id = ${id} FOR UPDATE`;
      await hold(tx);
      locked();
      await released;
    });
    try {
      await rowLocked;
      const running = start();
      await waitForLockWaits(waiting);
      release();
      await holding;
      return await running;
    } finally {
      release();
      await holding.catch(() => {});
      await holder.end();
    }
  }

  it("si otra transacción la pierde mientras el pedido espera, el pedido no vincula nada", async () => {
    const hilux = await vehicle(ORG_1);
    const id = await opportunity(ORG_1);
    const result = await whileRowIsHeld(
      id,
      async (tx) => {
        await tx`UPDATE public.opportunities SET stage = 'lost', loss_reason = 'ghosted' WHERE id = ${id}`;
      },
      () =>
        setOpportunityVehicle(tenantContext(USER_A, ORG_1), {
          opportunityId: id,
          vehicleId: hilux,
        }),
      1,
    );
    expect(result).toEqual({
      outcome: "stage_not_allowed",
      opportunityId: id,
      stage: "lost",
    });
    expect(await row(id)).toMatchObject({ stage: "lost", vehicleId: null });
  });

  it("dos pedidos con unidades distintas: se aplican en orden y el segundo ve al primero como la anterior", async () => {
    const first = await vehicle(ORG_1);
    const second = await vehicle(ORG_1);
    const id = await opportunity(ORG_1);
    const results = await whileRowIsHeld(
      id,
      async () => {},
      () =>
        Promise.all([
          setOpportunityVehicle(tenantContext(USER_A, ORG_1), {
            opportunityId: id,
            vehicleId: first,
          }),
          setOpportunityVehicle(tenantContext(USER_C, ORG_1), {
            opportunityId: id,
            vehicleId: second,
          }),
        ]),
      2,
    );
    expect(results.every((r) => r.outcome === "linked")).toBe(true);
    const linked = results as Extract<
      (typeof results)[number],
      { outcome: "linked" }
    >[];
    const earlier = linked.find((r) => r.previousVehicleId === null);
    const later = linked.find((r) => r !== earlier);
    expect(earlier).toBeDefined();
    expect(later!.previousVehicleId).toBe(earlier!.vehicleId);
    expect((await row(id))!.vehicleId).toBe(later!.vehicleId);
  });

  it("la misma unidad dos veces a la vez: un linked y un unchanged", async () => {
    const hilux = await vehicle(ORG_1);
    const id = await opportunity(ORG_1);
    request(USER_A);
    const results = await whileRowIsHeld(
      id,
      async () => {},
      () => Promise.all([link(id, hilux), link(id, hilux)]),
      2,
    );
    expect(results.map((r) => r?.status).sort()).toEqual([
      "linked",
      "unchanged",
    ]);
    expect((await row(id))!.vehicleId).toBe(hilux);
  });

  it("ganar y vincular a la vez: ninguno pisa al otro y nunca hay una venta sin unidad", async () => {
    const hilux = await vehicle(ORG_1);
    const id = await opportunity(ORG_1);
    const [won, linked] = await whileRowIsHeld(
      id,
      async () => {},
      () =>
        Promise.all([
          closeOpportunityWithMetadata(tenantContext(USER_A, ORG_1), {
            opportunityId: id,
            closure: {
              outcome: "won",
              salePrice: { amount: "47500.00", currency: "USD" },
              paymentMethod: "cash",
              deliveryStatus: "delivered",
              deliveryDate: "2026-10-01",
            },
          }),
          setOpportunityVehicle(tenantContext(USER_C, ORG_1), {
            opportunityId: id,
            vehicleId: hilux,
          }),
        ]),
      2,
    );
    // Vincular siempre llega: o antes del cierre, o después de un cierre que
    // no pudo ser (sin unidad, vehicle_required).
    expect(linked).toMatchObject({ outcome: "linked", vehicleId: hilux });
    const final = (await row(id))!;
    if (won.outcome === "closed") {
      expect(final).toMatchObject({ stage: "won", vehicleId: hilux });
    } else {
      expect(won).toEqual({ outcome: "vehicle_required", opportunityId: id });
      expect(final).toMatchObject({ stage: "negotiating", vehicleId: hilux });
    }
  });
});

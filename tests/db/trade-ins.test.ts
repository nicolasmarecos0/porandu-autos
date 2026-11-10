import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { opportunities, tradeIns, vehicles } from "@/db/schema";
import { withTenant, type TenantContext } from "@/db/tenant";
import {
  TRADE_IN_STATUSES,
  TRADE_IN_TRANSITIONS,
} from "@/domains/opportunities/trade-ins";

import { ACTIVE_ORGANIZATION_COOKIE } from "@/lib/tenant/cookie";
import {
  appraiseTradeIn,
  changeTradeInStatus,
  registerTradeIn,
} from "@/lib/trade-ins/actions";

import { cookieJar, type CookieJar } from "../unit/support/cookie-jar";
import { closureColumns, WON_METADATA } from "./support/closures";
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
  seedTenants,
  tenantContext,
  USER_A,
  USER_B,
  USER_C,
  USER_D,
  USER_E,
} from "./support/tenants";

/*
 * Tomas de usados y tasaciones (Hito 20, DEC-052) contra PostgreSQL 17 con
 * las migraciones aplicadas. Esta primera parte prueba la base sola, por el
 * boundary real (withTenant() como app_runtime → authenticated, con UPDATEs
 * directos que no pasan por el dominio) y con el rol dueño, que el trigger
 * no exime:
 *
 *   RLS (lectura y alta pendiente de una oportunidad abierta) → grants por
 *   columna → trigger trade_ins_change_guard (matriz, usado inmutable,
 *   oportunidad abierta bloqueada FOR SHARE, valor de toma para aceptar,
 *   admin para tasar, ingreso al stock solo con el cierre Ganada) →
 *   CHECKs → constraint trigger diferido opportunities_won_trade_in_stocked
 *
 * Tenants (support/tenants.ts): A: admin de ORG_1 · B: admin de ORG_2 · C:
 * seller de ORG_1 y admin de ORG_3.
 *
 * Cada caso usa sus propias oportunidades, unidades y tomas (insertadas con
 * el superusuario en el estado que necesita) para no depender del orden.
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

const ctxA = (): TenantContext => tenantContext(USER_A, ORG_1);
const ctxB = (): TenantContext => tenantContext(USER_B, ORG_2);
const ctxC = (): TenantContext => tenantContext(USER_C, ORG_1);

type StageName = "new" | "qualifying" | "negotiating" | "won" | "lost";
type DbVehicleStatus = "in_preparation" | "available" | "reserved" | "sold";
type DbTradeInStatus = "pending" | "appraised" | "accepted" | "rejected";

const STATUSES: readonly DbTradeInStatus[] = [
  "pending",
  "appraised",
  "accepted",
  "rejected",
];

/** La matriz de DEC-052 §2: los únicos pases que la base acepta. */
const MATRIX: Readonly<Record<DbTradeInStatus, readonly DbTradeInStatus[]>> = {
  pending: ["appraised", "rejected"],
  appraised: ["appraised", "accepted", "rejected"],
  accepted: ["rejected"],
  rejected: [],
};

let sequence = 0;

/** Una unidad propia del caso (superusuario). */
async function unit(
  organizationId: string,
  status: DbVehicleStatus = "available",
): Promise<string> {
  sequence += 1;
  const id = randomUUID();
  await db.admin`
    INSERT INTO public.vehicles (id, organization_id, brand, model, version,
      year, km, price, currency, status)
    VALUES (${id}, ${organizationId}, 'Toyota', 'Hilux',
      ${`Prueba Hito 20 ${sequence}`}, 2025, 0, 49900, 'USD', ${status})
  `;
  return id;
}

/**
 * Una oportunidad propia del caso en `stage`. En negociación o cerrada,
 * con una unidad vinculada (vendida si está ganada), como la deja la
 * aplicación.
 */
async function opportunity(
  organizationId: string,
  stage: StageName = "negotiating",
): Promise<{ id: string; vehicleId: string | null }> {
  sequence += 1;
  const contactId = randomUUID();
  const id = randomUUID();
  const vehicleId =
    stage === "negotiating" || stage === "lost"
      ? await unit(organizationId, "available")
      : stage === "won"
        ? await unit(organizationId, "sold")
        : null;
  await db.admin`
    INSERT INTO public.contacts (id, organization_id, name)
    VALUES (${contactId}, ${organizationId}, ${`Cliente toma ${sequence}`})
  `;
  await db.admin`
    INSERT INTO public.opportunities ${db.admin({
      id,
      organization_id: organizationId,
      contact_id: contactId,
      stage,
      source: "showroom",
      vehicle_id: vehicleId,
      ...closureColumns(stage),
    })}
  `;
  return { id, vehicleId };
}

/**
 * Una unidad En preparación con los datos del usado y sin precio: la que
 * crea el cierre Ganada (superusuario).
 */
async function stockUnit(organizationId: string): Promise<string> {
  const id = randomUUID();
  await db.admin`
    INSERT INTO public.vehicles (id, organization_id, brand, model, version,
      year, km, status)
    VALUES (${id}, ${organizationId}, 'Toyota', 'Vitz', '1.3 F', 2015, 98000,
      'in_preparation')
  `;
  return id;
}

/** El usado de prueba: un Toyota Vitz 2015 con su chapa. */
const VITZ = {
  brand: "Toyota",
  model: "Vitz",
  version: "1.3 F",
  year: 2015,
  km: 98000,
  plate: "ABC 123",
} as const;

/** Una tasación en dólares: USD 8.000 de toma y USD 800 de arreglo. */
const APPRAISAL = {
  currency: "USD",
  offer_price: "8000.00",
  estimated_repair_cost: "800.00",
} as const;

/**
 * Una toma de `opportunityId` en `status`, escrita por el superusuario (un
 * INSERT no pasa por el trigger de UPDATE). Tasada, aceptada o rechazada
 * después de tasar, con su tasación y su sello de A.
 */
async function tradeIn(
  organizationId: string,
  opportunityId: string,
  status: DbTradeInStatus = "pending",
  options: { appraised?: boolean } = {},
): Promise<string> {
  const id = randomUUID();
  const appraised = options.appraised ?? status !== "pending";
  await db.admin`
    INSERT INTO public.trade_ins ${db.admin({
      id,
      organization_id: organizationId,
      opportunity_id: opportunityId,
      ...VITZ,
      status,
      created_by: USER_C,
      currency: appraised ? APPRAISAL.currency : null,
      offer_price: appraised ? APPRAISAL.offer_price : null,
      estimated_repair_cost: appraised ? APPRAISAL.estimated_repair_cost : null,
      appraised_by: appraised ? USER_A : null,
      appraised_at: appraised ? new Date(Date.now() - 3_600_000) : null,
      created_at: new Date(Date.now() - 86_400_000),
      updated_at: new Date(Date.now() - 86_400_000),
    })}
  `;
  return id;
}

type TradeInRow = {
  status: DbTradeInStatus;
  currency: string | null;
  offerPrice: string | null;
  estimatedRepairCost: string | null;
  appraisedBy: string | null;
  appraisedAt: Date | null;
  convertedVehicleId: string | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
};

/** La fila tal como está en la base (sin RLS). */
async function rowOf(id: string): Promise<TradeInRow> {
  const [row] = await db.admin<TradeInRow[]>`
    SELECT status, currency, offer_price::text AS "offerPrice",
      estimated_repair_cost::text AS "estimatedRepairCost",
      appraised_by AS "appraisedBy", appraised_at AS "appraisedAt",
      converted_vehicle_id AS "convertedVehicleId", created_by AS "createdBy",
      created_at AS "createdAt", updated_at AS "updatedAt"
    FROM public.trade_ins WHERE id = ${id}
  `;
  return row!;
}

/** Alta por el boundary, como la hará la capa de escritura. */
function insertTradeIn(
  ctx: TenantContext,
  opportunityId: string,
  overrides: Partial<typeof tradeIns.$inferInsert> = {},
) {
  return withTenant(ctx, (tx) =>
    tx
      .insert(tradeIns)
      .values({
        organizationId: ctx.organizationId,
        opportunityId,
        ...VITZ,
        createdBy: ctx.userId,
        ...overrides,
      })
      .returning({ id: tradeIns.id }),
  ).then((rows) => rows[0]!);
}

/** UPDATE directo por el boundary, solo por id (sin el dominio). */
function update(
  ctx: TenantContext,
  id: string,
  set: Partial<typeof tradeIns.$inferInsert>,
) {
  return withTenant(ctx, (tx) =>
    tx
      .update(tradeIns)
      .set(set)
      .where(eq(tradeIns.id, id))
      .returning({ id: tradeIns.id, status: tradeIns.status }),
  );
}

/** El rol dueño (postgres), fuera del boundary: el trigger no lo exime. */
async function asOwner<T>(fn: (sql: Sql) => Promise<T>): Promise<T> {
  const owner = postgres(db.migrationUrl, { max: 1, onnotice: () => {} });
  try {
    return await fn(owner);
  } finally {
    await owner.end();
  }
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

/** Un error del driver sin envoltorio (rol dueño, COMMIT). */
async function expectRawSqlError(
  promise: Promise<unknown>,
  code: string,
  constraint?: string,
): Promise<void> {
  await expect(promise).rejects.toMatchObject({
    code,
    ...(constraint ? { constraint_name: constraint } : {}),
  });
}

describe("RLS de trade_ins: lectura y alta pendiente de una oportunidad abierta", () => {
  it.each(["new", "qualifying", "negotiating"] as const)(
    "admin (A) y seller (C) registran la toma de una oportunidad %s: nace pendiente, con su autor y el reloj de la base",
    async (stage) => {
      for (const ctx of [ctxA(), ctxC()]) {
        const { id: opportunityId } = await opportunity(ORG_1, stage);
        const { id } = await insertTradeIn(ctx, opportunityId);
        const row = await rowOf(id);
        expect(row).toMatchObject({
          status: "pending",
          currency: null,
          offerPrice: null,
          estimatedRepairCost: null,
          appraisedBy: null,
          appraisedAt: null,
          convertedVehicleId: null,
          createdBy: ctx.userId,
        });
        expect(Math.abs(row.createdAt.getTime() - Date.now())).toBeLessThan(
          60_000,
        );
      }
    },
  );

  it.each(["won", "lost"] as const)(
    "una oportunidad %s no admite registrar una toma (42501, WITH CHECK)",
    async (stage) => {
      const { id: opportunityId } = await opportunity(ORG_1, stage);
      await expectSqlError(insertTradeIn(ctxA(), opportunityId), "42501");
    },
  );

  it("el alta no elige estado, tasación, sellos, ingreso, autor ni reloj: el WITH CHECK los rechaza", async () => {
    const { id: opportunityId } = await opportunity(ORG_1);
    const converted = await unit(ORG_1, "in_preparation");
    const forged: Partial<typeof tradeIns.$inferInsert>[] = [
      { status: "appraised", ...appraisalValues() },
      { status: "accepted", ...appraisalValues() },
      { status: "rejected" },
      { ...appraisalValues() },
      { appraisedBy: USER_A, appraisedAt: new Date() },
      { convertedVehicleId: converted },
      { createdBy: USER_B },
      { createdAt: new Date("2026-01-01T00:00:00Z") },
      { updatedAt: new Date("2026-01-01T00:00:00Z") },
    ];
    for (const overrides of forged) {
      await expectSqlError(
        insertTradeIn(ctxA(), opportunityId, overrides),
        "42501",
      );
    }
    const [inserted] = await db.admin<{ count: number }[]>`
      SELECT count(*)::int AS count FROM public.trade_ins
      WHERE opportunity_id = ${opportunityId}
    `;
    expect(inserted?.count).toBe(0);
  });

  it("aislamiento: B no ve, no registra ni cambia tomas de ORG_1, y un contexto falsificado tampoco", async () => {
    const { id: opportunityId } = await opportunity(ORG_1);
    const id = await tradeIn(ORG_1, opportunityId, "appraised");

    const seen = await withTenant(ctxB(), (tx) =>
      tx.select({ id: tradeIns.id }).from(tradeIns),
    );
    expect(seen.map((row) => row.id)).not.toContain(id);
    expect(await update(ctxB(), id, { status: "accepted" })).toEqual([]);
    // La oportunidad de ORG_1 con la organización de B: la FK compuesta no
    // la encuentra y el WITH CHECK tampoco.
    await expect(insertTradeIn(ctxB(), opportunityId)).rejects.toMatchObject({
      cause: { code: expect.stringMatching(/^(42501|23503)$/) },
    });

    // B con ORG_1 (sin membership): RLS lo contiene igual.
    const forged = tenantContext(USER_B, ORG_1);
    expect(
      await withTenant(forged, (tx) =>
        tx
          .select({ id: tradeIns.id })
          .from(tradeIns)
          .where(eq(tradeIns.id, id)),
      ),
    ).toEqual([]);
    expect(await update(forged, id, { status: "accepted" })).toEqual([]);
    await expectSqlError(insertTradeIn(forged, opportunityId), "42501");
    expect((await rowOf(id)).status).toBe("appraised");
  });

  it("a lo sumo una toma vigente por oportunidad (trade_ins_active_opportunity_key); rechazada, se registra otra", async () => {
    const { id: opportunityId } = await opportunity(ORG_1);
    const { id: first } = await insertTradeIn(ctxA(), opportunityId);
    await expectSqlError(
      insertTradeIn(ctxC(), opportunityId),
      "23505",
      "trade_ins_active_opportunity_key",
    );
    await update(ctxC(), first, { status: "rejected" });
    const { id: second } = await insertTradeIn(ctxC(), opportunityId);
    expect((await rowOf(second)).status).toBe("pending");
  });

  it("authenticated no edita el usado ni los sellos (grant por columna) y no borra tomas", async () => {
    const { id: opportunityId } = await opportunity(ORG_1);
    const id = await tradeIn(ORG_1, opportunityId, "pending");
    for (const set of [
      { brand: "Otra" },
      { km: 1 },
      { plate: "XYZ 999" },
      { appraisedBy: USER_A },
      { createdBy: USER_A },
    ] satisfies Partial<typeof tradeIns.$inferInsert>[]) {
      await expectSqlError(update(ctxA(), id, set), "42501");
    }
    await expectSqlError(
      withTenant(ctxA(), (tx) =>
        tx.delete(tradeIns).where(eq(tradeIns.id, id)),
      ),
      "42501",
    );
    expect((await rowOf(id)).status).toBe("pending");
  });
});

/** Los valores de una tasación con las columnas de Drizzle. */
function appraisalValues(
  offerPrice = "8500.00",
  estimatedRepairCost = "600.00",
  currency: "USD" | "PYG" = "USD",
) {
  return { currency, offerPrice, estimatedRepairCost } as const;
}

describe("la base exige la matriz de DEC-052 (trigger trade_ins_change_guard)", () => {
  it("la matriz que prueba la base es la del dominio", () => {
    expect(STATUSES).toEqual(TRADE_IN_STATUSES);
    expect(MATRIX).toEqual(TRADE_IN_TRANSITIONS);
  });

  const PAIRS = STATUSES.flatMap((from) =>
    STATUSES.map((to) => [from, to] as const),
  );

  it.each(PAIRS)(
    "%s → %s: un admin (A) por el boundary solo hace los pases de la matriz",
    async (from, to) => {
      const { id: opportunityId } = await opportunity(ORG_1);
      const id = await tradeIn(ORG_1, opportunityId, from);
      const before = await rowOf(id);
      // Tasar o retasar lleva una tasación nueva; el resto, solo el estado.
      const set =
        to === "appraised"
          ? { status: to, ...appraisalValues() }
          : { status: to };
      const attempt = update(ctxA(), id, set);
      if (MATRIX[from].includes(to)) {
        expect(await attempt).toEqual([{ id, status: to }]);
        const after = await rowOf(id);
        expect(after.status).toBe(to);
        expect(after.updatedAt.getTime()).toBeGreaterThan(
          before.updatedAt.getTime(),
        );
      } else {
        // Aceptar sin una tasación previa es la regla del fundador.
        await expectSqlError(
          attempt,
          "23514",
          from === "pending" && to === "accepted"
            ? "trade_ins_offer_required"
            : "trade_ins_status_transition",
        );
        expect(await rowOf(id)).toEqual(before);
      }
    },
  );

  it("tasar: solo un admin de la organización (C es seller en ORG_1), siempre un usuario (el rol dueño sin claims, no)", async () => {
    const { id: opportunityId } = await opportunity(ORG_1);
    const id = await tradeIn(ORG_1, opportunityId, "pending");
    await expectSqlError(
      update(ctxC(), id, { status: "appraised", ...appraisalValues() }),
      "23514",
      "trade_ins_appraisal_requires_admin",
    );
    await expectRawSqlError(
      asOwner(
        (sql) =>
          sql`UPDATE public.trade_ins SET status = 'appraised', currency = 'USD', offer_price = 8000, estimated_repair_cost = 0 WHERE id = ${id}`,
      ),
      "23514",
      "trade_ins_appraisal_requires_user",
    );
    expect((await rowOf(id)).status).toBe("pending");
  });

  it("tasar fija el sello (quién y cuándo, con el reloj de la base); retasar exige otra tasación y renueva el sello", async () => {
    const { id: opportunityId } = await opportunity(ORG_1);
    const id = await tradeIn(ORG_1, opportunityId, "pending");
    await update(ctxA(), id, {
      status: "appraised",
      ...appraisalValues("8000.00", "800.00"),
      // El cliente no elige el sello: no tiene grant y el trigger lo fija.
    });
    const appraised = await rowOf(id);
    expect(appraised).toMatchObject({
      status: "appraised",
      currency: "USD",
      offerPrice: "8000.00",
      estimatedRepairCost: "800.00",
      appraisedBy: USER_A,
    });
    expect(
      Math.abs(appraised.appraisedAt!.getTime() - Date.now()),
    ).toBeLessThan(60_000);

    // La misma tasación no es un cambio.
    await expectSqlError(
      update(ctxA(), id, {
        status: "appraised",
        ...appraisalValues("8000.00", "800.00"),
      }),
      "23514",
      "trade_ins_status_transition",
    );
    await update(ctxA(), id, {
      status: "appraised",
      ...appraisalValues("8500.00", "800.00"),
    });
    const reappraised = await rowOf(id);
    expect(reappraised.offerPrice).toBe("8500.00");
    expect(reappraised.appraisedAt!.getTime()).toBeGreaterThanOrEqual(
      appraised.appraisedAt!.getTime(),
    );
  });

  it("fuera de una tasación la tasación no cambia, ni al decidir (trade_ins_immutable)", async () => {
    const { id: opportunityId } = await opportunity(ORG_1);
    const accepted = await tradeIn(ORG_1, opportunityId, "accepted");
    await expectSqlError(
      update(ctxA(), accepted, { status: "rejected", offerPrice: "1.00" }),
      "23514",
      "trade_ins_immutable",
    );
    const { id: other } = await opportunity(ORG_1);
    const appraised = await tradeIn(ORG_1, other, "appraised");
    await expectSqlError(
      update(ctxC(), appraised, {
        status: "accepted",
        offerPrice: "99999.00",
      }),
      "23514",
      "trade_ins_immutable",
    );
    expect((await rowOf(appraised)).offerPrice).toBe("8000.00");
  });

  it("el usado, el autor y los sellos son inmutables, también para el rol dueño", async () => {
    const { id: opportunityId } = await opportunity(ORG_1);
    const id = await tradeIn(ORG_1, opportunityId, "appraised");
    const { id: elsewhere } = await opportunity(ORG_1);
    for (const assignment of [
      "brand = 'Nissan'",
      "model = 'March'",
      "version = NULL",
      "year = 2016",
      "km = 1",
      "plate = 'XYZ 999'",
      `opportunity_id = '${elsewhere}'`,
      `created_by = '${USER_A}'`,
      "created_at = now()",
      `appraised_by = '${USER_C}'`,
      "appraised_at = now()",
    ]) {
      await expectRawSqlError(
        asOwner((sql) =>
          sql.unsafe(
            `UPDATE public.trade_ins SET ${assignment}, status = 'accepted' WHERE id = '${id}'`,
          ),
        ),
        "23514",
        "trade_ins_immutable",
      );
    }
    expect((await rowOf(id)).status).toBe("appraised");
  });

  it.each(["won", "lost"] as const)(
    "con la oportunidad %s la toma ya no cambia (trade_ins_opportunity_closed), tampoco para el rol dueño",
    async (stage) => {
      const { id: opportunityId } = await opportunity(ORG_1, stage);
      const appraised = await tradeIn(ORG_1, opportunityId, "appraised");
      await expectSqlError(
        update(ctxA(), appraised, { status: "accepted" }),
        "23514",
        "trade_ins_opportunity_closed",
      );
      await expectRawSqlError(
        asOwner(
          (sql) =>
            sql`UPDATE public.trade_ins SET status = 'rejected' WHERE id = ${appraised}`,
        ),
        "23514",
        "trade_ins_opportunity_closed",
      );
      expect((await rowOf(appraised)).status).toBe("appraised");
    },
  );

  it("aceptar exige el valor de toma: el trigger lo dice primero y el CHECK lo vuelve a exigir sobre la fila", async () => {
    const { id: opportunityId } = await opportunity(ORG_1);
    const pending = await tradeIn(ORG_1, opportunityId, "pending");
    // Aceptar y escribir el valor en la misma UPDATE tampoco: hace falta
    // una tasación previa.
    await expectRawSqlError(
      asOwner(
        (sql) =>
          sql`UPDATE public.trade_ins SET status = 'accepted', currency = 'USD', offer_price = 8000, estimated_repair_cost = 0 WHERE id = ${pending}`,
      ),
      "23514",
      "trade_ins_offer_required",
    );
    // Un INSERT del superusuario no pasa por el trigger: el CHECK con
    // nombre de la regla lo rechaza.
    const { id: other } = await opportunity(ORG_1);
    await expectRawSqlError(
      db.admin`
        INSERT INTO public.trade_ins (organization_id, opportunity_id, brand,
          model, year, status, created_by)
        VALUES (${ORG_1}, ${other}, 'Toyota', 'Vitz', 2015, 'accepted', ${USER_C})
      `,
      "23514",
      "trade_ins_accepted_offer_check",
    );
  });

  it("los CHECKs del usado y de la tasación: textos, año, km, chapa, montos y PYG sin decimales", async () => {
    const { id: opportunityId } = await opportunity(ORG_1);
    const base = {
      organization_id: ORG_1,
      opportunity_id: opportunityId,
      ...VITZ,
      created_by: USER_C,
    };
    const cases: [Record<string, unknown>, string][] = [
      [{ brand: " Toyota" }, "trade_ins_brand_check"],
      [{ brand: "" }, "trade_ins_brand_check"],
      [{ model: "x".repeat(81) }, "trade_ins_model_check"],
      [{ version: "1.3\tF" }, "trade_ins_version_check"],
      [{ year: 1899 }, "trade_ins_year_check"],
      [{ km: -1 }, "trade_ins_km_check"],
      [{ plate: "abc 123" }, "trade_ins_plate_check"],
      [{ plate: "ABC  123" }, "trade_ins_plate_check"],
      [{ plate: "ABC-123" }, "trade_ins_plate_check"],
      [
        {
          status: "appraised",
          currency: "EUR",
          offer_price: "8000",
          estimated_repair_cost: "0",
          appraised_by: USER_A,
          appraised_at: new Date(),
        },
        "trade_ins_currency_check",
      ],
      [
        {
          status: "appraised",
          currency: "USD",
          offer_price: "0",
          estimated_repair_cost: "0",
          appraised_by: USER_A,
          appraised_at: new Date(),
        },
        "trade_ins_offer_price_check",
      ],
      [
        {
          status: "appraised",
          currency: "PYG",
          offer_price: "50000000.50",
          estimated_repair_cost: "0",
          appraised_by: USER_A,
          appraised_at: new Date(),
        },
        "trade_ins_offer_price_check",
      ],
      [
        {
          status: "appraised",
          currency: "USD",
          offer_price: "8000",
          estimated_repair_cost: "-1",
          appraised_by: USER_A,
          appraised_at: new Date(),
        },
        "trade_ins_repair_cost_check",
      ],
      // La tasación va entera y según el estado.
      [
        { status: "appraised", currency: "USD", offer_price: "8000" },
        "trade_ins_appraisal_check",
      ],
      [{ status: "appraised" }, "trade_ins_appraisal_check"],
      [
        {
          status: "pending",
          currency: "USD",
          offer_price: "8000",
          estimated_repair_cost: "0",
          appraised_by: USER_A,
          appraised_at: new Date(),
        },
        "trade_ins_appraisal_check",
      ],
      [
        { status: "rejected", converted_vehicle_id: await unit(ORG_1) },
        "trade_ins_converted_check",
      ],
    ];
    for (const [overrides, constraint] of cases) {
      await expectRawSqlError(
        db.admin`INSERT INTO public.trade_ins ${db.admin({ ...base, ...overrides })}`,
        "23514",
        constraint,
      );
    }
    // Una rechazada sin tasar (descartada pendiente) y una sin chapa ni
    // versión ni km son válidas.
    await db.admin`INSERT INTO public.trade_ins ${db.admin({ ...base, status: "rejected" })}`;
    await db.admin`INSERT INTO public.trade_ins ${db.admin({
      ...base,
      status: "rejected",
      version: null,
      km: null,
      plate: null,
    })}`;
  });
});

/**
 * El cierre Ganada escrito a mano por el boundary, como lo hará
 * closeOpportunity(): la oportunidad, la venta de su unidad y, si `intake`,
 * la unidad nueva En preparación con los datos de la toma y su vínculo.
 */
function winWith(
  ctx: TenantContext,
  opportunityId: string,
  soldVehicleId: string,
  tradeInId: string | null,
  intake: Partial<typeof vehicles.$inferInsert> | null = {},
) {
  return withTenant(ctx, async (tx) => {
    await tx
      .update(opportunities)
      .set({ stage: "won", ...WON_METADATA })
      .where(eq(opportunities.id, opportunityId));
    await tx
      .update(vehicles)
      .set({ status: "sold" })
      .where(eq(vehicles.id, soldVehicleId));
    if (tradeInId === null || intake === null) return null;
    const [created] = await tx
      .insert(vehicles)
      .values({
        organizationId: ctx.organizationId,
        brand: VITZ.brand,
        model: VITZ.model,
        version: VITZ.version,
        year: VITZ.year,
        km: VITZ.km,
        status: "in_preparation",
        ...intake,
      })
      .returning({ id: vehicles.id });
    await tx
      .update(tradeIns)
      .set({ convertedVehicleId: created!.id })
      .where(
        and(
          eq(tradeIns.organizationId, ctx.organizationId),
          eq(tradeIns.id, tradeInId),
        ),
      );
    return created!.id;
  });
}

describe("el ingreso al stock: trade_ins_intake y el constraint trigger diferido", () => {
  it("ganar con la toma aceptada, vender la unidad y crear la unidad En preparación con su vínculo, en una transacción", async () => {
    const { id: opportunityId, vehicleId } = await opportunity(ORG_1);
    const id = await tradeIn(ORG_1, opportunityId, "accepted");
    const created = await winWith(ctxA(), opportunityId, vehicleId!, id);

    expect((await rowOf(id)).convertedVehicleId).toBe(created);
    const [stocked] = await db.admin`
      SELECT brand, model, version, year, km, price, currency, status
      FROM public.vehicles WHERE id = ${created}
    `;
    expect(stocked).toEqual({
      brand: "Toyota",
      model: "Vitz",
      version: "1.3 F",
      year: 2015,
      km: 98000,
      price: null,
      currency: null,
      status: "in_preparation",
    });
    // Convertida, la toma no vuelve a cambiar: la oportunidad está ganada.
    await expectSqlError(
      update(ctxA(), id, { convertedVehicleId: null }),
      "23514",
      "trade_ins_intake",
    );
    await expectSqlError(
      update(ctxA(), id, { status: "rejected" }),
      "23514",
      "trade_ins_opportunity_closed",
    );
  });

  it("ganar con una toma aceptada sin hacerla entrar al stock revierte la transacción entera al COMMIT (opportunities_won_trade_in_stocked)", async () => {
    const { id: opportunityId, vehicleId } = await opportunity(ORG_1);
    const id = await tradeIn(ORG_1, opportunityId, "accepted");
    await expectRawSqlError(
      winWith(ctxA(), opportunityId, vehicleId!, id, null),
      "23514",
      "opportunities_won_trade_in_stocked",
    );
    const [opportunityRow] = await db.admin`
      SELECT stage FROM public.opportunities WHERE id = ${opportunityId}
    `;
    expect(opportunityRow!.stage).toBe("negotiating");
    const [vehicleRow] = await db.admin`
      SELECT status FROM public.vehicles WHERE id = ${vehicleId}
    `;
    expect(vehicleRow!.status).toBe("available");
    expect((await rowOf(id)).convertedVehicleId).toBeNull();
  });

  it.each(["pending", "appraised", "rejected"] as const)(
    "con la toma %s, ganar no exige ingreso y la toma no se puede convertir",
    async (status) => {
      const { id: opportunityId, vehicleId } = await opportunity(ORG_1);
      const id = await tradeIn(ORG_1, opportunityId, status);
      await expectSqlError(
        winWith(ctxA(), opportunityId, vehicleId!, id),
        "23514",
        "trade_ins_intake",
      );
      // Sin intentar el ingreso, el cierre pasa y la toma queda como estaba.
      const { id: again, vehicleId: unitAgain } = await opportunity(ORG_1);
      const other = await tradeIn(ORG_1, again, status);
      expect(await winWith(ctxA(), again, unitAgain!, other, null)).toBeNull();
      expect(await rowOf(other)).toMatchObject({
        status,
        convertedVehicleId: null,
      });
    },
  );

  it("el ingreso exige la unidad nueva En preparación, sin precio y con los datos del usado (trade_ins_intake)", async () => {
    for (const intake of [
      { status: "in_preparation", brand: "Nissan" },
      { model: "Yaris" },
      { version: null },
      { year: 2016 },
      { km: 1 },
      { price: "9000.00", currency: "USD" },
    ] satisfies Partial<typeof vehicles.$inferInsert>[]) {
      const { id: opportunityId, vehicleId } = await opportunity(ORG_1);
      const id = await tradeIn(ORG_1, opportunityId, "accepted");
      await expectSqlError(
        winWith(ctxA(), opportunityId, vehicleId!, id, intake),
        "23514",
        "trade_ins_intake",
      );
      expect((await rowOf(id)).convertedVehicleId).toBeNull();
    }
  });

  it("el ingreso exige la oportunidad ganada: en negociación, ni un admin ni el rol dueño la convierten", async () => {
    const { id: opportunityId } = await opportunity(ORG_1);
    const id = await tradeIn(ORG_1, opportunityId, "accepted");
    // La unidad es la correcta: lo que falta es el cierre Ganada.
    const stocked = await stockUnit(ORG_1);
    await expectSqlError(
      update(ctxA(), id, { convertedVehicleId: stocked }),
      "23514",
      "trade_ins_intake",
    );
    await expectRawSqlError(
      asOwner(
        (sql) =>
          sql`UPDATE public.trade_ins SET converted_vehicle_id = ${stocked} WHERE id = ${id}`,
      ),
      "23514",
      "trade_ins_intake",
    );
  });

  it("una unidad nace de a lo sumo una toma, y de la misma organización (FK compuesta)", async () => {
    const { id: first, vehicleId } = await opportunity(ORG_1);
    const firstTradeIn = await tradeIn(ORG_1, first, "accepted");
    const created = await winWith(ctxA(), first, vehicleId!, firstTradeIn);

    const { id: second } = await opportunity(ORG_1, "won");
    const secondTradeIn = await tradeIn(ORG_1, second, "accepted");
    await expectRawSqlError(
      db.admin`UPDATE public.trade_ins SET converted_vehicle_id = ${created} WHERE id = ${secondTradeIn}`,
      "23505",
      "trade_ins_organization_id_converted_vehicle_id_key",
    );
    // Una unidad de otra organización: la FK compuesta no la encuentra.
    const { id: third } = await opportunity(ORG_1, "won");
    const foreign = await stockUnit(ORG_2);
    await expectRawSqlError(
      db.admin`
        INSERT INTO public.trade_ins (organization_id, opportunity_id, brand,
          model, year, status, created_by, converted_vehicle_id, currency,
          offer_price, estimated_repair_cost, appraised_by, appraised_at)
        VALUES (${ORG_1}, ${third}, 'Toyota', 'Vitz', 2015, 'accepted',
          ${USER_C}, ${foreign}, 'USD', 8000, 0, ${USER_A}, now())
      `,
      "23503",
      "trade_ins_converted_vehicle_fk",
    );
  });

  it("el rol dueño tampoco convierte hacia una unidad que no está En preparación; con la ganada y la unidad correcta, sí", async () => {
    const { id: opportunityId } = await opportunity(ORG_1, "won");
    const id = await tradeIn(ORG_1, opportunityId, "accepted");
    const onFloor = await unit(ORG_1, "available");
    await expectRawSqlError(
      asOwner(
        (sql) =>
          sql`UPDATE public.trade_ins SET converted_vehicle_id = ${onFloor} WHERE id = ${id}`,
      ),
      "23514",
      "trade_ins_intake",
    );
    const stocked = await stockUnit(ORG_1);
    await asOwner(
      (sql) =>
        sql`UPDATE public.trade_ins SET converted_vehicle_id = ${stocked} WHERE id = ${id}`,
    );
    expect((await rowOf(id)).convertedVehicleId).toBe(stocked);
  });
});

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.append(name, value);
  return data;
}

const USED = {
  brand: "Toyota",
  model: "Vitz",
  version: "1.3 F",
  year: "2015",
  km: "98.000",
  plate: "abc-123",
} as const;

const OFFER = {
  currency: "USD",
  estimatedRepairCost: "800",
  offerPrice: "8.000",
} as const;

async function redirectOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof mocks.RedirectSignal) return error.path;
    throw error;
  }
  throw new Error("expected a redirect");
}

/** La toma vigente de una oportunidad (sin RLS). */
async function activeOf(
  opportunityId: string,
): Promise<{ id: string } & TradeInRow> {
  const [found] = await db.admin<{ id: string }[]>`
    SELECT id FROM public.trade_ins
    WHERE opportunity_id = ${opportunityId}
      AND status IN ('pending', 'appraised', 'accepted')
  `;
  return { id: found!.id, ...(await rowOf(found!.id)) };
}

describe("Server Actions: requireTenant() → pedido → withTenant() → trade_ins", () => {
  it("seller registra, admin tasa y el cliente aprueba: pendiente → tasado → aprobado, con sus sellos", async () => {
    const { id: opportunityId } = await opportunity(ORG_1);
    const paths = [
      `/opportunities/${opportunityId}`,
      "/opportunities/pipeline",
    ];

    request(USER_C, ORG_1);
    expect(
      await registerTradeIn(null, form({ opportunityId, ...USED })),
    ).toMatchObject({
      status: "registered",
      appraised: false,
      label: "Toyota Vitz 2015",
    });
    expect(mocks.revalidated).toEqual(paths);
    const registered = await activeOf(opportunityId);
    expect(registered).toMatchObject({
      status: "pending",
      createdBy: USER_C,
      offerPrice: null,
    });
    const [used] = await db.admin`
      SELECT brand, model, version, year, km, plate FROM public.trade_ins
      WHERE id = ${registered.id}
    `;
    expect(used).toEqual({
      brand: "Toyota",
      model: "Vitz",
      version: "1.3 F",
      year: 2015,
      km: 98000,
      plate: "ABC 123",
    });

    // El seller no tasa: es del admin (la escritura no llega a la base).
    request(USER_C, ORG_1);
    expect(
      await appraiseTradeIn(
        null,
        form({ tradeInId: registered.id, from: "pending", ...OFFER }),
      ),
    ).toEqual({ status: "requires_admin" });
    expect((await rowOf(registered.id)).status).toBe("pending");

    request(USER_A);
    expect(
      await appraiseTradeIn(
        null,
        form({ tradeInId: registered.id, from: "pending", ...OFFER }),
      ),
    ).toEqual({
      status: "appraised",
      label: "Toyota Vitz 2015",
      offerPriceLabel: "USD 8.000",
    });
    expect(await rowOf(registered.id)).toMatchObject({
      status: "appraised",
      currency: "USD",
      offerPrice: "8000.00",
      estimatedRepairCost: "800.00",
      appraisedBy: USER_A,
    });

    request(USER_C, ORG_1);
    expect(
      await changeTradeInStatus(
        null,
        form({ tradeInId: registered.id, decision: "accept" }),
      ),
    ).toEqual({
      status: "changed",
      decision: "accept",
      to: "accepted",
      label: "Toyota Vitz 2015",
    });
    expect(mocks.revalidated).toEqual(paths);
    expect((await rowOf(registered.id)).status).toBe("accepted");
  });

  it("un admin registra y tasa en el mismo acto", async () => {
    const { id: opportunityId } = await opportunity(ORG_1, "qualifying");
    request(USER_A);
    expect(
      await registerTradeIn(null, form({ opportunityId, ...USED, ...OFFER })),
    ).toMatchObject({ status: "registered", appraised: true });
    expect(await activeOf(opportunityId)).toMatchObject({
      status: "appraised",
      createdBy: USER_A,
      appraisedBy: USER_A,
      offerPrice: "8000.00",
    });
  });

  it("un seller no puede colar la tasación en el alta: requires_admin y nada se registra", async () => {
    const { id: opportunityId } = await opportunity(ORG_1);
    request(USER_C, ORG_1);
    expect(
      await registerTradeIn(null, form({ opportunityId, ...USED, ...OFFER })),
    ).toMatchObject({ status: "requires_admin" });
    const [{ count } = { count: -1 }] = await db.admin<{ count: number }[]>`
      SELECT count(*)::int AS count FROM public.trade_ins
      WHERE opportunity_id = ${opportunityId}
    `;
    expect(count).toBe(0);
  });

  it("aceptar sin tasar es offer_price_required; con una vigente no se registra otra; cerrada, nada cambia", async () => {
    const { id: opportunityId } = await opportunity(ORG_1);
    request(USER_C, ORG_1);
    await registerTradeIn(null, form({ opportunityId, ...USED }));
    const { id } = await activeOf(opportunityId);

    expect(
      await changeTradeInStatus(
        null,
        form({ tradeInId: id, decision: "accept" }),
      ),
    ).toEqual({ status: "offer_price_required" });
    expect(
      await registerTradeIn(null, form({ opportunityId, ...USED })),
    ).toMatchObject({ status: "already_registered" });

    const { id: closed } = await opportunity(ORG_1, "lost");
    const frozen = await tradeIn(ORG_1, closed, "appraised");
    expect(
      await changeTradeInStatus(
        null,
        form({ tradeInId: frozen, decision: "accept" }),
      ),
    ).toEqual({ status: "opportunity_closed" });
    expect(
      await registerTradeIn(null, form({ opportunityId: closed, ...USED })),
    ).toMatchObject({ status: "opportunity_closed" });
    expect((await rowOf(frozen)).status).toBe("appraised");
  });

  it("un pedido viejo no deshace lo que hizo otro: conflict con el estado real", async () => {
    const { id: opportunityId } = await opportunity(ORG_1);
    const id = await tradeIn(ORG_1, opportunityId, "accepted");
    request(USER_C, ORG_1);
    // Vio la toma tasada y pidió "el cliente rechazó": ya estaba aprobada.
    expect(
      await changeTradeInStatus(
        null,
        form({ tradeInId: id, decision: "reject" }),
      ),
    ).toEqual({
      status: "conflict",
      current: "accepted",
      label: "Toyota Vitz 2015",
    });
    request(USER_A);
    expect(
      await appraiseTradeIn(
        null,
        form({ tradeInId: id, from: "appraised", ...OFFER }),
      ),
    ).toEqual({
      status: "conflict",
      current: "accepted",
      label: "Toyota Vitz 2015",
    });
    expect((await rowOf(id)).status).toBe("accepted");
  });

  it("aislamiento: otra organización no ve ni cambia la toma (not_found, sin revelar nada)", async () => {
    const { id: opportunityId } = await opportunity(ORG_1);
    const id = await tradeIn(ORG_1, opportunityId, "appraised");
    request(USER_B);
    expect(
      await changeTradeInStatus(
        null,
        form({ tradeInId: id, decision: "accept" }),
      ),
    ).toEqual({ status: "not_found" });
    expect(
      await appraiseTradeIn(
        null,
        form({ tradeInId: id, from: "appraised", ...OFFER }),
      ),
    ).toEqual({ status: "not_found" });
    expect(
      await registerTradeIn(null, form({ opportunityId, ...USED })),
    ).toEqual({ status: "not_found" });
    expect((await rowOf(id)).status).toBe("appraised");
  });

  it("sin sesión o sin membership activa no llega a la base", async () => {
    const { id: opportunityId } = await opportunity(ORG_1);
    for (const [userId, path] of [
      [null, "/login"],
      [USER_D, "/no-access"],
      [USER_E, "/no-access"],
    ] as const) {
      request(userId);
      expect(
        await redirectOf(
          registerTradeIn(null, form({ opportunityId, ...USED })),
        ),
      ).toBe(path);
    }
    const [{ count } = { count: -1 }] = await db.admin<{ count: number }[]>`
      SELECT count(*)::int AS count FROM public.trade_ins
      WHERE opportunity_id = ${opportunityId}
    `;
    expect(count).toBe(0);
  });

  it("dos altas simultáneas dejan una sola toma vigente", async () => {
    const { id: opportunityId } = await opportunity(ORG_1);
    request(USER_A);
    const results = await Promise.all([
      registerTradeIn(null, form({ opportunityId, ...USED })),
      registerTradeIn(null, form({ opportunityId, ...USED, plate: "XYZ 999" })),
    ]);
    expect(results.map((result) => result?.status).sort()).toEqual([
      "already_registered",
      "registered",
    ]);
    const [{ count } = { count: -1 }] = await db.admin<{ count: number }[]>`
      SELECT count(*)::int AS count FROM public.trade_ins
      WHERE opportunity_id = ${opportunityId}
    `;
    expect(count).toBe(1);
  });
});

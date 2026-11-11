import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { writeVehiclePrice } from "@/db/queries/change-vehicle-status";
import { getCockpitMetrics } from "@/db/queries/cockpit-metrics";
import { deleteDelivery } from "@/db/queries/deliveries-write";
import { writeTradeInDecision } from "@/db/queries/trade-ins-write";
import { getStockList } from "@/db/queries/vehicles";
import { deliveries, tradeIns, vehicles } from "@/db/schema";
import { withTenant, type TenantContext } from "@/db/tenant";
import { cancelDelivery, scheduleDelivery } from "@/lib/deliveries/actions";
import { ACTIVE_ORGANIZATION_COOKIE } from "@/lib/tenant/cookie";
import { resolveTenant } from "@/lib/tenant/resolution";
import { appraiseTradeIn, changeTradeInStatus } from "@/lib/trade-ins/actions";
import { changeVehiclePrice } from "@/lib/vehicles/actions";

import { cookieJar, type CookieJar } from "../unit/support/cookie-jar";
import { closureColumns } from "./support/closures";
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
} from "./support/tenants";

/*
 * Seguridad y roles (Hito 22, DEC-054) contra PostgreSQL con las
 * migraciones aplicadas (0023_security_roles). El bloqueo existe en las
 * dos capas:
 *
 *   la base sola, por el boundary real (withTenant() como app_runtime →
 *   authenticated) y con el rol dueño: los triggers de trade_ins y
 *   vehicles exigen un admin de la organización para aprobar una toma y
 *   para cambiar un precio, y la policy de DELETE de deliveries solo deja
 *   anular una pendiente a un admin (el trigger conserva las completadas
 *   también para el dueño);
 *
 *   las Server Actions por el boundary completo: un `seller` recibe
 *   UNAUTHORIZED_ROLE y nada cambia; un `admin`, sí. Un contexto que dice
 *   admin sin serlo en la base (un bug de resolución) choca igual contra
 *   la base.
 *
 * Tenants (support/tenants.ts): A: admin de ORG_1 · B: admin de ORG_2 · C:
 * seller de ORG_1 (y admin de ORG_3).
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

const ctxA = (): TenantContext => tenantContext(USER_A, ORG_1);
const ctxB = (): TenantContext => tenantContext(USER_B, ORG_2);
const ctxC = (): TenantContext => tenantContext(USER_C, ORG_1);

/**
 * C (seller en ORG_1) con un contexto que dice `admin`: lo que dejaría un
 * bug en la resolución del tenant. La base no le cree: lee el rol de la
 * membership.
 */
function forgedAdminC(): TenantContext {
  const resolution = resolveTenant(
    { userId: USER_C, claims: { sub: USER_C, role: "authenticated" } },
    [
      {
        organizationId: ORG_1,
        organizationName: "Organización",
        role: "admin",
      },
    ],
    undefined,
  );
  if (resolution.kind !== "resolved") throw new Error("unresolved tenant");
  return resolution.context;
}

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

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.append(name, value);
  return data;
}

type DbVehicleStatus =
  "in_preparation" | "available" | "reserved" | "sold" | "delivered";

let sequence = 0;

async function unit(
  organizationId: string,
  status: DbVehicleStatus,
): Promise<string> {
  sequence += 1;
  const id = randomUUID();
  await db.admin`
    INSERT INTO public.vehicles (id, organization_id, brand, model, version,
      year, km, price, currency, status)
    VALUES (${id}, ${organizationId}, 'Toyota', 'Hilux',
      ${`Prueba Hito 22 ${sequence}`}, 2025, 0, 49900, 'USD', ${status})
  `;
  return id;
}

async function opportunity(
  organizationId: string,
  stage: "negotiating" | "won",
  unitStatus?: DbVehicleStatus,
): Promise<{ id: string; vehicleId: string }> {
  sequence += 1;
  const contactId = randomUUID();
  const id = randomUUID();
  const vehicleId = await unit(
    organizationId,
    unitStatus ?? (stage === "won" ? "sold" : "available"),
  );
  await db.admin`
    INSERT INTO public.contacts (id, organization_id, name)
    VALUES (${contactId}, ${organizationId}, ${`Cliente Hito 22 ${sequence}`})
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

/** Una toma tasada (lista para aprobar) de una oportunidad abierta. */
async function appraisedTradeIn(organizationId: string): Promise<string> {
  const { id: opportunityId } = await opportunity(
    organizationId,
    "negotiating",
  );
  const id = randomUUID();
  await db.admin`
    INSERT INTO public.trade_ins ${db.admin({
      id,
      organization_id: organizationId,
      opportunity_id: opportunityId,
      brand: "Toyota",
      model: "Vitz",
      version: "1.3 F",
      year: 2015,
      km: 98000,
      plate: "ABC 123",
      status: "appraised",
      created_by: USER_C,
      currency: "USD",
      offer_price: "8000.00",
      estimated_repair_cost: "800.00",
      appraised_by: USER_A,
      appraised_at: new Date(Date.now() - 3_600_000),
      created_at: new Date(Date.now() - 86_400_000),
      updated_at: new Date(Date.now() - 86_400_000),
    })}
  `;
  return id;
}

async function tradeInStatusOf(id: string): Promise<string> {
  const [row] = await db.admin<{ status: string }[]>`
    SELECT status FROM public.trade_ins WHERE id = ${id}
  `;
  return row!.status;
}

async function priceOf(
  id: string,
): Promise<{ price: string | null; currency: string | null }> {
  const [row] = await db.admin<
    { price: string | null; currency: string | null }[]
  >`
    SELECT price::text AS price, currency FROM public.vehicles WHERE id = ${id}
  `;
  return row!;
}

const VERIFIED = {
  keys: true,
  manuals: true,
  spare_tire: true,
  cleaning: true,
  documents: true,
};
const EMPTY = {
  keys: false,
  manuals: false,
  spare_tire: false,
  cleaning: false,
  documents: false,
};

/** Una entrega de una venta nueva: pendiente o completada (superusuario). */
async function delivery(
  organizationId: string,
  status: "pending" | "completed" = "pending",
): Promise<{ id: string; opportunityId: string; vehicleId: string }> {
  const { id: opportunityId, vehicleId } = await opportunity(
    organizationId,
    "won",
    status === "completed" ? "delivered" : "sold",
  );
  const id = randomUUID();
  await db.admin`
    INSERT INTO public.deliveries ${db.admin({
      id,
      organization_id: organizationId,
      opportunity_id: opportunityId,
      vehicle_id: vehicleId,
      scheduled_at: new Date(Date.now() + 86_400_000),
      checklist: db.admin.json(
        status === "completed" ? VERIFIED : EMPTY,
      ) as unknown as string,
      status,
      created_by: USER_C,
      completed_by: status === "completed" ? USER_A : null,
      completed_at: status === "completed" ? new Date() : null,
    })}
  `;
  return { id, opportunityId, vehicleId };
}

async function deliveryExists(id: string): Promise<boolean> {
  const [row] = await db.admin<{ count: number }[]>`
    SELECT count(*)::int AS count FROM public.deliveries WHERE id = ${id}
  `;
  return row!.count === 1;
}

function directDelete(ctx: TenantContext, id: string) {
  return withTenant(ctx, (tx) =>
    tx
      .delete(deliveries)
      .where(eq(deliveries.id, id))
      .returning({ id: deliveries.id }),
  );
}

describe("la base: aprobar una toma es del admin (trade_ins_acceptance_requires_admin)", () => {
  it("un seller (C) no aprueba: 23514 y la toma sigue tasada", async () => {
    const id = await appraisedTradeIn(ORG_1);
    await expectSqlError(
      withTenant(ctxC(), (tx) =>
        tx
          .update(tradeIns)
          .set({ status: "accepted" })
          .where(eq(tradeIns.id, id)),
      ),
      "23514",
      "trade_ins_acceptance_requires_admin",
    );
    expect(await tradeInStatusOf(id)).toBe("appraised");
  });

  it("el seller sí rechaza: solo la aprobación es de la gerencia", async () => {
    const id = await appraisedTradeIn(ORG_1);
    await withTenant(ctxC(), (tx) =>
      tx
        .update(tradeIns)
        .set({ status: "rejected" })
        .where(eq(tradeIns.id, id)),
    );
    expect(await tradeInStatusOf(id)).toBe("rejected");
  });

  it("un admin (A) aprueba; el rol dueño sin claims, no", async () => {
    const id = await appraisedTradeIn(ORG_1);
    await withTenant(ctxA(), (tx) =>
      tx
        .update(tradeIns)
        .set({ status: "accepted" })
        .where(eq(tradeIns.id, id)),
    );
    expect(await tradeInStatusOf(id)).toBe("accepted");

    const other = await appraisedTradeIn(ORG_1);
    await expect(
      asOwner(
        (sql) =>
          sql`UPDATE public.trade_ins SET status = 'accepted' WHERE id = ${other}`,
      ),
    ).rejects.toMatchObject({
      code: "23514",
      constraint_name: "trade_ins_acceptance_requires_admin",
    });
    expect(await tradeInStatusOf(other)).toBe("appraised");
  });

  it("un contexto que dice admin sin serlo en la base tampoco aprueba", async () => {
    const id = await appraisedTradeIn(ORG_1);
    expect(
      await writeTradeInDecision(
        forgedAdminC(),
        { tradeInId: id, decision: "accept" },
        { isAdmin: true },
      ),
    ).toMatchObject({ outcome: "requires_admin" });
    expect(await tradeInStatusOf(id)).toBe("appraised");
  });
});

describe("la base: el precio publicado es del admin (trigger vehicles_status_transition)", () => {
  it("un seller (C) no cambia el precio: 23514 vehicles_price_requires_admin", async () => {
    const id = await unit(ORG_1, "available");
    await expectSqlError(
      withTenant(ctxC(), (tx) =>
        tx
          .update(vehicles)
          .set({ price: "1.00", currency: "USD" })
          .where(eq(vehicles.id, id)),
      ),
      "23514",
      "vehicles_price_requires_admin",
    );
    expect(await priceOf(id)).toEqual({ price: "49900.00", currency: "USD" });
  });

  it("un admin (A) lo cambia en preparación, disponible o reservada; nunca vendida ni entregada", async () => {
    for (const status of ["in_preparation", "available", "reserved"] as const) {
      const id = await unit(ORG_1, status);
      await withTenant(ctxA(), (tx) =>
        tx
          .update(vehicles)
          .set({ price: "150000000.00", currency: "PYG" })
          .where(eq(vehicles.id, id)),
      );
      expect(await priceOf(id)).toEqual({
        price: "150000000.00",
        currency: "PYG",
      });
    }
    for (const status of ["sold", "delivered"] as const) {
      const id = await unit(ORG_1, status);
      await expectSqlError(
        withTenant(ctxA(), (tx) =>
          tx.update(vehicles).set({ price: "1.00" }).where(eq(vehicles.id, id)),
        ),
        "23514",
        "vehicles_price_locked",
      );
    }
  });

  it("ni junto con un cambio de estado, ni borrando el precio, ni en PYG con decimales", async () => {
    const id = await unit(ORG_1, "available");
    await expectSqlError(
      withTenant(ctxA(), (tx) =>
        tx
          .update(vehicles)
          .set({ price: "1.00", status: "reserved" })
          .where(eq(vehicles.id, id)),
      ),
      "23514",
      "vehicles_immutable",
    );
    await expectSqlError(
      withTenant(ctxA(), (tx) =>
        tx
          .update(vehicles)
          .set({ price: null, currency: null })
          .where(eq(vehicles.id, id)),
      ),
      "23514",
      "vehicles_price_required",
    );
    await expectSqlError(
      withTenant(ctxA(), (tx) =>
        tx
          .update(vehicles)
          .set({ price: "1000.50", currency: "PYG" })
          .where(eq(vehicles.id, id)),
      ),
      "23514",
      "vehicles_price_check",
    );
    expect(await priceOf(id)).toEqual({ price: "49900.00", currency: "USD" });
  });

  it("el resto de la unidad sigue sin grant (42501), otra organización no la ve y el rol dueño no cambia precios", async () => {
    const id = await unit(ORG_1, "available");
    await expectSqlError(
      withTenant(ctxA(), (tx) =>
        tx.update(vehicles).set({ brand: "Otra" }).where(eq(vehicles.id, id)),
      ),
      "42501",
    );
    expect(
      await withTenant(ctxB(), (tx) =>
        tx
          .update(vehicles)
          .set({ price: "1.00" })
          .where(eq(vehicles.id, id))
          .returning({ id: vehicles.id }),
      ),
    ).toEqual([]);
    await expect(
      asOwner(
        (sql) => sql`UPDATE public.vehicles SET price = 1 WHERE id = ${id}`,
      ),
    ).rejects.toMatchObject({
      code: "23514",
      constraint_name: "vehicles_price_requires_admin",
    });
    expect(await priceOf(id)).toEqual({ price: "49900.00", currency: "USD" });
  });

  it("un contexto que dice admin sin serlo en la base: unauthorized_role y nada cambia", async () => {
    const id = await unit(ORG_1, "available");
    expect(
      await writeVehiclePrice(forgedAdminC(), {
        vehicleId: id,
        price: { amount: "1.00", currency: "USD" },
      }),
    ).toEqual({ outcome: "unauthorized_role" });
    expect(await priceOf(id)).toEqual({ price: "49900.00", currency: "USD" });
  });
});

describe("la base: anular una entrega es del admin y solo una pendiente (DELETE de deliveries)", () => {
  it("un seller (C) no borra: la policy filtra el DELETE (0 filas) y la entrega queda", async () => {
    const { id } = await delivery(ORG_1);
    expect(await directDelete(ctxC(), id)).toEqual([]);
    expect(await deliveryExists(id)).toBe(true);
  });

  it("un admin (A) anula una pendiente; una completada, no (0 filas)", async () => {
    const pending = await delivery(ORG_1);
    expect(await directDelete(ctxA(), pending.id)).toEqual([
      { id: pending.id },
    ]);
    expect(await deliveryExists(pending.id)).toBe(false);

    const completed = await delivery(ORG_1, "completed");
    expect(await directDelete(ctxA(), completed.id)).toEqual([]);
    expect(await deliveryExists(completed.id)).toBe(true);
  });

  it("el admin de otra organización no la ve ni la borra; el rol dueño no borra una completada", async () => {
    const { id } = await delivery(ORG_1);
    expect(await directDelete(ctxB(), id)).toEqual([]);
    expect(await deliveryExists(id)).toBe(true);

    const completed = await delivery(ORG_1, "completed");
    await expect(
      asOwner(
        (sql) => sql`DELETE FROM public.deliveries WHERE id = ${completed.id}`,
      ),
    ).rejects.toMatchObject({
      code: "23514",
      constraint_name: "deliveries_cancel_requires_pending",
    });
    expect(await deliveryExists(completed.id)).toBe(true);
  });

  it("un contexto que dice admin sin serlo en la base: unauthorized_role y la entrega queda", async () => {
    const { id } = await delivery(ORG_1);
    expect(await deleteDelivery(forgedAdminC(), id)).toMatchObject({
      outcome: "unauthorized_role",
    });
    expect(await deliveryExists(id)).toBe(true);
  });

  it("ninguna otra tabla admite DELETE para authenticated (42501), ni siquiera de un admin", async () => {
    const [privileges] = await db.admin<{ tables: string[] }[]>`
      SELECT array_agg(c.relname ORDER BY c.relname) AS tables
      FROM pg_class c
      WHERE c.relnamespace = 'public'::regnamespace
        AND c.relkind IN ('r', 'p')
        AND has_table_privilege('authenticated', c.oid, 'DELETE')
    `;
    expect(privileges!.tables).toEqual(["deliveries"]);
    const id = await unit(ORG_1, "available");
    await expectSqlError(
      withTenant(ctxA(), (tx) =>
        tx.delete(vehicles).where(eq(vehicles.id, id)),
      ),
      "42501",
    );
    const tradeIn = await appraisedTradeIn(ORG_1);
    await expectSqlError(
      withTenant(ctxA(), (tx) =>
        tx.delete(tradeIns).where(eq(tradeIns.id, tradeIn)),
      ),
      "42501",
    );
  });
});

describe("Server Actions: un seller recibe UNAUTHORIZED_ROLE y nada cambia; un admin, sí", () => {
  it("aprobar una tasación: C (seller) rechazado, A (admin) aprueba", async () => {
    const id = await appraisedTradeIn(ORG_1);
    request(USER_C, ORG_1);
    expect(
      await changeTradeInStatus(
        null,
        form({ tradeInId: id, decision: "accept" }),
      ),
    ).toEqual({
      status: "unauthorized_role",
      code: "UNAUTHORIZED_ROLE",
      capability: "trade_in.approve",
    });
    expect(mocks.revalidated).toEqual([]);
    expect(await tradeInStatusOf(id)).toBe("appraised");

    request(USER_A);
    expect(
      await changeTradeInStatus(
        null,
        form({ tradeInId: id, decision: "accept" }),
      ),
    ).toMatchObject({ status: "changed", to: "accepted" });
    expect(await tradeInStatusOf(id)).toBe("accepted");
  });

  it("tasar: C (seller) rechazado sin tocar la base", async () => {
    const id = await appraisedTradeIn(ORG_1);
    request(USER_C, ORG_1);
    expect(
      await appraiseTradeIn(
        null,
        form({
          tradeInId: id,
          from: "appraised",
          currency: "USD",
          estimatedRepairCost: "100",
          offerPrice: "1",
        }),
      ),
    ).toEqual({
      status: "unauthorized_role",
      code: "UNAUTHORIZED_ROLE",
      capability: "trade_in.appraise",
    });
    const [row] = await db.admin<{ offer: string }[]>`
      SELECT offer_price::text AS offer FROM public.trade_ins WHERE id = ${id}
    `;
    expect(row!.offer).toBe("8000.00");
  });

  it("cambiar el precio: C (seller) rechazado; A (admin) lo cambia y el Inventario lo muestra", async () => {
    const id = await unit(ORG_1, "available");
    const fields = { vehicleId: id, price: "52.500", currency: "USD" };

    request(USER_C, ORG_1);
    expect(await changeVehiclePrice(null, form(fields))).toEqual({
      status: "unauthorized_role",
      code: "UNAUTHORIZED_ROLE",
      capability: "vehicle.edit_price",
    });
    expect(mocks.revalidated).toEqual([]);
    expect(await priceOf(id)).toEqual({ price: "49900.00", currency: "USD" });

    request(USER_A);
    expect(await changeVehiclePrice(null, form(fields))).toMatchObject({
      status: "changed",
      vehicleId: id,
      priceLabel: "USD 52.500",
    });
    expect(mocks.revalidated).toContain("/stock");
    expect(await priceOf(id)).toEqual({ price: "52500.00", currency: "USD" });
    const listed = (await getStockList()).find((vehicle) => vehicle.id === id);
    expect(listed?.price).toEqual({ amount: "52500.00", currency: "USD" });

    // Otra organización no la encuentra (not_found, sin revelar nada).
    request(USER_B);
    expect(await changeVehiclePrice(null, form(fields))).toEqual({
      status: "not_found",
    });
  });

  it("anular una entrega: C (seller) rechazado; A (admin) la anula y se puede programar otra", async () => {
    const { id, opportunityId } = await delivery(ORG_1);

    request(USER_C, ORG_1);
    expect(await cancelDelivery(null, form({ deliveryId: id }))).toEqual({
      status: "unauthorized_role",
      code: "UNAUTHORIZED_ROLE",
      capability: "delivery.cancel",
    });
    expect(await deliveryExists(id)).toBe(true);

    request(USER_A);
    expect(await cancelDelivery(null, form({ deliveryId: id }))).toEqual({
      status: "cancelled",
    });
    expect(await deliveryExists(id)).toBe(false);
    expect(mocks.revalidated).toContain(`/opportunities/${opportunityId}`);

    const tomorrow = new Date(Date.now() + 2 * 86_400_000);
    const local = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "America/Asuncion",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(tomorrow);
    expect(
      await scheduleDelivery(
        null,
        form({ opportunityId, scheduledAt: `${local}T10:00` }),
      ),
    ).toEqual({ status: "scheduled" });

    const completed = await delivery(ORG_1, "completed");
    expect(
      await cancelDelivery(null, form({ deliveryId: completed.id })),
    ).toEqual({ status: "already_completed" });
    expect(await deliveryExists(completed.id)).toBe(true);
  });

  it("las Métricas del salón: C (seller) restringido, A (admin) las lee", async () => {
    request(USER_C, ORG_1);
    expect(await getCockpitMetrics({})).toEqual({ kind: "restricted" });
    request(USER_A);
    expect(await getCockpitMetrics({})).toMatchObject({ kind: "ready" });
  });
});

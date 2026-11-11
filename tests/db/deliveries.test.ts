import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { getOpportunityDetail } from "@/db/queries/opportunity-detail";
import { getStockCatalog } from "@/db/queries/stock-catalog";
import { getStockList } from "@/db/queries/vehicles";
import { deliveries, vehicles } from "@/db/schema";
import { withTenant, type TenantContext } from "@/db/tenant";
import {
  DELIVERY_CHECKLIST_ITEMS,
  type DeliveryChecklistItem,
} from "@/domains/opportunities/deliveries";
import {
  completeDelivery,
  rescheduleDelivery,
  scheduleDelivery,
  setDeliveryChecklistItem,
} from "@/lib/deliveries/actions";
import { ACTIVE_ORGANIZATION_COOKIE } from "@/lib/tenant/cookie";
import { VEHICLE_LIFECYCLE_PATHS } from "@/lib/vehicles/paths";

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
  USER_D,
  USER_E,
} from "./support/tenants";

/*
 * Logística y entregas (Hito 21, DEC-053) contra PostgreSQL 17 con las
 * migraciones aplicadas. Primero la base sola, por el boundary real
 * (withTenant() como app_runtime → authenticated, con escrituras directas
 * que no pasan por el dominio) y con el rol dueño, que los triggers no
 * eximen:
 *
 *   RLS (lectura y alta pendiente de la unidad vendida de una ganada) →
 *   grants por columna → trigger deliveries_change_guard (matriz,
 *   inmutabilidad, checklist entero, usuario y unidad vendida) → CHECKs →
 *   trigger de vehicles (sold → delivered solo con la entrega completada) →
 *   constraint trigger diferido deliveries_completed_vehicle_delivered
 *
 * Después, las Server Actions por el boundary completo: programar, tildar,
 * reprogramar y completeDelivery(), que completa la entrega y da salida a
 * la unidad en una sola transacción, o no escribe nada; el aislamiento
 * entre organizaciones y las carreras reales.
 *
 * Tenants (support/tenants.ts): A: admin de ORG_1 · B: admin de ORG_2 · C:
 * seller de ORG_1 y admin de ORG_3 · D: seller inactivo de ORG_1 · E: sin
 * memberships.
 *
 * Cada caso usa sus propias oportunidades, unidades y entregas (insertadas
 * con el superusuario en el estado que necesita) para no depender del orden.
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
type DbVehicleStatus =
  "in_preparation" | "available" | "reserved" | "sold" | "delivered";

/** El checklist como lo guarda la base. */
type DbChecklist = Record<
  "keys" | "manuals" | "spare_tire" | "cleaning" | "documents",
  boolean
>;

const EMPTY: DbChecklist = {
  keys: false,
  manuals: false,
  spare_tire: false,
  cleaning: false,
  documents: false,
};

const VERIFIED: DbChecklist = {
  keys: true,
  manuals: true,
  spare_tire: true,
  cleaning: true,
  documents: true,
};

let sequence = 0;

/** Una unidad propia del caso (superusuario). */
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
      ${`Prueba Hito 21 ${sequence}`}, 2025, 0, 49900, 'USD', ${status})
  `;
  return id;
}

/**
 * Una oportunidad propia del caso en `stage`, con su unidad vinculada:
 * vendida si está ganada, disponible si no (como la deja la aplicación);
 * `unitStatus` fuerza otro estado.
 */
async function opportunity(
  organizationId: string,
  stage: StageName = "won",
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
    VALUES (${contactId}, ${organizationId}, ${`Cliente entrega ${sequence}`})
  `;
  await db.admin`
    INSERT INTO public.opportunities ${db.admin({
      id,
      organization_id: organizationId,
      contact_id: contactId,
      stage: stage === "new" || stage === "qualifying" ? "negotiating" : stage,
      source: "showroom",
      vehicle_id: vehicleId,
      ...closureColumns(stage),
    })}
  `;
  return { id, vehicleId };
}

/**
 * Una entrega de una venta nueva, escrita por el superusuario (un INSERT
 * no pasa por el trigger de UPDATE): pendiente con `checklist`, o
 * completada con todo verificado y el sello de A.
 */
async function delivery(
  organizationId: string,
  options: {
    checklist?: DbChecklist;
    status?: "pending" | "completed";
  } = {},
): Promise<{ id: string; opportunityId: string; vehicleId: string }> {
  const status = options.status ?? "pending";
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
        status === "completed" ? VERIFIED : (options.checklist ?? EMPTY),
      ) as unknown as string,
      status,
      created_by: USER_C,
      completed_by: status === "completed" ? USER_A : null,
      completed_at: status === "completed" ? new Date() : null,
      created_at: new Date(Date.now() - 86_400_000),
      updated_at: new Date(Date.now() - 86_400_000),
    })}
  `;
  return { id, opportunityId, vehicleId };
}

type DeliveryRow = {
  status: "pending" | "completed";
  checklist: DbChecklist;
  scheduledAt: Date;
  completedAt: Date | null;
  completedBy: string | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
};

/** La fila tal como está en la base (sin RLS). */
async function rowOf(id: string): Promise<DeliveryRow> {
  const [row] = await db.admin<DeliveryRow[]>`
    SELECT status, checklist, scheduled_at AS "scheduledAt",
      completed_at AS "completedAt", completed_by AS "completedBy",
      created_by AS "createdBy", created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM public.deliveries WHERE id = ${id}
  `;
  return row!;
}

async function vehicleStatusOf(id: string): Promise<DbVehicleStatus> {
  const [row] = await db.admin<{ status: DbVehicleStatus }[]>`
    SELECT status FROM public.vehicles WHERE id = ${id}
  `;
  return row!.status;
}

async function deliveriesOf(opportunityId: string): Promise<number> {
  const [row] = await db.admin<{ count: number }[]>`
    SELECT count(*)::int AS count FROM public.deliveries
    WHERE opportunity_id = ${opportunityId}
  `;
  return row!.count;
}

/** Alta por el boundary, como la hace la capa de escritura. */
function insertDelivery(
  ctx: TenantContext,
  target: { opportunityId: string; vehicleId: string },
  overrides: Partial<typeof deliveries.$inferInsert> = {},
) {
  return withTenant(ctx, (tx) =>
    tx
      .insert(deliveries)
      .values({
        organizationId: ctx.organizationId,
        opportunityId: target.opportunityId,
        vehicleId: target.vehicleId,
        scheduledAt: new Date(Date.now() + 86_400_000),
        createdBy: ctx.userId,
        ...overrides,
      })
      .returning({ id: deliveries.id }),
  ).then((rows) => rows[0]!);
}

/** UPDATE directo por el boundary, solo por id (sin el dominio). */
function update(
  ctx: TenantContext,
  id: string,
  set: Partial<typeof deliveries.$inferInsert>,
) {
  return withTenant(ctx, (tx) =>
    tx
      .update(deliveries)
      .set(set)
      .where(eq(deliveries.id, id))
      .returning({ id: deliveries.id }),
  );
}

/** El rol dueño (postgres), fuera del boundary: los triggers no lo eximen. */
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

describe("RLS de deliveries: lectura y alta pendiente de la unidad vendida de una ganada", () => {
  it("admin (A) y seller (C) programan la entrega de una venta: nace pendiente, sin nada verificado, con su autor y el reloj de la base", async () => {
    for (const ctx of [ctxA(), ctxC()]) {
      const target = await opportunity(ORG_1);
      const { id } = await insertDelivery(ctx, {
        opportunityId: target.id,
        vehicleId: target.vehicleId,
      });
      const row = await rowOf(id);
      expect(row).toMatchObject({
        status: "pending",
        checklist: EMPTY,
        completedAt: null,
        completedBy: null,
        createdBy: ctx.userId,
      });
      expect(Math.abs(row.createdAt.getTime() - Date.now())).toBeLessThan(
        60_000,
      );
      // La unidad no cambia al programar: sigue vendida en el salón.
      expect(await vehicleStatusOf(target.vehicleId)).toBe("sold");
    }
  });

  it.each([
    ["una oportunidad en negociación", "negotiating", undefined],
    ["una oportunidad perdida", "lost", undefined],
    ["una ganada con la unidad todavía disponible", "won", "available"],
    ["una ganada con la unidad ya entregada", "won", "delivered"],
  ] as const)(
    "no se programa la entrega de %s (42501, RLS)",
    async (_, stage, unitStatus) => {
      const target = await opportunity(ORG_1, stage, unitStatus);
      await expectSqlError(
        insertDelivery(ctxA(), {
          opportunityId: target.id,
          vehicleId: target.vehicleId,
        }),
        "42501",
      );
      expect(await deliveriesOf(target.id)).toBe(0);
    },
  );

  it("no se programa con otra unidad que la vendida, otro autor, otro estado, el checklist verificado, un sello ni otro reloj (42501)", async () => {
    const target = await opportunity(ORG_1);
    const other = await unit(ORG_1, "sold");
    const base = { opportunityId: target.id, vehicleId: target.vehicleId };
    for (const [values, overrides] of [
      [{ ...base, vehicleId: other }, {}],
      [base, { createdBy: USER_C }],
      [base, { status: "completed" as const }],
      [base, { checklist: VERIFIED }],
      [base, { completedAt: new Date(), completedBy: USER_A }],
      [base, { createdAt: new Date(Date.now() - 86_400_000) }],
    ] as const) {
      await expectSqlError(insertDelivery(ctxA(), values, overrides), "42501");
    }
    expect(await deliveriesOf(target.id)).toBe(0);
  });

  it("aislamiento: otra organización no ve, no programa ni cambia la entrega", async () => {
    const own = await delivery(ORG_1);
    const foreign = await opportunity(ORG_1);
    // B (admin de ORG_2) no lee la entrega de ORG_1…
    const seen = await withTenant(ctxB(), (tx) =>
      tx.select({ id: deliveries.id }).from(deliveries),
    );
    expect(seen.map((row) => row.id)).not.toContain(own.id);
    // …no la cambia (RLS: cero filas)…
    expect(await update(ctxB(), own.id, { checklist: VERIFIED })).toEqual([]);
    expect((await rowOf(own.id)).checklist).toEqual(EMPTY);
    // …ni programa la de una venta de ORG_1, aunque diga ser de ORG_2 (la
    // FK compuesta) o de ORG_1 (RLS).
    await expectSqlError(
      insertDelivery(
        ctxB(),
        { opportunityId: foreign.id, vehicleId: foreign.vehicleId },
        { organizationId: ORG_1 },
      ),
      "42501",
    );
    expect(await deliveriesOf(foreign.id)).toBe(0);
  });

  it("una sola entrega por venta y por unidad (23505)", async () => {
    const own = await delivery(ORG_1);
    await expectSqlError(
      insertDelivery(ctxA(), {
        opportunityId: own.opportunityId,
        vehicleId: own.vehicleId,
      }),
      "23505",
      "deliveries_organization_id_opportunity_id_key",
    );
    expect(await deliveriesOf(own.opportunityId)).toBe(1);
  });

  it("sin DELETE y sin UPDATE de otras columnas para authenticated (42501)", async () => {
    const own = await delivery(ORG_1);
    await expectSqlError(
      withTenant(ctxA(), (tx) =>
        tx.delete(deliveries).where(eq(deliveries.id, own.id)),
      ),
      "42501",
    );
    for (const set of [
      { completedAt: new Date() },
      { completedBy: USER_A },
      { vehicleId: own.vehicleId },
      { createdBy: USER_A },
    ]) {
      await expectSqlError(update(ctxA(), own.id, set), "42501");
    }
    expect(await rowOf(own.id)).toMatchObject({
      status: "pending",
      completedAt: null,
    });
  });
});

describe("la base exige la entrega (trigger deliveries_change_guard y CHECKs)", () => {
  it("tildar y reprogramar una pendiente: el trigger fija updated_at con el reloj de la base", async () => {
    const own = await delivery(ORG_1);
    const before = await rowOf(own.id);
    await update(ctxC(), own.id, {
      checklist: { ...EMPTY, keys: true },
    });
    const later = new Date(Date.now() + 3 * 86_400_000);
    await update(ctxC(), own.id, { scheduledAt: later });
    const after = await rowOf(own.id);
    expect(after).toMatchObject({
      status: "pending",
      checklist: { ...EMPTY, keys: true },
      scheduledAt: later,
    });
    expect(after.updatedAt.getTime()).toBeGreaterThan(
      before.updatedAt.getTime(),
    );
  });

  it("un UPDATE que no cambia nada no es un pase: deliveries_status_transition", async () => {
    const own = await delivery(ORG_1);
    await expectSqlError(
      update(ctxA(), own.id, { status: "pending" }),
      "23514",
      "deliveries_status_transition",
    );
  });

  it("la regla del fundador: no se completa sin el checklist entero verificado (deliveries_checklist_incomplete)", async () => {
    const own = await delivery(ORG_1, {
      checklist: { ...VERIFIED, documents: false },
    });
    await expectSqlError(
      update(ctxA(), own.id, { status: "completed" }),
      "23514",
      "deliveries_checklist_incomplete",
    );
    expect((await rowOf(own.id)).status).toBe("pending");
    expect(await vehicleStatusOf(own.vehicleId)).toBe("sold");
  });

  it("completar solo con la unidad todavía vendida (deliveries_vehicle_not_sold)", async () => {
    const own = await delivery(ORG_1, { checklist: VERIFIED });
    // Un superusuario la dejó en otro estado: la base no completa.
    await db.admin.begin(async (tx) => {
      await tx`ALTER TABLE public.vehicles DISABLE TRIGGER vehicles_status_transition`;
      await tx`UPDATE public.vehicles SET status = 'reserved' WHERE id = ${own.vehicleId}`;
      await tx`ALTER TABLE public.vehicles ENABLE TRIGGER vehicles_status_transition`;
    });
    await expectSqlError(
      update(ctxA(), own.id, { status: "completed" }),
      "23514",
      "deliveries_vehicle_not_sold",
    );
    expect((await rowOf(own.id)).status).toBe("pending");
  });

  it("completar sin dar salida a la unidad revierte la transacción entera al COMMIT (deliveries_completed_vehicle_delivered)", async () => {
    const own = await delivery(ORG_1, { checklist: VERIFIED });
    // Al COMMIT, el error del driver llega sin el envoltorio de Drizzle.
    await expectRawSqlError(
      update(ctxA(), own.id, { status: "completed" }),
      "23514",
      "deliveries_completed_vehicle_delivered",
    );
    expect(await rowOf(own.id)).toMatchObject({
      status: "pending",
      completedAt: null,
      completedBy: null,
    });
    expect(await vehicleStatusOf(own.vehicleId)).toBe("sold");
  });

  it("la entrega y la salida en la misma transacción: completada con el sello del usuario y la unidad Entregada", async () => {
    const own = await delivery(ORG_1, { checklist: VERIFIED });
    await withTenant(ctxC(), async (tx) => {
      await tx
        .update(deliveries)
        .set({ status: "completed" })
        .where(eq(deliveries.id, own.id));
      await tx
        .update(vehicles)
        .set({ status: "delivered" })
        .where(eq(vehicles.id, own.vehicleId));
    });
    const row = await rowOf(own.id);
    expect(row).toMatchObject({ status: "completed", completedBy: USER_C });
    expect(Math.abs(row.completedAt!.getTime() - Date.now())).toBeLessThan(
      60_000,
    );
    expect(await vehicleStatusOf(own.vehicleId)).toBe("delivered");
  });

  it("una entrega completada no cambia más (deliveries_completed), tampoco para el rol dueño", async () => {
    const own = await delivery(ORG_1, { status: "completed" });
    const before = await rowOf(own.id);
    await expectSqlError(
      update(ctxA(), own.id, { checklist: EMPTY }),
      "23514",
      "deliveries_completed",
    );
    await expectRawSqlError(
      asOwner(
        (sql) =>
          sql`UPDATE public.deliveries SET status = 'pending', completed_at = NULL, completed_by = NULL WHERE id = ${own.id}`,
      ),
      "23514",
      "deliveries_immutable",
    );
    await expectRawSqlError(
      asOwner(
        (sql) =>
          sql`UPDATE public.deliveries SET scheduled_at = now() WHERE id = ${own.id}`,
      ),
      "23514",
      "deliveries_completed",
    );
    expect(await rowOf(own.id)).toEqual(before);
  });

  it("el rol dueño no cambia la venta, la unidad, el autor ni el sello (deliveries_immutable), ni completa sin usuario (deliveries_completion_requires_user)", async () => {
    const own = await delivery(ORG_1, { checklist: VERIFIED });
    const other = await opportunity(ORG_1);
    for (const statement of [
      `UPDATE public.deliveries SET opportunity_id = '${other.id}' WHERE id = $1`,
      `UPDATE public.deliveries SET vehicle_id = '${other.vehicleId}' WHERE id = $1`,
      `UPDATE public.deliveries SET created_by = '${USER_A}' WHERE id = $1`,
      "UPDATE public.deliveries SET created_at = now() WHERE id = $1",
      `UPDATE public.deliveries SET completed_by = '${USER_A}', completed_at = now(), status = 'completed' WHERE id = $1`,
    ]) {
      await expectRawSqlError(
        asOwner((sql) => sql.unsafe(statement, [own.id])),
        "23514",
        "deliveries_immutable",
      );
    }
    await expectRawSqlError(
      asOwner(
        (sql) =>
          sql`UPDATE public.deliveries SET status = 'completed' WHERE id = ${own.id}`,
      ),
      "23514",
      "deliveries_completion_requires_user",
    );
    expect((await rowOf(own.id)).status).toBe("pending");
  });

  it("el checklist tiene exactamente los cinco ítems booleanos (deliveries_checklist_check)", async () => {
    const own = await delivery(ORG_1);
    for (const checklist of [
      { ...EMPTY, extra: true },
      { keys: true },
      { ...EMPTY, keys: "yes" },
    ]) {
      await expectSqlError(
        update(ctxA(), own.id, {
          checklist: checklist as unknown as DbChecklist,
        }),
        "23514",
        "deliveries_checklist_check",
      );
    }
    expect((await rowOf(own.id)).checklist).toEqual(EMPTY);
  });
});

describe("la unidad sale del salón solo con su entrega completada (trigger vehicles_status_transition)", () => {
  it("sold → delivered sin la entrega completada: vehicles_delivery_requires_completed, también para el rol dueño", async () => {
    // Con la entrega pendiente…
    const pending = await delivery(ORG_1, { checklist: VERIFIED });
    // …y sin entrega.
    const { vehicleId: undelivered } = await opportunity(ORG_1);
    for (const vehicleId of [pending.vehicleId, undelivered]) {
      await expectSqlError(
        withTenant(ctxA(), (tx) =>
          tx
            .update(vehicles)
            .set({ status: "delivered" })
            .where(eq(vehicles.id, vehicleId)),
        ),
        "23514",
        "vehicles_delivery_requires_completed",
      );
      await expectRawSqlError(
        asOwner(
          (sql) =>
            sql`UPDATE public.vehicles SET status = 'delivered' WHERE id = ${vehicleId}`,
        ),
        "23514",
        "vehicles_delivery_requires_completed",
      );
      expect(await vehicleStatusOf(vehicleId)).toBe("sold");
    }
  });

  it("delivered es terminal y solo se llega desde sold (vehicles_status_transition)", async () => {
    const done = await delivery(ORG_1, { status: "completed" });
    for (const status of ["in_preparation", "available", "reserved", "sold"]) {
      await expectRawSqlError(
        asOwner(
          (sql) =>
            sql`UPDATE public.vehicles SET status = ${status} WHERE id = ${done.vehicleId}`,
        ),
        "23514",
        "vehicles_status_transition",
      );
    }
    const available = await unit(ORG_1, "available");
    await expectRawSqlError(
      asOwner(
        (sql) =>
          sql`UPDATE public.vehicles SET status = 'delivered' WHERE id = ${available}`,
      ),
      "23514",
      "vehicles_status_transition",
    );
    expect(await vehicleStatusOf(done.vehicleId)).toBe("delivered");
  });
});

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.append(name, value);
  return data;
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

/** Pasado mañana a las 10:30, hora de pared de Asunción. */
function inTwoDays(): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Asuncion",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(new Date(Date.now() + 2 * 86_400_000))
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T10:30`;
}

function tick(deliveryId: string, item: DeliveryChecklistItem, checked = true) {
  return setDeliveryChecklistItem(
    null,
    form({ deliveryId, item, checked: String(checked) }),
  );
}

function complete(deliveryId: string) {
  return completeDelivery(null, form({ deliveryId }));
}

describe("Server Actions: programar, tildar el checklist y completar la entrega con la salida de la unidad (DEC-053 §4)", () => {
  it("programar → tildar los cinco ítems → completar: la entrega queda completada con su sello y la unidad Entregada, en una sola transacción", async () => {
    const target = await opportunity(ORG_1);

    // 1. El seller programa la entrega pactada con el cliente.
    request(USER_C, ORG_1);
    expect(
      await scheduleDelivery(
        null,
        form({ opportunityId: target.id, scheduledAt: inTwoDays() }),
      ),
    ).toEqual({ status: "scheduled" });
    expect(mocks.revalidated).toEqual([
      `/opportunities/${target.id}`,
      "/opportunities/pipeline",
    ]);
    const [created] = await db.admin<{ id: string }[]>`
      SELECT id FROM public.deliveries WHERE opportunity_id = ${target.id}
    `;
    const deliveryId = created!.id;
    expect(await rowOf(deliveryId)).toMatchObject({
      status: "pending",
      checklist: EMPTY,
      createdBy: USER_C,
    });

    // 2. Sin el checklist entero, no se completa (la regla del fundador).
    request(USER_C, ORG_1);
    expect(await complete(deliveryId)).toEqual({
      status: "checklist_incomplete",
      missing: [...DELIVERY_CHECKLIST_ITEMS],
    });
    expect(await vehicleStatusOf(target.vehicleId)).toBe("sold");

    // 3. Tilda los cinco ítems, de a uno.
    for (const item of DELIVERY_CHECKLIST_ITEMS) {
      request(USER_C, ORG_1);
      expect(await tick(deliveryId, item)).toMatchObject({ status: "changed" });
    }
    expect((await rowOf(deliveryId)).checklist).toEqual(VERIFIED);
    // Tildar lo que ya está tildado no reescribe nada.
    request(USER_C, ORG_1);
    expect(await tick(deliveryId, "keys")).toMatchObject({
      status: "unchanged",
    });

    // 4. Completa: la entrega y la salida del salón, juntas.
    request(USER_C, ORG_1);
    expect(await complete(deliveryId)).toEqual({
      status: "completed",
      label: "Toyota Hilux 2025",
    });
    const row = await rowOf(deliveryId);
    expect(row).toMatchObject({ status: "completed", completedBy: USER_C });
    expect(row.completedAt).not.toBeNull();
    expect(await vehicleStatusOf(target.vehicleId)).toBe("delivered");
    // Revalida el detalle, el embudo y todas las vistas del stock.
    expect(mocks.revalidated).toEqual([
      `/opportunities/${target.id}`,
      "/opportunities/pipeline",
      ...VEHICLE_LIFECYCLE_PATHS,
    ]);

    // 5. La unidad desapareció del Inventario y del Catálogo del salón…
    request(USER_C, ORG_1);
    expect((await getStockList()).map((v) => v.id)).not.toContain(
      target.vehicleId,
    );
    request(USER_C, ORG_1);
    const catalog = await getStockCatalog();
    expect(JSON.stringify(catalog)).not.toContain(target.vehicleId);
    // …y la oportunidad muestra la entrega completada.
    request(USER_C, ORG_1);
    const detail = await getOpportunityDetail(target.id);
    expect(detail?.delivery).toMatchObject({
      kind: "scheduled",
      delivery: {
        status: "completed",
        statusLabel: "Entregada",
        verified: true,
      },
    });
    expect(detail?.vehicleLink.linked?.status).toBe("delivered");

    // 6. Completada, nada cambia: ni el checklist, ni la fecha, ni otra vez.
    request(USER_C, ORG_1);
    expect(await complete(deliveryId)).toEqual({
      status: "already_completed",
    });
    request(USER_C, ORG_1);
    expect(await tick(deliveryId, "keys", false)).toEqual({
      status: "already_completed",
    });
    request(USER_C, ORG_1);
    expect(
      await rescheduleDelivery(
        null,
        form({ deliveryId, scheduledAt: inTwoDays() }),
      ),
    ).toEqual({ status: "already_completed" });
    expect((await rowOf(deliveryId)).checklist).toEqual(VERIFIED);
  });

  it("el panel solo existe con la oportunidad Ganada", async () => {
    const open = await opportunity(ORG_1, "negotiating");
    request(USER_A, ORG_1);
    expect((await getOpportunityDetail(open.id))?.delivery).toEqual({
      kind: "hidden",
    });
    const won = await opportunity(ORG_1);
    request(USER_A, ORG_1);
    expect((await getOpportunityDetail(won.id))?.delivery).toMatchObject({
      kind: "unscheduled",
      unit: { name: "Toyota Hilux", status: "sold" },
    });
  });

  it("programar: solo una ganada con su unidad vendida, una vez, y con una fecha válida", async () => {
    request(USER_A, ORG_1);
    const open = await opportunity(ORG_1, "negotiating");
    expect(
      await scheduleDelivery(
        null,
        form({ opportunityId: open.id, scheduledAt: inTwoDays() }),
      ),
    ).toEqual({ status: "opportunity_not_won" });

    const notSold = await opportunity(ORG_1, "won", "available");
    request(USER_A, ORG_1);
    expect(
      await scheduleDelivery(
        null,
        form({ opportunityId: notSold.id, scheduledAt: inTwoDays() }),
      ),
    ).toEqual({ status: "vehicle_conflict", reason: "not_sold" });

    const own = await delivery(ORG_1);
    request(USER_A, ORG_1);
    expect(
      await scheduleDelivery(
        null,
        form({ opportunityId: own.opportunityId, scheduledAt: inTwoDays() }),
      ),
    ).toEqual({ status: "already_scheduled" });

    const won = await opportunity(ORG_1);
    for (const [scheduledAt, error] of [
      ["", "required"],
      ["mañana", "invalid"],
      ["2001-01-01T10:00", "in_the_past"],
      ["2099-01-01T10:00", "too_far"],
    ] as const) {
      request(USER_A, ORG_1);
      expect(
        await scheduleDelivery(
          null,
          form({ opportunityId: won.id, scheduledAt }),
        ),
      ).toEqual({ status: "invalid", error, value: scheduledAt });
    }
    expect(await deliveriesOf(open.id)).toBe(0);
    expect(await deliveriesOf(notSold.id)).toBe(0);
    expect(await deliveriesOf(own.opportunityId)).toBe(1);
    expect(await deliveriesOf(won.id)).toBe(0);
  });

  it("reprogramar una pendiente: cambia la fecha pactada y nada más", async () => {
    const own = await delivery(ORG_1, { checklist: { ...EMPTY, keys: true } });
    const value = inTwoDays();
    request(USER_A, ORG_1);
    expect(
      await rescheduleDelivery(
        null,
        form({ deliveryId: own.id, scheduledAt: value }),
      ),
    ).toEqual({ status: "rescheduled" });
    request(USER_A, ORG_1);
    expect(
      await rescheduleDelivery(
        null,
        form({ deliveryId: own.id, scheduledAt: value }),
      ),
    ).toEqual({ status: "unchanged" });
    expect(await rowOf(own.id)).toMatchObject({
      status: "pending",
      checklist: { ...EMPTY, keys: true },
    });
  });

  it("el cliente no elige la organización, la unidad, el estado ni el checklist que se completa", async () => {
    const own = await delivery(ORG_1, {
      checklist: { ...VERIFIED, cleaning: false },
    });
    request(USER_A, ORG_1);
    // Campos de más no tienen adónde ir: se completa con el checklist
    // guardado, que está incompleto.
    expect(
      await completeDelivery(
        null,
        form({
          deliveryId: own.id,
          checklist: JSON.stringify(VERIFIED),
          status: "completed",
          organizationId: ORG_2,
          vehicleId: randomUUID(),
        }),
      ),
    ).toEqual({ status: "checklist_incomplete", missing: ["cleaning"] });
    // Un ítem o un valor desconocido no es un pedido.
    for (const fields of [
      { deliveryId: own.id, item: "spare_tire", checked: "true" },
      { deliveryId: own.id, item: "cleaning", checked: "1" },
      { deliveryId: "no-es-un-uuid", item: "cleaning", checked: "true" },
    ]) {
      request(USER_A, ORG_1);
      expect(await setDeliveryChecklistItem(null, form(fields))).toEqual({
        status: "not_found",
      });
    }
    expect(await rowOf(own.id)).toMatchObject({
      status: "pending",
      checklist: { ...VERIFIED, cleaning: false },
    });
    expect(await vehicleStatusOf(own.vehicleId)).toBe("sold");
  });

  it("aislamiento: otra organización no programa, no tilda ni completa (not_found, sin revelar nada)", async () => {
    const own = await delivery(ORG_1, { checklist: VERIFIED });
    const won = await opportunity(ORG_1);
    request(USER_B);
    expect(
      await scheduleDelivery(
        null,
        form({ opportunityId: won.id, scheduledAt: inTwoDays() }),
      ),
    ).toEqual({ status: "not_found" });
    request(USER_B);
    expect(await tick(own.id, "keys", false)).toEqual({ status: "not_found" });
    request(USER_B);
    expect(await complete(own.id)).toEqual({ status: "not_found" });
    request(USER_B);
    expect(
      await rescheduleDelivery(
        null,
        form({ deliveryId: own.id, scheduledAt: inTwoDays() }),
      ),
    ).toEqual({ status: "not_found" });
    expect(mocks.revalidated).toEqual([]);
    expect(await rowOf(own.id)).toMatchObject({
      status: "pending",
      checklist: VERIFIED,
    });
    expect(await vehicleStatusOf(own.vehicleId)).toBe("sold");
    expect(await deliveriesOf(won.id)).toBe(0);
  });

  it("sin sesión o sin membership activa no llega a la base", async () => {
    const own = await delivery(ORG_1, { checklist: VERIFIED });
    for (const [userId, path] of [
      [null, "/login"],
      [USER_D, "/no-access"],
      [USER_E, "/no-access"],
    ] as const) {
      request(userId);
      expect(await redirectOf(complete(own.id))).toBe(path);
    }
    expect((await rowOf(own.id)).status).toBe("pending");
    expect(await vehicleStatusOf(own.vehicleId)).toBe("sold");
  });

  it("atomicidad: si la salida de la unidad falla, la entrega tampoco se completa (failed, sin detalles ni revalidación)", async () => {
    const own = await delivery(ORG_1, { checklist: VERIFIED });
    await db.admin.unsafe(`
      CREATE FUNCTION public.test_fail_vehicle_exit() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.id = '${own.vehicleId}' THEN
          RAISE EXCEPTION 'forced failure' USING ERRCODE = 'P0001';
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER test_fail_vehicle_exit BEFORE UPDATE ON public.vehicles
        FOR EACH ROW EXECUTE FUNCTION public.test_fail_vehicle_exit();
    `);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      request(USER_A, ORG_1);
      expect(await complete(own.id)).toEqual({ status: "failed" });
      expect(errors).toHaveBeenCalled();
      expect(mocks.revalidated).toEqual([]);
      expect(await rowOf(own.id)).toMatchObject({
        status: "pending",
        completedAt: null,
        completedBy: null,
      });
      expect(await vehicleStatusOf(own.vehicleId)).toBe("sold");
    } finally {
      errors.mockRestore();
      await db.admin.unsafe(`
        DROP TRIGGER test_fail_vehicle_exit ON public.vehicles;
        DROP FUNCTION public.test_fail_vehicle_exit();
      `);
    }
  });

  it("dos completados simultáneos: uno completa y el otro es already_completed; la unidad sale una sola vez", async () => {
    for (let round = 0; round < 3; round += 1) {
      const own = await delivery(ORG_1, { checklist: VERIFIED });
      request(USER_A, ORG_1);
      const results = await Promise.all([complete(own.id), complete(own.id)]);
      expect(results.map((result) => result?.status).sort()).toEqual([
        "already_completed",
        "completed",
      ]);
      expect((await rowOf(own.id)).status).toBe("completed");
      expect(await vehicleStatusOf(own.vehicleId)).toBe("delivered");
    }
  });

  it("destildar y completar a la vez se serializan: nunca una entrega completada con un ítem sin verificar", async () => {
    for (let round = 0; round < 4; round += 1) {
      const own = await delivery(ORG_1, { checklist: VERIFIED });
      request(USER_A, ORG_1);
      const [untick, completion] = await Promise.all([
        tick(own.id, "documents", false),
        complete(own.id),
      ]);
      const row = await rowOf(own.id);
      if (completion?.status === "completed") {
        // El completado llegó antes: el ítem ya no se destilda.
        expect(untick).toEqual({ status: "already_completed" });
        expect(row).toMatchObject({ status: "completed", checklist: VERIFIED });
        expect(await vehicleStatusOf(own.vehicleId)).toBe("delivered");
      } else {
        // Se destildó antes: el completado lee el checklist incompleto.
        expect(untick).toMatchObject({ status: "changed" });
        expect(completion).toEqual({
          status: "checklist_incomplete",
          missing: ["documents"],
        });
        expect(row).toMatchObject({
          status: "pending",
          checklist: { ...VERIFIED, documents: false },
        });
        expect(await vehicleStatusOf(own.vehicleId)).toBe("sold");
      }
    }
  });

  it("dos programaciones simultáneas dejan una sola entrega", async () => {
    const won = await opportunity(ORG_1);
    request(USER_A, ORG_1);
    const results = await Promise.all([
      scheduleDelivery(
        null,
        form({ opportunityId: won.id, scheduledAt: inTwoDays() }),
      ),
      scheduleDelivery(
        null,
        form({ opportunityId: won.id, scheduledAt: inTwoDays() }),
      ),
    ]);
    expect(results.map((result) => result?.status).sort()).toEqual([
      "already_scheduled",
      "scheduled",
    ]);
    expect(await deliveriesOf(won.id)).toBe(1);
  });
});

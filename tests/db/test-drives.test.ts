import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import type { TransactionSql } from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { getCalendarAgenda } from "@/db/queries/calendar";
import { testDrives } from "@/db/schema";
import { withTenant, type TenantContext } from "@/db/tenant";
import {
  CALENDAR_TIME_ZONE,
  TEST_DRIVE_STATUSES,
  TEST_DRIVE_TRANSITIONS,
  toLocalDateTime,
  type TestDriveStatus,
} from "@/domains/calendar/test-drives";
import { isoDate, zonedDate } from "@/domains/calendar/zoned-time";
import {
  changeTestDriveStatus,
  scheduleTestDrive,
} from "@/lib/calendar/actions";
import type {
  ChangeTestDriveStatusState,
  ScheduleTestDriveState,
} from "@/lib/calendar/requests";
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
 * Agenda de pruebas de manejo (Hito 9, DEC-041) de punta a punta contra
 * PostgreSQL 17 con las migraciones aplicadas:
 *
 *   Server Action → requireTenant() → validar → withTenant() → oportunidad
 *   abierta y unidad probable en la organización activa → INSERT → RLS
 *   (WITH CHECK) + FKs compuestas → loader de /calendar
 *
 *   Server Action → requireTenant() → withTenant() → fila bloqueada →
 *   estado esperado → matriz del dominio → UPDATE status → trigger
 *
 * La acción, la escritura y el loader son los reales, conectados como
 * app_runtime. Supabase Auth (claims ya verificados), la cookie, redirect()
 * y revalidatePath() de Next son simulados, como en opportunity-notes.test.ts.
 *
 * Tenants (support/tenants.ts): A: admin de ORG_1 · B: admin de ORG_2 · C:
 * seller de ORG_1 y admin de ORG_3, seller inactivo de ORG_2 · D: solo
 * inactiva en ORG_1 · E: sin memberships.
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

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

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

let sequence = 0;

/** Una oportunidad propia del caso, en `stage`, con su contacto. */
async function opportunity(
  organizationId: string,
  stage: "new" | "qualifying" | "negotiating" | "won" | "lost" = "qualifying",
): Promise<string> {
  sequence += 1;
  const contactId = randomUUID();
  const id = randomUUID();
  let vehicleId: string | null = null;
  if (stage === "won") vehicleId = await vehicle(organizationId, "sold");
  await db.admin`
    INSERT INTO public.contacts (id, organization_id, name)
    VALUES (${contactId}, ${organizationId}, ${`Cliente agenda ${sequence}`})
  `;
  await db.admin`
    INSERT INTO public.opportunities ${db.admin({
      id,
      organization_id: organizationId,
      contact_id: contactId,
      stage,
      vehicle_id: vehicleId,
      source: "web",
      ...closureColumns(stage),
    })}
  `;
  return id;
}

/** Una unidad propia del caso, en `status`. */
async function vehicle(
  organizationId: string,
  status: "in_preparation" | "available" | "reserved" | "sold" = "available",
): Promise<string> {
  const id = randomUUID();
  await db.admin`
    INSERT INTO public.vehicles (id, organization_id, brand, model, year, status)
    VALUES (${id}, ${organizationId}, 'Toyota', 'Hilux', 2024, ${status})
  `;
  return id;
}

/** Una prueba sembrada con el superusuario (p. ej. una que ya pasó). */
async function seededTestDrive(
  organizationId: string,
  scheduledAt: Date,
  status: TestDriveStatus = "scheduled",
  createdBy = USER_A,
): Promise<string> {
  const id = randomUUID();
  await db.admin`
    INSERT INTO public.test_drives ${db.admin({
      id,
      organization_id: organizationId,
      opportunity_id: await opportunity(organizationId),
      vehicle_id: await vehicle(organizationId),
      scheduled_at: scheduledAt,
      status,
      created_by: createdBy,
    })}
  `;
  return id;
}

type TestDriveRecord = {
  id: string;
  organizationId: string;
  opportunityId: string;
  vehicleId: string;
  scheduledAt: Date;
  status: TestDriveStatus;
  createdBy: string;
  updatedAt: Date;
};

/** Las pruebas tal como están en la base (sin RLS). */
async function testDrivesWhere(
  column: "opportunity_id" | "id",
  value: string,
): Promise<TestDriveRecord[]> {
  return db.admin<TestDriveRecord[]>`
    SELECT id, organization_id AS "organizationId",
      opportunity_id AS "opportunityId", vehicle_id AS "vehicleId",
      scheduled_at AS "scheduledAt", status, created_by AS "createdBy",
      updated_at AS "updatedAt"
    FROM public.test_drives WHERE ${db.admin(column)} = ${value}
  `;
}

async function statusOf(id: string): Promise<TestDriveStatus | undefined> {
  return (await testDrivesWhere("id", id))[0]?.status;
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.append(name, value);
  return data;
}

/** Hora de Asunción, para el campo datetime-local, a `offsetMs` de ahora. */
function localIn(offsetMs: number): string {
  return toLocalDateTime(new Date(Date.now() + offsetMs), CALENDAR_TIME_ZONE);
}

function schedule(fields: {
  opportunityId: string;
  vehicleId: string;
  scheduledAt?: string;
  [extra: string]: string | undefined;
}): Promise<ScheduleTestDriveState> {
  const entries = Object.fromEntries(
    Object.entries({ scheduledAt: localIn(2 * DAY), ...fields }).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
  return scheduleTestDrive(null, form(entries));
}

function change(
  testDriveId: string,
  from: TestDriveStatus,
  to: TestDriveStatus,
): Promise<ChangeTestDriveStatusState> {
  return changeTestDriveStatus(null, form({ testDriveId, from, to }));
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

/** INSERT directo por el boundary, sin pasar por la Server Action. */
function directInsert(
  ctx: TenantContext,
  values: Partial<typeof testDrives.$inferInsert> &
    Pick<typeof testDrives.$inferInsert, "opportunityId" | "vehicleId">,
) {
  return withTenant(ctx, (tx) =>
    tx
      .insert(testDrives)
      .values({
        organizationId: ctx.organizationId,
        scheduledAt: new Date(Date.now() + DAY),
        createdBy: ctx.userId,
        ...values,
      })
      .returning({ id: testDrives.id }),
  );
}

describe("agendar (scheduleTestDrive)", () => {
  it("admin y seller agendan en la organización activa, como autores y en estado agendada", async () => {
    for (const [userId, cookie] of [
      [USER_A, undefined],
      [USER_C, ORG_1],
    ] as const) {
      const opportunityId = await opportunity(ORG_1);
      const vehicleId = await vehicle(ORG_1, "reserved");
      const scheduledAt = localIn(3 * DAY);
      request(userId, cookie);
      const result = await schedule({
        opportunityId,
        vehicleId,
        scheduledAt,
        // Se ignoran: no tienen adónde ir.
        organizationId: ORG_2,
        createdBy: USER_B,
        status: "completed",
      });
      expect(result).toMatchObject({ status: "scheduled" });
      expect(mocks.revalidated).toEqual(["/calendar"]);

      const [row] = await testDrivesWhere("opportunity_id", opportunityId);
      expect(row).toMatchObject({
        organizationId: ORG_1,
        vehicleId,
        status: "scheduled",
        createdBy: userId,
      });
      expect(toLocalDateTime(row!.scheduledAt, CALENDAR_TIME_ZONE)).toBe(
        scheduledAt,
      );
    }
  });

  it("sin sesión o sin membership activa no llega a la base", async () => {
    const opportunityId = await opportunity(ORG_1);
    const vehicleId = await vehicle(ORG_1);
    for (const [userId, path] of [
      [null, "/login"],
      [USER_D, "/no-access"],
      [USER_E, "/no-access"],
    ] as const) {
      request(userId);
      expect(await redirectOf(schedule({ opportunityId, vehicleId }))).toBe(
        path,
      );
    }
    expect(await testDrivesWhere("opportunity_id", opportunityId)).toEqual([]);
  });

  it("la oportunidad y la unidad tienen que ser de la organización activa, sin revelar si existen", async () => {
    const mine = await opportunity(ORG_1);
    const myVehicle = await vehicle(ORG_1);
    const foreign = await opportunity(ORG_3);
    const foreignVehicle = await vehicle(ORG_3);

    // C pertenece a ORG_1 y ORG_3: con ORG_1 activa, lo de ORG_3 no existe.
    request(USER_C, ORG_1);
    expect(
      await schedule({ opportunityId: foreign, vehicleId: myVehicle }),
    ).toMatchObject({
      status: "invalid",
      errors: { opportunityId: "unavailable" },
    });
    expect(
      await schedule({ opportunityId: mine, vehicleId: foreignVehicle }),
    ).toMatchObject({
      status: "invalid",
      errors: { vehicleId: "unavailable" },
    });
    expect(
      await schedule({ opportunityId: randomUUID(), vehicleId: myVehicle }),
    ).toMatchObject({ errors: { opportunityId: "unavailable" } });
    expect(mocks.revalidated).toEqual([]);
    expect(await testDrivesWhere("opportunity_id", mine)).toEqual([]);
    expect(await testDrivesWhere("opportunity_id", foreign)).toEqual([]);
  });

  it("solo oportunidades abiertas y unidades disponibles o reservadas", async () => {
    const myVehicle = await vehicle(ORG_1);
    request(USER_A);
    for (const stage of ["won", "lost"] as const) {
      expect(
        await schedule({
          opportunityId: await opportunity(ORG_1, stage),
          vehicleId: myVehicle,
        }),
      ).toMatchObject({ errors: { opportunityId: "unavailable" } });
    }
    for (const status of ["in_preparation", "sold"] as const) {
      expect(
        await schedule({
          opportunityId: await opportunity(ORG_1, "new"),
          vehicleId: await vehicle(ORG_1, status),
        }),
      ).toMatchObject({ errors: { vehicleId: "unavailable" } });
    }
  });

  it("una hora pasada, inválida o fuera del horizonte no llega a la base", async () => {
    const opportunityId = await opportunity(ORG_1);
    const vehicleId = await vehicle(ORG_1);
    request(USER_A);
    for (const [scheduledAt, error] of [
      [localIn(-DAY), "in_the_past"],
      ["2026-02-30T10:00", "invalid"],
      [localIn(400 * DAY), "too_far"],
      ["", "required"],
    ] as const) {
      expect(
        await schedule({ opportunityId, vehicleId, scheduledAt }),
      ).toMatchObject({ status: "invalid", errors: { scheduledAt: error } });
    }
    expect(await testDrivesWhere("opportunity_id", opportunityId)).toEqual([]);
  });
});

describe("cambiar el estado (changeTestDriveStatus)", () => {
  it("recorre la matriz: confirmar, después realizada (cuando ya pasó la hora)", async () => {
    const id = await seededTestDrive(
      ORG_1,
      new Date(Date.now() - 2 * 60 * MINUTE),
    );
    request(USER_C, ORG_1);
    expect(await change(id, "scheduled", "confirmed")).toEqual({
      status: "changed",
      testDriveId: id,
      to: "confirmed",
    });
    expect(mocks.revalidated).toEqual(["/calendar"]);
    expect(await change(id, "confirmed", "completed")).toMatchObject({
      status: "changed",
      to: "completed",
    });
    expect(await statusOf(id)).toBe("completed");
    // Terminal: no se reabre.
    expect(await change(id, "completed", "scheduled")).toEqual({
      status: "invalid_transition",
    });
    expect(await statusOf(id)).toBe("completed");
  });

  it("realizada o no asistió antes de la hora: not_started, sin cambios", async () => {
    const id = await seededTestDrive(ORG_1, new Date(Date.now() + DAY));
    request(USER_A);
    for (const to of ["completed", "no_show"] as const) {
      expect(await change(id, "scheduled", to)).toEqual({
        status: "not_started",
      });
    }
    expect(await statusOf(id)).toBe("scheduled");
    expect(await change(id, "scheduled", "cancelled")).toMatchObject({
      status: "changed",
    });
  });

  it("compare-and-set: si otra persona ya la movió, es unchanged con el estado real", async () => {
    const id = await seededTestDrive(ORG_1, new Date(Date.now() + DAY));
    request(USER_A);
    await change(id, "scheduled", "confirmed");
    request(USER_C, ORG_1);
    expect(await change(id, "scheduled", "cancelled")).toEqual({
      status: "unchanged",
      testDriveId: id,
      current: "confirmed",
    });
    expect(await statusOf(id)).toBe("confirmed");
  });

  it("una prueba de otra organización, inexistente o un pedido inválido es not_found", async () => {
    const foreign = await seededTestDrive(
      ORG_2,
      new Date(Date.now() + DAY),
      "scheduled",
      USER_B,
    );
    request(USER_A);
    expect(await change(foreign, "scheduled", "cancelled")).toEqual({
      status: "not_found",
    });
    expect(await change(randomUUID(), "scheduled", "cancelled")).toEqual({
      status: "not_found",
    });
    expect(
      await changeTestDriveStatus(
        null,
        form({ testDriveId: foreign, from: "scheduled", to: "deleted" }),
      ),
    ).toEqual({ status: "not_found" });
    expect(await statusOf(foreign)).toBe("scheduled");
  });

  it("sin sesión o sin membership activa no llega a la base", async () => {
    const id = await seededTestDrive(ORG_1, new Date(Date.now() + DAY));
    for (const [userId, path] of [
      [null, "/login"],
      [USER_D, "/no-access"],
    ] as const) {
      request(userId);
      expect(await redirectOf(change(id, "scheduled", "cancelled"))).toBe(path);
    }
    expect(await statusOf(id)).toBe("scheduled");
  });
});

describe("loader de /calendar (getCalendarAgenda)", () => {
  it("la semana de la organización activa, sin cruces, con las opciones del alta", async () => {
    const when = new Date(Date.now() + 2 * DAY);
    const week = isoDate(zonedDate(when, CALENDAR_TIME_ZONE));
    const mine = await seededTestDrive(ORG_1, when);
    const foreign = await seededTestDrive(ORG_2, when, "scheduled", USER_B);
    const outside = await seededTestDrive(
      ORG_1,
      new Date(when.getTime() + 21 * DAY),
    );

    request(USER_A);
    const agenda = await getCalendarAgenda(week);
    const ids = agenda.days.flatMap((day) => day.items.map((item) => item.id));
    expect(ids).toContain(mine);
    expect(ids).not.toContain(foreign);
    expect(ids).not.toContain(outside);
    const item = agenda.days
      .flatMap((day) => day.items)
      .find((found) => found.id === mine);
    expect(item).toMatchObject({
      status: "scheduled",
      scheduledByLabel: "Vos",
      vehicleLabel: "Toyota Hilux 2024",
    });
    expect(agenda.total).toBe(ids.length);

    // Opciones: solo oportunidades abiertas y unidades probables de ORG_1.
    const options = await db.admin<{ id: string }[]>`
      SELECT o.id FROM public.opportunities o
      WHERE o.organization_id = ${ORG_1}
        AND o.stage IN ('new', 'qualifying', 'negotiating')
    `;
    expect(
      agenda.opportunities.every((option) =>
        options.some((row) => row.id === option.id),
      ),
    ).toBe(true);
    const vehicles = await db.admin<{ id: string }[]>`
      SELECT id FROM public.vehicles
      WHERE organization_id = ${ORG_1} AND status IN ('available', 'reserved')
    `;
    expect(
      agenda.vehicles.every((option) =>
        vehicles.some((row) => row.id === option.id),
      ),
    ).toBe(true);

    // B (ORG_2) ve la suya y no la de ORG_1.
    request(USER_B);
    const other = await getCalendarAgenda(week);
    const otherIds = other.days.flatMap((day) => day.items.map((i) => i.id));
    expect(otherIds).toContain(foreign);
    expect(otherIds).not.toContain(mine);
  });

  it("sin sesión o sin membership activa redirige", async () => {
    for (const [userId, path] of [
      [null, "/login"],
      [USER_E, "/no-access"],
    ] as const) {
      request(userId);
      expect(await redirectOf(getCalendarAgenda(undefined))).toBe(path);
    }
  });
});

describe("RLS, privilegios y trigger de test_drives", () => {
  it("el alta exige autor de la request, estado inicial, reloj de la base y hora no pasada (42501)", async () => {
    const opportunityId = await opportunity(ORG_1);
    const vehicleId = await vehicle(ORG_1);
    for (const values of [
      { createdBy: USER_C },
      { status: "confirmed" as const },
      { createdAt: new Date("2000-01-01T00:00:00Z") },
      { scheduledAt: new Date(Date.now() - 60 * MINUTE) },
    ]) {
      await expectSqlError(
        directInsert(ctxA(), { opportunityId, vehicleId, ...values }),
        "42501",
      );
    }
    // Por el boundary, con todo en regla, sí.
    await expect(
      directInsert(ctxA(), { opportunityId, vehicleId }),
    ).resolves.toHaveLength(1);
  });

  it("no se agenda en una organización sin membership activa (42501) ni cruzando organizaciones (FK compuesta)", async () => {
    const foreign = await opportunity(ORG_2);
    const foreignVehicle = await vehicle(ORG_2);
    await expectSqlError(
      directInsert(ctxA(), {
        organizationId: ORG_2,
        opportunityId: foreign,
        vehicleId: foreignVehicle,
      }),
      "42501",
    );
    // D: membership inactiva en ORG_1.
    await expectSqlError(
      directInsert(tenantContext(USER_D, ORG_1), {
        opportunityId: await opportunity(ORG_1),
        vehicleId: await vehicle(ORG_1),
      }),
      "42501",
    );
    // Oportunidad propia con la unidad de otra organización.
    await expectSqlError(
      directInsert(ctxA(), {
        opportunityId: await opportunity(ORG_1),
        vehicleId: foreignVehicle,
      }),
      "23503",
      "test_drives_vehicle_fk",
    );
    expect(await testDrivesWhere("opportunity_id", foreign)).toEqual([]);
  });

  it("un miembro no ve las pruebas de otra organización", async () => {
    const foreign = await seededTestDrive(
      ORG_2,
      new Date(Date.now() + DAY),
      "scheduled",
      USER_B,
    );
    const rows = await withTenant(ctxA(), (tx) =>
      tx.execute(sql`SELECT id FROM public.test_drives WHERE id = ${foreign}`),
    );
    expect([...rows]).toEqual([]);
  });

  it("authenticated solo edita status (y updated_at); nunca borra (42501)", async () => {
    const id = await seededTestDrive(ORG_1, new Date(Date.now() + DAY));
    for (const statement of [
      sql`UPDATE public.test_drives SET scheduled_at = now() + interval '2 days' WHERE id = ${id}`,
      sql`UPDATE public.test_drives SET vehicle_id = vehicle_id WHERE id = ${id}`,
      sql`UPDATE public.test_drives SET created_by = ${USER_C} WHERE id = ${id}`,
      sql`DELETE FROM public.test_drives WHERE id = ${id}`,
      sql`TRUNCATE public.test_drives`,
    ]) {
      await expectSqlError(
        withTenant(ctxA(), (tx) => tx.execute(statement)),
        "42501",
      );
    }
    expect(await statusOf(id)).toBe("scheduled");
  });

  it("el trigger: los 25 pares cruzados con el dominio, también para el rol dueño", async () => {
    for (const from of TEST_DRIVE_STATUSES) {
      for (const to of TEST_DRIVE_STATUSES) {
        const id = await seededTestDrive(
          ORG_1,
          new Date(Date.now() - 60 * MINUTE),
          from,
        );
        const update = db.admin`
          UPDATE public.test_drives SET status = ${to} WHERE id = ${id}
        `;
        if (TEST_DRIVE_TRANSITIONS[from].includes(to)) {
          await update;
          expect(await statusOf(id)).toBe(to);
        } else {
          await expect(update).rejects.toMatchObject({
            code: "23514",
            constraint_name: "test_drives_status_transition",
          });
          expect(await statusOf(id)).toBe(from);
        }
      }
    }
  });

  it("el trigger exige la hora agendada para realizada y no asistió, fija updated_at y deja inmutable el resto", async () => {
    const future = await seededTestDrive(ORG_1, new Date(Date.now() + DAY));
    for (const to of ["completed", "no_show"]) {
      await expect(
        db.admin`UPDATE public.test_drives SET status = ${to} WHERE id = ${future}`,
      ).rejects.toMatchObject({
        code: "23514",
        constraint_name: "test_drives_not_started",
      });
    }
    await expect(
      db.admin`UPDATE public.test_drives SET scheduled_at = now() + interval '3 days', status = 'confirmed' WHERE id = ${future}`,
    ).rejects.toMatchObject({
      code: "23514",
      constraint_name: "test_drives_immutable",
    });

    const before = (await testDrivesWhere("id", future))[0]!;
    await withTenant(ctxA(), (tx) =>
      tx.execute(
        sql`UPDATE public.test_drives SET status = 'confirmed', updated_at = '2000-01-01T00:00:00Z' WHERE id = ${future}`,
      ),
    );
    const after = (await testDrivesWhere("id", future))[0]!;
    expect(after.status).toBe("confirmed");
    expect(after.updatedAt.getTime()).toBeGreaterThan(
      before.updatedAt.getTime() - 1,
    );
    expect(after.updatedAt.getFullYear()).toBeGreaterThan(2000);
  });

  it("app_runtime fuera del boundary y anon no leen ni escriben (42501)", async () => {
    const id = await seededTestDrive(ORG_1, new Date(Date.now() + DAY));
    await expect(
      runtimePool()`SELECT id FROM public.test_drives`,
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      db.admin.begin(async (tx: TransactionSql) => {
        await tx.unsafe("SET LOCAL ROLE anon");
        await tx`UPDATE public.test_drives SET status = 'cancelled' WHERE id = ${id}`;
      }),
    ).rejects.toMatchObject({ code: "42501" });
    expect(await statusOf(id)).toBe("scheduled");
  });

  it("una oportunidad o una unidad con pruebas no se borran (FK RESTRICT)", async () => {
    const id = await seededTestDrive(ORG_1, new Date(Date.now() + DAY));
    const [row] = await testDrivesWhere("id", id);
    await expect(
      db.admin`DELETE FROM public.opportunities WHERE id = ${row!.opportunityId}`,
    ).rejects.toMatchObject({
      code: "23503",
      constraint_name: "test_drives_opportunity_fk",
    });
    await expect(
      db.admin`DELETE FROM public.vehicles WHERE id = ${row!.vehicleId}`,
    ).rejects.toMatchObject({
      code: "23503",
      constraint_name: "test_drives_vehicle_fk",
    });
  });
});

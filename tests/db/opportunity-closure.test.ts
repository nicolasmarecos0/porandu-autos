import { randomUUID } from "node:crypto";

import { eq, sql } from "drizzle-orm";
import postgres, { type TransactionSql } from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeOpportunityWithMetadata } from "@/db/queries/close-opportunity";
import { setOpportunityVehicle } from "@/db/queries/link-opportunity-vehicle";
import { getOpportunityDetail } from "@/db/queries/opportunity-detail";
import { opportunities } from "@/db/schema";
import { withTenant, type TenantContext } from "@/db/tenant";
import type { Closure } from "@/domains/opportunities/closure";
import type { Stage } from "@/domains/opportunities/stages";
import {
  changeOpportunityStage,
  closeOpportunity,
} from "@/lib/opportunities/actions";
import type { CloseOpportunityState } from "@/lib/opportunities/closure";
import { ACTIVE_ORGANIZATION_COOKIE } from "@/lib/tenant/cookie";

import { cookieJar, type CookieJar } from "../unit/support/cookie-jar";
import {
  closureColumns,
  LOST_METADATA,
  WON_METADATA,
} from "./support/closures";
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
 * Cierre comercial (DEC-034) de punta a punta contra PostgreSQL 17 con las
 * migraciones aplicadas:
 *
 *   Server Action → requireTenant() → validación del pedido (Zod) →
 *   withTenant() → SELECT … FOR UPDATE → planOpportunityClosure() → UPDATE
 *   → RLS (policy de UPDATE) + CHECKs de cierre + trigger → loader
 *
 * La acción, la escritura y el loader son los reales, conectados como
 * app_runtime. Supabase Auth (claims ya verificados), la cookie, redirect()
 * y revalidatePath() de Next son simulados, como en opportunity-stages.test.ts.
 * Además se prueba la base sola: UPDATEs directos por el boundary (sin el
 * dominio) y con los roles dueño y superusuario, que los CHECKs y el
 * trigger rechazan igual.
 *
 * Tenants (support/tenants.ts): A: admin de ORG_1 · B: admin de ORG_2 · C:
 * seller de ORG_1 y admin de ORG_3, seller inactivo de ORG_2 · D: solo
 * inactiva en ORG_1 · E: sin memberships.
 *
 * Cada caso usa sus propias oportunidades y unidades (insertadas con el
 * superusuario, en la etapa que necesita) para no depender del orden.
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

/** Una unidad propia del caso: una Toyota Hilux disponible. */
async function vehicle(organizationId: string): Promise<string> {
  const id = randomUUID();
  await db.admin`
    INSERT INTO public.vehicles (id, organization_id, brand, model, version,
      year, price, currency, status, created_at, updated_at)
    VALUES (${id}, ${organizationId}, 'Toyota', 'Hilux', 'SRV 2.8 4x4 AT',
      2025, 49900, 'USD', 'available', now() - interval '1 day',
      now() - interval '1 day')
  `;
  return id;
}

let sequence = 0;

/**
 * Una oportunidad propia del caso en `stage`, con la unidad `vehicleId` (por
 * defecto, una nueva si la etapa la admite y `withVehicle`) y, cerrada, con
 * metadatos válidos. Creada (y actualizada por última vez) hace un día: así
 * se ve qué cambia.
 */
async function opportunity(
  organizationId: string,
  stage: Stage = "negotiating",
  { withVehicle = stage !== "new" && stage !== "qualifying" } = {},
): Promise<{ id: string; vehicleId: string | null }> {
  sequence += 1;
  const contactId = randomUUID();
  const id = randomUUID();
  const vehicleId = withVehicle ? await vehicle(organizationId) : null;
  await db.admin`
    INSERT INTO public.contacts (id, organization_id, name)
    VALUES (${contactId}, ${organizationId}, ${`Prueba cierre ${sequence}`})
  `;
  await db.admin`
    INSERT INTO public.opportunities ${db.admin({
      id,
      organization_id: organizationId,
      contact_id: contactId,
      stage,
      source: "web",
      vehicle_id: vehicleId,
      ...closureColumns(stage),
      last_activity_at: new Date(Date.now() - 86_400_000),
      created_at: new Date(Date.now() - 86_400_000),
      updated_at: new Date(Date.now() - 86_400_000),
    })}
  `;
  return { id, vehicleId };
}

type OpportunityRow = {
  organizationId: string;
  stage: Stage;
  vehicleId: string | null;
  lossReason: string | null;
  lossNotes: string | null;
  salePrice: string | null;
  saleCurrency: string | null;
  paymentMethod: string | null;
  deliveryStatus: string | null;
  deliveryDate: string | null;
  lastActivityAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

/** La fila tal como está en la base (sin RLS). */
async function row(id: string): Promise<OpportunityRow | undefined> {
  const [found] = await db.admin<OpportunityRow[]>`
    SELECT organization_id AS "organizationId", stage,
      vehicle_id AS "vehicleId", loss_reason AS "lossReason",
      loss_notes AS "lossNotes", sale_price::text AS "salePrice",
      sale_currency AS "saleCurrency", payment_method AS "paymentMethod",
      delivery_status AS "deliveryStatus",
      delivery_date::text AS "deliveryDate",
      last_activity_at AS "lastActivityAt", created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM public.opportunities WHERE id = ${id}
  `;
  return found;
}

async function vehicleStatus(id: string): Promise<string | undefined> {
  const [found] = await db.admin<{ status: string }[]>`
    SELECT status FROM public.vehicles WHERE id = ${id}
  `;
  return found?.status;
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.append(name, value);
  return data;
}

/** El día de hoy en Asunción, como lo calcula el servidor. */
function today(): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Asuncion",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(new Date())
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

const WIN = {
  outcome: "won",
  salePrice: "47.500",
  saleCurrency: "USD",
  paymentMethod: "financing",
  deliveryStatus: "scheduled",
  deliveryDate: "2100-01-15",
} as const;

function close(
  opportunityId: string,
  fields: Record<string, string>,
): Promise<CloseOpportunityState> {
  return closeOpportunity(null, form({ opportunityId, ...fields }));
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

type Update = Partial<typeof opportunities.$inferInsert>;

/** UPDATE directo por el boundary, solo por id (sin el dominio). */
function directUpdate(ctx: TenantContext, id: string, set: Update) {
  return withTenant(ctx, (tx) =>
    tx
      .update(opportunities)
      .set(set)
      .where(eq(opportunities.id, id))
      .returning({ id: opportunities.id, stage: opportunities.stage }),
  );
}

const ctxA = () => tenantContext(USER_A, ORG_1);

describe("Server Action: requireTenant() → validación → withTenant() → UPDATE", () => {
  it("admin (A) gana una oportunidad En negociación: etapa y venta en una UPDATE, nada más", async () => {
    const { id, vehicleId } = await opportunity(ORG_1, "negotiating");
    const before = await row(id);
    request(USER_A);

    expect(await close(id, WIN)).toEqual({
      status: "closed",
      opportunityId: id,
      from: "negotiating",
      to: "won",
    });
    expect(mocks.revalidated).toEqual([
      "/opportunities",
      `/opportunities/${id}`,
    ]);

    const after = await row(id);
    expect(after).toEqual({
      ...before,
      stage: "won",
      salePrice: "47500.00",
      saleCurrency: "USD",
      paymentMethod: "financing",
      deliveryStatus: "scheduled",
      deliveryDate: "2100-01-15",
      updatedAt: expect.any(Date),
    });
    expect(after!.updatedAt.getTime()).toBeGreaterThan(
      before!.updatedAt.getTime(),
    );
    // DEC-034 §9 y §12: ni la recencia, ni la unidad, ni su stock.
    expect(after!.lastActivityAt).toEqual(before!.lastActivityAt);
    expect(after!.vehicleId).toBe(vehicleId);
    expect(await vehicleStatus(vehicleId!)).toBe("available");
  });

  it("guaraníes y centavos se guardan exactos, sin pasar por float", async () => {
    const pyg = await opportunity(ORG_1, "negotiating");
    const usd = await opportunity(ORG_1, "negotiating");
    request(USER_A);
    await close(pyg.id, {
      ...WIN,
      salePrice: "245.000.000",
      saleCurrency: "PYG",
    });
    await close(usd.id, { ...WIN, salePrice: "999.999.999.999,99" });
    expect((await row(pyg.id))!).toMatchObject({
      salePrice: "245000000.00",
      saleCurrency: "PYG",
    });
    expect((await row(usd.id))!.salePrice).toBe("999999999999.99");
  });

  it("una entrega hecha hoy (Asunción) se acepta", async () => {
    const { id } = await opportunity(ORG_1, "negotiating");
    request(USER_A);
    expect(
      await close(id, {
        ...WIN,
        deliveryStatus: "delivered",
        deliveryDate: today(),
      }),
    ).toMatchObject({ status: "closed" });
    expect((await row(id))!).toMatchObject({
      deliveryStatus: "delivered",
      deliveryDate: today(),
    });
  });

  it.each(["new", "qualifying", "negotiating"] as const)(
    "seller (C con ORG_1) pierde desde %s: motivo y notas normalizadas, y la unidad que había se conserva",
    async (from) => {
      const { id, vehicleId } = await opportunity(ORG_1, from);
      request(USER_C, ORG_1);
      expect(
        await close(id, {
          outcome: "lost",
          lossReason: "competitor",
          lossNotes:
            "  Compró en   la agencia de enfrente.\r\n\r\n\r\nPagó contado. ",
        }),
      ).toEqual({ status: "closed", opportunityId: id, from, to: "lost" });
      expect(await row(id)).toMatchObject({
        stage: "lost",
        lossReason: "competitor",
        lossNotes: "Compró en la agencia de enfrente.\n\nPagó contado.",
        vehicleId,
        salePrice: null,
        paymentMethod: null,
      });
    },
  );

  it("perder sin notas guarda NULL", async () => {
    const { id } = await opportunity(ORG_1, "qualifying");
    request(USER_A);
    await close(id, { outcome: "lost", lossReason: "ghosted", lossNotes: " " });
    expect(await row(id)).toMatchObject({
      lossReason: "ghosted",
      lossNotes: null,
    });
  });

  it("C con ORG_3 activa (admin) cierra una oportunidad de ORG_3", async () => {
    const { id } = await opportunity(ORG_3, "negotiating");
    request(USER_C, ORG_3);
    expect(await close(id, WIN)).toMatchObject({ status: "closed" });
    expect((await row(id))!.stage).toBe("won");
  });

  it("ganar sin unidad vinculada es vehicle_required: no escribe y revalida", async () => {
    const { id } = await opportunity(ORG_1, "negotiating", {
      withVehicle: false,
    });
    const before = await row(id);
    request(USER_A);
    expect(await close(id, WIN)).toEqual({
      status: "vehicle_required",
      opportunityId: id,
    });
    expect(await row(id)).toEqual(before);
    expect(mocks.revalidated).toContain(`/opportunities/${id}`);
  });

  it.each(["new", "qualifying"] as const)(
    "ganar desde %s es invalid_transition (sin pasar por la negociación)",
    async (from) => {
      const { id } = await opportunity(ORG_1, from);
      const before = await row(id);
      request(USER_A);
      expect(await close(id, WIN)).toEqual({
        status: "invalid_transition",
        opportunityId: id,
        current: from,
      });
      expect(await row(id)).toEqual(before);
    },
  );

  it.each([
    ["won", { outcome: "lost", lossReason: "price" }],
    ["lost", WIN],
  ] as const)(
    "una oportunidad %s no cambia de cierre",
    async (from, fields) => {
      const { id } = await opportunity(ORG_1, from);
      const before = await row(id);
      request(USER_A);
      expect(await close(id, fields)).toEqual({
        status: "invalid_transition",
        opportunityId: id,
        current: from,
      });
      expect(await row(id)).toEqual(before);
    },
  );

  it("pedir el cierre que ya tiene es unchanged: los metadatos no se reescriben", async () => {
    const won = await opportunity(ORG_1, "won");
    const lost = await opportunity(ORG_1, "lost");
    const before = [await row(won.id), await row(lost.id)];
    request(USER_A);
    expect(
      await close(won.id, { ...WIN, salePrice: "1", paymentMethod: "cash" }),
    ).toEqual({ status: "unchanged", opportunityId: won.id, stage: "won" });
    expect(
      await close(lost.id, {
        outcome: "lost",
        lossReason: "other",
        lossNotes: "Otra cosa",
      }),
    ).toEqual({ status: "unchanged", opportunityId: lost.id, stage: "lost" });
    expect([await row(won.id), await row(lost.id)]).toEqual(before);
    expect(mocks.revalidated).toEqual([]);
  });

  it("un pedido inválido no llega a la base", async () => {
    const { id } = await opportunity(ORG_1, "negotiating");
    const before = await row(id);
    request(USER_A);
    expect(
      await close(id, { ...WIN, salePrice: "0", deliveryDate: "2000-01-01" }),
    ).toMatchObject({
      status: "invalid",
      errors: { salePrice: "not_positive", deliveryDate: "scheduled_in_past" },
    });
    expect(
      await close(id, { outcome: "lost", lossReason: "bought_elsewhere" }),
    ).toMatchObject({
      status: "invalid",
      errors: { lossReason: "invalid_option" },
    });
    expect(await row(id)).toEqual(before);
    expect(mocks.revalidated).toEqual([]);
  });

  it("sin sesión o sin membership activa no llega a la base", async () => {
    const { id } = await opportunity(ORG_1, "negotiating");
    const before = await row(id);
    for (const [userId, path] of [
      [null, "/login"],
      [USER_D, "/no-access"],
      [USER_E, "/no-access"],
    ] as const) {
      request(userId);
      expect(await redirectOf(close(id, WIN))).toBe(path);
    }
    expect(await row(id)).toEqual(before);
  });

  it("una oportunidad de otra organización es not_found, aun con membership activa en ambas", async () => {
    const foreign = await opportunity(ORG_2, "negotiating");
    const foreign3 = await opportunity(ORG_3, "negotiating");
    const before = [await row(foreign.id), await row(foreign3.id)];

    // A solo pertenece a ORG_1.
    request(USER_A);
    expect(await close(foreign.id, WIN)).toEqual({ status: "not_found" });
    // C pertenece a ORG_1 y ORG_3: con ORG_1 activa, la de ORG_3 no se ve.
    request(USER_C, ORG_1);
    expect(
      await close(foreign3.id, { outcome: "lost", lossReason: "price" }),
    ).toEqual({ status: "not_found" });
    // Su membership inactiva en ORG_2 no cuenta.
    request(USER_C, ORG_1);
    expect(await close(foreign.id, WIN)).toEqual({ status: "not_found" });

    expect([await row(foreign.id), await row(foreign3.id)]).toEqual(before);
    expect(mocks.revalidated).toEqual([]);
  });

  it("organización, etapa, unidad, autor y reloj del pedido no tienen efecto", async () => {
    const mine = await opportunity(ORG_1, "negotiating");
    const foreignVehicle = await vehicle(ORG_2);
    request(USER_A);
    expect(
      await close(mine.id, {
        ...WIN,
        organizationId: ORG_2,
        organization_id: ORG_2,
        stage: "new",
        vehicleId: foreignVehicle,
        vehicle_id: foreignVehicle,
        updated_at: "2000-01-01T00:00:00Z",
        lastActivityAt: "2000-01-01T00:00:00Z",
        userId: USER_B,
      }),
    ).toMatchObject({ status: "closed", from: "negotiating" });
    const after = await row(mine.id);
    expect(after).toMatchObject({
      organizationId: ORG_1,
      stage: "won",
      vehicleId: mine.vehicleId,
    });
    expect(after!.updatedAt.getFullYear()).toBeGreaterThan(2020);
  });

  it("changeOpportunityStage() no cierra: closure_required y nada se escribe (DEC-034 §1)", async () => {
    const { id } = await opportunity(ORG_1, "negotiating");
    const before = await row(id);
    request(USER_A);
    for (const stage of ["won", "lost"]) {
      expect(
        await changeOpportunityStage(
          null,
          form({ opportunityId: id, stage, lossReason: "price" }),
        ),
      ).toEqual({
        status: "closure_required",
        opportunityId: id,
        current: "negotiating",
      });
    }
    expect(await row(id)).toEqual(before);
  });

  it("el detalle trae el resumen del cierre, y es notFound en otra organización", async () => {
    const { id } = await opportunity(ORG_1, "negotiating");
    request(USER_A);
    expect((await getOpportunityDetail(id))!.closure).toBeNull();
    await close(id, {
      ...WIN,
      salePrice: "245.000.000",
      saleCurrency: "PYG",
      paymentMethod: "trade_in",
    });

    request(USER_C, ORG_1);
    const detail = await getOpportunityDetail(id);
    expect(detail).toMatchObject({
      stage: "won",
      closure: {
        outcome: "won",
        salePrice: "Gs. 245.000.000",
        paymentMethod: "Usado como parte de pago",
        delivery: "Programada para el 15 ene 2100",
      },
      // La unidad vendida queda fija (DEC-034 §4).
      vehicleLink: { canChange: false, linked: { name: "Toyota Hilux" } },
    });
    request(USER_B);
    expect(await getOpportunityDetail(id)).toBeNull();

    const lost = await opportunity(ORG_1, "qualifying");
    request(USER_A);
    await close(lost.id, {
      outcome: "lost",
      lossReason: "financing_rejected",
      lossNotes: "El banco no aprobó.",
    });
    request(USER_A);
    expect((await getOpportunityDetail(lost.id))!.closure).toEqual({
      outcome: "lost",
      reason: "Financiación rechazada",
      notes: "El banco no aprobó.",
    });
  });
});

/*
 * Defensa en profundidad (DEC-034 §5): la base exige el cierre aunque el
 * código no pase por el dominio. UPDATEs directos por el boundary, como
 * authenticated con RLS.
 */
describe("la base no deja cerrar sin metadatos completos (CHECKs)", () => {
  it("ganar sin la venta falla por opportunities_won_closure_check", async () => {
    const { id } = await opportunity(ORG_1, "negotiating");
    await expectSqlError(
      directUpdate(ctxA(), id, { stage: "won" }),
      "23514",
      "opportunities_won_closure_check",
    );
    expect((await row(id))!.stage).toBe("negotiating");
  });

  it.each([
    "salePrice",
    "paymentMethod",
    "deliveryStatus",
    "deliveryDate",
  ] as const)("ganar sin %s falla por el mismo CHECK", async (missing) => {
    const { id } = await opportunity(ORG_1, "negotiating");
    const set: Record<string, unknown> = { stage: "won", ...WON_METADATA };
    set[missing] = null;
    if (missing === "salePrice") set.saleCurrency = null;
    await expectSqlError(
      directUpdate(ctxA(), id, set as Update),
      "23514",
      "opportunities_won_closure_check",
    );
    expect((await row(id))!.stage).toBe("negotiating");
  });

  it("ganar sin unidad vinculada falla aunque la venta esté completa", async () => {
    const { id } = await opportunity(ORG_1, "negotiating", {
      withVehicle: false,
    });
    await expectSqlError(
      directUpdate(ctxA(), id, { stage: "won", ...WON_METADATA }),
      "23514",
      "opportunities_won_closure_check",
    );
  });

  it("perder sin motivo falla por opportunities_loss_reason_stage_check", async () => {
    const { id } = await opportunity(ORG_1, "qualifying");
    await expectSqlError(
      directUpdate(ctxA(), id, { stage: "lost" }),
      "23514",
      "opportunities_loss_reason_stage_check",
    );
  });

  it("una pérdida con datos de venta falla por opportunities_won_closure_check", async () => {
    const { id } = await opportunity(ORG_1, "negotiating");
    await expectSqlError(
      directUpdate(ctxA(), id, {
        stage: "lost",
        ...LOST_METADATA,
        ...WON_METADATA,
      }),
      "23514",
      "opportunities_won_closure_check",
    );
  });

  it("una venta con motivo de pérdida falla por opportunities_loss_reason_stage_check", async () => {
    const { id } = await opportunity(ORG_1, "negotiating");
    await expectSqlError(
      directUpdate(ctxA(), id, {
        stage: "won",
        ...WON_METADATA,
        lossReason: "price",
      }),
      "23514",
      "opportunities_loss_reason_stage_check",
    );
  });

  it("notas en una venta fallan por opportunities_loss_notes_stage_check", async () => {
    const { id } = await opportunity(ORG_1, "negotiating");
    await expectSqlError(
      directUpdate(ctxA(), id, {
        stage: "won",
        ...WON_METADATA,
        lossNotes: "nota",
      }),
      "23514",
      "opportunities_loss_notes_stage_check",
    );
  });

  /*
   * Cada caso viola un solo CHECK de valores: el resto de la fila es una
   * venta (o pérdida) válida.
   */
  it.each([
    ["sale_price = 0", { salePrice: "0" }, "opportunities_sale_price_check"],
    [
      "sale_price negativo",
      { salePrice: "-1.00" },
      "opportunities_sale_price_check",
    ],
    [
      "guaraníes con decimales",
      { salePrice: "150000.50", saleCurrency: "PYG" },
      "opportunities_sale_price_check",
    ],
    [
      "una moneda fuera de la lista",
      { saleCurrency: "EUR" },
      "opportunities_sale_currency_check",
    ],
    [
      "una forma de pago fuera de la lista",
      { paymentMethod: "credit" },
      "opportunities_payment_method_check",
    ],
    [
      "un estado de entrega fuera de la lista",
      { deliveryStatus: "pending" },
      "opportunities_delivery_status_check",
    ],
    [
      "una fecha anterior a 2000",
      { deliveryDate: "1999-12-31" },
      "opportunities_delivery_date_check",
    ],
    [
      "una fecha posterior a 2100",
      { deliveryDate: "2101-01-01" },
      "opportunities_delivery_date_check",
    ],
  ] as const)(
    "una venta con %s falla por su CHECK",
    async (_, values, check) => {
      const { id } = await opportunity(ORG_1, "negotiating");
      await expectSqlError(
        directUpdate(ctxA(), id, {
          stage: "won",
          ...WON_METADATA,
          ...values,
        } as Update),
        "23514",
        check,
      );
      expect((await row(id))!.stage).toBe("negotiating");
    },
  );

  it.each([
    [
      "un motivo de DEC-032 que ya no existe",
      { lossReason: "bought_elsewhere" },
      "opportunities_loss_reason_check",
    ],
    [
      "un motivo desconocido",
      { lossReason: "caro" },
      "opportunities_loss_reason_check",
    ],
    ["notas vacías", { lossNotes: "" }, "opportunities_loss_notes_check"],
    [
      "notas sin recortar",
      { lossNotes: " hola" },
      "opportunities_loss_notes_check",
    ],
    [
      "notas con un tabulador",
      { lossNotes: "a\tb" },
      "opportunities_loss_notes_check",
    ],
    [
      "notas de 501 caracteres",
      { lossNotes: "x".repeat(501) },
      "opportunities_loss_notes_check",
    ],
  ] as const)(
    "una pérdida con %s falla por su CHECK",
    async (_, values, check) => {
      const { id } = await opportunity(ORG_1, "qualifying");
      await expectSqlError(
        withTenant(ctxA(), (tx) =>
          tx.execute(
            sql`UPDATE public.opportunities SET stage = 'lost',
            loss_reason = ${"lossReason" in values ? values.lossReason : "price"},
            loss_notes = ${"lossNotes" in values ? values.lossNotes : null}
            WHERE id = ${id}`,
          ),
        ),
        "23514",
        check,
      );
      expect((await row(id))!.stage).toBe("qualifying");
    },
  );

  it("notas de 500 caracteres con un salto de línea pasan", async () => {
    const { id } = await opportunity(ORG_1, "qualifying");
    const notes = `${"x".repeat(250)}\n${"y".repeat(249)}`;
    await directUpdate(ctxA(), id, {
      stage: "lost",
      lossReason: "other",
      lossNotes: notes,
    });
    expect((await row(id))!.lossNotes).toBe(notes);
  });
});

describe("la base mantiene inmutable el cierre (trigger)", () => {
  it.each([
    ["el precio", { salePrice: "1.00" }],
    ["la moneda y el precio", { salePrice: "1000000", saleCurrency: "PYG" }],
    ["la forma de pago", { paymentMethod: "mixed" }],
    ["el estado de la entrega", { deliveryStatus: "scheduled" }],
    ["la fecha de entrega", { deliveryDate: "2026-10-02" }],
  ] as const)(
    "una venta no cambia %s: opportunities_closure_immutable",
    async (_, values) => {
      const { id } = await opportunity(ORG_1, "won");
      const before = await row(id);
      await expectSqlError(
        directUpdate(ctxA(), id, values),
        "23514",
        "opportunities_closure_immutable",
      );
      expect(await row(id)).toEqual(before);
    },
  );

  it.each([
    ["el motivo", { lossReason: "other" }],
    ["las notas", { lossNotes: "Agregado después" }],
  ] as const)(
    "una pérdida no cambia %s: opportunities_closure_immutable",
    async (_, values) => {
      const { id } = await opportunity(ORG_1, "lost");
      const before = await row(id);
      await expectSqlError(
        directUpdate(ctxA(), id, values),
        "23514",
        "opportunities_closure_immutable",
      );
      expect(await row(id)).toEqual(before);
    },
  );

  it("los metadatos de cierre no se adelantan en un avance que no cierra", async () => {
    const { id } = await opportunity(ORG_1, "qualifying");
    await expectSqlError(
      directUpdate(ctxA(), id, { stage: "negotiating", lossNotes: "nota" }),
      "23514",
      "opportunities_closure_immutable",
    );
    // Ni sin pase de etapa en una abierta.
    await expectSqlError(
      directUpdate(ctxA(), id, { paymentMethod: "cash" }),
      "23514",
      "opportunities_closure_immutable",
    );
    expect((await row(id))!.stage).toBe("qualifying");
  });

  it("ni junto con un cambio de unidad En negociación", async () => {
    const { id } = await opportunity(ORG_1, "negotiating");
    const other = await vehicle(ORG_1);
    await expectSqlError(
      directUpdate(ctxA(), id, { vehicleId: other, paymentMethod: "cash" }),
      "23514",
      "opportunities_closure_immutable",
    );
  });

  it("la unidad vendida queda fija: ni cambiarla ni quitarla (opportunities_vehicle_link)", async () => {
    const { id, vehicleId } = await opportunity(ORG_1, "won");
    const other = await vehicle(ORG_1);
    for (const next of [other, null]) {
      await expectSqlError(
        directUpdate(ctxA(), id, { vehicleId: next }),
        "23514",
        "opportunities_vehicle_link",
      );
    }
    expect((await row(id))!.vehicleId).toBe(vehicleId);
    // Y por la puerta oficial, stage_not_allowed sin escribir.
    expect(
      await setOpportunityVehicle(ctxA(), {
        opportunityId: id,
        vehicleId: null,
      }),
    ).toEqual({
      outcome: "stage_not_allowed",
      opportunityId: id,
      stage: "won",
    });
  });

  it("ni el rol dueño ni el superusuario reescriben un cierre", async () => {
    const won = await opportunity(ORG_1, "won");
    const lost = await opportunity(ORG_1, "lost");
    await expect(
      db.admin`UPDATE public.opportunities SET sale_price = 1 WHERE id = ${won.id}`,
    ).rejects.toMatchObject({
      code: "23514",
      constraint_name: "opportunities_closure_immutable",
    });
    const owner = postgres(db.migrationUrl, { max: 1, onnotice: () => {} });
    try {
      await expect(
        owner`UPDATE public.opportunities SET loss_reason = 'other' WHERE id = ${lost.id}`,
      ).rejects.toMatchObject({
        code: "23514",
        constraint_name: "opportunities_closure_immutable",
      });
      // Tampoco cerrar sin metadatos: el CHECK no distingue roles.
      const open = await opportunity(ORG_1, "negotiating");
      await expect(
        owner`UPDATE public.opportunities SET stage = 'won' WHERE id = ${open.id}`,
      ).rejects.toMatchObject({
        code: "23514",
        constraint_name: "opportunities_won_closure_check",
      });
    } finally {
      await owner.end();
    }
    expect((await row(won.id))!.salePrice).toBe(WON_METADATA.salePrice);
    expect((await row(lost.id))!.lossReason).toBe(LOST_METADATA.lossReason);
  });
});

describe("privilegios y RLS del cierre", () => {
  it("authenticated actualiza los metadatos solo por columna: el resto sigue en 42501", async () => {
    const [columns] = await db.admin<{ names: string[] }[]>`
      SELECT array_agg(attname::text ORDER BY attname) AS names
      FROM pg_attribute
      WHERE attrelid = 'public.opportunities'::regclass AND attnum > 0
        AND NOT attisdropped
        AND has_column_privilege('authenticated', attrelid, attnum, 'UPDATE')
    `;
    expect(columns!.names).toEqual([
      "delivery_date",
      "delivery_status",
      "loss_notes",
      "loss_reason",
      "payment_method",
      "sale_currency",
      "sale_price",
      "stage",
      "updated_at",
      "vehicle_id",
    ]);
    const { id } = await opportunity(ORG_1, "negotiating");
    await expectSqlError(
      withTenant(ctxA(), (tx) =>
        tx.execute(
          sql`UPDATE public.opportunities SET stage = 'won', sale_price = 1,
            sale_currency = 'USD', payment_method = 'cash',
            delivery_status = 'delivered', delivery_date = '2026-10-01',
            last_activity_at = now() WHERE id = ${id}`,
        ),
      ),
      "42501",
    );
    expect((await row(id))!.stage).toBe("negotiating");
  });

  it("una oportunidad de otra organización no se ve para cerrarla: 0 filas", async () => {
    const foreign = await opportunity(ORG_2, "negotiating");
    const before = await row(foreign.id);
    expect(
      await directUpdate(ctxA(), foreign.id, { stage: "won", ...WON_METADATA }),
    ).toEqual([]);
    // C: ORG_1 y ORG_3 activas, ORG_2 inactiva.
    expect(
      await directUpdate(tenantContext(USER_C, ORG_1), foreign.id, {
        stage: "lost",
        ...LOST_METADATA,
      }),
    ).toEqual([]);
    expect(await row(foreign.id)).toEqual(before);
  });

  it("una membership inactiva no cierra (la policy no encuentra la organización)", async () => {
    const { id } = await opportunity(ORG_1, "negotiating");
    const before = await row(id);
    expect(
      await directUpdate(tenantContext(USER_D, ORG_1), id, {
        stage: "lost",
        ...LOST_METADATA,
      }),
    ).toEqual([]);
    expect(await row(id)).toEqual(before);
  });

  it("el filtro de organización del módulo es defensa en profundidad: con la organización de otro tenant en el contexto, no se ve", async () => {
    const { id } = await opportunity(ORG_1, "negotiating");
    const before = await row(id);
    expect(
      await closeOpportunityWithMetadata(tenantContext(USER_B, ORG_2), {
        opportunityId: id,
        closure: { outcome: "lost", lossReason: "price", lossNotes: null },
      }),
    ).toEqual({ outcome: "not_found" });
    expect(await row(id)).toEqual(before);
  });

  it("app_runtime fuera del boundary y anon no cierran (42501)", async () => {
    const { id } = await opportunity(ORG_1, "qualifying");
    await expect(
      runtimePool()`UPDATE public.opportunities SET stage = 'lost', loss_reason = 'price' WHERE id = ${id}`,
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      db.admin.begin(async (tx: TransactionSql) => {
        await tx`SET LOCAL ROLE anon`;
        await tx`UPDATE public.opportunities SET stage = 'lost', loss_reason = 'price' WHERE id = ${id}`;
      }),
    ).rejects.toMatchObject({ code: "42501" });
    // authenticated sin claims: la policy no encuentra organizaciones.
    const touched = await runtimePool().begin(async (tx) => {
      await tx`SELECT set_config('role', 'authenticated', true)`;
      return tx`UPDATE public.opportunities SET stage = 'lost', loss_reason = 'price' WHERE id = ${id} RETURNING id`;
    });
    expect(touched).toHaveLength(0);
    expect((await row(id))!.stage).toBe("qualifying");
  });

  it("el INSERT sigue naciendo en `new`: no se crea una oportunidad ya cerrada", async () => {
    sequence += 1;
    const [contact] = await db.admin<{ id: string }[]>`
      INSERT INTO public.contacts (organization_id, name)
      VALUES (${ORG_1}, ${`Insert cierre ${sequence}`}) RETURNING id
    `;
    const hilux = await vehicle(ORG_1);
    await expectSqlError(
      withTenant(ctxA(), (tx) =>
        tx.insert(opportunities).values({
          organizationId: ORG_1,
          contactId: contact!.id,
          stage: "won",
          source: "web",
          vehicleId: hilux,
          ...WON_METADATA,
        }),
      ),
      "42501",
    );
  });
});

/*
 * Dos pedidos sobre la misma oportunidad casi a la vez. El módulo bloquea la
 * fila (SELECT … FOR UPDATE): el que llega segundo espera, lee la etapa ya
 * confirmada y el dominio decide sobre ella. Nunca ganada y perdida, nunca
 * dos cierres, nunca metadatos pisados.
 */
describe("concurrencia: la fila bloqueada serializa los cierres", () => {
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

  async function whileRowIsHeld<T>(
    id: string,
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

  const WON: Closure = {
    outcome: "won",
    salePrice: { amount: "47500.00", currency: "USD" },
    paymentMethod: "cash",
    deliveryStatus: "delivered",
    deliveryDate: "2026-10-01",
  };

  it("ganar y perder a la vez: uno cierra y el otro ve la etapa real, nunca ganada y perdida", async () => {
    const { id } = await opportunity(ORG_1, "negotiating");
    const [won, lost] = await whileRowIsHeld(
      id,
      () =>
        Promise.all([
          closeOpportunityWithMetadata(tenantContext(USER_A, ORG_1), {
            opportunityId: id,
            closure: WON,
          }),
          closeOpportunityWithMetadata(tenantContext(USER_C, ORG_1), {
            opportunityId: id,
            closure: { outcome: "lost", lossReason: "price", lossNotes: null },
          }),
        ]),
      2,
    );
    const final = (await row(id))!;
    expect(["won", "lost"]).toContain(final.stage);
    if (final.stage === "won") {
      expect(won).toMatchObject({ outcome: "closed", to: "won" });
      expect(lost).toEqual({
        outcome: "invalid_transition",
        opportunityId: id,
        current: "won",
      });
      expect(final).toMatchObject({ lossReason: null, salePrice: "47500.00" });
    } else {
      expect(lost).toMatchObject({ outcome: "closed", to: "lost" });
      expect(won).toEqual({
        outcome: "invalid_transition",
        opportunityId: id,
        current: "lost",
      });
      expect(final).toMatchObject({ lossReason: "price", salePrice: null });
    }
  });

  it("dos ventas con montos distintos a la vez: queda la primera, la segunda es unchanged", async () => {
    const { id } = await opportunity(ORG_1, "negotiating");
    const results = await whileRowIsHeld(
      id,
      () =>
        Promise.all([
          closeOpportunityWithMetadata(tenantContext(USER_A, ORG_1), {
            opportunityId: id,
            closure: WON,
          }),
          closeOpportunityWithMetadata(tenantContext(USER_C, ORG_1), {
            opportunityId: id,
            closure: {
              ...WON,
              salePrice: { amount: "1.00", currency: "USD" },
            },
          }),
        ]),
      2,
    );
    expect(results.filter((r) => r.outcome === "closed")).toHaveLength(1);
    expect(results.filter((r) => r.outcome === "unchanged")).toHaveLength(1);
    const winner = results.findIndex((r) => r.outcome === "closed");
    expect((await row(id))!.salePrice).toBe(winner === 0 ? "47500.00" : "1.00");
  });

  it("ganar y quitar la unidad a la vez: nunca una venta sin unidad", async () => {
    const { id } = await opportunity(ORG_1, "negotiating");
    const [won, unlinked] = await whileRowIsHeld(
      id,
      () =>
        Promise.all([
          closeOpportunityWithMetadata(tenantContext(USER_A, ORG_1), {
            opportunityId: id,
            closure: WON,
          }),
          setOpportunityVehicle(tenantContext(USER_C, ORG_1), {
            opportunityId: id,
            vehicleId: null,
          }),
        ]),
      2,
    );
    const final = (await row(id))!;
    if (final.stage === "won") {
      expect(won).toMatchObject({ outcome: "closed" });
      expect(unlinked).toEqual({
        outcome: "stage_not_allowed",
        opportunityId: id,
        stage: "won",
      });
      expect(final.vehicleId).not.toBeNull();
    } else {
      expect(unlinked).toMatchObject({ outcome: "unlinked" });
      expect(won).toEqual({ outcome: "vehicle_required", opportunityId: id });
      expect(final).toMatchObject({
        stage: "negotiating",
        vehicleId: null,
        salePrice: null,
      });
    }
  });

  it("por la Server Action, dos cierres simultáneos del mismo usuario: uno closed y otro unchanged", async () => {
    const { id } = await opportunity(ORG_1, "qualifying");
    request(USER_A);
    const results = await whileRowIsHeld(
      id,
      () =>
        Promise.all([
          close(id, { outcome: "lost", lossReason: "price" }),
          close(id, { outcome: "lost", lossReason: "price" }),
        ]),
      2,
    );
    expect(results.map((result) => result?.status).sort()).toEqual([
      "closed",
      "unchanged",
    ]);
    expect((await row(id))!.stage).toBe("lost");
  });
});

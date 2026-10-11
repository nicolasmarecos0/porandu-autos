import { randomUUID } from "node:crypto";

import { eq, sql } from "drizzle-orm";
import postgres, { type TransactionSql } from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { transitionOpportunityStage } from "@/db/queries/change-opportunity-stage";
import { getOpportunityDetail } from "@/db/queries/opportunity-detail";
import { getOpportunityQueue } from "@/db/queries/opportunities";
import { opportunities } from "@/db/schema";
import { withTenant, type TenantContext } from "@/db/tenant";
import {
  canTransition,
  OPPORTUNITY_STAGES,
  type Stage,
} from "@/domains/opportunities/stages";
import {
  changeOpportunityStage,
  closeOpportunity,
} from "@/lib/opportunities/actions";
import type { ChangeStageState } from "@/lib/opportunities/stage-change";
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
 * Etapas de la oportunidad (H1.6, DEC-032) de punta a punta contra
 * PostgreSQL 17 con las migraciones aplicadas. Los avances van por
 * changeOpportunityStage(); los cierres (`won` y `lost`, con sus metadatos)
 * tienen su propia puerta y su propio archivo (opportunity-closure.test.ts,
 * DEC-034), pero el trigger se cruza acá con los 25 pares:
 *
 *   Server Action → requireTenant() → validación del pedido → withTenant() →
 *   SELECT … FOR UPDATE → máquina de estados del dominio → UPDATE → RLS
 *   (policy de UPDATE) + trigger de transiciones → loaders
 *
 * La acción, la escritura y los loaders son los reales, conectados como
 * app_runtime. Supabase Auth (claims ya verificados), la cookie, redirect()
 * y revalidatePath() de Next son simulados, como en vehicle-availability.test.ts.
 *
 * Tenants (support/tenants.ts): A: admin de ORG_1 · B: admin de ORG_2 · C:
 * seller de ORG_1 y admin de ORG_3, seller inactivo de ORG_2 · D: solo
 * inactiva en ORG_1 · E: sin memberships.
 *
 * Cada caso usa sus propias oportunidades (insertadas con el superusuario, en
 * la etapa que necesita) para no depender del orden de los demás.
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

let sequence = 0;

/**
 * Una oportunidad propia del caso, en `stage`, creada (y actualizada por
 * última vez) hace un día: así se ve si el cambio toca `updated_at` y que no
 * toca `last_activity_at`. Cerrada, trae metadatos de cierre válidos
 * (DEC-034), y `won` (o `negotiating` con `withVehicle`), su unidad.
 */
async function opportunity(
  organizationId: string,
  stage: Stage = "new",
  { withVehicle = stage === "won" } = {},
): Promise<string> {
  sequence += 1;
  const contactId = randomUUID();
  const id = randomUUID();
  let vehicleId: string | null = null;
  if (withVehicle) {
    vehicleId = randomUUID();
    await db.admin`
      INSERT INTO public.vehicles (id, organization_id, brand, model, year,
        status)
      VALUES (${vehicleId}, ${organizationId}, 'Toyota', 'Hilux', 2025,
        'available')
    `;
  }
  await db.admin`
    INSERT INTO public.contacts (id, organization_id, name)
    VALUES (${contactId}, ${organizationId}, ${`Prueba H1.6 ${sequence}`})
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
  return id;
}

type OpportunityRow = {
  organizationId: string;
  contactId: string;
  stage: Stage;
  lossReason: string | null;
  source: string;
  lastActivityAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

/** La fila tal como está en la base (sin RLS). */
async function row(id: string): Promise<OpportunityRow | undefined> {
  const [found] = await db.admin<OpportunityRow[]>`
    SELECT organization_id AS "organizationId", contact_id AS "contactId",
      stage, loss_reason AS "lossReason", source,
      last_activity_at AS "lastActivityAt", created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM public.opportunities WHERE id = ${id}
  `;
  return found;
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.append(name, value);
  return data;
}

function change(
  opportunityId: string,
  stage: string,
  extra: Record<string, string> = {},
): Promise<ChangeStageState> {
  return changeOpportunityStage(null, form({ opportunityId, stage, ...extra }));
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
      .returning({ id: opportunities.id, stage: opportunities.stage }),
  );
}

const ctxA = () => tenantContext(USER_A, ORG_1);

describe("Server Action: requireTenant() → validación → withTenant() → UPDATE", () => {
  it("admin (A) avanza de Nueva a En calificación: cambia stage y updated_at, y nada más", async () => {
    const id = await opportunity(ORG_1);
    const before = await row(id);
    request(USER_A);

    expect(await change(id, "qualifying")).toEqual({
      status: "changed",
      opportunityId: id,
      from: "new",
      to: "qualifying",
    });
    expect(mocks.revalidated).toEqual([
      "/opportunities",
      `/opportunities/${id}`,
    ]);

    const after = await row(id);
    expect(after).toEqual({
      ...before,
      stage: "qualifying",
      updatedAt: expect.any(Date),
    });
    expect(after!.updatedAt.getTime()).toBeGreaterThan(
      before!.updatedAt.getTime(),
    );
    // DEC-032 §7: la recencia del cliente no es el trabajo del vendedor.
    expect(after!.lastActivityAt).toEqual(before!.lastActivityAt);
    expect(after!.createdAt).toEqual(before!.createdAt);
    expect(after!.lossReason).toBeNull();
  });

  it("seller (C con ORG_1 activa) recorre el flujo hasta En negociación; un cambio no depende de quién lo hizo antes", async () => {
    const id = await opportunity(ORG_1);
    request(USER_A);
    expect(await change(id, "qualifying")).toMatchObject({ status: "changed" });
    request(USER_C, ORG_1);
    expect(await change(id, "negotiating")).toMatchObject({
      status: "changed",
      from: "qualifying",
      to: "negotiating",
    });
    expect(await row(id)).toMatchObject({
      stage: "negotiating",
      lossReason: null,
    });
  });

  it("C con ORG_3 activa (admin) mueve una oportunidad de ORG_3", async () => {
    const id = await opportunity(ORG_3);
    request(USER_C, ORG_3);
    expect(await change(id, "qualifying")).toMatchObject({ status: "changed" });
    expect((await row(id))!.stage).toBe("qualifying");
  });

  it.each([
    ["new", "lost"],
    ["qualifying", "lost"],
    ["negotiating", "lost"],
    ["negotiating", "won"],
  ] as const)(
    "un cierre (%s → %s) no va por acá: closure_required, no escribe ni revalida (DEC-034 §1)",
    async (from, to) => {
      const id = await opportunity(ORG_1, from, {
        withVehicle: from === "negotiating",
      });
      const before = await row(id);
      request(USER_A);
      expect(await change(id, to, { lossReason: "price" })).toEqual({
        status: "closure_required",
        opportunityId: id,
        current: from,
      });
      expect(await row(id)).toEqual(before);
      expect(mocks.revalidated).toEqual([]);
    },
  );

  it("un motivo de pérdida con otra etapa de destino se descarta: no queda en la fila", async () => {
    const id = await opportunity(ORG_1, "qualifying");
    request(USER_A);
    expect(
      await change(id, "negotiating", { lossReason: "price" }),
    ).toMatchObject({ status: "changed" });
    expect(await row(id)).toMatchObject({
      stage: "negotiating",
      lossReason: null,
    });
  });

  it.each([
    ["new", "negotiating"],
    ["new", "won"],
    ["qualifying", "won"],
    ["qualifying", "new"],
    ["negotiating", "qualifying"],
    ["negotiating", "new"],
  ] as const)(
    "un pase que la máquina no permite (%s → %s) no escribe y devuelve la etapa real",
    async (from, to) => {
      const id = await opportunity(ORG_1, from);
      const before = await row(id);
      request(USER_A);
      expect(await change(id, to, { lossReason: "price" })).toEqual({
        status: "invalid_transition",
        opportunityId: id,
        current: from,
      });
      expect(await row(id)).toEqual(before);
      // Se revalida para que el panel muestre el estado real.
      expect(mocks.revalidated).toEqual([
        "/opportunities",
        `/opportunities/${id}`,
      ]);
    },
  );

  it.each([
    ["won", "lost"],
    ["won", "qualifying"],
    ["won", "new"],
    ["lost", "won"],
    ["lost", "negotiating"],
    ["lost", "new"],
  ] as const)(
    "una oportunidad cerrada no se reabre ni cambia de cierre (%s → %s)",
    async (from, to) => {
      const id = await opportunity(ORG_1, from);
      const before = await row(id);
      request(USER_A);
      expect(await change(id, to, { lossReason: "price" })).toMatchObject({
        status: "invalid_transition",
        current: from,
      });
      expect(await row(id)).toEqual(before);
    },
  );

  it.each(OPPORTUNITY_STAGES)(
    "pedir la etapa actual (%s) es unchanged: no escribe, no toca updated_at, no revalida",
    async (stage) => {
      const id = await opportunity(ORG_1, stage);
      const before = await row(id);
      request(USER_A);
      expect(await change(id, stage, { lossReason: "price" })).toEqual({
        status: "unchanged",
        opportunityId: id,
        stage,
      });
      expect(await row(id)).toEqual(before);
      expect(mocks.revalidated).toEqual([]);
    },
  );

  it("sin sesión o sin membership activa no llega a la base", async () => {
    const id = await opportunity(ORG_1);
    const before = await row(id);
    for (const [userId, path] of [
      [null, "/login"],
      [USER_D, "/no-access"],
      [USER_E, "/no-access"],
    ] as const) {
      request(userId);
      expect(await redirectOf(change(id, "qualifying"))).toBe(path);
    }
    expect(await row(id)).toEqual(before);
  });

  it("una oportunidad de otra organización es not_found, aun con membership activa en ambas", async () => {
    const foreign = await opportunity(ORG_2);
    const foreign3 = await opportunity(ORG_3);
    const before = [await row(foreign), await row(foreign3)];

    // A solo pertenece a ORG_1.
    request(USER_A);
    expect(await change(foreign, "qualifying")).toEqual({
      status: "not_found",
    });
    // C pertenece a ORG_1 y ORG_3: con ORG_1 activa, la de ORG_3 no se ve.
    request(USER_C, ORG_1);
    expect(await change(foreign3, "qualifying")).toEqual({
      status: "not_found",
    });
    // Su membership inactiva en ORG_2 no cuenta.
    request(USER_C, ORG_1);
    expect(await change(foreign, "qualifying")).toEqual({
      status: "not_found",
    });

    expect([await row(foreign), await row(foreign3)]).toEqual(before);
    expect(mocks.revalidated).toEqual([]);
  });

  it("organización, etapa de origen y reloj del pedido no tienen efecto", async () => {
    const mine = await opportunity(ORG_1);
    const foreign = await opportunity(ORG_2);
    const foreignBefore = await row(foreign);
    request(USER_A);
    expect(
      await change(mine, "qualifying", {
        organizationId: ORG_2,
        organization_id: ORG_2,
        from: "negotiating",
        updated_at: "2000-01-01T00:00:00Z",
        updatedAt: "2000-01-01T00:00:00Z",
        lastActivityAt: "2000-01-01T00:00:00Z",
        userId: USER_B,
      }),
    ).toMatchObject({ status: "changed", from: "new", to: "qualifying" });

    const after = await row(mine);
    expect(after).toMatchObject({ organizationId: ORG_1, stage: "qualifying" });
    expect(after!.updatedAt.getFullYear()).toBeGreaterThan(2020);
    expect(await row(foreign)).toEqual(foreignBefore);
  });

  it.each([
    ["sin id", { stage: "qualifying" }],
    ["un id que no es UUID", { opportunityId: "123", stage: "qualifying" }],
    [
      "una inyección en el id",
      { opportunityId: "x' OR '1'='1", stage: "qualifying" },
    ],
  ])("un pedido con %s es not_found", async (_, fields) => {
    request(USER_A);
    expect(await changeOpportunityStage(null, form(fields))).toEqual({
      status: "not_found",
    });
  });

  it.each(["", "qualified", "test_drive", "negotiation", "sold"])(
    "la etapa %j no existe: invalid, nada se escribe",
    async (stage) => {
      const id = await opportunity(ORG_1);
      const before = await row(id);
      request(USER_A);
      expect(await change(id, stage)).toEqual({ status: "invalid" });
      expect(await row(id)).toEqual(before);
    },
  );

  it("un id UUID inexistente es not_found", async () => {
    request(USER_A);
    expect(await change(randomUUID(), "qualifying")).toEqual({
      status: "not_found",
    });
  });
});

describe("los loaders reflejan la etapa", () => {
  it("la cola muestra la etapa nueva, solo en su organización", async () => {
    const id = await opportunity(ORG_1);
    request(USER_A);
    const stageOf = async (userId: string) => {
      request(userId);
      const queue = await getOpportunityQueue();
      return queue.opportunities.find((o) => o.id === id)?.stage;
    };
    expect(await stageOf(USER_A)).toBe("new");

    request(USER_A);
    await change(id, "qualifying");
    expect(await stageOf(USER_A)).toBe("qualifying");
    // Otra organización no la ve.
    expect(await stageOf(USER_B)).toBeUndefined();

    request(USER_A);
    await closeOpportunity(
      null,
      form({ opportunityId: id, outcome: "lost", lossReason: "ghosted" }),
    );
    expect(await stageOf(USER_A)).toBe("lost");
  });

  it("el detalle trae la etapa y, cerrada, su cierre; es notFound en otra organización", async () => {
    const id = await opportunity(ORG_1, "negotiating");
    request(USER_A);
    expect(await getOpportunityDetail(id)).toMatchObject({
      id,
      stage: "negotiating",
      closure: null,
    });
    request(USER_A);
    await closeOpportunity(
      null,
      form({ opportunityId: id, outcome: "lost", lossReason: "price" }),
    );

    request(USER_C, ORG_1);
    expect(await getOpportunityDetail(id)).toMatchObject({
      stage: "lost",
      closure: { outcome: "lost", reason: "Precio", notes: null },
    });
    request(USER_B);
    expect(await getOpportunityDetail(id)).toBeNull();
  });

  it("cambiar de etapa no modifica la demanda ni el orden de la cola (last_activity_at)", async () => {
    const id = await opportunity(ORG_1);
    request(USER_A);
    const before = (await getOpportunityQueue()).opportunities.find(
      (o) => o.id === id,
    );
    request(USER_A);
    await change(id, "qualifying");
    request(USER_A);
    const after = (await getOpportunityQueue()).opportunities.find(
      (o) => o.id === id,
    );
    expect(after!.lastActivity.minutes).toBeGreaterThanOrEqual(
      before!.lastActivity.minutes,
    );
    expect(after!.demand).toEqual(before!.demand);
  });
});

/*
 * La máquina de estados vive dos veces: en el dominio (planStageChange y
 * planOpportunityClosure, que deciden qué se ofrece y qué se escribe) y en
 * el trigger de la base (que lo exige aunque el código falle). Acá se cruzan
 * los 25 pares: un UPDATE directo por el boundary, sin pasar por la Server
 * Action ni por el dominio. Un pase a `won` o `lost` lleva sus metadatos de
 * cierre (DEC-034), y la oportunidad En negociación, su unidad: así lo único
 * que decide es el par.
 */
describe("el trigger de la base espeja la máquina del dominio (25 pares)", () => {
  const pairs = OPPORTUNITY_STAGES.flatMap((from) =>
    OPPORTUNITY_STAGES.map((to) => [from, to] as const),
  );

  /** La UPDATE del pase: con `won` o `lost`, sus metadatos. */
  function pass(to: Stage) {
    if (to === "won") return { stage: to, lossReason: null, ...WON_METADATA };
    if (to === "lost") return { stage: to, ...LOST_METADATA };
    return { stage: to, lossReason: null };
  }

  it.each(pairs)("%s → %s", async (from, to) => {
    const id = await opportunity(ORG_1, from, {
      withVehicle: from === "negotiating" || from === "won",
    });
    const before = await row(id);
    const attempt = directUpdate(ctxA(), id, pass(to));

    if (canTransition(from, to)) {
      expect(await attempt).toEqual([{ id, stage: to }]);
      expect(await row(id)).toMatchObject({
        stage: to,
        lossReason: to === "lost" ? "price" : null,
      });
    } else {
      await expectSqlError(attempt, "23514", "opportunities_stage_transition");
      expect(await row(id)).toEqual(before);
    }
  });
});

describe("la base exige la coherencia del motivo de pérdida y del reloj", () => {
  it("perder sin motivo falla por CHECK, aunque el par sea válido", async () => {
    const id = await opportunity(ORG_1, "qualifying");
    await expectSqlError(
      directUpdate(ctxA(), id, { stage: "lost", lossReason: null }),
      "23514",
      "opportunities_loss_reason_stage_check",
    );
    expect((await row(id))!.stage).toBe("qualifying");
  });

  it("un motivo en un avance que no cierra lo rechaza el trigger (DEC-034 §5)", async () => {
    const id = await opportunity(ORG_1, "qualifying");
    await expectSqlError(
      directUpdate(ctxA(), id, { stage: "negotiating", lossReason: "price" }),
      "23514",
      "opportunities_closure_immutable",
    );
    expect((await row(id))!.stage).toBe("qualifying");
  });

  it("un motivo fuera de la lista falla por CHECK", async () => {
    const id = await opportunity(ORG_1, "new");
    await expectSqlError(
      withTenant(ctxA(), (tx) =>
        tx.execute(
          sql`UPDATE public.opportunities SET stage = 'lost', loss_reason = 'caro' WHERE id = ${id}`,
        ),
      ),
      "23514",
      "opportunities_loss_reason_check",
    );
  });

  it("el motivo de una oportunidad perdida no se reescribe (DEC-034 §4)", async () => {
    const id = await opportunity(ORG_1, "lost");
    await expectSqlError(
      directUpdate(ctxA(), id, { lossReason: "other" }),
      "23514",
      "opportunities_closure_immutable",
    );
    await expectSqlError(
      directUpdate(ctxA(), id, { stage: "lost", lossReason: "other" }),
      "23514",
      "opportunities_closure_immutable",
    );
    expect((await row(id))!.lossReason).toBe("price");
  });

  it("toda UPDATE es un cambio de etapa: tocar solo updated_at falla", async () => {
    const id = await opportunity(ORG_1, "new");
    await expectSqlError(
      directUpdate(ctxA(), id, { updatedAt: new Date() }),
      "23514",
      "opportunities_stage_transition",
    );
  });

  it("updated_at lo fija la base con su reloj, no el pedido", async () => {
    const id = await opportunity(ORG_1, "new");
    await directUpdate(ctxA(), id, {
      stage: "qualifying",
      updatedAt: new Date("2000-01-01T00:00:00Z"),
    });
    const after = await row(id);
    expect(after!.updatedAt.getFullYear()).toBeGreaterThan(2020);
    const [now] = await db.admin<{ delta: number }[]>`
      SELECT extract(epoch FROM (now() - updated_at))::float AS delta
      FROM public.opportunities WHERE id = ${id}
    `;
    expect(now!.delta).toBeLessThan(60);
  });

  it("ni el rol dueño se salta la máquina: el superusuario tampoco cambia una etapa fuera de ella", async () => {
    const id = await opportunity(ORG_1, "new");
    await expect(
      db.admin`UPDATE public.opportunities SET stage = 'won' WHERE id = ${id}`,
    ).rejects.toMatchObject({
      code: "23514",
      constraint_name: "opportunities_stage_transition",
    });
    const owner = postgres(db.migrationUrl, { max: 1, onnotice: () => {} });
    try {
      await expect(
        owner`UPDATE public.opportunities SET last_activity_at = now() WHERE id = ${id}`,
      ).rejects.toMatchObject({ code: "23514" });
    } finally {
      await owner.end();
    }
    expect((await row(id))!.stage).toBe("new");
  });
});

describe("privilegios y RLS del UPDATE", () => {
  it.each([
    ["organization_id", `'${ORG_2}'::uuid`],
    ["contact_id", "gen_random_uuid()"],
    ["source", "'whatsapp'"],
    ["interest_model", "'Hilux'"],
    ["interest_version", "'SRV'"],
    ["last_activity_at", "now()"],
    ["created_at", "now()"],
    ["id", "gen_random_uuid()"],
  ])(
    "authenticated no puede actualizar %s (42501 por privilegios, antes de RLS)",
    async (column, value) => {
      const id = await opportunity(ORG_1);
      const before = await row(id);
      await expectSqlError(
        withTenant(ctxA(), (tx) =>
          tx.execute(
            sql.raw(
              `UPDATE public.opportunities SET ${column} = ${value} WHERE id = '${id}'`,
            ),
          ),
        ),
        "42501",
      );
      expect(await row(id)).toEqual(before);
    },
  );

  it("una oportunidad de otra organización no se ve para UPDATE: 0 filas, ni aun con membership activa en la propia", async () => {
    const foreign = await opportunity(ORG_2);
    const before = await row(foreign);
    expect(
      await directUpdate(ctxA(), foreign, { stage: "qualifying" }),
    ).toEqual([]);
    // C: ORG_1 y ORG_3 activas, ORG_2 inactiva.
    expect(
      await directUpdate(tenantContext(USER_C, ORG_1), foreign, {
        stage: "qualifying",
      }),
    ).toEqual([]);
    expect(await row(foreign)).toEqual(before);
  });

  it("una membership inactiva no actualiza (la policy no encuentra la organización)", async () => {
    const id = await opportunity(ORG_1);
    const before = await row(id);
    expect(
      await directUpdate(tenantContext(USER_D, ORG_1), id, {
        stage: "qualifying",
      }),
    ).toEqual([]);
    expect(await row(id)).toEqual(before);
  });

  it("el filtro de organización del módulo es defensa en profundidad: con la organización de otro tenant en el contexto, no se ve", async () => {
    const id = await opportunity(ORG_1);
    const before = await row(id);
    // B (admin de ORG_2) con un contexto de ORG_2: la oportunidad es de ORG_1.
    expect(
      await transitionOpportunityStage(tenantContext(USER_B, ORG_2), {
        opportunityId: id,
        to: "qualifying",
      }),
    ).toEqual({ outcome: "not_found" });
    expect(await row(id)).toEqual(before);
  });

  it("DELETE sigue prohibido", async () => {
    const id = await opportunity(ORG_1);
    await expectSqlError(
      withTenant(ctxA(), (tx) =>
        tx.delete(opportunities).where(eq(opportunities.id, id)),
      ),
      "42501",
    );
    expect(await row(id)).toBeDefined();
  });

  it("app_runtime fuera del boundary y anon no actualizan (42501)", async () => {
    const id = await opportunity(ORG_1);
    await expect(
      runtimePool()`UPDATE public.opportunities SET stage = 'qualifying' WHERE id = ${id}`,
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      db.admin.begin(async (tx: TransactionSql) => {
        await tx`SET LOCAL ROLE anon`;
        await tx`UPDATE public.opportunities SET stage = 'qualifying' WHERE id = ${id}`;
      }),
    ).rejects.toMatchObject({ code: "42501" });
    // authenticated sin claims: la policy no encuentra organizaciones.
    const touched = await runtimePool().begin(async (tx) => {
      await tx`SELECT set_config('role', 'authenticated', true)`;
      return tx`UPDATE public.opportunities SET stage = 'qualifying' WHERE id = ${id} RETURNING id`;
    });
    expect(touched).toHaveLength(0);
    expect((await row(id))!.stage).toBe("new");
  });

  it("el INSERT sigue naciendo en `new`: no se crea una oportunidad ya avanzada ni cerrada", async () => {
    sequence += 1;
    const [contact] = await db.admin<{ id: string }[]>`
      INSERT INTO public.contacts (organization_id, name)
      VALUES (${ORG_1}, ${`Insert H1.6 ${sequence}`}) RETURNING id
    `;
    for (const stage of ["qualifying", "negotiating", "won"]) {
      await expectSqlError(
        withTenant(ctxA(), (tx) =>
          tx.insert(opportunities).values({
            organizationId: ORG_1,
            contactId: contact!.id,
            stage: stage as Stage,
            source: "web",
          }),
        ),
        "42501",
      );
    }
  });
});

/*
 * Dos pedidos sobre la misma oportunidad casi a la vez. El módulo bloquea la
 * fila (SELECT … FOR UPDATE): el que llega segundo espera, lee la etapa ya
 * confirmada y el dominio decide sobre ella. Nunca dos transiciones del mismo
 * pase, nunca un pase fuera de la máquina, nunca un cierre pisado.
 */
describe("concurrencia: la fila bloqueada serializa los cambios", () => {
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

  const advance = (ctx: TenantContext, id: string, to: Stage) =>
    transitionOpportunityStage(ctx, { opportunityId: id, to });

  it("admin y seller a la vez (dos pedidos cada uno) piden el mismo pase: exactamente un changed, los demás unchanged", async () => {
    const id = await opportunity(ORG_1);
    const contexts = [
      tenantContext(USER_A, ORG_1),
      tenantContext(USER_C, ORG_1),
      tenantContext(USER_A, ORG_1),
      tenantContext(USER_C, ORG_1),
    ];
    const results = await whileRowIsHeld(
      id,
      async () => {},
      () => Promise.all(contexts.map((ctx) => advance(ctx, id, "qualifying"))),
      contexts.length,
    );
    expect(results.filter((r) => r.outcome === "changed")).toHaveLength(1);
    expect(results.filter((r) => r.outcome === "unchanged")).toEqual(
      Array.from({ length: 3 }, () =>
        expect.objectContaining({ stage: "qualifying" }),
      ),
    );
    expect(await row(id)).toMatchObject({ stage: "qualifying" });
  });

  it("si otra transacción la pasa a En calificación mientras el pedido espera, el pedido no hace una segunda transición", async () => {
    const id = await opportunity(ORG_1);
    const result = await whileRowIsHeld(
      id,
      async (tx) => {
        await tx`UPDATE public.opportunities SET stage = 'qualifying' WHERE id = ${id}`;
      },
      () => advance(tenantContext(USER_A, ORG_1), id, "qualifying"),
      1,
    );
    expect(result).toEqual({
      outcome: "unchanged",
      opportunityId: id,
      stage: "qualifying",
    });
  });

  it("si otra transacción la pierde mientras el pedido espera para avanzarla, el pedido no la reabre", async () => {
    const id = await opportunity(ORG_1);
    const result = await whileRowIsHeld(
      id,
      async (tx) => {
        await tx`UPDATE public.opportunities SET stage = 'lost', loss_reason = 'ghosted' WHERE id = ${id}`;
      },
      () => advance(tenantContext(USER_C, ORG_1), id, "qualifying"),
      1,
    );
    expect(result).toEqual({
      outcome: "invalid_transition",
      opportunityId: id,
      current: "lost",
    });
    expect(await row(id)).toMatchObject({
      stage: "lost",
      lossReason: "ghosted",
    });
  });

  it("por la Server Action, dos pedidos simultáneos del mismo usuario: uno changed y otro unchanged", async () => {
    const id = await opportunity(ORG_1);
    request(USER_A);
    const results = await whileRowIsHeld(
      id,
      async () => {},
      () => Promise.all([change(id, "qualifying"), change(id, "qualifying")]),
      2,
    );
    expect(results.map((result) => result?.status).sort()).toEqual([
      "changed",
      "unchanged",
    ]);
    expect((await row(id))!.stage).toBe("qualifying");
  });
});

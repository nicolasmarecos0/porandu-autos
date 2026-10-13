import { randomUUID } from "node:crypto";

import { eq, sql } from "drizzle-orm";
import type { TransactionSql } from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { getOpportunityDetail } from "@/db/queries/opportunity-detail";
import { insertOpportunityNote } from "@/db/queries/record-opportunity-note";
import { opportunityNotes } from "@/db/schema";
import { withTenant, type TenantContext } from "@/db/tenant";
import { NOTE_MAX_LENGTH } from "@/domains/opportunities/notes";
import { OPPORTUNITY_STAGES, type Stage } from "@/domains/opportunities/stages";
import { addOpportunityNote } from "@/lib/opportunities/actions";
import type { AddNoteState } from "@/lib/opportunities/note";
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
 * Bitácora comercial (Hito 2, DEC-033 §1) de punta a punta contra
 * PostgreSQL 17 con las migraciones aplicadas:
 *
 *   Server Action → requireTenant() → normalizar y validar → withTenant() →
 *   la oportunidad en la organización activa → INSERT append-only → RLS
 *   (WITH CHECK) + FK compuesta + CHECK del texto → loader del detalle
 *
 * La acción, la escritura y el loader son los reales, conectados como
 * app_runtime. Supabase Auth (claims ya verificados), la cookie, redirect()
 * y revalidatePath() de Next son simulados, como en opportunity-stages.test.ts.
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
 * última vez) hace un día: así se ve que una nota solo mueve su recencia.
 * Cerrada, trae metadatos de cierre válidos, y `won`, su unidad (DEC-034).
 */
async function opportunity(
  organizationId: string,
  stage: Stage = "negotiating",
): Promise<string> {
  sequence += 1;
  const contactId = randomUUID();
  const id = randomUUID();
  let vehicleId: string | null = null;
  if (stage === "won") {
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
    VALUES (${contactId}, ${organizationId}, ${`Prueba notas ${sequence}`})
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
      last_activity_at: new Date(Date.now() - 86_400_000),
      created_at: new Date(Date.now() - 86_400_000),
      updated_at: new Date(Date.now() - 86_400_000),
    })}
  `;
  return id;
}

type NoteRecord = {
  id: string;
  organizationId: string;
  opportunityId: string;
  body: string;
  recordedBy: string;
  recordedAt: Date;
};

/** Las notas de una oportunidad tal como están en la base (sin RLS). */
async function notesOf(opportunityId: string): Promise<NoteRecord[]> {
  return db.admin<NoteRecord[]>`
    SELECT id, organization_id AS "organizationId",
      opportunity_id AS "opportunityId", body, recorded_by AS "recordedBy",
      recorded_at AS "recordedAt"
    FROM public.opportunity_notes WHERE opportunity_id = ${opportunityId}
    ORDER BY recorded_at, id
  `;
}

/** La oportunidad tal como está en la base (sin RLS). */
async function opportunityRow(id: string) {
  const [found] = await db.admin`
    SELECT stage, vehicle_id AS "vehicleId", last_activity_at AS "lastActivityAt",
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

function add(opportunityId: string, body: string): Promise<AddNoteState> {
  return addOpportunityNote(null, form({ opportunityId, body }));
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
  values: Partial<typeof opportunityNotes.$inferInsert> &
    Pick<typeof opportunityNotes.$inferInsert, "opportunityId">,
) {
  return withTenant(ctx, (tx) =>
    tx
      .insert(opportunityNotes)
      .values({
        organizationId: ctx.organizationId,
        body: "Nota directa",
        recordedBy: ctx.userId,
        ...values,
      })
      .returning({ id: opportunityNotes.id }),
  );
}

const ctxA = () => tenantContext(USER_A, ORG_1);

describe("Server Action: requireTenant() → validación → withTenant() → INSERT", () => {
  it("admin (A) anota: una fila con su autor, el reloj de la base y el texto normalizado; la oportunidad solo mueve su recencia", async () => {
    const id = await opportunity(ORG_1);
    const before = await opportunityRow(id);
    request(USER_A);

    expect(
      await add(id, "  Pidió cuota fija.\r\n\r\n\r\nVuelve el lunes.  "),
    ).toEqual({ status: "recorded", opportunityId: id });
    // La nota mueve la recencia: la cola también cambia (DEC-036 §1).
    expect(mocks.revalidated).toEqual([
      "/opportunities",
      `/opportunities/${id}`,
    ]);

    const [note, ...rest] = await notesOf(id);
    expect(rest).toEqual([]);
    expect(note).toMatchObject({
      organizationId: ORG_1,
      opportunityId: id,
      body: "Pidió cuota fija.\n\nVuelve el lunes.",
      recordedBy: USER_A,
    });
    const [delta] = await db.admin<{ seconds: number }[]>`
      SELECT extract(epoch FROM (now() - recorded_at))::float AS seconds
      FROM public.opportunity_notes WHERE id = ${note!.id}
    `;
    expect(delta!.seconds).toBeLessThan(60);
    // DEC-036 §1 (supersede DEC-033 §6): la nota mueve la recencia al reloj
    // de su alta. Etapa, unidad y updated_at no cambian.
    const after = await opportunityRow(id);
    expect(after).toEqual({ ...before, lastActivityAt: note!.recordedAt });
    expect(after!.lastActivityAt.getTime()).toBeGreaterThan(
      before!.lastActivityAt.getTime(),
    );
  });

  it("seller (C con ORG_1 activa) anota en la oportunidad de otro; el detalle presenta los autores contra quien mira", async () => {
    const id = await opportunity(ORG_1);
    request(USER_A);
    expect(await add(id, "Primera llamada.")).toMatchObject({
      status: "recorded",
    });
    request(USER_C, ORG_1);
    expect(await add(id, "Segunda llamada.")).toMatchObject({
      status: "recorded",
    });

    request(USER_A);
    const forA = await getOpportunityDetail(id);
    expect(forA!.activity.map((n) => [n.body, n.author])).toEqual([
      ["Segunda llamada.", "Otro miembro"],
      ["Primera llamada.", "Vos"],
    ]);
    request(USER_C, ORG_1);
    const forC = await getOpportunityDetail(id);
    expect(forC!.activity.map((n) => n.author)).toEqual([
      "Vos",
      "Otro miembro",
    ]);
    expect(JSON.stringify(forC)).not.toContain(USER_A);
    expect(JSON.stringify(forC)).not.toContain(USER_C);
  });

  it.each(OPPORTUNITY_STAGES)(
    "se puede anotar en %s (también cerrada)",
    async (stage) => {
      const id = await opportunity(ORG_1, stage);
      request(USER_A);
      expect(await add(id, `Nota en ${stage}`)).toMatchObject({
        status: "recorded",
      });
      expect((await opportunityRow(id))!.stage).toBe(stage);
    },
  );

  it("sin sesión o sin membership activa no llega a la base", async () => {
    const id = await opportunity(ORG_1);
    for (const [userId, path] of [
      [null, "/login"],
      [USER_D, "/no-access"],
      [USER_E, "/no-access"],
    ] as const) {
      request(userId);
      expect(await redirectOf(add(id, "Intrusa"))).toBe(path);
    }
    expect(await notesOf(id)).toEqual([]);
  });

  it("una oportunidad de otra organización es not_found, aun con membership activa en ambas", async () => {
    const foreign = await opportunity(ORG_2);
    const foreign3 = await opportunity(ORG_3);

    request(USER_A);
    expect(await add(foreign, "Intrusa")).toEqual({ status: "not_found" });
    // C pertenece a ORG_1 y ORG_3: con ORG_1 activa, la de ORG_3 no se ve.
    request(USER_C, ORG_1);
    expect(await add(foreign3, "Intrusa")).toEqual({ status: "not_found" });
    // Su membership inactiva en ORG_2 no cuenta.
    expect(await add(foreign, "Intrusa")).toEqual({ status: "not_found" });

    expect(await notesOf(foreign)).toEqual([]);
    expect(await notesOf(foreign3)).toEqual([]);
    expect(mocks.revalidated).toEqual([]);
  });

  it("organización, autor y fecha del pedido no tienen efecto", async () => {
    const id = await opportunity(ORG_1);
    request(USER_A);
    expect(
      await addOpportunityNote(
        null,
        form({
          opportunityId: id,
          body: "Nota",
          organizationId: ORG_2,
          organization_id: ORG_2,
          recordedBy: USER_B,
          recorded_by: USER_B,
          recordedAt: "2000-01-01T00:00:00Z",
        }),
      ),
    ).toMatchObject({ status: "recorded" });
    const [note] = await notesOf(id);
    expect(note).toMatchObject({ organizationId: ORG_1, recordedBy: USER_A });
    expect(note!.recordedAt.getFullYear()).toBeGreaterThan(2020);
  });

  it.each([
    ["vacía", "", "empty"],
    ["en blanco", "  \n\t ", "empty"],
    ["demasiado larga", "a".repeat(NOTE_MAX_LENGTH + 1), "too_long"],
  ] as const)("una nota %s es invalid y no escribe", async (_, body, error) => {
    const id = await opportunity(ORG_1);
    request(USER_A);
    expect(await add(id, body)).toEqual({ status: "invalid", error, body });
    expect(await notesOf(id)).toEqual([]);
    expect(mocks.revalidated).toEqual([]);
  });

  it("el largo máximo exacto se guarda, contado en caracteres como la base", async () => {
    const id = await opportunity(ORG_1);
    request(USER_A);
    const body = "🚗".repeat(NOTE_MAX_LENGTH);
    expect(await add(id, body)).toMatchObject({ status: "recorded" });
    expect((await notesOf(id))[0]!.body).toBe(body);
  });

  it.each([
    ["sin id", { body: "Nota" }],
    ["un id que no es UUID", { opportunityId: "123", body: "Nota" }],
    ["un id inexistente", { opportunityId: randomUUID(), body: "Nota" }],
  ])("un pedido con %s es not_found", async (_, fields) => {
    request(USER_A);
    expect(await addOpportunityNote(null, form(fields))).toEqual({
      status: "not_found",
    });
  });
});

describe("el detalle muestra la bitácora de la organización activa", () => {
  it("solo las notas de la oportunidad, de la más reciente a la más vieja, y notFound en otra organización", async () => {
    const id = await opportunity(ORG_1);
    const other = await opportunity(ORG_1);
    await db.admin`
      INSERT INTO public.opportunity_notes (organization_id, opportunity_id,
        body, recorded_by, recorded_at)
      VALUES
        (${ORG_1}, ${id}, 'Vieja', ${USER_A}, now() - interval '2 hours'),
        (${ORG_1}, ${id}, 'Nueva', ${USER_C}, now() - interval '1 hour'),
        (${ORG_1}, ${other}, 'De otra oportunidad', ${USER_A}, now())
    `;
    request(USER_A);
    expect(
      (await getOpportunityDetail(id))!.activity.map((n) => n.body),
    ).toEqual(["Nueva", "Vieja"]);
    request(USER_B);
    expect(await getOpportunityDetail(id)).toBeNull();
  });
});

describe("RLS y privilegios de la bitácora", () => {
  it("el autor tiene que ser el usuario de la request (42501)", async () => {
    const id = await opportunity(ORG_1);
    await expectSqlError(
      directInsert(ctxA(), { opportunityId: id, recordedBy: USER_C }),
      "42501",
    );
    expect(await notesOf(id)).toEqual([]);
  });

  it("la fecha la pone la base: una fecha del pedido falla (42501)", async () => {
    const id = await opportunity(ORG_1);
    await expectSqlError(
      directInsert(ctxA(), {
        opportunityId: id,
        recordedAt: new Date("2000-01-01T00:00:00Z"),
      }),
      "42501",
    );
  });

  it("no se anota en una organización sin membership activa (42501)", async () => {
    const foreign = await opportunity(ORG_2);
    await expectSqlError(
      directInsert(ctxA(), { organizationId: ORG_2, opportunityId: foreign }),
      "42501",
    );
    // D: membership inactiva en ORG_1.
    const mine = await opportunity(ORG_1);
    await expectSqlError(
      directInsert(tenantContext(USER_D, ORG_1), { opportunityId: mine }),
      "42501",
    );
    expect(await notesOf(foreign)).toEqual([]);
    expect(await notesOf(mine)).toEqual([]);
  });

  it("la FK compuesta impide anotar en una oportunidad de otra organización con la organización propia (23503)", async () => {
    const foreign = await opportunity(ORG_2);
    await expectSqlError(
      directInsert(ctxA(), { opportunityId: foreign }),
      "23503",
      "opportunity_notes_opportunity_fk",
    );
    expect(await notesOf(foreign)).toEqual([]);
  });

  it("el filtro de organización del módulo es defensa en profundidad: con el contexto de otro tenant, not_found", async () => {
    const id = await opportunity(ORG_1);
    expect(
      await insertOpportunityNote(tenantContext(USER_B, ORG_2), {
        opportunityId: id,
        body: "Intrusa",
      }),
    ).toEqual({ outcome: "not_found" });
    expect(await notesOf(id)).toEqual([]);
  });

  it("otra organización y una membership inactiva no leen las notas", async () => {
    const id = await opportunity(ORG_1);
    request(USER_A);
    await add(id, "Confidencial");
    for (const ctx of [
      tenantContext(USER_B, ORG_2),
      tenantContext(USER_D, ORG_1),
    ]) {
      const rows = await withTenant(ctx, (tx) =>
        tx
          .select({ id: opportunityNotes.id })
          .from(opportunityNotes)
          .where(eq(opportunityNotes.opportunityId, id)),
      );
      expect(rows).toEqual([]);
    }
  });

  it.each([
    ["vacía", ""],
    ["con espacios en los bordes", " Nota "],
    ["con un salto de línea en el borde", "Nota\n"],
    ["con un tab", "Uno\tdos"],
    ["con un retorno de carro", "Uno\r\ndos"],
    ["con un carácter de control", "Uno\u0007dos"],
    ["demasiado larga", "a".repeat(NOTE_MAX_LENGTH + 1)],
  ])(
    "el CHECK rechaza una nota %s aunque no pase por el dominio (23514)",
    async (_, body) => {
      const id = await opportunity(ORG_1);
      await expectSqlError(
        directInsert(ctxA(), { opportunityId: id, body }),
        "23514",
        "opportunity_notes_body_check",
      );
    },
  );

  it("el CHECK admite saltos de línea internos", async () => {
    const id = await opportunity(ORG_1);
    expect(
      await directInsert(ctxA(), { opportunityId: id, body: "Uno\n\nDos" }),
    ).toHaveLength(1);
  });

  it("append-only: authenticated no actualiza ni borra notas, ni las propias (42501)", async () => {
    const id = await opportunity(ORG_1);
    request(USER_A);
    await add(id, "Original");
    const [note] = await notesOf(id);
    for (const statement of [
      sql`UPDATE public.opportunity_notes SET body = 'Editada' WHERE id = ${note!.id}`,
      sql`UPDATE public.opportunity_notes SET recorded_at = now() WHERE id = ${note!.id}`,
      sql`DELETE FROM public.opportunity_notes WHERE id = ${note!.id}`,
      sql`TRUNCATE public.opportunity_notes`,
    ]) {
      await expectSqlError(
        withTenant(ctxA(), (tx) => tx.execute(statement)),
        "42501",
      );
    }
    expect((await notesOf(id))[0]!.body).toBe("Original");
  });

  it("app_runtime fuera del boundary, anon y service_role no escriben ni editan notas (42501)", async () => {
    const id = await opportunity(ORG_1);
    request(USER_A);
    await add(id, "Original");
    const [note] = await notesOf(id);
    await expect(
      runtimePool()`INSERT INTO public.opportunity_notes (organization_id, opportunity_id, body, recorded_by) VALUES (${ORG_1}, ${id}, 'x', ${USER_A})`,
    ).rejects.toMatchObject({ code: "42501" });
    for (const role of ["anon", "service_role"]) {
      await expect(
        db.admin.begin(async (tx: TransactionSql) => {
          await tx.unsafe(`SET LOCAL ROLE ${role}`);
          await tx`UPDATE public.opportunity_notes SET body = 'x' WHERE id = ${note!.id}`;
        }),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        db.admin.begin(async (tx: TransactionSql) => {
          await tx.unsafe(`SET LOCAL ROLE ${role}`);
          await tx`DELETE FROM public.opportunity_notes WHERE id = ${note!.id}`;
        }),
      ).rejects.toMatchObject({ code: "42501" });
    }
    expect((await notesOf(id))[0]!.body).toBe("Original");
  });

  it("una oportunidad con notas no se puede borrar ni con el rol dueño (FK RESTRICT)", async () => {
    const id = await opportunity(ORG_1);
    request(USER_A);
    await add(id, "Nota");
    await expect(
      db.admin`DELETE FROM public.opportunities WHERE id = ${id}`,
    ).rejects.toMatchObject({
      code: "23503",
      constraint_name: "opportunity_notes_opportunity_fk",
    });
  });
});

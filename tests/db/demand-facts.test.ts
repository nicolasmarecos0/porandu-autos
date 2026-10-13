import { readFile } from "node:fs/promises";

import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import type { TransactionSql } from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { opportunityDemandFacts } from "@/db/schema";
import { withTenant } from "@/db/tenant";

import { OPPORTUNITIES, seedOpportunities } from "./support/opportunities";
import {
  inRolledBackTransaction,
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
 * opportunity_demand_facts (H1.4, DEC-030 §9) contra PostgreSQL 17 con las
 * migraciones aplicadas: el diseño de grants frente al INSERT real de
 * Drizzle (P0, P1 y P2, bloqueantes), RLS de lectura y alta, append-only
 * (también para service_role, C-11), aislamiento entre organizaciones,
 * RESTRICT hacia los autores (C-9) y las postcondiciones de 0007.
 *
 * Los inserts por withTenant() quedan committeados (conexiones propias):
 * cada caso usa una oportunidad nueva para no chocar con la cadena humana de
 * otro. Los casos que mutan policies o grants corren en una transacción del
 * superusuario que termina en ROLLBACK.
 */

vi.mock("server-only", () => ({}));

/*
 * Las postcondiciones del ledger append-only (0007) viajan en cada migración
 * posterior junto con las de toda la base: se corren las de la última
 * (0011_conversations_and_activity_trigger, DEC-036), que son las que
 * describen el catálogo real de hoy.
 */
const MIGRATION = new URL(
  "../../db/migrations/0011_conversations_and_activity_trigger.sql",
  import.meta.url,
);

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

const OPP_3 = OPPORTUNITIES.find((o) => o.organizationId === ORG_3)!.id;
const CONTACT_OF: Record<string, string> = Object.fromEntries(
  OPPORTUNITIES.map((o) => [o.organizationId, o.contact.id]),
);

/** Oportunidad nueva (committeada) de `organizationId`, sin demanda. */
async function freshOpportunity(organizationId: string): Promise<string> {
  const [row] = await db.admin<{ id: string }[]>`
    INSERT INTO public.opportunities (organization_id, contact_id, stage, source)
    VALUES (${organizationId}, ${CONTACT_OF[organizationId]!}, 'new', 'web')
    RETURNING id
  `;
  return row!.id;
}

type NewFact = typeof opportunityDemandFacts.$inferInsert;

/** Un acto humano mínimo: el root `confirmed` de purchase_type. */
function confirmedPurchase(
  organizationId: string,
  opportunityId: string,
  recordedBy: string,
): NewFact {
  return {
    organizationId,
    opportunityId,
    fact: "purchase_type",
    status: "confirmed",
    sourceKind: "member",
    recordedBy,
    purchaseType: "cash",
  };
}

/** SQL y parámetros que Drizzle manda para un INSERT … RETURNING id. */
function drizzleInsert(values: NewFact) {
  return drizzle
    .mock()
    .insert(opportunityDemandFacts)
    .values(values)
    .returning({ id: opportunityDemandFacts.id })
    .toSQL();
}

/**
 * El mismo INSERT sin RETURNING: con RETURNING, la fila nueva también tiene
 * que pasar la policy de lectura, que es otra barrera.
 */
function drizzleInsertOnly(values: NewFact) {
  return drizzle.mock().insert(opportunityDemandFacts).values(values).toSQL();
}

/**
 * Como `authenticated` con los claims de `userId`, dentro de un savepoint:
 * si falla, el ROLLBACK TO SAVEPOINT deshace rol y claims.
 */
async function asMember<T>(
  tx: TransactionSql,
  userId: string,
  fn: (sp: TransactionSql) => Promise<T>,
): Promise<T> {
  return tx.savepoint(async (sp) => {
    await sp`SELECT set_config('request.jwt.claims', ${JSON.stringify({ sub: userId, role: "authenticated" })}, true)`;
    await sp.unsafe("SET LOCAL ROLE authenticated");
    const result = await fn(sp);
    await sp`RESET ROLE`;
    return result;
  }) as Promise<T>;
}

/** Como `role` (sin claims), dentro de un savepoint. */
async function asRole<T>(
  tx: TransactionSql,
  role: "anon" | "service_role" | "app_runtime",
  fn: (sp: TransactionSql) => Promise<T>,
): Promise<T> {
  return tx.savepoint(async (sp) => {
    await sp.unsafe(`SET LOCAL ROLE ${role}`);
    const result = await fn(sp);
    await sp`RESET ROLE`;
    return result;
  }) as Promise<T>;
}

async function expectCode(
  promise: Promise<unknown>,
  code: string,
  message?: RegExp,
): Promise<void> {
  // postgres-js trae el SQLSTATE en `code`; Drizzle lo envuelve en `cause`.
  await expect(promise).rejects.toSatisfy((error: unknown) => {
    const { code: direct, cause } = error as {
      code?: string;
      cause?: { code?: string; message?: string };
    };
    const actual = direct ?? cause?.code;
    const text = direct ? (error as Error).message : (cause?.message ?? "");
    return actual === code && (!message || message.test(text));
  });
}

/** 42501 por privilegios (antes de RLS) y por RLS: mismo SQLSTATE. */
const PRIVILEGE = /^permission denied for table opportunity_demand_facts$/;
const ROW_LEVEL_SECURITY =
  /^new row violates row-level security policy for table "opportunity_demand_facts"$/;

/** Filas de la oportunidad, leídas como superusuario. */
function factsOf(opportunityId: string) {
  return db.admin<
    {
      id: string;
      organizationId: string;
      fact: string;
      status: string;
      sourceKind: string;
      recordedBy: string;
      recentlyRecorded: boolean;
    }[]
  >`
    SELECT id, organization_id AS "organizationId", fact, status,
      source_kind AS "sourceKind", recorded_by AS "recordedBy",
      recorded_at > now() - interval '1 minute' AS "recentlyRecorded"
    FROM public.opportunity_demand_facts
    WHERE opportunity_id = ${opportunityId}
    ORDER BY recorded_at, id
  `;
}

describe("P0: el INSERT que genera Drizzle", () => {
  it("lista todas las columnas, incluidas id y recorded_at con `default`", () => {
    const query = drizzleInsert(
      confirmedPurchase(ORG_1, OPPORTUNITIES[0]!.id, USER_A),
    );
    // Si Drizzle cambia este comportamiento, el test se rompe a propósito:
    // el diseño de grants (A) depende de él.
    expect(query.sql).toBe(
      'insert into "opportunity_demand_facts" ("id", "organization_id", "opportunity_id", "fact", "status", "source_kind", "recorded_by", "recorded_at", "target_fact_id", "previous_member_fact_id", "brand", "model", "year_min", "year_max", "amount", "currency", "purchase_type", "trade_in", "evidence_text") values (default, $1, $2, $3, $4, $5, $6, default, default, default, default, default, default, default, default, default, $7, default, default) returning "id"',
    );
    expect(query.params).toEqual([
      ORG_1,
      OPPORTUNITIES[0]!.id,
      "purchase_type",
      "confirmed",
      "member",
      USER_A,
      "cash",
    ]);
  });

  it("los defaults de id y recorded_at funcionan: gen_random_uuid() y now() de la transacción", async () => {
    const opportunityId = await freshOpportunity(ORG_1);
    const query = drizzleInsert(
      confirmedPurchase(ORG_1, opportunityId, USER_A),
    );
    await inRolledBackTransaction(db.admin, async (tx) => {
      const [now] = await tx<{ now: Date }[]>`SELECT now() AS now`;
      const [inserted] = await asMember(tx, USER_A, (sp) =>
        sp.unsafe(query.sql, query.params as never[]),
      );
      const [row] = await tx<{ id: string; recordedAt: Date }[]>`
        SELECT id, recorded_at AS "recordedAt"
        FROM public.opportunity_demand_facts WHERE id = ${inserted!.id}
      `;
      expect(row?.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      expect(row?.recordedAt).toEqual(now!.now);
    });
  });
});

describe("P1: un grant por columna sin id ni recorded_at rompe el INSERT de Drizzle", () => {
  const GRANTED = [
    "organization_id",
    "opportunity_id",
    "fact",
    "status",
    "source_kind",
    "recorded_by",
    "target_fact_id",
    "previous_member_fact_id",
    "brand",
    "model",
    "year_min",
    "year_max",
    "amount",
    "currency",
    "purchase_type",
    "trade_in",
    "evidence_text",
  ];

  it("el SQL de Drizzle da 42501 y un INSERT manual con esas mismas columnas funciona: la causa es la lista de columnas, no RLS", async () => {
    const opportunityId = await freshOpportunity(ORG_1);
    const query = drizzleInsert(
      confirmedPurchase(ORG_1, opportunityId, USER_A),
    );
    await inRolledBackTransaction(db.admin, async (tx) => {
      await tx.unsafe(`
        REVOKE INSERT ON public.opportunity_demand_facts FROM authenticated;
        GRANT INSERT (${GRANTED.join(", ")}) ON public.opportunity_demand_facts TO authenticated;
      `);
      await expectCode(
        asMember(tx, USER_A, (sp) =>
          sp.unsafe(query.sql, query.params as never[]),
        ),
        "42501",
        PRIVILEGE,
      );
      const [manual] = await asMember(
        tx,
        USER_A,
        (sp) => sp`
          INSERT INTO public.opportunity_demand_facts
            (organization_id, opportunity_id, fact, status, source_kind, recorded_by, purchase_type)
          VALUES (${ORG_1}, ${opportunityId}, 'purchase_type', 'confirmed', 'member', ${USER_A}, 'cash')
          RETURNING id
        `,
      );
      expect(manual?.id).toEqual(expect.any(String));
    });
    expect(await factsOf(opportunityId)).toEqual([]);
  });
});

describe("P2: el diseño A (INSERT de tabla + WITH CHECK) funciona con Drizzle", () => {
  it("withTenant() → INSERT … RETURNING id, con id, autor y reloj de la base", async () => {
    const opportunityId = await freshOpportunity(ORG_1);
    const [inserted] = await withTenant(tenantContext(USER_A, ORG_1), (tx) =>
      tx
        .insert(opportunityDemandFacts)
        .values(confirmedPurchase(ORG_1, opportunityId, USER_A))
        .returning({ id: opportunityDemandFacts.id }),
    );
    expect(await factsOf(opportunityId)).toEqual([
      {
        id: inserted!.id,
        organizationId: ORG_1,
        fact: "purchase_type",
        status: "confirmed",
        sourceKind: "member",
        recordedBy: USER_A,
        recentlyRecorded: true,
      },
    ]);
  });

  it.each([
    [
      "recorded_at en el pasado",
      (opportunityId: string) => ({
        ...confirmedPurchase(ORG_1, opportunityId, USER_A),
        recordedAt: new Date("2020-01-01T00:00:00Z"),
      }),
    ],
    [
      "recorded_by de otro miembro de la organización",
      (opportunityId: string) =>
        confirmedPurchase(ORG_1, opportunityId, USER_C),
    ],
    [
      "un estado de máquina (detected)",
      (opportunityId: string) => ({
        ...confirmedPurchase(ORG_1, opportunityId, USER_A),
        status: "detected" as const,
      }),
    ],
    [
      "una fuente que no es un miembro",
      (opportunityId: string) => ({
        ...confirmedPurchase(ORG_1, opportunityId, USER_A),
        sourceKind: "extractor" as "member",
      }),
    ],
  ])("rechaza %s (42501, RLS)", async (_, values) => {
    const opportunityId = await freshOpportunity(ORG_1);
    await expectCode(
      withTenant(tenantContext(USER_A, ORG_1), (tx) =>
        tx
          .insert(opportunityDemandFacts)
          .values(values(opportunityId))
          .returning({ id: opportunityDemandFacts.id }),
      ),
      "42501",
      ROW_LEVEL_SECURITY,
    );
    expect(await factsOf(opportunityId)).toEqual([]);
  });

  it("sin la cláusula de fuente o de estado en el WITH CHECK, el CHECK de la base igual lo rechaza (23514)", async () => {
    const opportunityId = await freshOpportunity(ORG_1);
    await inRolledBackTransaction(db.admin, async (tx) => {
      await tx.unsafe(`
        ALTER POLICY opportunity_demand_facts_insert_member ON public.opportunity_demand_facts
          WITH CHECK (organization_id IN (SELECT private.user_org_ids()) AND recorded_by = (SELECT auth.uid()) AND recorded_at = now())
      `);
      for (const values of [
        {
          ...confirmedPurchase(ORG_1, opportunityId, USER_A),
          sourceKind: "extractor" as "member",
        },
        {
          ...confirmedPurchase(ORG_1, opportunityId, USER_A),
          status: "detected" as const,
        },
      ]) {
        const query = drizzleInsert(values);
        await expectCode(
          asMember(tx, USER_A, (sp) =>
            sp.unsafe(query.sql, query.params as never[]),
          ),
          "23514",
        );
      }
    });
  });

  it("onConflictDoUpdate exige UPDATE: 42501", async () => {
    const opportunityId = await freshOpportunity(ORG_1);
    await expectCode(
      withTenant(tenantContext(USER_A, ORG_1), (tx) =>
        tx
          .insert(opportunityDemandFacts)
          .values(confirmedPurchase(ORG_1, opportunityId, USER_A))
          .onConflictDoUpdate({
            target: opportunityDemandFacts.id,
            set: { purchaseType: "financed" },
          }),
      ),
      "42501",
      PRIVILEGE,
    );
  });
});

describe("aislamiento entre organizaciones (T17)", () => {
  it("un contexto de otra organización no escribe (A con ORG_2): 42501", async () => {
    const opportunityId = await freshOpportunity(ORG_2);
    await expectCode(
      withTenant(tenantContext(USER_A, ORG_2), (tx) =>
        tx
          .insert(opportunityDemandFacts)
          .values(confirmedPurchase(ORG_2, opportunityId, USER_A)),
      ),
      "42501",
    );
    expect(await factsOf(opportunityId)).toEqual([]);
  });

  it("una membership inactiva no escribe (D en ORG_1): 42501", async () => {
    const opportunityId = await freshOpportunity(ORG_1);
    await expectCode(
      withTenant(tenantContext(USER_D, ORG_1), (tx) =>
        tx
          .insert(opportunityDemandFacts)
          .values(confirmedPurchase(ORG_1, opportunityId, USER_D)),
      ),
      "42501",
    );
    expect(await factsOf(opportunityId)).toEqual([]);
  });

  it("la oportunidad tiene que ser de la organización de la fila (FK compuesta): C en ORG_1 con una oportunidad de ORG_3 → 23503", async () => {
    await expectCode(
      withTenant(tenantContext(USER_C, ORG_1), (tx) =>
        tx
          .insert(opportunityDemandFacts)
          .values(confirmedPurchase(ORG_1, OPP_3, USER_C)),
      ),
      "23503",
    );
    expect(await factsOf(OPP_3)).toEqual([]);
  });

  it("target y previous solo dentro de la misma oportunidad y del mismo fact: 23503", async () => {
    const [first, second] = [
      await freshOpportunity(ORG_1),
      await freshOpportunity(ORG_1),
    ];
    const ctx = tenantContext(USER_A, ORG_1);
    const [root] = await withTenant(ctx, (tx) =>
      tx
        .insert(opportunityDemandFacts)
        .values(confirmedPurchase(ORG_1, first, USER_A))
        .returning({ id: opportunityDemandFacts.id }),
    );
    const rootId = root!.id;
    for (const values of [
      // Otra oportunidad.
      {
        ...confirmedPurchase(ORG_1, second, USER_A),
        purchaseType: "financed" as const,
        targetFactId: rootId,
        previousMemberFactId: rootId,
      },
      // Otro fact de la misma oportunidad.
      {
        organizationId: ORG_1,
        opportunityId: first,
        fact: "trade_in_intent" as const,
        status: "confirmed" as const,
        sourceKind: "member" as const,
        recordedBy: USER_A,
        tradeIn: true,
        previousMemberFactId: rootId,
      },
      {
        organizationId: ORG_1,
        opportunityId: first,
        fact: "trade_in_intent" as const,
        status: "rejected" as const,
        sourceKind: "member" as const,
        recordedBy: USER_A,
        targetFactId: rootId,
      },
    ]) {
      await expectCode(
        withTenant(ctx, (tx) =>
          tx.insert(opportunityDemandFacts).values(values),
        ),
        "23503",
      );
    }
    expect((await factsOf(first)).map((row) => row.id)).toEqual([rootId]);
    expect(await factsOf(second)).toEqual([]);
  });

  it("lectura: cada usuario ve solo las filas de sus organizaciones activas; el filtro deja solo la activa", async () => {
    const opportunityId = await freshOpportunity(ORG_1);
    await withTenant(tenantContext(USER_A, ORG_1), (tx) =>
      tx
        .insert(opportunityDemandFacts)
        .values(confirmedPurchase(ORG_1, opportunityId, USER_A)),
    );
    const read = (userId: string, organizationId: string) =>
      withTenant(tenantContext(userId, organizationId), (tx) =>
        tx
          .select({ id: opportunityDemandFacts.id })
          .from(opportunityDemandFacts)
          .where(eq(opportunityDemandFacts.opportunityId, opportunityId)),
      );
    expect(await read(USER_A, ORG_1)).toHaveLength(1);
    expect(await read(USER_C, ORG_1)).toHaveLength(1);
    // B no tiene membership en ORG_1; D solo una inactiva.
    expect(await read(USER_B, ORG_2)).toEqual([]);
    expect(await read(USER_D, ORG_1)).toEqual([]);
    // C con ORG_3 activa: RLS dejaría ver ORG_1; el filtro por la
    // organización activa no.
    expect(
      await withTenant(tenantContext(USER_C, ORG_3), (tx) =>
        tx
          .select({ id: opportunityDemandFacts.id })
          .from(opportunityDemandFacts)
          .where(
            and(
              eq(opportunityDemandFacts.organizationId, ORG_3),
              eq(opportunityDemandFacts.opportunityId, opportunityId),
            ),
          ),
      ),
    ).toEqual([]);
  });
});

describe("append-only (T24)", () => {
  let factId: string;

  beforeAll(async () => {
    const opportunityId = await freshOpportunity(ORG_1);
    const [row] = await withTenant(tenantContext(USER_A, ORG_1), (tx) =>
      tx
        .insert(opportunityDemandFacts)
        .values(confirmedPurchase(ORG_1, opportunityId, USER_A))
        .returning({ id: opportunityDemandFacts.id }),
    );
    factId = row!.id;
  });

  it("authenticated (withTenant): UPDATE y DELETE → 42501, también en su organización", async () => {
    const ctx = tenantContext(USER_A, ORG_1);
    await expectCode(
      withTenant(ctx, (tx) =>
        tx
          .update(opportunityDemandFacts)
          .set({ purchaseType: "financed" })
          .where(eq(opportunityDemandFacts.id, factId)),
      ),
      "42501",
    );
    await expectCode(
      withTenant(ctx, (tx) =>
        tx
          .delete(opportunityDemandFacts)
          .where(eq(opportunityDemandFacts.id, factId)),
      ),
      "42501",
    );
    await expectCode(
      withTenant(ctx, (tx) =>
        tx.execute(sql`TRUNCATE public.opportunity_demand_facts`),
      ),
      "42501",
    );
  });

  it.each(["service_role", "anon", "app_runtime"] as const)(
    "%s: UPDATE, DELETE y TRUNCATE → 42501",
    async (role) => {
      await inRolledBackTransaction(db.admin, async (tx) => {
        for (const statement of [
          `UPDATE public.opportunity_demand_facts SET purchase_type = 'financed' WHERE id = '${factId}'`,
          `DELETE FROM public.opportunity_demand_facts WHERE id = '${factId}'`,
          "TRUNCATE public.opportunity_demand_facts",
        ]) {
          await expectCode(
            asRole(tx, role, (sp) => sp.unsafe(statement)),
            "42501",
          );
        }
      });
    },
  );

  it("anon y app_runtime fuera de withTenant() no leen ni insertan: 42501", async () => {
    await inRolledBackTransaction(db.admin, async (tx) => {
      for (const role of ["anon", "app_runtime"] as const) {
        await expectCode(
          asRole(
            tx,
            role,
            (sp) => sp`SELECT * FROM public.opportunity_demand_facts`,
          ),
          "42501",
        );
        await expectCode(
          asRole(
            tx,
            role,
            (sp) => sp`
              INSERT INTO public.opportunity_demand_facts
                (organization_id, opportunity_id, fact, status, source_kind, recorded_by, purchase_type)
              VALUES (${ORG_1}, ${OPPORTUNITIES[0]!.id}, 'purchase_type', 'confirmed', 'member', ${USER_A}, 'cash')
            `,
          ),
          "42501",
        );
      }
    });
  });
});

describe("mutación: cada cláusula del WITH CHECK de alta es necesaria", () => {
  const clauses = {
    organization: "organization_id IN (SELECT private.user_org_ids())",
    author: "recorded_by = (SELECT auth.uid())",
    clock: "recorded_at = now()",
    source: "source_kind = 'member'",
    status: "status IN ('confirmed', 'corrected', 'rejected')",
  };

  function policyWithout(omit: keyof typeof clauses): string {
    const kept = Object.entries(clauses)
      .filter(([key]) => key !== omit)
      .map(([, clause]) => clause)
      .join(" AND ");
    return `ALTER POLICY opportunity_demand_facts_insert_member ON public.opportunity_demand_facts WITH CHECK (${kept})`;
  }

  it.each([
    [
      "organization",
      "un alta en una organización ajena (A en ORG_2)",
      ORG_2,
      USER_A,
      {},
    ],
    [
      "author",
      "un alta a nombre de otro miembro (A firma como C)",
      ORG_1,
      USER_C,
      {},
    ],
    [
      "clock",
      "un alta con el reloj adulterado",
      ORG_1,
      USER_A,
      { recordedAt: new Date("2020-01-01T00:00:00Z") },
    ],
  ] as const)(
    "sin la cláusula %s pasaría %s",
    async (omit, _, organizationId, recordedBy, extra) => {
      const opportunityId = await freshOpportunity(organizationId);
      const query = drizzleInsertOnly({
        ...confirmedPurchase(organizationId, opportunityId, recordedBy),
        ...extra,
      });
      await inRolledBackTransaction(db.admin, async (tx) => {
        // Con la policy real, rechazado.
        await expectCode(
          asMember(tx, USER_A, (sp) =>
            sp.unsafe(query.sql, query.params as never[]),
          ),
          "42501",
        );
        await tx.unsafe(policyWithout(omit));
        await asMember(tx, USER_A, (sp) =>
          sp.unsafe(query.sql, query.params as never[]),
        );
        const [row] = await tx<{ count: number }[]>`
          SELECT count(*)::int AS count FROM public.opportunity_demand_facts
          WHERE opportunity_id = ${opportunityId}
        `;
        expect(row?.count).toBe(1);
      });
    },
  );
});

describe("autores (C-9): RESTRICT hacia profiles", () => {
  it("borrar de auth.users a un autor con historial falla (23503) y no borra nada", async () => {
    const opportunityId = await freshOpportunity(ORG_1);
    await withTenant(tenantContext(USER_A, ORG_1), (tx) =>
      tx
        .insert(opportunityDemandFacts)
        .values(confirmedPurchase(ORG_1, opportunityId, USER_A)),
    );
    await inRolledBackTransaction(db.admin, async (tx) => {
      await expect(
        tx.savepoint((sp) => sp`DELETE FROM auth.users WHERE id = ${USER_A}`),
      ).rejects.toMatchObject({ code: "23503" });
    });
    expect(await factsOf(opportunityId)).toHaveLength(1);
  });

  it("no se borra una oportunidad con demanda (RESTRICT)", async () => {
    const opportunityId = await freshOpportunity(ORG_1);
    await withTenant(tenantContext(USER_A, ORG_1), (tx) =>
      tx
        .insert(opportunityDemandFacts)
        .values(confirmedPurchase(ORG_1, opportunityId, USER_A)),
    );
    await inRolledBackTransaction(db.admin, async (tx) => {
      await expect(
        tx.savepoint(
          (sp) =>
            sp`DELETE FROM public.opportunities WHERE id = ${opportunityId}`,
        ),
      ).rejects.toMatchObject({ code: "23503" });
    });
  });
});

describe("postcondiciones del ledger (0007, vigentes en 0011) sobre catálogos mutados (DB5)", () => {
  let postconditions: string;

  beforeAll(async () => {
    const migration = await readFile(MIGRATION, "utf8");
    postconditions = migration.slice(migration.lastIndexOf("DO $$"));
    expect(postconditions).toMatch(/^DO \$\$[\s\S]*END\n\$\$;\n?$/);
  });

  it("pasan sobre el catálogo real", async () => {
    await inRolledBackTransaction(db.admin, async (tx) => {
      await tx.unsafe(postconditions);
    });
  });

  it.each([
    [
      "una policy de DELETE sobre la tabla",
      `CREATE POLICY probe ON public.opportunity_demand_facts FOR DELETE TO authenticated
         USING (organization_id IN (SELECT private.user_org_ids()))`,
      /append-only: no UPDATE, DELETE or ALL policies/,
    ],
    [
      "una policy ALL sobre la tabla",
      `CREATE POLICY probe ON public.opportunity_demand_facts FOR ALL TO authenticated
         USING (organization_id IN (SELECT private.user_org_ids()))
         WITH CHECK (organization_id IN (SELECT private.user_org_ids()))`,
      /append-only: no UPDATE, DELETE or ALL policies/,
    ],
    [
      "UPDATE por columna de authenticated (con su policy)",
      `GRANT UPDATE (purchase_type) ON public.opportunity_demand_facts TO authenticated;
       CREATE POLICY probe ON public.opportunity_demand_facts FOR UPDATE TO authenticated
         USING (organization_id IN (SELECT private.user_org_ids()))
         WITH CHECK (organization_id IN (SELECT private.user_org_ids()))`,
      /may only update vehicles\.status, vehicles\.updated_at \(H1\.3C\) and opportunities\.stage, loss_reason, vehicle_id, updated_at and the closure metadata \(H1\.6, Hito 2, DEC-034\)/,
    ],
    [
      "UPDATE de service_role",
      "GRANT UPDATE ON public.opportunity_demand_facts TO service_role",
      /service_role must not update, delete or truncate opportunity_demand_facts/,
    ],
    [
      "UPDATE por columna de service_role",
      "GRANT UPDATE (purchase_type) ON public.opportunity_demand_facts TO service_role",
      /service_role must not update, delete or truncate opportunity_demand_facts/,
    ],
    [
      "DELETE de service_role",
      "GRANT DELETE ON public.opportunity_demand_facts TO service_role",
      /service_role must not update, delete or truncate opportunity_demand_facts/,
    ],
    [
      "TRUNCATE de service_role",
      "GRANT TRUNCATE ON public.opportunity_demand_facts TO service_role",
      /service_role must not update, delete or truncate opportunity_demand_facts/,
    ],
    [
      "DELETE de authenticated",
      "GRANT DELETE ON public.opportunity_demand_facts TO authenticated",
      /must be covered by a policy|must not delete or truncate/,
    ],
    [
      "INSERT de authenticated fuera de las altas aprobadas",
      `GRANT INSERT ON public.memberships TO authenticated;
       CREATE POLICY probe ON public.memberships FOR INSERT TO authenticated
         WITH CHECK (organization_id IN (SELECT private.user_org_ids()))`,
      /may only insert into contacts, opportunities, vehicles, opportunity_demand_facts \(H1\.4\), opportunity_notes \(Hito 2\) and messages \(Hito 4\)/,
    ],
    [
      "privilegios de app_runtime sobre la tabla",
      "GRANT SELECT ON public.opportunity_demand_facts TO app_runtime",
      /anon and app_runtime must not have privileges/,
    ],
    [
      "la tabla sin RLS",
      "ALTER TABLE public.opportunity_demand_facts DISABLE ROW LEVEL SECURITY",
      /RLS enabled/,
    ],
  ])("fallan ante %s", async (_, mutation, reason) => {
    await inRolledBackTransaction(db.admin, async (tx) => {
      await tx.unsafe(mutation);
      await expect(
        tx.savepoint((sp) => sp.unsafe(postconditions)),
      ).rejects.toMatchObject({ message: expect.stringMatching(reason) });
    });
  });
});

import { eq, sql } from "drizzle-orm";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { organizations } from "@/db/schema";
import {
  withTenant,
  withUser,
  type ScopedTransaction,
  type TenantContext,
  type UserContext,
} from "@/db/tenant";

import {
  runMigrations,
  startTestServer,
  type TestDatabase,
  type TestServer,
} from "./support/postgres";
import { closeRuntimePool, runtimePool } from "./support/runtime";
import {
  activeOrganizations,
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
  userContext,
} from "./support/tenants";

// `server-only` lo resuelve Next; en Vitest (entorno node) es un no-op.
vi.mock("server-only", () => ({}));

/*
 * Rol y claims no sobreviven a la transacción (ADR-001 §3.2, criterio C6).
 * Las conexiones del pool de runtime se inspeccionan fuera del boundary
 * después de cada transacción: tienen que volver a ser app_runtime sin
 * claims. Todo corre contra un PostgreSQL local y desechable; el control
 * negativo (set_config de sesión) nunca se ejecuta contra staging.
 */

let server: TestServer;
let db: TestDatabase;
let runtimeUrl: string;

beforeAll(async () => {
  server = await startTestServer();
  db = await server.createDatabase();
  await runMigrations(db.migrationUrl);
  await seedTenants(db.admin);
  runtimeUrl = await db.runtimeUrl();
  vi.stubEnv("RUNTIME_DATABASE_URL", runtimeUrl);
});

afterAll(async () => {
  await closeRuntimePool();
  vi.unstubAllEnvs();
  await server?.close();
});

type SessionState = {
  pid: number;
  currentUser: string;
  sessionUser: string;
  role: string;
  claims: string;
  claimSub: string;
};

/** Estado de sesión de la conexión: lo que podría filtrarse a la siguiente. */
async function sessionState(sql: Sql): Promise<SessionState> {
  const [state] = await sql<SessionState[]>`
    SELECT
      pg_backend_pid() AS pid,
      current_user AS "currentUser",
      session_user AS "sessionUser",
      current_setting('role') AS role,
      coalesce(current_setting('request.jwt.claims', true), '') AS claims,
      coalesce(current_setting('request.jwt.claim.sub', true), '') AS "claimSub"
  `;
  if (!state) throw new Error("no session state");
  return state;
}

const CLEAN = {
  currentUser: "app_runtime",
  sessionUser: "app_runtime",
  role: "none",
  claims: "",
  claimSub: "",
};

function withoutPid(state: SessionState): Omit<SessionState, "pid"> {
  const { currentUser, sessionUser, role, claims, claimSub } = state;
  return { currentUser, sessionUser, role, claims, claimSub };
}

type Identity = {
  pid: number;
  currentUser: string;
  sessionUser: string;
  uid: string | null;
  organizations: string[];
};

/** Identidad efectiva dentro del boundary y organizaciones visibles. */
async function identity(tx: ScopedTransaction): Promise<Identity> {
  const [row] = await tx.execute<Omit<Identity, "organizations">>(sql`
    SELECT pg_backend_pid() AS pid, current_user AS "currentUser",
      session_user AS "sessionUser", auth.uid() AS uid
  `);
  const orgs = await tx
    .select({ id: organizations.id })
    .from(organizations)
    .orderBy(organizations.id);
  if (!row) throw new Error("no identity");
  return { ...row, organizations: orgs.map((o) => o.id) };
}

function expectIdentity(seen: Identity, userId: string): void {
  expect(seen).toEqual({
    pid: seen.pid,
    currentUser: "authenticated",
    sessionUser: "app_runtime",
    uid: userId,
    organizations: activeOrganizations(userId),
  });
}

type Scope =
  { kind: "tenant"; ctx: TenantContext } | { kind: "user"; ctx: UserContext };

const SCOPES: Scope[] = [
  { kind: "tenant", ctx: tenantContext(USER_A, ORG_1) },
  { kind: "tenant", ctx: tenantContext(USER_B, ORG_2) },
  { kind: "tenant", ctx: tenantContext(USER_C, ORG_1) },
  { kind: "tenant", ctx: tenantContext(USER_C, ORG_3) },
  { kind: "tenant", ctx: tenantContext(USER_D, ORG_1) },
  { kind: "user", ctx: userContext(USER_E) },
];

function inScope<T>(
  scope: Scope,
  fn: (tx: ScopedTransaction) => Promise<T>,
): Promise<T> {
  return scope.kind === "tenant"
    ? withTenant(scope.ctx, fn)
    : withUser(scope.ctx, fn);
}

describe("residuos de sesión entre transacciones (C6)", () => {
  it("600 transacciones secuenciales sobre el mismo backend: 0 residuos", async () => {
    const pool = runtimePool();
    const baseline = await sessionState(pool);
    expect(withoutPid(baseline)).toEqual(CLEAN);

    const pids = new Set<number>();
    const usersByPid = new Map<number, Set<string>>();
    let residues = 0;

    for (let i = 0; i < 600; i++) {
      const scope = SCOPES[i % SCOPES.length]!;
      const seen = await inScope(scope, identity);
      expectIdentity(seen, scope.ctx.userId);

      const after = await sessionState(pool);
      if (JSON.stringify(withoutPid(after)) !== JSON.stringify(CLEAN)) {
        residues++;
      }
      // Misma conexión antes y después: la inspección mira el backend que
      // acaba de usar la transacción.
      expect(after.pid).toBe(seen.pid);

      pids.add(seen.pid);
      const users = usersByPid.get(seen.pid) ?? new Set<string>();
      users.add(scope.ctx.userId);
      usersByPid.set(seen.pid, users);
    }

    expect(residues).toBe(0);
    // Un solo backend atendió a los cinco usuarios, alternados.
    expect(pids.size).toBe(1);
    expect([...usersByPid.values()][0]?.size).toBe(5);
  });
});

describe("COMMIT, ROLLBACK y error no contaminan la siguiente operación", () => {
  const ctxA = tenantContext(USER_A, ORG_1);
  const ctxB = tenantContext(USER_B, ORG_2);

  /** SQLSTATE o mensaje del error esperado; `null` = la transacción hace COMMIT. */
  type Expected = { code: string } | { message: string } | null;

  const outcomes: [
    string,
    (tx: ScopedTransaction) => Promise<unknown>,
    Expected,
  ][] = [
    ["COMMIT", async () => "ok", null],
    [
      "excepción de la aplicación (ROLLBACK)",
      async () => {
        throw new Error("boom");
      },
      { message: "boom" },
    ],
    ["error de SQL", (tx) => tx.execute(sql`SELECT 1 / 0`), { code: "22012" }],
    [
      "escritura denegada por privilegios",
      (tx) => tx.insert(organizations).values({ name: "Intrusa" }),
      { code: "42501" },
    ],
    [
      "intento de asumir postgres",
      (tx) => tx.execute(sql`SELECT set_config('role', 'postgres', true)`),
      { code: "42501" },
    ],
  ];

  it.each(outcomes)("%s", async (_, fn, expected) => {
    const pool = runtimePool();
    let inside: Identity | undefined;

    const result = withTenant(ctxA, async (tx) => {
      inside = await identity(tx);
      return fn(tx);
    });
    if (expected === null) {
      await expect(result).resolves.toBe("ok");
    } else if ("message" in expected) {
      await expect(result).rejects.toThrow(expected.message);
    } else {
      // Drizzle envuelve el error del driver: el SQLSTATE queda en `cause`.
      await expect(result).rejects.toMatchObject({ cause: expected });
    }

    expect(inside?.uid).toBe(USER_A);
    const after = await sessionState(pool);
    expect(after.pid).toBe(inside?.pid);
    expect(withoutPid(after)).toEqual(CLEAN);

    // La siguiente operación, de otro tenant y en el mismo backend, solo
    // ve lo suyo.
    const next = await withTenant(ctxB, async (tx) => ({
      identity: await identity(tx),
      foreign: await tx
        .select()
        .from(organizations)
        .where(eq(organizations.id, ORG_1)),
    }));
    expect(next.identity.pid).toBe(inside?.pid);
    expectIdentity(next.identity, USER_B);
    expect(next.foreign).toEqual([]);
  });
});

describe("concurrencia: varios backends compartidos entre usuarios", () => {
  // Corre después de los casos de un solo backend: abre el resto del pool.
  it("transacciones concurrentes en varios backends: cada una ve solo su identidad", async () => {
    const pool = runtimePool();
    const usersByPid = new Map<number, Set<string>>();

    for (let round = 0; round < 25; round++) {
      const batch = Array.from(
        { length: 12 },
        (_, i) => SCOPES[(round + i) % SCOPES.length]!,
      );
      const seen = await Promise.all(
        batch.map((scope) => inScope(scope, identity)),
      );
      seen.forEach((identitySeen, i) => {
        const userId = batch[i]!.ctx.userId;
        expectIdentity(identitySeen, userId);
        const users = usersByPid.get(identitySeen.pid) ?? new Set<string>();
        users.add(userId);
        usersByPid.set(identitySeen.pid, users);
      });
    }

    // Después de 300 transacciones, cada conexión del pool está limpia.
    const reserved = await Promise.all(
      Array.from({ length: 10 }, () => pool.reserve()),
    );
    try {
      const states = await Promise.all(reserved.map((c) => sessionState(c)));
      expect(new Set(states.map((s) => s.pid)).size).toBe(10);
      for (const state of states) expect(withoutPid(state)).toEqual(CLEAN);
    } finally {
      reserved.forEach((c) => c.release());
    }

    expect(usersByPid.size).toBeGreaterThan(1);
    const shared = [...usersByPid.values()].filter((users) => users.size > 1);
    expect(shared.length).toBeGreaterThan(0);
  });
});

describe("control negativo (solo local)", () => {
  /*
   * Prueba que el detector de residuos no es vacuo: un SET de sesión o un
   * set_config(..., false) sí sobrevive a la transacción. Por eso el
   * runtime nunca los usa (ADR-001 §3.2, Hallazgo 2). Corre en una conexión
   * propia y desechable, fuera del pool de runtime.
   */
  let raw: Sql;

  beforeAll(() => {
    raw = postgres(runtimeUrl, { max: 1, onnotice: () => {} });
  });

  afterAll(async () => {
    await raw?.end();
  });

  it("un set_config(..., false) deja los claims en la conexión", async () => {
    const claims = JSON.stringify(userContext(USER_A).claims);
    await raw.begin(
      (tx) => tx`SELECT set_config('request.jwt.claims', ${claims}, false)`,
    );
    expect((await sessionState(raw)).claims).toBe(claims);
  });

  it("un SET ROLE de sesión deja la conexión como authenticated", async () => {
    await raw.begin((tx) => tx`SET ROLE authenticated`);
    expect((await sessionState(raw)).currentUser).toBe("authenticated");
  });
});

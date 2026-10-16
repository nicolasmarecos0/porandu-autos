import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { getOrganizationSettings, getTeam } from "@/db/queries/settings";
import {
  changeMemberRole,
  deactivateMember,
  inviteMemberByEmail,
  updateOrganizationSettings,
} from "@/db/queries/settings-write";
import { withTenant, type TenantContext } from "@/db/tenant";
import {
  inviteMember,
  removeMember,
  updateMemberRole,
  updateOrganization,
} from "@/lib/settings/actions";
import { ACTIVE_ORGANIZATION_COOKIE } from "@/lib/tenant/cookie";
import { resolveTenant } from "@/lib/tenant/resolution";

import { cookieJar, type CookieJar } from "../unit/support/cookie-jar";
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

/*
 * Configuración del concesionario y gestión del equipo (Hito 6, DEC-038) de
 * punta a punta contra PostgreSQL 17 con las migraciones aplicadas:
 *
 *   Server Action → requireTenant() → rol admin → validación (Zod) →
 *   withTenant() → filtro explícito → RLS de admin
 *   (private.user_admin_org_ids()) → triggers de guarda
 *
 * El foco es el RBAC (DEC-038 §5): un `seller` no muta la organización ni
 * el equipo, ni por las acciones (capa de aplicación) ni llamando directo a
 * la capa de escritura o con SQL crudo como `authenticated` (RLS y
 * privilegios de la base). Las acciones, la escritura y los loaders son los
 * reales, conectados como app_runtime. Supabase Auth (claims ya
 * verificados), la cookie, redirect() y revalidatePath() de Next son
 * simulados, como en add-message.test.ts.
 *
 * Tenants (support/tenants.ts): A: admin de ORG_1 · B: admin de ORG_2 · C:
 * seller de ORG_1 y admin de ORG_3, seller inactivo de ORG_2 · D: solo
 * inactiva (seller) en ORG_1 · E: sin memberships. Este archivo agrega F y G
 * (cuentas sin memberships) y les pone email a todos. Cada archivo de
 * tests/db tiene su propia base, así que mutar memberships acá no afecta a
 * los demás.
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

const USER_F = "00000000-0000-4000-8000-00000000000f";
const USER_G = "00000000-0000-4000-8000-000000000010";
const ORG_4 = "00000000-0000-4000-8000-000000000004";

const EMAILS: Record<string, string> = {
  [USER_A]: "ana@org1.test",
  [USER_B]: "beto@org2.test",
  [USER_C]: "carla@org1.test",
  [USER_D]: "dario@org1.test",
  [USER_E]: "eva@sin-org.test",
  [USER_F]: "fabi@nuevo.test",
  [USER_G]: "gus@nuevo.test",
};

let server: TestServer;
let db: TestDatabase;

beforeAll(async () => {
  server = await startTestServer();
  db = await server.createDatabase();
  await runMigrations(db.migrationUrl);
  await seedTenants(db.admin);
  await db.admin`INSERT INTO auth.users ${db.admin([{ id: USER_F }, { id: USER_G }])}`;
  await db.admin`
    INSERT INTO public.profiles ${db.admin([
      { id: USER_F, full_name: "Fabiana Nueva" },
      { id: USER_G, full_name: null },
    ])}
  `;
  for (const [id, email] of Object.entries(EMAILS)) {
    await db.admin`UPDATE auth.users SET email = ${email} WHERE id = ${id}`;
  }
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

/** Contexto emitido por Tenant Resolution con el rol pedido (puede ser falso). */
function forgedContext(
  userId: string,
  organizationId: string,
  role: "admin" | "seller",
): TenantContext {
  const resolution = resolveTenant(
    userContext(userId),
    [{ organizationId, organizationName: "Organización", role }],
    undefined,
  );
  if (resolution.kind !== "resolved") throw new Error("unresolved tenant");
  return resolution.context;
}

type MembershipRow = {
  id: string;
  organizationId: string;
  userId: string;
  role: string;
  active: boolean;
  updatedAt: Date;
};

/** Las memberships de una organización tal como están en la base (sin RLS). */
async function membershipsOf(organizationId: string): Promise<MembershipRow[]> {
  return db.admin<MembershipRow[]>`
    SELECT id, organization_id AS "organizationId", user_id AS "userId",
      role::text AS role, active, updated_at AS "updatedAt"
    FROM public.memberships WHERE organization_id = ${organizationId}
    ORDER BY user_id
  `;
}

async function membershipOf(
  organizationId: string,
  userId: string,
): Promise<MembershipRow | undefined> {
  return (await membershipsOf(organizationId)).find(
    (row) => row.userId === userId,
  );
}

async function organizationRow(id: string) {
  const [row] = await db.admin<
    { name: string; defaultCurrency: string; updatedAt: Date }[]
  >`
    SELECT name, default_currency AS "defaultCurrency", updated_at AS "updatedAt"
    FROM public.organizations WHERE id = ${id}
  `;
  return row!;
}

/** Restablece los datos que este archivo muta, antes de cada caso. */
beforeEach(async () => {
  await db.admin.begin(async (tx) => {
    await tx`DELETE FROM public.memberships WHERE organization_id = ${ORG_4} OR user_id IN (${USER_F}, ${USER_G})`;
    await tx`DELETE FROM public.organizations WHERE id = ${ORG_4}`;
    await tx`UPDATE public.organizations SET name = 'Organización 1', default_currency = 'PYG' WHERE id = ${ORG_1}`;
    await tx`UPDATE public.organizations SET name = 'Organización 2', default_currency = 'PYG' WHERE id = ${ORG_2}`;
    // El seed: A admin y C seller activos, D seller inactivo (ORG_1).
    await tx`UPDATE public.memberships SET role = 'admin', active = true WHERE organization_id = ${ORG_1} AND user_id = ${USER_A}`;
    await tx`UPDATE public.memberships SET role = 'seller', active = true WHERE organization_id = ${ORG_1} AND user_id = ${USER_C}`;
    await tx`UPDATE public.memberships SET role = 'seller', active = false WHERE organization_id = ${ORG_1} AND user_id = ${USER_D}`;
  });
});

/* ── Seller: la capa de aplicación ──────────────────────────────────────── */

describe("RBAC en las Server Actions: un seller no muta nada", () => {
  it("seller (C, ORG_1) no edita la organización: forbidden y la fila intacta", async () => {
    const before = await organizationRow(ORG_1);
    request(USER_C, ORG_1);
    expect(
      await updateOrganization(
        null,
        form({ name: "Tomada por un vendedor", defaultCurrency: "USD" }),
      ),
    ).toEqual({ status: "forbidden" });
    expect(await organizationRow(ORG_1)).toEqual(before);
    expect(mocks.revalidated).toEqual([]);
  });

  it("seller (C, ORG_1) no invita: forbidden, ni con una cuenta que existe", async () => {
    const before = await membershipsOf(ORG_1);
    request(USER_C, ORG_1);
    expect(
      await inviteMember(null, form({ email: EMAILS[USER_F]!, role: "admin" })),
    ).toEqual({ status: "forbidden" });
    expect(await membershipsOf(ORG_1)).toEqual(before);
    expect(mocks.revalidated).toEqual([]);
  });

  it("seller (C, ORG_1) no cambia roles (ni el propio) ni revoca: forbidden", async () => {
    const before = await membershipsOf(ORG_1);
    const admin = (await membershipOf(ORG_1, USER_A))!;
    const self = (await membershipOf(ORG_1, USER_C))!;
    request(USER_C, ORG_1);
    for (const membershipId of [admin.id, self.id]) {
      expect(
        await updateMemberRole(null, form({ membershipId, role: "admin" })),
      ).toEqual({ status: "forbidden" });
      expect(await removeMember(null, form({ membershipId }))).toEqual({
        status: "forbidden",
      });
    }
    expect(await membershipsOf(ORG_1)).toEqual(before);
  });

  it("el rol sale de la membership de la organización activa: C es admin en ORG_3, pero con ORG_1 activa sigue siendo seller", async () => {
    request(USER_C, ORG_3);
    expect((await getOrganizationSettings()).canEdit).toBe(true);
    request(USER_C, ORG_1);
    expect((await getOrganizationSettings()).canEdit).toBe(false);
  });

  it("una membership inactiva (D) o sin memberships (E) no llega a escribir: /no-access", async () => {
    for (const user of [USER_D, USER_E]) {
      request(user);
      expect(
        await redirectOf(
          inviteMember(null, form({ email: EMAILS[USER_F]!, role: "admin" })),
        ),
      ).toBe("/no-access");
      expect(
        await redirectOf(
          updateOrganization(null, form({ name: "X", defaultCurrency: "PYG" })),
        ),
      ).toBe("/no-access");
    }
    expect(await membershipOf(ORG_1, USER_F)).toBeUndefined();
  });

  it("sin sesión: /login", async () => {
    request(null);
    expect(
      await redirectOf(
        removeMember(null, form({ membershipId: randomUUID() })),
      ),
    ).toBe("/login");
  });
});

/* ── Seller: la base sola ───────────────────────────────────────────────── */

describe("RBAC en la base: sin la regla de la acción, RLS y los privilegios igual rechazan al seller", () => {
  const seller = () => tenantContext(USER_C, ORG_1);

  it("la capa de escritura con contexto de seller: la organización no cambia (RLS filtra el UPDATE)", async () => {
    const before = await organizationRow(ORG_1);
    expect(
      await updateOrganizationSettings(seller(), {
        name: "Tomada por un vendedor",
        defaultCurrency: "USD",
      }),
    ).toEqual({ outcome: "forbidden" });
    expect(await organizationRow(ORG_1)).toEqual(before);
  });

  it("la capa de escritura con contexto de seller: invitar falla con 42501 en private.find_member_candidate()", async () => {
    expect(
      await inviteMemberByEmail(seller(), {
        email: EMAILS[USER_F]!,
        role: "admin",
      }),
    ).toEqual({ outcome: "forbidden" });
    expect(await membershipOf(ORG_1, USER_F)).toBeUndefined();
  });

  it("la capa de escritura con contexto de seller: cambiar un rol o revocar no encuentra filas (RLS)", async () => {
    const before = await membershipsOf(ORG_1);
    const admin = (await membershipOf(ORG_1, USER_A))!;
    expect(await changeMemberRole(seller(), admin.id, "seller")).toEqual({
      outcome: "not_found",
    });
    expect(await deactivateMember(seller(), admin.id)).toEqual({
      outcome: "not_found",
    });
    expect(await membershipsOf(ORG_1)).toEqual(before);
  });

  it("SQL crudo como authenticated (seller): UPDATE de organizations y memberships afecta 0 filas", async () => {
    const before = await membershipsOf(ORG_1);
    const counts = await withTenant(seller(), async (tx) => {
      const org = await tx.execute(
        sql`UPDATE public.organizations SET name = 'Hackeada' WHERE id = ${ORG_1}`,
      );
      const roles = await tx.execute(
        sql`UPDATE public.memberships SET role = 'admin' WHERE organization_id = ${ORG_1}`,
      );
      return [org.count, roles.count];
    });
    expect(counts).toEqual([0, 0]);
    expect((await organizationRow(ORG_1)).name).toBe("Organización 1");
    expect(await membershipsOf(ORG_1)).toEqual(before);
  });

  it("SQL crudo como authenticated (seller): INSERT en memberships viola la policy (42501)", async () => {
    await expect(
      withTenant(seller(), (tx) =>
        tx.execute(
          sql`INSERT INTO public.memberships (organization_id, user_id, role) VALUES (${ORG_1}, ${USER_F}, 'admin')`,
        ),
      ),
    ).rejects.toMatchObject({
      cause: { code: "42501" },
    });
    expect(await membershipOf(ORG_1, USER_F)).toBeUndefined();
  });

  it("SQL crudo como authenticated (seller): private.find_member_candidate() responde 42501 y no busca", async () => {
    await expect(
      withTenant(seller(), (tx) =>
        tx.execute(
          sql`SELECT private.find_member_candidate(${ORG_1}, ${EMAILS[USER_F]!})`,
        ),
      ),
    ).rejects.toMatchObject({ cause: { code: "42501" } });
  });

  it("un contexto falsificado de admin (A con ORG_2, donde no es miembro) no escribe en ORG_2", async () => {
    const forged = forgedContext(USER_A, ORG_2, "admin");
    const before = await membershipsOf(ORG_2);
    const beforeOrg = await organizationRow(ORG_2);
    const adminB = (await membershipOf(ORG_2, USER_B))!;
    expect(
      await updateOrganizationSettings(forged, {
        name: "Cruce",
        defaultCurrency: "USD",
      }),
    ).toEqual({ outcome: "forbidden" });
    expect(
      await inviteMemberByEmail(forged, {
        email: EMAILS[USER_F]!,
        role: "admin",
      }),
    ).toEqual({ outcome: "forbidden" });
    expect(await changeMemberRole(forged, adminB.id, "seller")).toEqual({
      outcome: "not_found",
    });
    expect(await deactivateMember(forged, adminB.id)).toEqual({
      outcome: "not_found",
    });
    expect(await membershipsOf(ORG_2)).toEqual(before);
    expect(await organizationRow(ORG_2)).toEqual(beforeOrg);
  });

  it("un contexto falsificado de admin para un seller real (C en ORG_1 como admin) tampoco escribe: la base mira la membership", async () => {
    const forged = forgedContext(USER_C, ORG_1, "admin");
    const admin = (await membershipOf(ORG_1, USER_A))!;
    expect(
      await updateOrganizationSettings(forged, {
        name: "Cruce",
        defaultCurrency: "USD",
      }),
    ).toEqual({ outcome: "forbidden" });
    expect(
      await inviteMemberByEmail(forged, {
        email: EMAILS[USER_F]!,
        role: "seller",
      }),
    ).toEqual({ outcome: "forbidden" });
    expect(await deactivateMember(forged, admin.id)).toEqual({
      outcome: "not_found",
    });
    expect((await membershipOf(ORG_1, USER_A))!.active).toBe(true);
  });
});

/* ── Admin ──────────────────────────────────────────────────────────────── */

describe("admin: configuración general", () => {
  it("admin (A) edita nombre y moneda: normalizados, con updated_at de la base, y revalida /settings", async () => {
    const before = await organizationRow(ORG_1);
    request(USER_A);
    expect(
      await updateOrganization(
        null,
        form({ name: "  Porandú   Autos\tAsunción ", defaultCurrency: "USD" }),
      ),
    ).toEqual({
      status: "saved",
      settings: { name: "Porandú Autos Asunción", defaultCurrency: "USD" },
    });
    const after = await organizationRow(ORG_1);
    expect(after.name).toBe("Porandú Autos Asunción");
    expect(after.defaultCurrency).toBe("USD");
    expect(after.updatedAt.getTime()).toBeGreaterThan(
      before.updatedAt.getTime(),
    );
    expect(mocks.revalidated).toEqual(["/settings"]);
    expect(await getOrganizationSettings()).toEqual({
      name: "Porandú Autos Asunción",
      defaultCurrency: "USD",
      canEdit: true,
    });
  });

  it("un pedido inválido no llega a la base", async () => {
    const before = await organizationRow(ORG_1);
    request(USER_A);
    expect(
      await updateOrganization(
        null,
        form({ name: "   ", defaultCurrency: "EUR" }),
      ),
    ).toEqual({
      status: "invalid",
      errors: { name: "required", defaultCurrency: "invalid_option" },
      values: { name: "   ", defaultCurrency: "EUR" },
    });
    expect(await organizationRow(ORG_1)).toEqual(before);
  });

  it("la organización sale del contexto: un organizationId en el pedido se ignora", async () => {
    const other = await organizationRow(ORG_2);
    request(USER_A);
    await updateOrganization(
      null,
      form({
        name: "Solo la mía",
        defaultCurrency: "PYG",
        organizationId: ORG_2,
      }),
    );
    expect(await organizationRow(ORG_2)).toEqual(other);
    expect((await organizationRow(ORG_1)).name).toBe("Solo la mía");
  });

  it("updated_at lo fija la base aunque el UPDATE traiga otro, y id no es editable (42501)", async () => {
    const ctx = tenantContext(USER_A, ORG_1);
    await withTenant(ctx, (tx) =>
      tx.execute(
        sql`UPDATE public.organizations SET name = 'Con fecha', updated_at = '2000-01-01' WHERE id = ${ORG_1}`,
      ),
    );
    expect((await organizationRow(ORG_1)).updatedAt.getFullYear()).not.toBe(
      2000,
    );
    await expect(
      withTenant(ctx, (tx) =>
        tx.execute(
          sql`UPDATE public.organizations SET id = ${randomUUID()} WHERE id = ${ORG_1}`,
        ),
      ),
    ).rejects.toMatchObject({ cause: { code: "42501" } });
  });

  it("los CHECKs de la base espejan el dominio (nombre y moneda)", async () => {
    for (const [name, currency] of [
      [" con espacios ", "PYG"],
      ["", "PYG"],
      ["x".repeat(121), "PYG"],
      ["Bien", "EUR"],
    ] as const) {
      await expect(
        db.admin`UPDATE public.organizations SET name = ${name}, default_currency = ${currency} WHERE id = ${ORG_1}`,
      ).rejects.toMatchObject({ code: "23514" });
    }
  });

  it("nadie borra una organización ni crea otra (sin INSERT ni DELETE)", async () => {
    const ctx = tenantContext(USER_A, ORG_1);
    await expect(
      withTenant(ctx, (tx) =>
        tx.execute(sql`DELETE FROM public.organizations WHERE id = ${ORG_1}`),
      ),
    ).rejects.toMatchObject({ cause: { code: "42501" } });
    await expect(
      withTenant(ctx, (tx) =>
        tx.execute(
          sql`INSERT INTO public.organizations (name) VALUES ('Nueva')`,
        ),
      ),
    ).rejects.toMatchObject({ cause: { code: "42501" } });
  });
});

describe("admin: invitar por email", () => {
  it("una cuenta sin membership entra activa con el rol pedido (el email no distingue mayúsculas)", async () => {
    request(USER_A);
    expect(
      await inviteMember(
        null,
        form({ email: "  FABI@Nuevo.test ", role: "seller" }),
      ),
    ).toEqual({
      status: "added",
      invitation: { email: "fabi@nuevo.test", role: "seller" },
    });
    expect(await membershipOf(ORG_1, USER_F)).toMatchObject({
      role: "seller",
      active: true,
    });
    expect(mocks.revalidated).toEqual(["/settings/team"]);
  });

  it("invitar otra vez a un miembro activo no cambia nada (tampoco su rol)", async () => {
    request(USER_A);
    await inviteMember(null, form({ email: EMAILS[USER_F]!, role: "seller" }));
    const before = await membershipOf(ORG_1, USER_F);
    expect(
      await inviteMember(null, form({ email: EMAILS[USER_F]!, role: "admin" })),
    ).toEqual({
      status: "already_member",
      invitation: { email: EMAILS[USER_F], role: "admin" },
    });
    expect(await membershipOf(ORG_1, USER_F)).toEqual(before);
  });

  it("una membership revocada (D) vuelve activa con el rol pedido", async () => {
    const before = (await membershipOf(ORG_1, USER_D))!;
    request(USER_A);
    expect(
      await inviteMember(null, form({ email: EMAILS[USER_D]!, role: "admin" })),
    ).toEqual({
      status: "reactivated",
      invitation: { email: EMAILS[USER_D], role: "admin" },
    });
    const after = (await membershipOf(ORG_1, USER_D))!;
    expect(after).toMatchObject({ id: before.id, role: "admin", active: true });
  });

  it("un email sin cuenta de Porandú: no_account y nada cambia (no se crean cuentas)", async () => {
    const before = await membershipsOf(ORG_1);
    request(USER_A);
    expect(
      await inviteMember(
        null,
        form({ email: "nadie@nuevo.test", role: "seller" }),
      ),
    ).toEqual({
      status: "no_account",
      values: { email: "nadie@nuevo.test", role: "seller" },
    });
    expect(await membershipsOf(ORG_1)).toEqual(before);
    const [users] = await db.admin<
      { count: number }[]
    >`SELECT count(*)::int AS count FROM auth.users`;
    expect(users?.count).toBe(7);
  });

  it("validación: email y rol inválidos no llegan a la base", async () => {
    request(USER_A);
    expect(
      await inviteMember(null, form({ email: "no-es-email", role: "owner" })),
    ).toEqual({
      status: "invalid",
      errors: { email: "invalid_email", role: "invalid_option" },
      values: { email: "no-es-email", role: "owner" },
    });
  });

  it("la membership nace con el reloj de la base: un INSERT con fechas inventadas o inactivo viola la policy", async () => {
    const ctx = tenantContext(USER_A, ORG_1);
    await expect(
      withTenant(ctx, (tx) =>
        tx.execute(
          sql`INSERT INTO public.memberships (organization_id, user_id, role, created_at) VALUES (${ORG_1}, ${USER_G}, 'seller', '2000-01-01')`,
        ),
      ),
    ).rejects.toMatchObject({ cause: { code: "42501" } });
    await expect(
      withTenant(ctx, (tx) =>
        tx.execute(
          sql`INSERT INTO public.memberships (organization_id, user_id, role, active) VALUES (${ORG_1}, ${USER_G}, 'seller', false)`,
        ),
      ),
    ).rejects.toMatchObject({ cause: { code: "42501" } });
    // Ni en otra organización.
    await expect(
      withTenant(ctx, (tx) =>
        tx.execute(
          sql`INSERT INTO public.memberships (organization_id, user_id, role) VALUES (${ORG_2}, ${USER_G}, 'admin')`,
        ),
      ),
    ).rejects.toMatchObject({ cause: { code: "42501" } });
    expect(await membershipOf(ORG_1, USER_G)).toBeUndefined();
    expect(await membershipOf(ORG_2, USER_G)).toBeUndefined();
  });

  it("el invitado accede: requireTenant() lo resuelve a la organización y con el rol de la membership", async () => {
    request(USER_A);
    await inviteMember(null, form({ email: EMAILS[USER_G]!, role: "seller" }));
    request(USER_G);
    const team = await getTeam();
    expect(team.viewerRole).toBe("seller");
    expect(team.canInvite).toBe(false);
  });
});

describe("admin: cambiar rol y revocar", () => {
  it("admin (A) cambia el rol de C y lo vuelve atrás; updated_at lo fija la base", async () => {
    const c = (await membershipOf(ORG_1, USER_C))!;
    request(USER_A);
    expect(
      await updateMemberRole(null, form({ membershipId: c.id, role: "admin" })),
    ).toEqual({ status: "updated" });
    const promoted = (await membershipOf(ORG_1, USER_C))!;
    expect(promoted.role).toBe("admin");
    expect(promoted.updatedAt.getTime()).toBeGreaterThan(c.updatedAt.getTime());
    expect(mocks.revalidated).toEqual(["/settings/team"]);
    expect(
      await updateMemberRole(
        null,
        form({ membershipId: c.id, role: "seller" }),
      ),
    ).toEqual({ status: "updated" });
    expect((await membershipOf(ORG_1, USER_C))!.role).toBe("seller");
  });

  it("revocar desactiva (no borra) y el miembro pierde el acceso en la request siguiente", async () => {
    request(USER_A);
    await inviteMember(null, form({ email: EMAILS[USER_F]!, role: "seller" }));
    const f = (await membershipOf(ORG_1, USER_F))!;
    request(USER_A);
    expect(await removeMember(null, form({ membershipId: f.id }))).toEqual({
      status: "removed",
    });
    expect(await membershipOf(ORG_1, USER_F)).toMatchObject({
      id: f.id,
      active: false,
    });
    request(USER_F);
    expect(await redirectOf(getTeam())).toBe("/no-access");
    // Ya revocada: otra vez es not_found.
    request(USER_A);
    expect(await removeMember(null, form({ membershipId: f.id }))).toEqual({
      status: "not_found",
    });
  });

  it("nadie cambia ni revoca su propia membership: self (trigger de la base)", async () => {
    const a = (await membershipOf(ORG_1, USER_A))!;
    request(USER_A);
    expect(
      await updateMemberRole(
        null,
        form({ membershipId: a.id, role: "seller" }),
      ),
    ).toEqual({ status: "self" });
    expect(await removeMember(null, form({ membershipId: a.id }))).toEqual({
      status: "self",
    });
    expect(await membershipOf(ORG_1, USER_A)).toEqual(a);
  });

  it("una membership de otra organización, inexistente o malformada es not_found sin revelar nada", async () => {
    const b = (await membershipOf(ORG_2, USER_B))!;
    request(USER_A);
    for (const membershipId of [b.id, randomUUID(), "no-es-un-uuid"]) {
      expect(
        await updateMemberRole(null, form({ membershipId, role: "seller" })),
      ).toEqual({ status: "not_found" });
      expect(await removeMember(null, form({ membershipId }))).toEqual({
        status: "not_found",
      });
    }
    expect(await membershipOf(ORG_2, USER_B)).toEqual(b);
  });

  it("un rol fuera de la lista es invalid y no llega a la base", async () => {
    const c = (await membershipOf(ORG_1, USER_C))!;
    request(USER_A);
    expect(
      await updateMemberRole(null, form({ membershipId: c.id, role: "owner" })),
    ).toEqual({ status: "invalid" });
    expect(await membershipOf(ORG_1, USER_C)).toEqual(c);
  });

  it("una membership no cambia de organización ni de usuario, ni se borra", async () => {
    const c = (await membershipOf(ORG_1, USER_C))!;
    const ctx = tenantContext(USER_A, ORG_1);
    // Sin privilegio de columna (42501)…
    await expect(
      withTenant(ctx, (tx) =>
        tx.execute(
          sql`UPDATE public.memberships SET user_id = ${USER_F} WHERE id = ${c.id}`,
        ),
      ),
    ).rejects.toMatchObject({ cause: { code: "42501" } });
    await expect(
      withTenant(ctx, (tx) =>
        tx.execute(sql`DELETE FROM public.memberships WHERE id = ${c.id}`),
      ),
    ).rejects.toMatchObject({ cause: { code: "42501" } });
    // …y tampoco el rol dueño: el trigger lo rechaza (23514).
    await expect(
      db.admin`UPDATE public.memberships SET organization_id = ${ORG_2} WHERE id = ${c.id}`,
    ).rejects.toMatchObject({
      code: "23514",
      constraint_name: "memberships_identity_immutable",
    });
    expect(await membershipOf(ORG_1, USER_C)).toEqual(c);
  });
});

describe("siempre queda un admin activo (memberships_last_admin)", () => {
  it("un pedido con identidad no puede dejar la organización sin admin activo", async () => {
    await db.admin`INSERT INTO public.organizations (id, name) VALUES (${ORG_4}, 'Organización 4')`;
    await db.admin`
      INSERT INTO public.memberships (organization_id, user_id, role)
      VALUES (${ORG_4}, ${USER_F}, 'admin'), (${ORG_4}, ${USER_G}, 'seller')
    `;
    // El trigger, aislado de RLS: claims de otro usuario en la transacción
    // del superusuario.
    for (const change of ["role = 'seller'", "active = false"]) {
      await expect(
        db.admin.begin(async (tx) => {
          await tx`SELECT set_config('request.jwt.claims', ${JSON.stringify({ sub: USER_A, role: "authenticated" })}, true)`;
          await tx.unsafe(
            `UPDATE public.memberships SET ${change} WHERE organization_id = '${ORG_4}' AND user_id = '${USER_F}'`,
          );
        }),
      ).rejects.toMatchObject({
        code: "23514",
        constraint_name: "memberships_last_admin",
      });
    }
    expect(await membershipOf(ORG_4, USER_F)).toMatchObject({
      role: "admin",
      active: true,
    });
  });

  it("sin claims (provisioning con el rol dueño) revocar al único admin sigue siendo posible (A-09)", async () => {
    await db.admin`INSERT INTO public.organizations (id, name) VALUES (${ORG_4}, 'Organización 4')`;
    await db.admin`
      INSERT INTO public.memberships (organization_id, user_id, role)
      VALUES (${ORG_4}, ${USER_F}, 'admin')
    `;
    await db.admin`UPDATE public.memberships SET active = false WHERE organization_id = ${ORG_4} AND user_id = ${USER_F}`;
    expect(await membershipOf(ORG_4, USER_F)).toMatchObject({ active: false });
  });

  it("dos admins que se degradan a la vez: el segundo espera el bloqueo de la organización y recibe last_admin", async () => {
    await db.admin`INSERT INTO public.organizations (id, name) VALUES (${ORG_4}, 'Organización 4')`;
    await db.admin`
      INSERT INTO public.memberships (organization_id, user_id, role)
      VALUES (${ORG_4}, ${USER_F}, 'admin'), (${ORG_4}, ${USER_G}, 'admin')
    `;
    const f = (await membershipOf(ORG_4, USER_F))!;
    const g = (await membershipOf(ORG_4, USER_G))!;
    const asF = forgedContext(USER_F, ORG_4, "admin");
    const asG = forgedContext(USER_G, ORG_4, "admin");

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let firstUpdated!: () => void;
    const updated = new Promise<void>((resolve) => {
      firstUpdated = resolve;
    });
    // F degrada a G y retiene la transacción abierta.
    const first = withTenant(asF, async (tx) => {
      await tx.execute(
        sql`UPDATE public.memberships SET role = 'seller' WHERE id = ${g.id}`,
      );
      firstUpdated();
      await gate;
    });
    await updated;
    // G degrada a F: espera el bloqueo de la organización.
    const second = changeMemberRole(asG, f.id, "seller");
    await new Promise((resolve) => setTimeout(resolve, 300));
    release();
    await first;
    expect(await second).toEqual({ outcome: "last_admin" });
    expect(await membershipOf(ORG_4, USER_F)).toMatchObject({
      role: "admin",
      active: true,
    });
    expect(await membershipOf(ORG_4, USER_G)).toMatchObject({
      role: "seller",
    });
  });
});

/* ── Lectura del equipo ─────────────────────────────────────────────────── */

describe("lista del equipo (private.organization_members(), DEC-038 §6)", () => {
  it("admin (A) ve los miembros activos de ORG_1 con nombre, email y rol; no los inactivos ni los de otra organización", async () => {
    request(USER_A);
    const team = await getTeam();
    expect(team.canInvite).toBe(true);
    expect(team.viewerRole).toBe("admin");
    expect(
      team.members.map(({ userId, email, role, isViewer, manageable }) => ({
        userId,
        email,
        role,
        isViewer,
        manageable,
      })),
    ).toEqual([
      {
        userId: USER_A,
        email: EMAILS[USER_A],
        role: "admin",
        isViewer: true,
        manageable: false,
      },
      {
        userId: USER_C,
        email: EMAILS[USER_C],
        role: "seller",
        isViewer: false,
        manageable: true,
      },
    ]);
  });

  it("seller (C, ORG_1) ve la misma lista, de solo lectura", async () => {
    request(USER_C, ORG_1);
    const team = await getTeam();
    expect(team.canInvite).toBe(false);
    expect(team.members.map((member) => member.userId)).toEqual([
      USER_A,
      USER_C,
    ]);
    expect(team.members.every((member) => !member.manageable)).toBe(true);
  });

  it("la función no devuelve nada para una organización sin membership activa, y profiles sigue mostrando solo el perfil propio", async () => {
    const ctx = tenantContext(USER_A, ORG_1);
    const [other, profiles] = await withTenant(ctx, async (tx) => [
      await tx.execute(
        sql`SELECT * FROM private.organization_members(${ORG_2})`,
      ),
      await tx.execute(sql`SELECT id FROM public.profiles`),
    ]);
    expect([...other]).toEqual([]);
    expect([...profiles].map((row) => row.id)).toEqual([USER_A]);
    // auth.users sigue cerrado para authenticated.
    await expect(
      withTenant(ctx, (tx) => tx.execute(sql`SELECT email FROM auth.users`)),
    ).rejects.toMatchObject({ cause: { code: "42501" } });
  });

  it("app_runtime sin withTenant() no ejecuta ninguna de las funciones nuevas", async () => {
    const runtime = (await import("./support/runtime")).runtimePool();
    for (const call of [
      runtime`SELECT private.user_admin_org_ids()`,
      runtime`SELECT * FROM private.organization_members(${ORG_1})`,
      runtime`SELECT private.find_member_candidate(${ORG_1}, 'x@y.z')`,
    ]) {
      await expect(call).rejects.toMatchObject({ code: "42501" });
    }
  });
});

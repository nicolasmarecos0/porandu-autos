import type { TransactionSql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  columns,
  constraints,
  indexes,
  publicDefaultPrivileges,
  tablePrivileges,
  tenancy,
} from "./support/catalog";
import {
  asRole,
  inRolledBackTransaction,
  runMigrations,
  startTestServer,
  type TestDatabase,
  type TestServer,
} from "./support/postgres";

/*
 * Schema SaaS base tal como queda en PostgreSQL 17 después de las
 * migraciones: catálogo (PK, FK, unique, índices, enum, RLS, grants) y
 * comportamiento de las constraints. Los datos de prueba viven en
 * transacciones que terminan en ROLLBACK.
 */

// Tablas que no pertenecen a una organización (ADR-001 §3.6).
const NOT_TENANT_OWNED = ["organizations", "profiles"];

const USER_A = "00000000-0000-4000-8000-00000000000a";
const USER_B = "00000000-0000-4000-8000-00000000000b";
const ORG_1 = "00000000-0000-4000-8000-000000000001";
const ORG_2 = "00000000-0000-4000-8000-000000000002";

const TIMESTAMPS = [
  {
    name: "created_at",
    type: "timestamp with time zone",
    notNull: true,
    default: "now()",
  },
  {
    name: "updated_at",
    type: "timestamp with time zone",
    notNull: true,
    default: "now()",
  },
];

let server: TestServer;
let db: TestDatabase;

beforeAll(async () => {
  server = await startTestServer();
  db = await server.createDatabase();
  await runMigrations(db.migrationUrl);
});

afterAll(async () => {
  await server?.close();
});

const CONTACT_1 = "10000000-0000-4000-8000-000000000001";
const CONTACT_2 = "10000000-0000-4000-8000-000000000002";

/**
 * Usuarios A y B con perfil, organizaciones 1 y 2, A es admin de 1. Un
 * contacto por organización y una oportunidad en la 1.
 */
async function seed(tx: TransactionSql): Promise<void> {
  await tx`INSERT INTO auth.users (id) VALUES (${USER_A}), (${USER_B})`;
  await tx`
    INSERT INTO public.profiles (id, full_name)
    VALUES (${USER_A}, 'Usuario A'), (${USER_B}, 'Usuario B')
  `;
  await tx`
    INSERT INTO public.organizations (id, name)
    VALUES (${ORG_1}, 'Organización 1'), (${ORG_2}, 'Organización 2')
  `;
  await tx`
    INSERT INTO public.memberships (organization_id, user_id, role)
    VALUES (${ORG_1}, ${USER_A}, 'admin')
  `;
  await tx`
    INSERT INTO public.contacts (id, organization_id, name)
    VALUES (${CONTACT_1}, ${ORG_1}, 'Contacto 1'), (${CONTACT_2}, ${ORG_2}, 'Contacto 2')
  `;
  await tx`
    INSERT INTO public.opportunities (organization_id, contact_id, stage, source)
    VALUES (${ORG_1}, ${CONTACT_1}, 'new', 'whatsapp')
  `;
}

async function expectSqlError(
  tx: TransactionSql,
  code: string,
  run: (sp: TransactionSql) => Promise<unknown>,
): Promise<void> {
  await expect(tx.savepoint(run)).rejects.toMatchObject({ code });
}

describe("organizations", () => {
  it("es la raíz del tenant: UUID PK, nombre y timestamps, sin organization_id", async () => {
    expect(await columns(db.admin, "organizations")).toEqual([
      {
        name: "id",
        type: "uuid",
        notNull: true,
        default: "gen_random_uuid()",
      },
      { name: "name", type: "text", notNull: true, default: null },
      ...TIMESTAMPS,
    ]);
    expect(await constraints(db.admin, "organizations")).toEqual({
      organizations_pkey: "PRIMARY KEY (id)",
    });
  });
});

describe("profiles", () => {
  it("es 1:1 con auth.users y no lleva organization_id", async () => {
    expect(await columns(db.admin, "profiles")).toEqual([
      // Sin default: el id es siempre el de auth.users.
      { name: "id", type: "uuid", notNull: true, default: null },
      { name: "full_name", type: "text", notNull: false, default: null },
      ...TIMESTAMPS,
    ]);
    expect(await constraints(db.admin, "profiles")).toEqual({
      profiles_pkey: "PRIMARY KEY (id)",
      profiles_id_users_id_fk:
        "FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE",
    });
  });
});

describe("memberships", () => {
  it("columnas: organization_id y user_id obligatorios, role sin default", async () => {
    expect(await columns(db.admin, "memberships")).toEqual([
      {
        name: "id",
        type: "uuid",
        notNull: true,
        default: "gen_random_uuid()",
      },
      { name: "organization_id", type: "uuid", notNull: true, default: null },
      { name: "user_id", type: "uuid", notNull: true, default: null },
      { name: "role", type: "membership_role", notNull: true, default: null },
      { name: "active", type: "boolean", notNull: true, default: "true" },
      ...TIMESTAMPS,
    ]);
  });

  it("PK, FKs y unique (organization_id, user_id)", async () => {
    expect(await constraints(db.admin, "memberships")).toEqual({
      memberships_pkey: "PRIMARY KEY (id)",
      memberships_organization_id_user_id_key:
        "UNIQUE (organization_id, user_id)",
      memberships_organization_id_organizations_id_fk:
        "FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT",
      memberships_user_id_profiles_id_fk:
        "FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE",
    });
  });

  it("índices: PK, unique que empieza por organization_id y user_id", async () => {
    expect(await indexes(db.admin, "memberships")).toEqual({
      memberships_pkey:
        "CREATE UNIQUE INDEX memberships_pkey ON public.memberships USING btree (id)",
      memberships_organization_id_user_id_key:
        "CREATE UNIQUE INDEX memberships_organization_id_user_id_key ON public.memberships USING btree (organization_id, user_id)",
      memberships_user_id_idx:
        "CREATE INDEX memberships_user_id_idx ON public.memberships USING btree (user_id)",
    });
  });

  it("membership_role es exactamente admin | seller", async () => {
    const [row] = await db.admin<{ labels: string[] }[]>`
      SELECT array_agg(enumlabel ORDER BY enumsortorder) AS labels
      FROM pg_enum WHERE enumtypid = 'public.membership_role'::regtype
    `;
    expect(row?.labels).toEqual(["admin", "seller"]);
  });
});

describe("contacts (H1.1)", () => {
  it("columnas: nombre obligatorio, teléfono y ciudad opcionales", async () => {
    expect(await columns(db.admin, "contacts")).toEqual([
      {
        name: "id",
        type: "uuid",
        notNull: true,
        default: "gen_random_uuid()",
      },
      { name: "organization_id", type: "uuid", notNull: true, default: null },
      { name: "name", type: "text", notNull: true, default: null },
      { name: "phone", type: "text", notNull: false, default: null },
      { name: "city", type: "text", notNull: false, default: null },
      ...TIMESTAMPS,
    ]);
  });

  it("PK, FK a organizations (RESTRICT) y unique (organization_id, id)", async () => {
    expect(await constraints(db.admin, "contacts")).toEqual({
      contacts_pkey: "PRIMARY KEY (id)",
      contacts_organization_id_id_key: "UNIQUE (organization_id, id)",
      contacts_organization_id_organizations_id_fk:
        "FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT",
    });
    expect(await indexes(db.admin, "contacts")).toEqual({
      contacts_pkey:
        "CREATE UNIQUE INDEX contacts_pkey ON public.contacts USING btree (id)",
      contacts_organization_id_id_key:
        "CREATE UNIQUE INDEX contacts_organization_id_id_key ON public.contacts USING btree (organization_id, id)",
    });
  });
});

describe("opportunities (H1.1)", () => {
  it("columnas: contacto, etapa y origen obligatorios; interés opcional; recencia propia", async () => {
    expect(await columns(db.admin, "opportunities")).toEqual([
      {
        name: "id",
        type: "uuid",
        notNull: true,
        default: "gen_random_uuid()",
      },
      { name: "organization_id", type: "uuid", notNull: true, default: null },
      { name: "contact_id", type: "uuid", notNull: true, default: null },
      { name: "stage", type: "text", notNull: true, default: null },
      { name: "source", type: "text", notNull: true, default: null },
      { name: "interest_model", type: "text", notNull: false, default: null },
      {
        name: "interest_version",
        type: "text",
        notNull: false,
        default: null,
      },
      {
        name: "last_activity_at",
        type: "timestamp with time zone",
        notNull: true,
        default: "now()",
      },
      ...TIMESTAMPS,
    ]);
  });

  it("FK compuesta al contacto de la misma organización, CHECK de etapa y origen", async () => {
    expect(await constraints(db.admin, "opportunities")).toEqual({
      opportunities_pkey: "PRIMARY KEY (id)",
      opportunities_organization_id_organizations_id_fk:
        "FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT",
      opportunities_organization_id_contact_id_contacts_fk:
        "FOREIGN KEY (organization_id, contact_id) REFERENCES contacts(organization_id, id) ON DELETE RESTRICT",
      opportunities_stage_check:
        "CHECK ((stage = ANY (ARRAY['new'::text, 'qualified'::text, 'test_drive'::text, 'negotiation'::text])))",
      opportunities_source_check:
        "CHECK ((source = ANY (ARRAY['whatsapp'::text, 'meta_ads'::text, 'web'::text, 'showroom'::text, 'referral'::text])))",
    });
  });

  it("índices: la cola por organización y recencia, y la FK al contacto", async () => {
    expect(await indexes(db.admin, "opportunities")).toEqual({
      opportunities_pkey:
        "CREATE UNIQUE INDEX opportunities_pkey ON public.opportunities USING btree (id)",
      opportunities_organization_id_last_activity_at_idx:
        "CREATE INDEX opportunities_organization_id_last_activity_at_idx ON public.opportunities USING btree (organization_id, last_activity_at DESC)",
      opportunities_organization_id_contact_id_idx:
        "CREATE INDEX opportunities_organization_id_contact_id_idx ON public.opportunities USING btree (organization_id, contact_id)",
    });
  });
});

describe("invariantes de tenancy (ADR-001 §3.6)", () => {
  it("toda tabla de public tiene RLS habilitado", async () => {
    const tables = await tenancy(db.admin);
    expect(tables.length).toBeGreaterThan(0);
    expect(tables.filter((t) => !t.rls).map((t) => t.table)).toEqual([]);
  });

  it("organizations y profiles no tienen organization_id", async () => {
    const tables = await tenancy(db.admin);
    const notTenantOwned = tables.filter((t) =>
      NOT_TENANT_OWNED.includes(t.table),
    );
    expect(notTenantOwned.map((t) => t.table)).toEqual(NOT_TENANT_OWNED);
    expect(notTenantOwned.every((t) => !t.hasOrganizationId)).toBe(true);
  });

  it("toda otra tabla es tenant-scoped: organization_id NOT NULL, FK e índice", async () => {
    const tenantScoped = (await tenancy(db.admin)).filter(
      (t) => !NOT_TENANT_OWNED.includes(t.table),
    );
    expect(tenantScoped.map((t) => t.table)).toEqual([
      "contacts",
      "memberships",
      "opportunities",
    ]);
    for (const table of tenantScoped) {
      expect(table).toEqual({
        table: table.table,
        rls: true,
        hasOrganizationId: true,
        organizationIdNotNull: true,
        organizationIdFk: true,
        organizationIdLeadingIndex: true,
      });
    }
  });

  it("anon no tiene privilegios sobre las tablas de public", async () => {
    // Los de authenticated (solo SELECT) se prueban en tenant-catalog.test.ts.
    expect(await tablePrivileges(db.admin, ["anon"])).toEqual([]);
  });

  it("los objetos nuevos que cree postgres en public no heredan grants para anon ni authenticated", async () => {
    expect(
      (await publicDefaultPrivileges(db.admin)).filter((entry) =>
        /\s(anon|authenticated)=/.test(entry),
      ),
    ).toEqual([]);

    await inRolledBackTransaction(db.admin, async (tx) => {
      await asRole(
        tx,
        "postgres",
        (sp) => sp`CREATE TABLE public.probe (id int)`,
      );
      expect(
        (await tablePrivileges(tx, ["anon", "authenticated"])).filter((grant) =>
          grant.endsWith(" probe"),
        ),
      ).toEqual([]);
    });
  });
});

describe("constraints con datos", () => {
  it("memberships exige organization_id, user_id y role", async () => {
    await inRolledBackTransaction(db.admin, async (tx) => {
      await seed(tx);
      await expectSqlError(
        tx,
        "23502",
        (sp) =>
          sp`INSERT INTO public.memberships (user_id, role) VALUES (${USER_B}, 'seller')`,
      );
      await expectSqlError(
        tx,
        "23502",
        (sp) =>
          sp`INSERT INTO public.memberships (organization_id, role) VALUES (${ORG_1}, 'seller')`,
      );
      await expectSqlError(
        tx,
        "23502",
        (sp) =>
          sp`INSERT INTO public.memberships (organization_id, user_id) VALUES (${ORG_1}, ${USER_B})`,
      );
    });
  });

  it("role solo acepta admin o seller", async () => {
    await inRolledBackTransaction(db.admin, async (tx) => {
      await seed(tx);
      for (const role of ["owner", "manager", "vendedor"]) {
        await expectSqlError(
          tx,
          "22P02",
          (sp) =>
            sp`INSERT INTO public.memberships (organization_id, user_id, role) VALUES (${ORG_2}, ${USER_A}, ${role})`,
        );
      }
      const [membership] = await tx<{ role: string; active: boolean }[]>`
        INSERT INTO public.memberships (organization_id, user_id, role)
        VALUES (${ORG_1}, ${USER_B}, 'seller')
        RETURNING role, active
      `;
      expect(membership).toEqual({ role: "seller", active: true });
    });
  });

  it("una membership por usuario y organización", async () => {
    await inRolledBackTransaction(db.admin, async (tx) => {
      await seed(tx);
      await expectSqlError(
        tx,
        "23505",
        (sp) =>
          sp`INSERT INTO public.memberships (organization_id, user_id, role) VALUES (${ORG_1}, ${USER_A}, 'seller')`,
      );
      // El mismo usuario sí puede ser miembro de otra organización.
      await tx`
        INSERT INTO public.memberships (organization_id, user_id, role)
        VALUES (${ORG_2}, ${USER_A}, 'seller')
      `;
    });
  });

  it("las FKs exigen organización, perfil y usuario de auth existentes", async () => {
    const unknown = "00000000-0000-4000-8000-0000000000ff";
    await inRolledBackTransaction(db.admin, async (tx) => {
      await seed(tx);
      await expectSqlError(
        tx,
        "23503",
        (sp) =>
          sp`INSERT INTO public.memberships (organization_id, user_id, role) VALUES (${unknown}, ${USER_B}, 'seller')`,
      );
      await expectSqlError(
        tx,
        "23503",
        (sp) =>
          sp`INSERT INTO public.memberships (organization_id, user_id, role) VALUES (${ORG_1}, ${unknown}, 'seller')`,
      );
      await expectSqlError(
        tx,
        "23503",
        (sp) =>
          sp`INSERT INTO public.profiles (id, full_name) VALUES (${unknown}, 'Sin usuario')`,
      );
    });
  });

  it("un perfil ligado a auth.users se crea sin full_name", async () => {
    const userC = "00000000-0000-4000-8000-00000000000c";
    await inRolledBackTransaction(db.admin, async (tx) => {
      await tx`INSERT INTO auth.users (id) VALUES (${userC})`;
      const [profile] = await tx<{ id: string; fullName: string | null }[]>`
        INSERT INTO public.profiles (id) VALUES (${userC})
        RETURNING id, full_name AS "fullName"
      `;
      expect(profile).toEqual({ id: userC, fullName: null });
    });
  });

  it("no se borra una organización con memberships", async () => {
    await inRolledBackTransaction(db.admin, async (tx) => {
      await seed(tx);
      await expectSqlError(
        tx,
        "23503",
        (sp) => sp`DELETE FROM public.organizations WHERE id = ${ORG_1}`,
      );
    });
  });

  it("borrar un usuario de auth.users borra su perfil y sus memberships", async () => {
    await inRolledBackTransaction(db.admin, async (tx) => {
      await seed(tx);
      await tx`DELETE FROM auth.users WHERE id = ${USER_A}`;

      const [row] = await tx<{ profiles: number; memberships: number }[]>`
        SELECT
          (SELECT count(*)::int FROM public.profiles WHERE id = ${USER_A}) AS profiles,
          (SELECT count(*)::int FROM public.memberships WHERE user_id = ${USER_A}) AS memberships
      `;
      expect(row).toEqual({ profiles: 0, memberships: 0 });
    });
  });
});

describe("constraints de contacts y opportunities con datos", () => {
  it("una oportunidad no puede apuntar a un contacto de otra organización", async () => {
    await inRolledBackTransaction(db.admin, async (tx) => {
      await seed(tx);
      await expectSqlError(
        tx,
        "23503",
        (sp) =>
          sp`INSERT INTO public.opportunities (organization_id, contact_id, stage, source) VALUES (${ORG_1}, ${CONTACT_2}, 'new', 'web')`,
      );
      const unknown = "10000000-0000-4000-8000-0000000000ff";
      await expectSqlError(
        tx,
        "23503",
        (sp) =>
          sp`INSERT INTO public.opportunities (organization_id, contact_id, stage, source) VALUES (${ORG_1}, ${unknown}, 'new', 'web')`,
      );
    });
  });

  it("etapa y origen solo aceptan los valores del CHECK", async () => {
    await inRolledBackTransaction(db.admin, async (tx) => {
      await seed(tx);
      for (const [stage, source] of [
        ["sold", "web"],
        ["testDrive", "web"],
        ["new", "instagram"],
        ["new", "WhatsApp"],
      ]) {
        await expectSqlError(
          tx,
          "23514",
          (sp) =>
            sp`INSERT INTO public.opportunities (organization_id, contact_id, stage, source) VALUES (${ORG_1}, ${CONTACT_1}, ${stage!}, ${source!})`,
        );
      }
      const [row] = await tx<{ stage: string; recent: boolean }[]>`
        INSERT INTO public.opportunities (organization_id, contact_id, stage, source)
        VALUES (${ORG_1}, ${CONTACT_1}, 'test_drive', 'referral')
        RETURNING stage, last_activity_at > now() - interval '1 minute' AS recent
      `;
      expect(row).toEqual({ stage: "test_drive", recent: true });
    });
  });

  it("contacto, etapa, origen y organización son obligatorios", async () => {
    await inRolledBackTransaction(db.admin, async (tx) => {
      await seed(tx);
      for (const insert of [
        (sp: TransactionSql) =>
          sp`INSERT INTO public.opportunities (organization_id, stage, source) VALUES (${ORG_1}, 'new', 'web')`,
        (sp: TransactionSql) =>
          sp`INSERT INTO public.opportunities (organization_id, contact_id, source) VALUES (${ORG_1}, ${CONTACT_1}, 'web')`,
        (sp: TransactionSql) =>
          sp`INSERT INTO public.opportunities (organization_id, contact_id, stage) VALUES (${ORG_1}, ${CONTACT_1}, 'new')`,
        (sp: TransactionSql) =>
          sp`INSERT INTO public.contacts (name) VALUES ('Sin organización')`,
        (sp: TransactionSql) =>
          sp`INSERT INTO public.contacts (organization_id) VALUES (${ORG_1})`,
      ]) {
        await expectSqlError(tx, "23502", insert);
      }
    });
  });

  it("no se borra un contacto con oportunidades ni una organización con contactos", async () => {
    await inRolledBackTransaction(db.admin, async (tx) => {
      await seed(tx);
      await expectSqlError(
        tx,
        "23503",
        (sp) => sp`DELETE FROM public.contacts WHERE id = ${CONTACT_1}`,
      );
      await tx`DELETE FROM public.memberships`;
      await expectSqlError(
        tx,
        "23503",
        (sp) => sp`DELETE FROM public.organizations WHERE id = ${ORG_2}`,
      );
    });
  });
});

describe("acceso directo por rol, sin withTenant", () => {
  const tables = [
    "organizations",
    "profiles",
    "memberships",
    "contacts",
    "opportunities",
  ];

  it("anon no puede leer ni escribir (42501, sin grants)", async () => {
    await inRolledBackTransaction(db.admin, async (tx) => {
      await seed(tx);
      for (const table of tables) {
        await expectSqlError(tx, "42501", (sp) =>
          asRole(
            sp,
            "anon",
            (as) => as`SELECT * FROM ${as(`public.${table}`)}`,
          ),
        );
        await expectSqlError(tx, "42501", (sp) =>
          asRole(sp, "anon", (as) => as`DELETE FROM ${as(`public.${table}`)}`),
        );
      }
      await expectSqlError(tx, "42501", (sp) =>
        asRole(
          sp,
          "anon",
          (as) =>
            as`INSERT INTO public.organizations (name) VALUES ('Intrusa')`,
        ),
      );
    });
  });

  it("authenticated sin claims no ve filas ni escribe", async () => {
    await inRolledBackTransaction(db.admin, async (tx) => {
      await seed(tx);
      for (const table of tables) {
        const rows = await asRole(
          tx,
          "authenticated",
          (as) => as`SELECT * FROM ${as(`public.${table}`)}`,
        );
        expect(rows).toHaveLength(0);
        await expectSqlError(tx, "42501", (sp) =>
          asRole(
            sp,
            "authenticated",
            (as) => as`DELETE FROM ${as(`public.${table}`)}`,
          ),
        );
      }
      await expectSqlError(tx, "42501", (sp) =>
        asRole(
          sp,
          "authenticated",
          (as) =>
            as`INSERT INTO public.memberships (organization_id, user_id, role) VALUES (${ORG_2}, ${USER_B}, 'admin')`,
        ),
      );
    });
  });

  it("postgres (solo migraciones) sí ve las filas: BYPASSRLS, nunca en runtime", async () => {
    await inRolledBackTransaction(db.admin, async (tx) => {
      await seed(tx);
      const rows = await asRole(
        tx,
        "postgres",
        (as) => as`SELECT id FROM public.organizations`,
      );
      expect(rows).toHaveLength(2);
    });
  });
});

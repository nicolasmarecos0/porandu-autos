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
  it("es la raíz del tenant: UUID PK, nombre, timestamps y moneda por defecto (DEC-038), sin organization_id", async () => {
    expect(await columns(db.admin, "organizations")).toEqual([
      {
        name: "id",
        type: "uuid",
        notNull: true,
        default: "gen_random_uuid()",
      },
      { name: "name", type: "text", notNull: true, default: null },
      ...TIMESTAMPS,
      // 0012 (Hito 6): ADD COLUMN la agrega al final.
      {
        name: "default_currency",
        type: "text",
        notNull: true,
        default: "'PYG'::text",
      },
    ]);
    expect(await constraints(db.admin, "organizations")).toEqual({
      organizations_pkey: "PRIMARY KEY (id)",
      organizations_name_check:
        "CHECK ((((char_length(name) >= 1) AND (char_length(name) <= 120)) AND (name = btrim(name)) AND (name !~ '[[:cntrl:]]'::text)))",
      organizations_default_currency_check:
        "CHECK ((default_currency = ANY (ARRAY['PYG'::text, 'USD'::text])))",
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

describe("contacts (H1.1, H1.2)", () => {
  it("columnas: nombre obligatorio; teléfono, teléfono normalizado y ciudad opcionales", async () => {
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
      // 0003 la agrega al final de la tabla (ALTER TABLE … ADD COLUMN).
      {
        name: "phone_normalized",
        type: "text",
        notNull: false,
        default: null,
      },
    ]);
  });

  it("PK, FK a organizations (RESTRICT), unique (organization_id, id) y CHECK E.164", async () => {
    expect(await constraints(db.admin, "contacts")).toEqual({
      contacts_pkey: "PRIMARY KEY (id)",
      contacts_organization_id_id_key: "UNIQUE (organization_id, id)",
      contacts_organization_id_organizations_id_fk:
        "FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT",
      contacts_phone_normalized_check:
        "CHECK (((phone_normalized IS NULL) OR ((phone IS NOT NULL) AND (phone_normalized ~ '^\\+[1-9][0-9]{1,14}$'::text))))",
    });
  });

  it("índices: el teléfono normalizado es único por organización (parcial), no global", async () => {
    expect(await indexes(db.admin, "contacts")).toEqual({
      contacts_pkey:
        "CREATE UNIQUE INDEX contacts_pkey ON public.contacts USING btree (id)",
      contacts_organization_id_id_key:
        "CREATE UNIQUE INDEX contacts_organization_id_id_key ON public.contacts USING btree (organization_id, id)",
      contacts_organization_id_phone_normalized_key:
        "CREATE UNIQUE INDEX contacts_organization_id_phone_normalized_key ON public.contacts USING btree (organization_id, phone_normalized) WHERE (phone_normalized IS NOT NULL)",
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
      // H1.6 (0008), Hito 2 (0009) y el cierre (0010, DEC-034): agregadas
      // con ALTER TABLE, así que son las últimas.
      { name: "loss_reason", type: "text", notNull: false, default: null },
      { name: "vehicle_id", type: "uuid", notNull: false, default: null },
      { name: "loss_notes", type: "text", notNull: false, default: null },
      {
        name: "sale_price",
        type: "numeric(14,2)",
        notNull: false,
        default: null,
      },
      { name: "sale_currency", type: "text", notNull: false, default: null },
      { name: "payment_method", type: "text", notNull: false, default: null },
      { name: "delivery_status", type: "text", notNull: false, default: null },
      { name: "delivery_date", type: "date", notNull: false, default: null },
    ]);
  });

  it("FK compuesta al contacto de la misma organización, CHECK de etapa, origen y motivo de pérdida", async () => {
    expect(await constraints(db.admin, "opportunities")).toEqual({
      opportunities_pkey: "PRIMARY KEY (id)",
      opportunities_organization_id_organizations_id_fk:
        "FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT",
      opportunities_organization_id_contact_id_contacts_fk:
        "FOREIGN KEY (organization_id, contact_id) REFERENCES contacts(organization_id, id) ON DELETE RESTRICT",
      opportunities_stage_check:
        "CHECK ((stage = ANY (ARRAY['new'::text, 'qualifying'::text, 'negotiating'::text, 'won'::text, 'lost'::text])))",
      opportunities_source_check:
        "CHECK ((source = ANY (ARRAY['whatsapp'::text, 'meta_ads'::text, 'web'::text, 'showroom'::text, 'referral'::text])))",
      // H1.6: motivo de pérdida estructurado, si y solo si la etapa es lost
      // (lista de DEC-034 §2).
      opportunities_loss_reason_check:
        "CHECK ((loss_reason = ANY (ARRAY['price'::text, 'vehicle_unavailable'::text, 'competitor'::text, 'financing_rejected'::text, 'ghosted'::text, 'other'::text])))",
      opportunities_loss_reason_stage_check:
        "CHECK ((((stage = 'lost'::text) AND (loss_reason IS NOT NULL)) OR ((stage <> 'lost'::text) AND (loss_reason IS NULL))))",
      // H1.4: destino de la FK compuesta de opportunity_demand_facts.
      opportunities_organization_id_id_key: "UNIQUE (organization_id, id)",
      // Hito 4: destino de la FK compuesta de messages (con el contacto).
      opportunities_organization_id_id_contact_id_key:
        "UNIQUE (organization_id, id, contact_id)",
      // Hito 2: la unidad vinculada es de la misma organización y solo existe
      // desde la negociación.
      opportunities_vehicle_fk:
        "FOREIGN KEY (organization_id, vehicle_id) REFERENCES vehicles(organization_id, id) ON DELETE RESTRICT",
      opportunities_vehicle_stage_check:
        "CHECK (((vehicle_id IS NULL) OR (stage = ANY (ARRAY['negotiating'::text, 'won'::text, 'lost'::text]))))",
      // DEC-034: notas solo con lost; la venta completa, con su unidad, si y
      // solo si won; y los valores de cada metadato.
      opportunities_loss_notes_check:
        "CHECK ((((char_length(loss_notes) >= 1) AND (char_length(loss_notes) <= 500)) AND (loss_notes = btrim(loss_notes, (' '::text || chr(10)))) AND (translate(loss_notes, chr(10), ''::text) !~ '[[:cntrl:]]'::text)))",
      opportunities_loss_notes_stage_check:
        "CHECK (((loss_notes IS NULL) OR (stage = 'lost'::text)))",
      opportunities_sale_currency_check:
        "CHECK ((sale_currency = ANY (ARRAY['PYG'::text, 'USD'::text])))",
      opportunities_sale_price_check:
        "CHECK ((((sale_price IS NULL) = (sale_currency IS NULL)) AND ((sale_price IS NULL) OR ((sale_price > (0)::numeric) AND ((sale_currency <> 'PYG'::text) OR (sale_price = trunc(sale_price)))))))",
      opportunities_payment_method_check:
        "CHECK ((payment_method = ANY (ARRAY['cash'::text, 'financing'::text, 'trade_in'::text, 'mixed'::text])))",
      opportunities_delivery_status_check:
        "CHECK ((delivery_status = ANY (ARRAY['scheduled'::text, 'delivered'::text])))",
      opportunities_delivery_date_check:
        "CHECK (((delivery_date >= '2000-01-01'::date) AND (delivery_date <= '2100-12-31'::date)))",
      opportunities_won_closure_check:
        "CHECK ((((stage = 'won'::text) AND (vehicle_id IS NOT NULL) AND (sale_price IS NOT NULL) AND (sale_currency IS NOT NULL) AND (payment_method IS NOT NULL) AND (delivery_status IS NOT NULL) AND (delivery_date IS NOT NULL)) OR ((stage <> 'won'::text) AND (sale_price IS NULL) AND (sale_currency IS NULL) AND (payment_method IS NULL) AND (delivery_status IS NULL) AND (delivery_date IS NULL))))",
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
      opportunities_organization_id_id_key:
        "CREATE UNIQUE INDEX opportunities_organization_id_id_key ON public.opportunities USING btree (organization_id, id)",
      opportunities_organization_id_id_contact_id_key:
        "CREATE UNIQUE INDEX opportunities_organization_id_id_contact_id_key ON public.opportunities USING btree (organization_id, id, contact_id)",
      opportunities_organization_id_vehicle_id_idx:
        "CREATE INDEX opportunities_organization_id_vehicle_id_idx ON public.opportunities USING btree (organization_id, vehicle_id) WHERE (vehicle_id IS NOT NULL)",
    });
  });
});

describe("vehicles (H1.3A)", () => {
  it("columnas: identificación y estado obligatorios; versión, km y precio opcionales; precio exacto", async () => {
    expect(await columns(db.admin, "vehicles")).toEqual([
      {
        name: "id",
        type: "uuid",
        notNull: true,
        default: "gen_random_uuid()",
      },
      { name: "organization_id", type: "uuid", notNull: true, default: null },
      { name: "brand", type: "text", notNull: true, default: null },
      { name: "model", type: "text", notNull: true, default: null },
      { name: "version", type: "text", notNull: false, default: null },
      { name: "year", type: "smallint", notNull: true, default: null },
      { name: "km", type: "integer", notNull: false, default: null },
      { name: "price", type: "numeric(14,2)", notNull: false, default: null },
      { name: "currency", type: "text", notNull: false, default: null },
      // Sin default: el estado de una unidad se declara, nunca se supone.
      { name: "status", type: "text", notNull: true, default: null },
      ...TIMESTAMPS,
    ]);
  });

  it("PK, FK a organizations (RESTRICT) y CHECKs de estado, moneda, precio, año y km", async () => {
    expect(await constraints(db.admin, "vehicles")).toEqual({
      vehicles_pkey: "PRIMARY KEY (id)",
      vehicles_organization_id_organizations_id_fk:
        "FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT",
      vehicles_status_check:
        "CHECK ((status = ANY (ARRAY['in_preparation'::text, 'available'::text, 'reserved'::text, 'sold'::text])))",
      vehicles_currency_check:
        "CHECK ((currency = ANY (ARRAY['PYG'::text, 'USD'::text])))",
      vehicles_price_check:
        "CHECK ((((price IS NULL) = (currency IS NULL)) AND ((price IS NULL) OR ((price > (0)::numeric) AND ((currency <> 'PYG'::text) OR (price = trunc(price)))))))",
      vehicles_year_check: "CHECK (((year >= 1900) AND (year <= 2100)))",
      vehicles_km_check: "CHECK (((km IS NULL) OR (km >= 0)))",
      // Hito 2: destino de la FK compuesta de opportunities.vehicle_id.
      vehicles_organization_id_id_key: "UNIQUE (organization_id, id)",
    });
  });

  it("índices: la lista por organización e ingreso", async () => {
    expect(await indexes(db.admin, "vehicles")).toEqual({
      vehicles_pkey:
        "CREATE UNIQUE INDEX vehicles_pkey ON public.vehicles USING btree (id)",
      vehicles_organization_id_created_at_idx:
        "CREATE INDEX vehicles_organization_id_created_at_idx ON public.vehicles USING btree (organization_id, created_at DESC)",
      vehicles_organization_id_id_key:
        "CREATE UNIQUE INDEX vehicles_organization_id_id_key ON public.vehicles USING btree (organization_id, id)",
    });
  });
});

describe("opportunity_demand_facts (H1.4)", () => {
  it("columnas: ledger con fact, estado, fuente, autor, reloj de la base, enlaces y valor por fact", async () => {
    const nullable = (name: string, type: string) => ({
      name,
      type,
      notNull: false,
      default: null,
    });
    expect(await columns(db.admin, "opportunity_demand_facts")).toEqual([
      {
        name: "id",
        type: "uuid",
        notNull: true,
        default: "gen_random_uuid()",
      },
      { name: "organization_id", type: "uuid", notNull: true, default: null },
      { name: "opportunity_id", type: "uuid", notNull: true, default: null },
      { name: "fact", type: "text", notNull: true, default: null },
      { name: "status", type: "text", notNull: true, default: null },
      { name: "source_kind", type: "text", notNull: true, default: null },
      nullable("recorded_by", "uuid"),
      // timestamptz sin precisión reducida: el reloj de la base, el mismo
      // now() que exige la policy de alta.
      {
        name: "recorded_at",
        type: "timestamp with time zone",
        notNull: true,
        default: "now()",
      },
      nullable("target_fact_id", "uuid"),
      nullable("previous_member_fact_id", "uuid"),
      nullable("brand", "text"),
      nullable("model", "text"),
      nullable("year_min", "smallint"),
      nullable("year_max", "smallint"),
      nullable("amount", "numeric(14,2)"),
      nullable("currency", "text"),
      nullable("purchase_type", "text"),
      nullable("trade_in", "boolean"),
      nullable("evidence_text", "text"),
    ]);
  });

  it("PK, FKs RESTRICT (organización, oportunidad de la misma organización, autor, target y previous dentro del mismo fact) y CHECKs con nombre", async () => {
    expect(await constraints(db.admin, "opportunity_demand_facts")).toEqual({
      opportunity_demand_facts_pkey: "PRIMARY KEY (id)",
      opportunity_demand_facts_organization_id_organizations_id_fk:
        "FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT",
      opportunity_demand_facts_opportunity_fk:
        "FOREIGN KEY (organization_id, opportunity_id) REFERENCES opportunities(organization_id, id) ON DELETE RESTRICT",
      opportunity_demand_facts_recorded_by_profiles_id_fk:
        "FOREIGN KEY (recorded_by) REFERENCES profiles(id) ON DELETE RESTRICT",
      opportunity_demand_facts_target_fk:
        "FOREIGN KEY (organization_id, opportunity_id, fact, target_fact_id) REFERENCES opportunity_demand_facts(organization_id, opportunity_id, fact, id) ON DELETE RESTRICT",
      opportunity_demand_facts_previous_fk:
        "FOREIGN KEY (organization_id, opportunity_id, fact, source_kind, previous_member_fact_id) REFERENCES opportunity_demand_facts(organization_id, opportunity_id, fact, source_kind, id) ON DELETE RESTRICT",
      opportunity_demand_facts_scope_key:
        "UNIQUE (organization_id, opportunity_id, fact, id)",
      opportunity_demand_facts_scope_source_key:
        "UNIQUE (organization_id, opportunity_id, fact, source_kind, id)",
      opportunity_demand_facts_fact_check:
        "CHECK ((fact = ANY (ARRAY['desired_vehicle'::text, 'year_range'::text, 'budget_max'::text, 'purchase_type'::text, 'trade_in_intent'::text, 'down_payment'::text])))",
      opportunity_demand_facts_status_check:
        "CHECK ((status = ANY (ARRAY['detected'::text, 'confirmed'::text, 'corrected'::text, 'rejected'::text])))",
      opportunity_demand_facts_source_kind_check:
        "CHECK ((source_kind = 'member'::text))",
      opportunity_demand_facts_currency_check:
        "CHECK ((currency = ANY (ARRAY['PYG'::text, 'USD'::text])))",
      opportunity_demand_facts_purchase_type_check:
        "CHECK ((purchase_type = ANY (ARRAY['cash'::text, 'financed'::text, 'undecided'::text])))",
      opportunity_demand_facts_value_check: `CHECK (
CASE
    WHEN (status = 'rejected'::text) THEN (num_nonnulls(brand, model, year_min, year_max, amount, currency, purchase_type, trade_in) = 0)
    WHEN (fact = 'desired_vehicle'::text) THEN ((num_nonnulls(brand, model) >= 1) AND (num_nonnulls(year_min, year_max, amount, currency, purchase_type, trade_in) = 0))
    WHEN (fact = 'year_range'::text) THEN ((num_nonnulls(year_min, year_max) >= 1) AND COALESCE(((year_min >= 1900) AND (year_min <= 2100)), true) AND COALESCE(((year_max >= 1900) AND (year_max <= 2100)), true) AND COALESCE((year_min <= year_max), true) AND (num_nonnulls(brand, model, amount, currency, purchase_type, trade_in) = 0))
    WHEN (fact = 'budget_max'::text) THEN ((num_nonnulls(amount, currency) = 2) AND (amount > (0)::numeric) AND ((currency <> 'PYG'::text) OR (amount = trunc(amount))) AND (num_nonnulls(brand, model, year_min, year_max, purchase_type, trade_in) = 0))
    WHEN (fact = 'down_payment'::text) THEN ((num_nonnulls(amount, currency) = 2) AND (amount >= (0)::numeric) AND ((currency <> 'PYG'::text) OR (amount = trunc(amount))) AND (num_nonnulls(brand, model, year_min, year_max, purchase_type, trade_in) = 0))
    WHEN (fact = 'purchase_type'::text) THEN ((purchase_type IS NOT NULL) AND (num_nonnulls(brand, model, year_min, year_max, amount, currency, trade_in) = 0))
    WHEN (fact = 'trade_in_intent'::text) THEN ((trade_in IS NOT NULL) AND (num_nonnulls(brand, model, year_min, year_max, amount, currency, purchase_type) = 0))
    ELSE false
END)`,
      opportunity_demand_facts_status_target_check:
        "CHECK ((((status <> ALL (ARRAY['rejected'::text, 'corrected'::text])) OR (target_fact_id IS NOT NULL)) AND ((status <> 'detected'::text) OR ((target_fact_id IS NULL) AND (previous_member_fact_id IS NULL)))))",
      opportunity_demand_facts_source_status_check:
        "CHECK (((status = 'detected'::text) = (source_kind <> 'member'::text)))",
      opportunity_demand_facts_member_author_check:
        "CHECK (((source_kind <> 'member'::text) OR (recorded_by IS NOT NULL)))",
      opportunity_demand_facts_member_chain_check:
        "CHECK (((source_kind = 'member'::text) OR (previous_member_fact_id IS NULL)))",
      opportunity_demand_facts_self_reference_check:
        "CHECK ((((target_fact_id IS NULL) OR (target_fact_id <> id)) AND ((previous_member_fact_id IS NULL) OR (previous_member_fact_id <> id))))",
      opportunity_demand_facts_text_check:
        "CHECK ((((brand IS NULL) OR (((char_length(brand) >= 1) AND (char_length(brand) <= 40)) AND (brand = btrim(brand)) AND (brand !~ '[[:cntrl:]]'::text))) AND ((model IS NULL) OR (((char_length(model) >= 1) AND (char_length(model) <= 80)) AND (model = btrim(model)) AND (model !~ '[[:cntrl:]]'::text))) AND ((evidence_text IS NULL) OR (((char_length(evidence_text) >= 1) AND (char_length(evidence_text) <= 500)) AND (evidence_text = btrim(evidence_text)) AND (evidence_text !~ '[[:cntrl:]]'::text)))))",
    });
  });

  it("índices: todos empiezan por organization_id; la cadena humana tiene un root y un sucesor por acto", async () => {
    expect(await indexes(db.admin, "opportunity_demand_facts")).toEqual({
      opportunity_demand_facts_pkey:
        "CREATE UNIQUE INDEX opportunity_demand_facts_pkey ON public.opportunity_demand_facts USING btree (id)",
      opportunity_demand_facts_scope_key:
        "CREATE UNIQUE INDEX opportunity_demand_facts_scope_key ON public.opportunity_demand_facts USING btree (organization_id, opportunity_id, fact, id)",
      opportunity_demand_facts_scope_source_key:
        "CREATE UNIQUE INDEX opportunity_demand_facts_scope_source_key ON public.opportunity_demand_facts USING btree (organization_id, opportunity_id, fact, source_kind, id)",
      opportunity_demand_facts_member_root_key:
        "CREATE UNIQUE INDEX opportunity_demand_facts_member_root_key ON public.opportunity_demand_facts USING btree (organization_id, opportunity_id, fact) WHERE ((source_kind = 'member'::text) AND (previous_member_fact_id IS NULL))",
      opportunity_demand_facts_member_next_key:
        "CREATE UNIQUE INDEX opportunity_demand_facts_member_next_key ON public.opportunity_demand_facts USING btree (organization_id, opportunity_id, fact, previous_member_fact_id) WHERE ((source_kind = 'member'::text) AND (previous_member_fact_id IS NOT NULL))",
    });
  });
});

describe("opportunity_notes (Hito 2)", () => {
  it("columnas: bitácora append-only con la oportunidad, el texto, el autor y el reloj de la base", async () => {
    expect(await columns(db.admin, "opportunity_notes")).toEqual([
      {
        name: "id",
        type: "uuid",
        notNull: true,
        default: "gen_random_uuid()",
      },
      { name: "organization_id", type: "uuid", notNull: true, default: null },
      { name: "opportunity_id", type: "uuid", notNull: true, default: null },
      { name: "body", type: "text", notNull: true, default: null },
      { name: "recorded_by", type: "uuid", notNull: true, default: null },
      {
        name: "recorded_at",
        type: "timestamp with time zone",
        notNull: true,
        default: "now()",
      },
    ]);
  });

  it("PK, FKs RESTRICT (organización, oportunidad de la misma organización, autor) y CHECK del texto", async () => {
    expect(await constraints(db.admin, "opportunity_notes")).toEqual({
      opportunity_notes_pkey: "PRIMARY KEY (id)",
      opportunity_notes_organization_id_organizations_id_fk:
        "FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT",
      opportunity_notes_opportunity_fk:
        "FOREIGN KEY (organization_id, opportunity_id) REFERENCES opportunities(organization_id, id) ON DELETE RESTRICT",
      opportunity_notes_recorded_by_profiles_id_fk:
        "FOREIGN KEY (recorded_by) REFERENCES profiles(id) ON DELETE RESTRICT",
      opportunity_notes_body_check:
        "CHECK ((((char_length(body) >= 1) AND (char_length(body) <= 1000)) AND (body = btrim(body, (' '::text || chr(10)))) AND (translate(body, chr(10), ''::text) !~ '[[:cntrl:]]'::text)))",
    });
  });

  it("índices: la bitácora por organización, oportunidad y fecha", async () => {
    expect(await indexes(db.admin, "opportunity_notes")).toEqual({
      opportunity_notes_pkey:
        "CREATE UNIQUE INDEX opportunity_notes_pkey ON public.opportunity_notes USING btree (id)",
      opportunity_notes_organization_id_opportunity_id_idx:
        "CREATE INDEX opportunity_notes_organization_id_opportunity_id_idx ON public.opportunity_notes USING btree (organization_id, opportunity_id, recorded_at DESC)",
    });
  });
});

describe("messages (Hito 4)", () => {
  it("columnas: mensajes append-only con el contacto, la oportunidad opcional, canal, dirección, texto, autor y reloj de la base", async () => {
    expect(await columns(db.admin, "messages")).toEqual([
      {
        name: "id",
        type: "uuid",
        notNull: true,
        default: "gen_random_uuid()",
      },
      { name: "organization_id", type: "uuid", notNull: true, default: null },
      { name: "contact_id", type: "uuid", notNull: true, default: null },
      { name: "opportunity_id", type: "uuid", notNull: false, default: null },
      { name: "channel", type: "text", notNull: true, default: null },
      { name: "direction", type: "text", notNull: true, default: null },
      { name: "content", type: "text", notNull: true, default: null },
      // Opcional desde 0013: un mensaje ingerido no tiene autor (DEC-039).
      { name: "recorded_by", type: "uuid", notNull: false, default: null },
      {
        name: "created_at",
        type: "timestamp with time zone",
        notNull: true,
        default: "now()",
      },
      { name: "conversation_id", type: "uuid", notNull: false, default: null },
      { name: "external_id", type: "text", notNull: false, default: null },
      {
        name: "sent_at",
        type: "timestamp with time zone",
        notNull: false,
        default: null,
      },
    ]);
  });

  it("PK, FKs RESTRICT (organización, contacto y oportunidad de la misma organización y del mismo contacto, autor) y CHECKs de canal, dirección y texto", async () => {
    expect(await constraints(db.admin, "messages")).toEqual({
      messages_pkey: "PRIMARY KEY (id)",
      messages_organization_id_organizations_id_fk:
        "FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT",
      messages_contact_fk:
        "FOREIGN KEY (organization_id, contact_id) REFERENCES contacts(organization_id, id) ON DELETE RESTRICT",
      messages_opportunity_fk:
        "FOREIGN KEY (organization_id, opportunity_id, contact_id) REFERENCES opportunities(organization_id, id, contact_id) ON DELETE RESTRICT",
      messages_recorded_by_profiles_id_fk:
        "FOREIGN KEY (recorded_by) REFERENCES profiles(id) ON DELETE RESTRICT",
      messages_channel_check:
        "CHECK ((channel = ANY (ARRAY['whatsapp'::text, 'email'::text, 'manual'::text])))",
      messages_direction_check:
        "CHECK ((direction = ANY (ARRAY['inbound'::text, 'outbound'::text])))",
      messages_content_check:
        "CHECK ((((char_length(content) >= 1) AND (char_length(content) <= 4096)) AND (content = btrim(content, (' '::text || chr(10)))) AND (translate(content, chr(10), ''::text) !~ '[[:cntrl:]]'::text)))",
      // Hito 7 (DEC-039 §10): la conversación del mismo contacto, el id del
      // proveedor y el origen (miembro o ingesta).
      messages_conversation_fk:
        "FOREIGN KEY (organization_id, conversation_id, contact_id) REFERENCES conversations(organization_id, id, contact_id) ON DELETE RESTRICT",
      messages_external_id_check:
        "CHECK ((((char_length(external_id) >= 1) AND (char_length(external_id) <= 256)) AND (external_id !~ '[[:space:][:cntrl:]]'::text)))",
      messages_source_check:
        "CHECK ((((recorded_by IS NOT NULL) AND (conversation_id IS NULL) AND (external_id IS NULL) AND (sent_at IS NULL)) OR ((recorded_by IS NULL) AND (conversation_id IS NOT NULL) AND (external_id IS NOT NULL) AND (sent_at IS NOT NULL) AND (channel = 'whatsapp'::text) AND (direction = 'inbound'::text))))",
    });
  });

  it("índices: el muro por organización, oportunidad y fecha, y la conversación del contacto", async () => {
    expect(await indexes(db.admin, "messages")).toEqual({
      messages_pkey:
        "CREATE UNIQUE INDEX messages_pkey ON public.messages USING btree (id)",
      messages_organization_id_opportunity_id_idx:
        "CREATE INDEX messages_organization_id_opportunity_id_idx ON public.messages USING btree (organization_id, opportunity_id, created_at DESC)",
      messages_organization_id_contact_id_idx:
        "CREATE INDEX messages_organization_id_contact_id_idx ON public.messages USING btree (organization_id, contact_id, created_at DESC)",
      // Idempotencia de la ingesta (DEC-039 §8).
      messages_organization_id_external_id_key:
        "CREATE UNIQUE INDEX messages_organization_id_external_id_key ON public.messages USING btree (organization_id, external_id) WHERE (external_id IS NOT NULL)",
    });
  });
});

describe("conversations y whatsapp_lines (Hito 7)", () => {
  it("conversations: columnas, una abierta por contacto y canal, el último mensaje en una línea", async () => {
    expect(await columns(db.admin, "conversations")).toEqual([
      {
        name: "id",
        type: "uuid",
        notNull: true,
        default: "gen_random_uuid()",
      },
      { name: "organization_id", type: "uuid", notNull: true, default: null },
      { name: "contact_id", type: "uuid", notNull: true, default: null },
      { name: "channel", type: "text", notNull: true, default: null },
      { name: "status", type: "text", notNull: true, default: "'open'::text" },
      {
        name: "last_message_at",
        type: "timestamp with time zone",
        notNull: false,
        default: null,
      },
      {
        name: "last_message_preview",
        type: "text",
        notNull: false,
        default: null,
      },
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
    ]);
    expect(await constraints(db.admin, "conversations")).toEqual({
      conversations_pkey: "PRIMARY KEY (id)",
      conversations_organization_id_organizations_id_fk:
        "FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT",
      conversations_contact_fk:
        "FOREIGN KEY (organization_id, contact_id) REFERENCES contacts(organization_id, id) ON DELETE RESTRICT",
      conversations_organization_id_id_contact_id_key:
        "UNIQUE (organization_id, id, contact_id)",
      conversations_channel_check: "CHECK ((channel = 'whatsapp'::text))",
      conversations_status_check:
        "CHECK ((status = ANY (ARRAY['open'::text, 'closed'::text])))",
      conversations_last_message_check:
        "CHECK (((last_message_at IS NULL) = (last_message_preview IS NULL)))",
      conversations_last_message_preview_check:
        "CHECK ((((char_length(last_message_preview) >= 1) AND (char_length(last_message_preview) <= 160)) AND (last_message_preview = btrim(last_message_preview)) AND (last_message_preview !~ '[[:cntrl:]]'::text)))",
    });
    expect(await indexes(db.admin, "conversations")).toEqual({
      conversations_pkey:
        "CREATE UNIQUE INDEX conversations_pkey ON public.conversations USING btree (id)",
      conversations_organization_id_id_contact_id_key:
        "CREATE UNIQUE INDEX conversations_organization_id_id_contact_id_key ON public.conversations USING btree (organization_id, id, contact_id)",
      conversations_open_contact_channel_key:
        "CREATE UNIQUE INDEX conversations_open_contact_channel_key ON public.conversations USING btree (organization_id, contact_id, channel) WHERE (status = 'open'::text)",
    });
  });

  it("whatsapp_lines: la línea receptora, única global y de una organización", async () => {
    expect(await columns(db.admin, "whatsapp_lines")).toEqual([
      {
        name: "id",
        type: "uuid",
        notNull: true,
        default: "gen_random_uuid()",
      },
      { name: "organization_id", type: "uuid", notNull: true, default: null },
      { name: "phone_number_id", type: "text", notNull: true, default: null },
      { name: "active", type: "boolean", notNull: true, default: "true" },
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
    ]);
    expect(await constraints(db.admin, "whatsapp_lines")).toEqual({
      whatsapp_lines_pkey: "PRIMARY KEY (id)",
      whatsapp_lines_organization_id_organizations_id_fk:
        "FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT",
      whatsapp_lines_phone_number_id_key: "UNIQUE (phone_number_id)",
      whatsapp_lines_phone_number_id_check:
        "CHECK ((phone_number_id ~ '^[0-9]{1,32}$'::text))",
    });
    expect(await indexes(db.admin, "whatsapp_lines")).toEqual({
      whatsapp_lines_pkey:
        "CREATE UNIQUE INDEX whatsapp_lines_pkey ON public.whatsapp_lines USING btree (id)",
      whatsapp_lines_phone_number_id_key:
        "CREATE UNIQUE INDEX whatsapp_lines_phone_number_id_key ON public.whatsapp_lines USING btree (phone_number_id)",
      whatsapp_lines_organization_id_idx:
        "CREATE INDEX whatsapp_lines_organization_id_idx ON public.whatsapp_lines USING btree (organization_id)",
    });
  });
});

describe("constraints de opportunity_demand_facts con datos (H1.4)", () => {
  const OPP_1 = "30000000-0000-4000-8000-000000000001";
  const OPP_1B = "30000000-0000-4000-8000-000000000002";

  class Undo extends Error {}

  type Row = Record<string, string | number | boolean | null>;

  /** Usuarios, organizaciones y dos oportunidades de ORG_1. */
  async function seedDemand(tx: TransactionSql): Promise<void> {
    await seed(tx);
    await tx`
      INSERT INTO public.opportunities (id, organization_id, contact_id, stage, source)
      VALUES (${OPP_1}, ${ORG_1}, ${CONTACT_1}, 'new', 'web'),
        (${OPP_1B}, ${ORG_1}, ${CONTACT_1}, 'new', 'web')
    `;
  }

  function row(overrides: Row): Row {
    return {
      organization_id: ORG_1,
      opportunity_id: OPP_1,
      status: "confirmed",
      source_kind: "member",
      recorded_by: USER_A,
      ...overrides,
    };
  }

  function insert(sp: TransactionSql, values: Row) {
    return sp<{ id: string }[]>`
      INSERT INTO public.opportunity_demand_facts ${sp(values)} RETURNING id
    `;
  }

  /** Intenta el INSERT y lo deshace siempre: "ok" o el SQLSTATE. */
  async function attempt(tx: TransactionSql, values: Row): Promise<string> {
    try {
      await tx.savepoint(async (sp) => {
        await insert(sp, values);
        throw new Undo();
      });
    } catch (error) {
      if (error instanceof Undo) return "ok";
      return (error as { code?: string }).code ?? String(error);
    }
    return "unreachable";
  }

  const valid: [string, Row][] = [
    ["vehículo con modelo", { fact: "desired_vehicle", model: "Hilux" }],
    ["vehículo con marca", { fact: "desired_vehicle", brand: "Toyota" }],
    [
      "vehículo con marca y modelo",
      { fact: "desired_vehicle", brand: "Toyota", model: "Hilux" },
    ],
    [
      "textos al límite",
      {
        fact: "desired_vehicle",
        brand: "x".repeat(40),
        model: "y".repeat(80),
        evidence_text: "z".repeat(500),
      },
    ],
    ["años desde", { fact: "year_range", year_min: 2022 }],
    ["años hasta", { fact: "year_range", year_max: 2020 }],
    ["años iguales", { fact: "year_range", year_min: 2022, year_max: 2022 }],
    [
      "presupuesto PYG",
      { fact: "budget_max", amount: "250000000", currency: "PYG" },
    ],
    [
      "presupuesto USD con centavos",
      { fact: "budget_max", amount: "29990.50", currency: "USD" },
    ],
    ["entrega 0 (C-6)", { fact: "down_payment", amount: "0", currency: "PYG" }],
    ["tipo de compra", { fact: "purchase_type", purchase_type: "undecided" }],
    ["usado: no", { fact: "trade_in_intent", trade_in: false }],
  ];

  it.each(valid)("acepta %s", async (_, values) => {
    await inRolledBackTransaction(db.admin, async (tx) => {
      await seedDemand(tx);
      expect(await attempt(tx, row(values))).toBe("ok");
    });
  });

  const invalid: [string, Row][] = [
    ["vehículo vacío", { fact: "desired_vehicle" }],
    [
      "vehículo con años",
      { fact: "desired_vehicle", model: "Hilux", year_min: 2020 },
    ],
    ["marca en blanco", { fact: "desired_vehicle", brand: "  " }],
    [
      "marca con espacios en los bordes",
      { fact: "desired_vehicle", brand: " Toyota" },
    ],
    [
      "modelo con salto de línea",
      { fact: "desired_vehicle", model: "Hilux\n" },
    ],
    [
      "modelo con carácter de control",
      { fact: "desired_vehicle", model: "Hi\u0007lux" },
    ],
    [
      "marca de 41 caracteres",
      { fact: "desired_vehicle", brand: "x".repeat(41) },
    ],
    [
      "modelo de 81 caracteres",
      { fact: "desired_vehicle", model: "y".repeat(81) },
    ],
    [
      "nota de 501 caracteres",
      {
        fact: "desired_vehicle",
        model: "Hilux",
        evidence_text: "z".repeat(501),
      },
    ],
    [
      "nota vacía",
      { fact: "desired_vehicle", model: "Hilux", evidence_text: "" },
    ],
    ["años vacíos", { fact: "year_range" }],
    ["año 1850", { fact: "year_range", year_min: 1850 }],
    ["año 2101", { fact: "year_range", year_max: 2101 }],
    [
      "desde mayor que hasta",
      { fact: "year_range", year_min: 2023, year_max: 2020 },
    ],
    ["presupuesto sin monto", { fact: "budget_max", currency: "PYG" }],
    ["presupuesto sin moneda", { fact: "budget_max", amount: "250000000" }],
    ["presupuesto 0", { fact: "budget_max", amount: "0", currency: "PYG" }],
    [
      "presupuesto negativo",
      { fact: "budget_max", amount: "-1", currency: "USD" },
    ],
    [
      "presupuesto PYG con decimales",
      { fact: "budget_max", amount: "150000000.5", currency: "PYG" },
    ],
    [
      "presupuesto en BRL",
      { fact: "budget_max", amount: "1000", currency: "BRL" },
    ],
    [
      "presupuesto con modelo",
      { fact: "budget_max", amount: "1000", currency: "USD", model: "Hilux" },
    ],
    [
      "entrega negativa",
      { fact: "down_payment", amount: "-1", currency: "PYG" },
    ],
    [
      "entrega PYG con decimales",
      { fact: "down_payment", amount: "50000000.5", currency: "PYG" },
    ],
    ["entrega sin monto", { fact: "down_payment", currency: "PYG" }],
    ["tipo de compra vacío", { fact: "purchase_type" }],
    ["tipo de compra mixed", { fact: "purchase_type", purchase_type: "mixed" }],
    ["usado vacío", { fact: "trade_in_intent" }],
    [
      "usado con tipo de compra",
      { fact: "trade_in_intent", trade_in: true, purchase_type: "cash" },
    ],
    ["fact desconocido (version)", { fact: "version", model: "SRV" }],
    [
      "un rechazo con valor",
      {
        fact: "purchase_type",
        status: "rejected",
        purchase_type: "cash",
        target_fact_id: CONTACT_1,
      },
    ],
    ["un rechazo sin target", { fact: "purchase_type", status: "rejected" }],
    [
      "una corrección sin target",
      { fact: "purchase_type", status: "corrected", purchase_type: "cash" },
    ],
    [
      "un miembro que detecta",
      { fact: "purchase_type", status: "detected", purchase_type: "cash" },
    ],
    [
      "una fuente que no es un miembro",
      {
        fact: "purchase_type",
        source_kind: "extractor",
        status: "detected",
        recorded_by: null,
        purchase_type: "cash",
      },
    ],
    [
      "un miembro sin autor",
      { fact: "purchase_type", recorded_by: null, purchase_type: "cash" },
    ],
    [
      "un estado desconocido",
      { fact: "purchase_type", status: "unknown", purchase_type: "cash" },
    ],
  ];

  it.each(invalid)("rechaza %s (23514)", async (_, values) => {
    await inRolledBackTransaction(db.admin, async (tx) => {
      await seedDemand(tx);
      expect(await attempt(tx, row(values))).toBe("23514");
    });
  });

  it("un acto no puede apuntarse a sí mismo (23514)", async () => {
    const id = "40000000-0000-4000-8000-000000000001";
    await inRolledBackTransaction(db.admin, async (tx) => {
      await seedDemand(tx);
      for (const link of ["target_fact_id", "previous_member_fact_id"]) {
        expect(
          await attempt(
            tx,
            row({
              id,
              fact: "purchase_type",
              status: "corrected",
              purchase_type: "cash",
              target_fact_id: id,
              [link]: id,
            }),
          ),
        ).toBe("23514");
      }
    });
  });

  it.each([
    "organization_id",
    "opportunity_id",
    "fact",
    "status",
    "source_kind",
    "recorded_at",
  ])("%s es obligatorio (23502)", async (column) => {
    await inRolledBackTransaction(db.admin, async (tx) => {
      await seedDemand(tx);
      expect(
        await attempt(
          tx,
          row({ fact: "purchase_type", purchase_type: "cash", [column]: null }),
        ),
      ).toBe("23502");
    });
  });

  it("DB3: la cadena humana es lineal (un root, un sucesor) y su predecesor es del mismo fact y oportunidad", async () => {
    await inRolledBackTransaction(db.admin, async (tx) => {
      await seedDemand(tx);
      const purchase = { fact: "purchase_type", purchase_type: "cash" };
      const [root] = await insert(tx, row(purchase));
      // Un segundo root del mismo fact: 23505.
      expect(
        await attempt(tx, row({ ...purchase, purchase_type: "financed" })),
      ).toBe("23505");
      // Otro fact u otra oportunidad tienen su propio root.
      expect(
        await attempt(tx, row({ fact: "trade_in_intent", trade_in: true })),
      ).toBe("ok");
      expect(
        await attempt(tx, row({ ...purchase, opportunity_id: OPP_1B })),
      ).toBe("ok");

      const next = {
        ...purchase,
        purchase_type: "financed",
        target_fact_id: root!.id,
        previous_member_fact_id: root!.id,
      };
      await insert(tx, row(next));
      // Un segundo sucesor del mismo acto: 23505.
      expect(
        await attempt(tx, row({ ...next, purchase_type: "undecided" })),
      ).toBe("23505");
      // Un predecesor de otro fact o de otra oportunidad: 23503.
      expect(
        await attempt(
          tx,
          row({
            fact: "trade_in_intent",
            trade_in: true,
            previous_member_fact_id: root!.id,
          }),
        ),
      ).toBe("23503");
      expect(await attempt(tx, row({ ...next, opportunity_id: OPP_1B }))).toBe(
        "23503",
      );
      // Las FKs entrantes son RESTRICT: un acto citado no se borra.
      await expect(
        tx.savepoint(
          (sp) =>
            sp`DELETE FROM public.opportunity_demand_facts WHERE id = ${root!.id}`,
        ),
      ).rejects.toMatchObject({ code: "23503" });
    });
  });

  it("DB3: el predecesor de un acto humano tiene que ser humano (FK con source_kind): 23503", async () => {
    await inRolledBackTransaction(db.admin, async (tx) => {
      await seedDemand(tx);
      // Solo para el test: sin los CHECKs de fuente, una detección.
      await tx.unsafe(`
        ALTER TABLE public.opportunity_demand_facts
          DROP CONSTRAINT opportunity_demand_facts_source_kind_check
      `);
      const [detected] = await insert(
        tx,
        row({
          fact: "purchase_type",
          status: "detected",
          source_kind: "extractor",
          recorded_by: null,
          purchase_type: "financed",
        }),
      );
      expect(
        await attempt(
          tx,
          row({
            fact: "purchase_type",
            purchase_type: "financed",
            target_fact_id: detected!.id,
            previous_member_fact_id: detected!.id,
          }),
        ),
      ).toBe("23503");
      // Apuntarla como target sí vale (confirmar una detección), sin
      // previous: es el root humano.
      expect(
        await attempt(
          tx,
          row({
            fact: "purchase_type",
            purchase_type: "financed",
            target_fact_id: detected!.id,
          }),
        ),
      ).toBe("ok");
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
      "conversations",
      "memberships",
      "messages",
      "opportunities",
      "opportunity_demand_facts",
      "opportunity_notes",
      "vehicles",
      "whatsapp_lines",
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
    // Los de authenticated (SELECT, e INSERT de H1.2) se prueban en
    // tenant-catalog.test.ts.
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
        ["test_drive", "web"],
        ["qualified", "web"],
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
        VALUES (${ORG_1}, ${CONTACT_1}, 'qualifying', 'referral')
        RETURNING stage, last_activity_at > now() - interval '1 minute' AS recent
      `;
      expect(row).toEqual({ stage: "qualifying", recent: true });
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

describe("identidad telefónica de contacts con datos (H1.2)", () => {
  const insertContact = (
    sp: TransactionSql,
    organizationId: string,
    phone: string | null,
    phoneNormalized: string | null,
  ) => sp`
    INSERT INTO public.contacts (organization_id, name, phone, phone_normalized)
    VALUES (${organizationId}, 'Contacto', ${phone}, ${phoneNormalized})
  `;

  it("el mismo teléfono normalizado no se repite en una organización", async () => {
    await inRolledBackTransaction(db.admin, async (tx) => {
      await seed(tx);
      await insertContact(tx, ORG_1, "0981 555 214", "+595981555214");
      await expectSqlError(tx, "23505", (sp) =>
        insertContact(sp, ORG_1, "+595 981 555 214", "+595981555214"),
      );
    });
  });

  it("el mismo teléfono sí puede ser contacto de otra organización", async () => {
    await inRolledBackTransaction(db.admin, async (tx) => {
      await seed(tx);
      await insertContact(tx, ORG_1, "0981 555 214", "+595981555214");
      await insertContact(tx, ORG_2, "0981 555 214", "+595981555214");
    });
  });

  it("sin teléfono normalizado no hay unicidad: contactos históricos o sin teléfono", async () => {
    await inRolledBackTransaction(db.admin, async (tx) => {
      await seed(tx);
      await insertContact(tx, ORG_1, "0981 555 214", null);
      await insertContact(tx, ORG_1, "0981 555 214", null);
      await insertContact(tx, ORG_1, null, null);
      await insertContact(tx, ORG_1, null, null);
    });
  });

  it("el CHECK exige forma E.164 y el teléfono original", async () => {
    await inRolledBackTransaction(db.admin, async (tx) => {
      await seed(tx);
      for (const normalized of [
        "0981555214",
        "595981555214",
        "+0981555214",
        "+595 981 555 214",
        "+5959815552141234",
        "+",
      ]) {
        await expectSqlError(tx, "23514", (sp) =>
          insertContact(sp, ORG_1, "0981 555 214", normalized),
        );
      }
      await expectSqlError(tx, "23514", (sp) =>
        insertContact(sp, ORG_1, null, "+595981555214"),
      );
      await insertContact(tx, ORG_1, "+1 202 555 0143", "+12025550143");
    });
  });
});

describe("constraints de vehicles con datos (H1.3A)", () => {
  type VehicleRow = {
    organization_id?: string;
    brand?: string;
    model?: string;
    version?: string | null;
    year?: number;
    km?: number | null;
    price?: string | null;
    currency?: string | null;
    status?: string;
  };
  const valid: VehicleRow = {
    organization_id: ORG_1,
    brand: "Toyota",
    model: "Hilux",
    year: 2025,
    km: 0,
    price: "49900.00",
    currency: "USD",
    status: "available",
  };
  const insertVehicle = (sp: TransactionSql, row: VehicleRow) =>
    sp`INSERT INTO public.vehicles ${sp(row as Record<string, unknown>)}`;
  const without = (key: keyof VehicleRow): VehicleRow => {
    const row = { ...valid };
    delete row[key];
    return row;
  };

  it("organización, marca, modelo, año y estado son obligatorios", async () => {
    await inRolledBackTransaction(db.admin, async (tx) => {
      await seed(tx);
      for (const key of [
        "organization_id",
        "brand",
        "model",
        "year",
        "status",
      ] as const) {
        await expectSqlError(tx, "23502", (sp) =>
          insertVehicle(sp, without(key)),
        );
      }
    });
  });

  it("estado y moneda solo aceptan los valores del CHECK", async () => {
    await inRolledBackTransaction(db.admin, async (tx) => {
      await seed(tx);
      for (const status of ["inPreparation", "en_preparacion", "retired"]) {
        await expectSqlError(tx, "23514", (sp) =>
          insertVehicle(sp, { ...valid, status }),
        );
      }
      for (const currency of ["BRL", "usd", "Gs."]) {
        await expectSqlError(tx, "23514", (sp) =>
          insertVehicle(sp, { ...valid, currency }),
        );
      }
      for (const status of [
        "in_preparation",
        "available",
        "reserved",
        "sold",
      ]) {
        await insertVehicle(tx, { ...valid, status });
      }
    });
  });

  it("precio y moneda van juntos; sin precio es sin dato", async () => {
    await inRolledBackTransaction(db.admin, async (tx) => {
      await seed(tx);
      await expectSqlError(tx, "23514", (sp) =>
        insertVehicle(sp, { ...valid, currency: null }),
      );
      await expectSqlError(tx, "23514", (sp) =>
        insertVehicle(sp, { ...valid, price: null }),
      );
      await insertVehicle(tx, {
        ...valid,
        price: null,
        currency: null,
        status: "in_preparation",
      });
    });
  });

  it("el precio es exacto, positivo y en guaraníes sin decimales", async () => {
    await inRolledBackTransaction(db.admin, async (tx) => {
      await seed(tx);
      for (const price of ["0", "-1.00"]) {
        await expectSqlError(tx, "23514", (sp) =>
          insertVehicle(sp, { ...valid, price }),
        );
      }
      await expectSqlError(tx, "23514", (sp) =>
        insertVehicle(sp, { ...valid, price: "150000000.50", currency: "PYG" }),
      );
      // Más de 12 dígitos enteros no entra en numeric(14,2).
      await expectSqlError(tx, "22003", (sp) =>
        insertVehicle(sp, { ...valid, price: "1000000000000.00" }),
      );
      const rows = await tx<{ price: string }[]>`
        INSERT INTO public.vehicles ${tx([
          { ...valid, price: "32990.50" },
          { ...valid, price: "150000000", currency: "PYG" },
          { ...valid, price: "999999999999.99" },
        ] as Record<string, unknown>[])}
        RETURNING price
      `;
      // postgres-js devuelve numeric como texto: el valor exacto, sin float.
      expect(rows.map((r) => r.price)).toEqual([
        "32990.50",
        "150000000.00",
        "999999999999.99",
      ]);
    });
  });

  it("año entre 1900 y 2100; km nunca negativo (NULL es sin dato, 0 es 0 km)", async () => {
    await inRolledBackTransaction(db.admin, async (tx) => {
      await seed(tx);
      for (const year of [1899, 2101, 0]) {
        await expectSqlError(tx, "23514", (sp) =>
          insertVehicle(sp, { ...valid, year }),
        );
      }
      await expectSqlError(tx, "23514", (sp) =>
        insertVehicle(sp, { ...valid, km: -1 }),
      );
      await insertVehicle(tx, { ...valid, km: null });
      await insertVehicle(tx, { ...valid, km: 0, year: 1900 });
    });
  });

  it("no se borra una organización con vehículos", async () => {
    await inRolledBackTransaction(db.admin, async (tx) => {
      await seed(tx);
      await insertVehicle(tx, { ...valid, organization_id: ORG_2 });
      await tx`DELETE FROM public.contacts WHERE organization_id = ${ORG_2}`;
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
    "vehicles",
    "opportunity_demand_facts",
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
      await tx`
        INSERT INTO public.vehicles (organization_id, brand, model, year, status)
        VALUES (${ORG_1}, 'Toyota', 'Hilux', 2025, 'available')
      `;
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

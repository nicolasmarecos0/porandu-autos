import type { TransactionSql } from "postgres";

import { compareHistory, type RepoMigration } from "./migrations.mts";
import { finding, type Finding } from "./report.mts";

/*
 * Verificación post-migración de staging (solo lectura): lo que dejaron
 * 0000_saas_core_schema, 0001_tenant_isolation,
 * 0002_opportunities_persistence, 0003_contact_identity_opportunity_create,
 * 0004_vehicles_stock_persistence, 0005_vehicle_quick_create,
 * 0006_vehicle_availability, 0007_opportunity_demand_facts,
 * 0008_opportunity_stages, 0009_opportunity_notes_vehicle_link,
 * 0010_opportunity_closure_metadata y 0011_conversations_and_activity_trigger,
 * leído del catálogo real (DEC-018, DEC-019, ADR-001 §2, §3.6 y §4, DEC-030,
 * DEC-032, DEC-033, DEC-034, DEC-036). Espeja tests/db/tenant-catalog y
 * tests/db/schema: si una migración nueva cambia lo esperado, se actualiza
 * junto con esos tests.
 */

const APP_TABLES = [
  "contacts",
  "memberships",
  "messages",
  "opportunities",
  "opportunity_demand_facts",
  "opportunity_notes",
  "organizations",
  "profiles",
  "vehicles",
];
const PRIVILEGES = [
  "SELECT",
  "INSERT",
  "UPDATE",
  "DELETE",
  "TRUNCATE",
  "REFERENCES",
  "TRIGGER",
  "MAINTAIN",
];

type Policy = {
  table: string;
  name: string;
  permissive: string;
  roles: string[];
  command: string;
  using: string | null;
  withCheck: string | null;
};

/**
 * Policies de lectura de H0 (DEC-019), de H1.1 (contacts, opportunities) y de
 * H1.3A (vehicles), y de alta de H1.2 (contacts, opportunities) y de H1.3B
 * (vehicles), con WITH CHECK: la de opportunities exige además la etapa
 * `new`, y la de vehicles, el estado `in_preparation`. La de disponibilidad
 * de H1.3C (vehicles) exige la fila actual en `in_preparation` (USING) y la
 * nueva en `available` (WITH CHECK). La demanda de H1.4
 * (opportunity_demand_facts) tiene lectura y un alta append-only: miembro
 * activo, fuente `member`, estado humano, autor de la request y reloj de la
 * base. El cambio de etapa de H1.6 y de unidad vinculada del Hito 2
 * (opportunities) exige solo la organización, antes y después: qué UPDATE es
 * válida lo decide el trigger (EXPECTED_OPPORTUNITY_STAGES). La bitácora del
 * Hito 2 (opportunity_notes) y los mensajes del Hito 4 (messages) tienen
 * lectura y un alta append-only: miembro activo, autor de la request y
 * reloj de la base. Tal como las deparsea PostgreSQL 17.
 */
export const EXPECTED_POLICIES: Policy[] = [
  {
    table: "contacts",
    name: "contacts_insert_member",
    permissive: "PERMISSIVE",
    roles: ["authenticated"],
    command: "INSERT",
    using: null,
    withCheck:
      "(organization_id IN ( SELECT private.user_org_ids() AS user_org_ids))",
  },
  {
    table: "contacts",
    name: "contacts_select_member",
    permissive: "PERMISSIVE",
    roles: ["authenticated"],
    command: "SELECT",
    using:
      "(organization_id IN ( SELECT private.user_org_ids() AS user_org_ids))",
    withCheck: null,
  },
  {
    table: "memberships",
    name: "memberships_select_member",
    permissive: "PERMISSIVE",
    roles: ["authenticated"],
    command: "SELECT",
    using:
      "(organization_id IN ( SELECT private.user_org_ids() AS user_org_ids))",
    withCheck: null,
  },
  {
    table: "messages",
    name: "messages_insert_member",
    permissive: "PERMISSIVE",
    roles: ["authenticated"],
    command: "INSERT",
    using: null,
    withCheck:
      "((organization_id IN ( SELECT private.user_org_ids() AS user_org_ids)) AND (recorded_by = ( SELECT auth.uid() AS uid)) AND (created_at = now()))",
  },
  {
    table: "messages",
    name: "messages_select_member",
    permissive: "PERMISSIVE",
    roles: ["authenticated"],
    command: "SELECT",
    using:
      "(organization_id IN ( SELECT private.user_org_ids() AS user_org_ids))",
    withCheck: null,
  },
  {
    table: "opportunities",
    name: "opportunities_insert_member",
    permissive: "PERMISSIVE",
    roles: ["authenticated"],
    command: "INSERT",
    using: null,
    withCheck:
      "((organization_id IN ( SELECT private.user_org_ids() AS user_org_ids)) AND (stage = 'new'::text))",
  },
  {
    table: "opportunities",
    name: "opportunities_select_member",
    permissive: "PERMISSIVE",
    roles: ["authenticated"],
    command: "SELECT",
    using:
      "(organization_id IN ( SELECT private.user_org_ids() AS user_org_ids))",
    withCheck: null,
  },
  {
    table: "opportunities",
    name: "opportunities_update_stage",
    permissive: "PERMISSIVE",
    roles: ["authenticated"],
    command: "UPDATE",
    using:
      "(organization_id IN ( SELECT private.user_org_ids() AS user_org_ids))",
    withCheck:
      "(organization_id IN ( SELECT private.user_org_ids() AS user_org_ids))",
  },
  {
    table: "opportunity_demand_facts",
    name: "opportunity_demand_facts_insert_member",
    permissive: "PERMISSIVE",
    roles: ["authenticated"],
    command: "INSERT",
    using: null,
    withCheck:
      "((organization_id IN ( SELECT private.user_org_ids() AS user_org_ids)) AND (source_kind = 'member'::text) AND (status = ANY (ARRAY['confirmed'::text, 'corrected'::text, 'rejected'::text])) AND (recorded_by = ( SELECT auth.uid() AS uid)) AND (recorded_at = now()))",
  },
  {
    table: "opportunity_demand_facts",
    name: "opportunity_demand_facts_select_member",
    permissive: "PERMISSIVE",
    roles: ["authenticated"],
    command: "SELECT",
    using:
      "(organization_id IN ( SELECT private.user_org_ids() AS user_org_ids))",
    withCheck: null,
  },
  {
    table: "opportunity_notes",
    name: "opportunity_notes_insert_member",
    permissive: "PERMISSIVE",
    roles: ["authenticated"],
    command: "INSERT",
    using: null,
    withCheck:
      "((organization_id IN ( SELECT private.user_org_ids() AS user_org_ids)) AND (recorded_by = ( SELECT auth.uid() AS uid)) AND (recorded_at = now()))",
  },
  {
    table: "opportunity_notes",
    name: "opportunity_notes_select_member",
    permissive: "PERMISSIVE",
    roles: ["authenticated"],
    command: "SELECT",
    using:
      "(organization_id IN ( SELECT private.user_org_ids() AS user_org_ids))",
    withCheck: null,
  },
  {
    table: "organizations",
    name: "organizations_select_member",
    permissive: "PERMISSIVE",
    roles: ["authenticated"],
    command: "SELECT",
    using: "(id IN ( SELECT private.user_org_ids() AS user_org_ids))",
    withCheck: null,
  },
  {
    table: "profiles",
    name: "profiles_select_own",
    permissive: "PERMISSIVE",
    roles: ["authenticated"],
    command: "SELECT",
    using: "(id = ( SELECT auth.uid() AS uid))",
    withCheck: null,
  },
  {
    table: "vehicles",
    name: "vehicles_insert_member",
    permissive: "PERMISSIVE",
    roles: ["authenticated"],
    command: "INSERT",
    using: null,
    withCheck:
      "((organization_id IN ( SELECT private.user_org_ids() AS user_org_ids)) AND (status = 'in_preparation'::text))",
  },
  {
    table: "vehicles",
    name: "vehicles_select_member",
    permissive: "PERMISSIVE",
    roles: ["authenticated"],
    command: "SELECT",
    using:
      "(organization_id IN ( SELECT private.user_org_ids() AS user_org_ids))",
    withCheck: null,
  },
  {
    table: "vehicles",
    name: "vehicles_update_mark_available",
    permissive: "PERMISSIVE",
    roles: ["authenticated"],
    command: "UPDATE",
    using:
      "((organization_id IN ( SELECT private.user_org_ids() AS user_org_ids)) AND (status = 'in_preparation'::text))",
    withCheck:
      "((organization_id IN ( SELECT private.user_org_ids() AS user_org_ids)) AND (status = 'available'::text))",
  },
];

/** `contacts.phone_normalized` tal como lo deja 0003 (PostgreSQL 17). */
export const EXPECTED_PHONE_IDENTITY = {
  column: "text",
  index:
    "CREATE UNIQUE INDEX contacts_organization_id_phone_normalized_key ON public.contacts USING btree (organization_id, phone_normalized) WHERE (phone_normalized IS NOT NULL)",
  check:
    "CHECK (((phone_normalized IS NULL) OR ((phone IS NOT NULL) AND (phone_normalized ~ '^\\+[1-9][0-9]{1,14}$'::text))))",
};

/**
 * Cadena humana lineal y FKs propias de la demanda (H1.4, 0007), tal como
 * las deja PostgreSQL 17: un solo root y un solo sucesor por acto, `target`
 * y `previous` dentro de la misma oportunidad y del mismo fact, el
 * predecesor humano (la FK incluye `source_kind`) y la oportunidad de la
 * misma organización.
 */
export const EXPECTED_DEMAND_CHAIN = {
  indexes: [
    "CREATE UNIQUE INDEX opportunity_demand_facts_member_next_key ON public.opportunity_demand_facts USING btree (organization_id, opportunity_id, fact, previous_member_fact_id) WHERE ((source_kind = 'member'::text) AND (previous_member_fact_id IS NOT NULL))",
    "CREATE UNIQUE INDEX opportunity_demand_facts_member_root_key ON public.opportunity_demand_facts USING btree (organization_id, opportunity_id, fact) WHERE ((source_kind = 'member'::text) AND (previous_member_fact_id IS NULL))",
  ],
  foreignKeys: [
    "opportunity_demand_facts_opportunity_fk FOREIGN KEY (organization_id, opportunity_id) REFERENCES opportunities(organization_id, id) ON DELETE RESTRICT",
    "opportunity_demand_facts_organization_id_organizations_id_fk FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT",
    "opportunity_demand_facts_previous_fk FOREIGN KEY (organization_id, opportunity_id, fact, source_kind, previous_member_fact_id) REFERENCES opportunity_demand_facts(organization_id, opportunity_id, fact, source_kind, id) ON DELETE RESTRICT",
    "opportunity_demand_facts_recorded_by_profiles_id_fk FOREIGN KEY (recorded_by) REFERENCES profiles(id) ON DELETE RESTRICT",
    "opportunity_demand_facts_target_fk FOREIGN KEY (organization_id, opportunity_id, fact, target_fact_id) REFERENCES opportunity_demand_facts(organization_id, opportunity_id, fact, id) ON DELETE RESTRICT",
  ],
};

/**
 * Etapas de la oportunidad (H1.6, 0008), su unidad vinculada (Hito 2,
 * 0009) y su cierre (DEC-034, 0010), tal como los deja PostgreSQL 17: las
 * cinco etapas, el motivo de pérdida estructurado (si y solo si `lost`) con
 * sus notas, la venta completa con su unidad (si y solo si `won`), la unidad
 * de la misma organización (FK compuesta) que solo existe desde la
 * negociación (CHECK) y el trigger BEFORE UPDATE que valida el par etapa
 * anterior → etapa nueva, el cambio de unidad, la inmutabilidad del cierre y
 * el toque de actividad, habilitado, con una función invoker, de search_path
 * vacío, sin EXECUTE para nadie (DEC-028 §6, DEC-032 §4, DEC-033 §3, DEC-034
 * §5, DEC-036 §3).
 */
export const EXPECTED_OPPORTUNITY_STAGES = {
  checks: [
    "opportunities_delivery_date_check CHECK (((delivery_date >= '2000-01-01'::date) AND (delivery_date <= '2100-12-31'::date)))",
    "opportunities_delivery_status_check CHECK ((delivery_status = ANY (ARRAY['scheduled'::text, 'delivered'::text])))",
    "opportunities_loss_notes_check CHECK ((((char_length(loss_notes) >= 1) AND (char_length(loss_notes) <= 500)) AND (loss_notes = btrim(loss_notes, (' '::text || chr(10)))) AND (translate(loss_notes, chr(10), ''::text) !~ '[[:cntrl:]]'::text)))",
    "opportunities_loss_notes_stage_check CHECK (((loss_notes IS NULL) OR (stage = 'lost'::text)))",
    "opportunities_loss_reason_check CHECK ((loss_reason = ANY (ARRAY['price'::text, 'vehicle_unavailable'::text, 'competitor'::text, 'financing_rejected'::text, 'ghosted'::text, 'other'::text])))",
    "opportunities_loss_reason_stage_check CHECK ((((stage = 'lost'::text) AND (loss_reason IS NOT NULL)) OR ((stage <> 'lost'::text) AND (loss_reason IS NULL))))",
    "opportunities_payment_method_check CHECK ((payment_method = ANY (ARRAY['cash'::text, 'financing'::text, 'trade_in'::text, 'mixed'::text])))",
    "opportunities_sale_currency_check CHECK ((sale_currency = ANY (ARRAY['PYG'::text, 'USD'::text])))",
    "opportunities_sale_price_check CHECK ((((sale_price IS NULL) = (sale_currency IS NULL)) AND ((sale_price IS NULL) OR ((sale_price > (0)::numeric) AND ((sale_currency <> 'PYG'::text) OR (sale_price = trunc(sale_price)))))))",
    "opportunities_stage_check CHECK ((stage = ANY (ARRAY['new'::text, 'qualifying'::text, 'negotiating'::text, 'won'::text, 'lost'::text])))",
    "opportunities_vehicle_fk FOREIGN KEY (organization_id, vehicle_id) REFERENCES vehicles(organization_id, id) ON DELETE RESTRICT",
    "opportunities_vehicle_stage_check CHECK (((vehicle_id IS NULL) OR (stage = ANY (ARRAY['negotiating'::text, 'won'::text, 'lost'::text]))))",
    "opportunities_won_closure_check CHECK ((((stage = 'won'::text) AND (vehicle_id IS NOT NULL) AND (sale_price IS NOT NULL) AND (sale_currency IS NOT NULL) AND (payment_method IS NOT NULL) AND (delivery_status IS NOT NULL) AND (delivery_date IS NOT NULL)) OR ((stage <> 'won'::text) AND (sale_price IS NULL) AND (sale_currency IS NULL) AND (payment_method IS NULL) AND (delivery_status IS NULL) AND (delivery_date IS NULL))))",
  ],
  triggers: [
    "O CREATE TRIGGER opportunities_stage_transition BEFORE UPDATE ON public.opportunities FOR EACH ROW EXECUTE FUNCTION private.enforce_opportunity_stage_transition()",
  ],
  function: {
    securityDefiner: false,
    config: ['search_path=""'],
    owner: "postgres",
    executable: false,
    // La versión de 0009: también valida el cambio de unidad vinculada.
    vehicleLink: true,
    // La versión de 0010: además mantiene inmutable el cierre (DEC-034).
    closureImmutable: true,
    // La versión de 0011: además valida el toque de actividad (DEC-036).
    activityTouch: true,
  },
};

/**
 * Bitácora comercial (Hito 2, 0009), tal como la deja PostgreSQL 17: FKs
 * RESTRICT a la organización, a la oportunidad de la misma organización y al
 * autor, el CHECK del texto y la unique de vehicles que es destino de la FK
 * compuesta de la unidad vinculada.
 */
export const EXPECTED_OPPORTUNITY_NOTES = {
  constraints: [
    "opportunity_notes_body_check CHECK ((((char_length(body) >= 1) AND (char_length(body) <= 1000)) AND (body = btrim(body, (' '::text || chr(10)))) AND (translate(body, chr(10), ''::text) !~ '[[:cntrl:]]'::text)))",
    "opportunity_notes_opportunity_fk FOREIGN KEY (organization_id, opportunity_id) REFERENCES opportunities(organization_id, id) ON DELETE RESTRICT",
    "opportunity_notes_organization_id_organizations_id_fk FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT",
    "opportunity_notes_recorded_by_profiles_id_fk FOREIGN KEY (recorded_by) REFERENCES profiles(id) ON DELETE RESTRICT",
  ],
  vehiclesKey: "UNIQUE (organization_id, id)",
};

/**
 * Mensajes (Hito 4, 0011), tal como los deja PostgreSQL 17: FKs RESTRICT a
 * la organización, al contacto y a la oportunidad de la misma organización
 * y del mismo contacto, y al autor; los CHECKs de canal, dirección y texto;
 * y la unique de opportunities que es destino de la FK compuesta.
 */
export const EXPECTED_MESSAGES = {
  constraints: [
    "messages_channel_check CHECK ((channel = ANY (ARRAY['whatsapp'::text, 'email'::text, 'manual'::text])))",
    "messages_contact_fk FOREIGN KEY (organization_id, contact_id) REFERENCES contacts(organization_id, id) ON DELETE RESTRICT",
    "messages_content_check CHECK ((((char_length(content) >= 1) AND (char_length(content) <= 4096)) AND (content = btrim(content, (' '::text || chr(10)))) AND (translate(content, chr(10), ''::text) !~ '[[:cntrl:]]'::text)))",
    "messages_direction_check CHECK ((direction = ANY (ARRAY['inbound'::text, 'outbound'::text])))",
    "messages_opportunity_fk FOREIGN KEY (organization_id, opportunity_id, contact_id) REFERENCES opportunities(organization_id, id, contact_id) ON DELETE RESTRICT",
    "messages_organization_id_organizations_id_fk FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT",
    "messages_recorded_by_profiles_id_fk FOREIGN KEY (recorded_by) REFERENCES profiles(id) ON DELETE RESTRICT",
  ],
  opportunitiesContactKey: "UNIQUE (organization_id, id, contact_id)",
};

/**
 * Toque de actividad (Hito 4, 0011, DEC-036 §1 y §2): una nota o un mensaje
 * nuevos mueven `last_activity_at` con un trigger AFTER INSERT de fila,
 * habilitado, cuya función es SECURITY DEFINER de postgres, con search_path
 * vacío y sin EXECUTE para nadie.
 */
export const EXPECTED_ACTIVITY_TOUCH = {
  triggers: [
    "O CREATE TRIGGER messages_touch_activity AFTER INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION private.touch_opportunity_activity()",
    "O CREATE TRIGGER opportunity_notes_touch_activity AFTER INSERT ON public.opportunity_notes FOR EACH ROW EXECUTE FUNCTION private.touch_opportunity_activity()",
  ],
  function: {
    securityDefiner: true,
    config: ['search_path=""'],
    owner: "postgres",
    executable: false,
  },
};

/**
 * Privilegios de authenticated: lectura en todo, las altas de H1.2
 * (contacts, opportunities), H1.3B (vehicles), H1.4
 * (opportunity_demand_facts), el Hito 2 (opportunity_notes) y el Hito 4
 * (messages), estas tres de tabla (diseño A), y los UPDATE de H1.3C
 * (vehicles), H1.6 y el Hito 2
 * (opportunities), que son por columna (AUTHENTICATED_UPDATE_COLUMNS).
 * Ningún DELETE.
 */
const AUTHENTICATED_PRIVILEGES = [
  "INSERT contacts",
  "INSERT messages",
  "INSERT opportunities",
  "INSERT opportunity_demand_facts",
  "INSERT opportunity_notes",
  "INSERT vehicles",
  ...APP_TABLES.map((table) => `SELECT ${table}`),
  "UPDATE opportunities",
  "UPDATE vehicles",
];

/**
 * Lo único que authenticated puede actualizar (H1.3C, H1.6, el Hito 2 y el
 * cierre de DEC-034): nunca la tabla.
 */
const AUTHENTICATED_UPDATE_COLUMNS = [
  "opportunities.delivery_date",
  "opportunities.delivery_status",
  "opportunities.loss_notes",
  "opportunities.loss_reason",
  "opportunities.payment_method",
  "opportunities.sale_currency",
  "opportunities.sale_price",
  "opportunities.stage",
  "opportunities.updated_at",
  "opportunities.vehicle_id",
  "vehicles.status",
  "vehicles.updated_at",
];

function list(values: readonly string[]): string {
  return values.length === 0 ? "none" : values.join(", ");
}

function equal(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function tablePrivileges(
  tx: TransactionSql,
  role: string,
): Promise<string[]> {
  const rows = await tx<{ grant: string }[]>`
    SELECT p.privilege || ' ' || c.relname AS grant
    FROM pg_class c
    CROSS JOIN unnest(${PRIVILEGES}::text[]) AS p(privilege)
    WHERE c.relnamespace = 'public'::regnamespace
      AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
      AND (
        has_table_privilege(${role}, c.oid, p.privilege)
        OR (
          p.privilege IN ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
          AND has_any_column_privilege(${role}, c.oid, p.privilege)
        )
      )
    ORDER BY 1
  `;
  return rows.map((r) => r.grant);
}

export async function verifyCatalog(
  tx: TransactionSql,
  repo: readonly RepoMigration[],
): Promise<Finding[]> {
  const findings: Finding[] = [];

  // Historial: exactamente las migraciones oficiales del repositorio.
  const history = await tx<{ id: number; hash: string; createdAt: string }[]>`
    SELECT id, hash, created_at::text AS "createdAt"
    FROM drizzle.__drizzle_migrations ORDER BY created_at, id
  `;
  const status = compareHistory(
    repo,
    history.map((r) => ({
      id: r.id,
      hash: r.hash,
      createdAt: Number(r.createdAt),
    })),
  );
  findings.push(
    finding(
      "migrations.history",
      status.kind === "consistent" && status.pending.length === 0,
      status.kind === "consistent"
        ? `applied: ${list(status.applied.map((m) => m.tag))}; pending: ${list(status.pending.map((m) => m.tag))}`
        : status.reason,
    ),
  );

  // Tablas, RLS y enum (DEC-018).
  const tables = await tx<{ name: string; rls: boolean }[]>`
    SELECT relname AS name, relrowsecurity AS rls FROM pg_class
    WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r', 'p')
    ORDER BY 1
  `;
  findings.push(
    finding(
      "schema.tables",
      equal(
        tables.map((t) => t.name),
        APP_TABLES,
      ),
      `public tables: ${list(tables.map((t) => t.name))}`,
    ),
    finding(
      "schema.rls",
      tables.every((t) => t.rls),
      `without RLS: ${list(tables.filter((t) => !t.rls).map((t) => t.name))}`,
    ),
  );
  const [roleEnum] = await tx<{ labels: string[] | null }[]>`
    SELECT (
      SELECT array_agg(e.enumlabel::text ORDER BY e.enumsortorder)
      FROM pg_enum e WHERE e.enumtypid = to_regtype('public.membership_role')
    ) AS labels
  `;
  findings.push(
    finding(
      "schema.membership_role",
      equal(roleEnum?.labels, ["admin", "seller"]),
      `membership_role = ${list(roleEnum?.labels ?? [])}`,
    ),
  );

  // Tablas tenant-scoped: organization_id NOT NULL, FK e índice líder.
  const tenancy = await tx<
    { table: string; notNull: boolean; fk: boolean; index: boolean }[]
  >`
    SELECT c.relname AS table, a.attnotnull AS "notNull",
      EXISTS (
        SELECT FROM pg_constraint k
        WHERE k.conrelid = c.oid AND k.contype = 'f'
          AND k.conkey = ARRAY[a.attnum]
          AND k.confrelid = 'public.organizations'::regclass
      ) AS fk,
      EXISTS (
        SELECT FROM pg_index i WHERE i.indrelid = c.oid AND i.indkey[0] = a.attnum
      ) AS index
    FROM pg_class c
    JOIN pg_attribute a ON a.attrelid = c.oid
      AND a.attname = 'organization_id' AND NOT a.attisdropped
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
    ORDER BY 1
  `;
  const badTenancy = tenancy.filter((t) => !(t.notNull && t.fk && t.index));
  findings.push(
    finding(
      "schema.tenant-scoped",
      tenancy.length > 0 && badTenancy.length === 0,
      `tenant-scoped: ${list(tenancy.map((t) => t.table))}; invalid: ${list(badTenancy.map((t) => t.table))}`,
    ),
  );

  // Identidad del contacto por teléfono (H1.2): E.164 opcional, único por
  // organización (índice parcial) y con la forma canónica exigida por CHECK.
  const [phoneIdentity] = await tx<
    { column: string | null; index: string | null; check: string | null }[]
  >`
    SELECT
      (
        SELECT format_type(a.atttypid, a.atttypmod)
          || CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE '' END
        FROM pg_attribute a
        WHERE a.attrelid = to_regclass('public.contacts')
          AND a.attname = 'phone_normalized' AND NOT a.attisdropped
      ) AS column,
      (
        SELECT indexdef FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname = 'contacts_organization_id_phone_normalized_key'
      ) AS index,
      (
        SELECT pg_get_constraintdef(oid) FROM pg_constraint
        WHERE conrelid = to_regclass('public.contacts')
          AND conname = 'contacts_phone_normalized_check'
      ) AS check
  `;
  findings.push(
    finding(
      "schema.contact-phone-identity",
      equal(phoneIdentity, EXPECTED_PHONE_IDENTITY),
      `phone_normalized: ${phoneIdentity?.column ?? "missing"}; unique index: ${phoneIdentity?.index ? "present" : "missing"}; check: ${phoneIdentity?.check ? "present" : "missing"}`,
    ),
  );

  // Policies (DEC-019, H1.1, H1.2, H1.3A, H1.3B, H1.3C, H1.4, H1.6):
  // lectura, alta, disponibilidad y cambio de etapa, con la forma de
  // referencia; ningún DELETE.
  const policies = await tx<Policy[]>`
    SELECT tablename AS table, policyname AS name, permissive,
      roles::text[] AS roles, cmd AS command, qual AS using,
      with_check AS "withCheck"
    FROM pg_policies WHERE schemaname = 'public'
    ORDER BY tablename, policyname
  `;
  findings.push(
    finding(
      "rls.policies",
      equal(policies, EXPECTED_POLICIES),
      `policies: ${list(policies.map((p) => `${p.table}.${p.name} ${p.command} TO ${p.roles.join("/")}`))}`,
    ),
  );

  // Demanda (H1.4): la cadena humana lineal y las FKs propias del ledger.
  const [demandChain] = await tx<
    { indexes: string[] | null; foreignKeys: string[] | null }[]
  >`
    SELECT
      (
        SELECT array_agg(indexdef ORDER BY indexname) FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname IN (
            'opportunity_demand_facts_member_root_key',
            'opportunity_demand_facts_member_next_key'
          )
      ) AS indexes,
      (
        SELECT array_agg(conname || ' ' || pg_get_constraintdef(oid) ORDER BY conname)
        FROM pg_constraint
        WHERE conrelid = to_regclass('public.opportunity_demand_facts')
          AND contype = 'f'
      ) AS "foreignKeys"
  `;
  const chain = {
    indexes: demandChain?.indexes ?? [],
    foreignKeys: demandChain?.foreignKeys ?? [],
  };
  findings.push(
    finding(
      "schema.demand-facts-chain",
      equal(chain, EXPECTED_DEMAND_CHAIN),
      `opportunity_demand_facts: ${chain.indexes.length} chain indexes, ${chain.foreignKeys.length} foreign keys (expected: ${EXPECTED_DEMAND_CHAIN.indexes.length} and ${EXPECTED_DEMAND_CHAIN.foreignKeys.length}, exact definitions)`,
    ),
  );

  // Etapas de la oportunidad (H1.6) y unidad vinculada (Hito 2): CHECKs,
  // FK compuesta, trigger y su función.
  const [stages] = await tx<
    {
      checks: string[] | null;
      triggers: string[] | null;
      securityDefiner: boolean | null;
      config: string[] | null;
      owner: string | null;
      executable: boolean | null;
      vehicleLink: boolean | null;
      closureImmutable: boolean | null;
      activityTouch: boolean | null;
    }[]
  >`
    SELECT
      (
        SELECT array_agg(conname || ' ' || pg_get_constraintdef(oid) ORDER BY conname)
        FROM pg_constraint
        WHERE conrelid = to_regclass('public.opportunities')
          AND contype IN ('c', 'f')
          AND conname IN (
            'opportunities_stage_check',
            'opportunities_loss_reason_check',
            'opportunities_loss_reason_stage_check',
            'opportunities_vehicle_fk',
            'opportunities_vehicle_stage_check',
            'opportunities_loss_notes_check',
            'opportunities_loss_notes_stage_check',
            'opportunities_sale_price_check',
            'opportunities_sale_currency_check',
            'opportunities_payment_method_check',
            'opportunities_delivery_status_check',
            'opportunities_delivery_date_check',
            'opportunities_won_closure_check'
          )
      ) AS checks,
      (
        SELECT array_agg(t.tgenabled::text || ' ' || pg_get_triggerdef(t.oid) ORDER BY t.tgname)
        FROM pg_trigger t
        WHERE t.tgrelid = to_regclass('public.opportunities') AND NOT t.tgisinternal
      ) AS triggers,
      p.prosecdef AS "securityDefiner", p.proconfig AS config,
      p.proowner::regrole::text AS owner,
      (
        has_function_privilege('authenticated', p.oid, 'EXECUTE')
        OR has_function_privilege('anon', p.oid, 'EXECUTE')
        OR has_function_privilege('app_runtime', p.oid, 'EXECUTE')
        OR EXISTS (
          SELECT FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
          WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
        )
      ) AS executable,
      position('opportunities_vehicle_link' in p.prosrc) > 0 AS "vehicleLink",
      position('opportunities_closure_immutable' in p.prosrc) > 0 AS "closureImmutable",
      position('opportunities_activity_touch' in p.prosrc) > 0 AS "activityTouch"
    FROM (SELECT 1) AS one
    LEFT JOIN pg_proc p
      ON p.oid = to_regprocedure('private.enforce_opportunity_stage_transition()')
  `;
  const stagesFound = {
    checks: stages?.checks ?? [],
    triggers: stages?.triggers ?? [],
    function: {
      securityDefiner: stages?.securityDefiner ?? null,
      config: stages?.config ?? null,
      owner: stages?.owner ?? null,
      executable: stages?.executable ?? null,
      vehicleLink: stages?.vehicleLink ?? null,
      closureImmutable: stages?.closureImmutable ?? null,
      activityTouch: stages?.activityTouch ?? null,
    },
  };
  findings.push(
    finding(
      "schema.opportunity-stages",
      equal(stagesFound, EXPECTED_OPPORTUNITY_STAGES),
      `opportunities: ${stagesFound.checks.length} stage, linked-vehicle and closure constraints (expected: ${EXPECTED_OPPORTUNITY_STAGES.checks.length}, exact definitions), triggers: ${list(stagesFound.triggers)}; transition function: ${stagesFound.function.owner === null ? "missing" : `SECURITY DEFINER=${stagesFound.function.securityDefiner}, config=${list(stagesFound.function.config ?? [])}, owner=${stagesFound.function.owner}, EXECUTE granted=${stagesFound.function.executable}, linked-vehicle rule=${stagesFound.function.vehicleLink}, immutable closure rule=${stagesFound.function.closureImmutable}, activity touch rule=${stagesFound.function.activityTouch}`}`,
    ),
  );

  // Bitácora comercial (Hito 2): FKs, CHECK del texto y el destino de la FK
  // compuesta de la unidad vinculada.
  const [notes] = await tx<
    { constraints: string[] | null; vehiclesKey: string | null }[]
  >`
    SELECT
      (
        SELECT array_agg(conname || ' ' || pg_get_constraintdef(oid) ORDER BY conname)
        FROM pg_constraint
        WHERE conrelid = to_regclass('public.opportunity_notes')
          AND contype IN ('c', 'f')
      ) AS constraints,
      (
        SELECT pg_get_constraintdef(oid) FROM pg_constraint
        WHERE conrelid = to_regclass('public.vehicles')
          AND conname = 'vehicles_organization_id_id_key'
      ) AS "vehiclesKey"
  `;
  const notesFound = {
    constraints: notes?.constraints ?? [],
    vehiclesKey: notes?.vehiclesKey ?? null,
  };
  findings.push(
    finding(
      "schema.opportunity-notes",
      equal(notesFound, EXPECTED_OPPORTUNITY_NOTES),
      `opportunity_notes: ${notesFound.constraints.length} constraints (expected: ${EXPECTED_OPPORTUNITY_NOTES.constraints.length}, exact definitions); vehicles (organization_id, id) key: ${notesFound.vehiclesKey ?? "missing"}`,
    ),
  );

  // Mensajes (Hito 4): FKs compuestas, CHECKs y el destino de la FK de la
  // oportunidad con su contacto.
  const [messages] = await tx<
    { constraints: string[] | null; opportunitiesContactKey: string | null }[]
  >`
    SELECT
      (
        SELECT array_agg(conname || ' ' || pg_get_constraintdef(oid) ORDER BY conname)
        FROM pg_constraint
        WHERE conrelid = to_regclass('public.messages')
          AND contype IN ('c', 'f')
      ) AS constraints,
      (
        SELECT pg_get_constraintdef(oid) FROM pg_constraint
        WHERE conrelid = to_regclass('public.opportunities')
          AND conname = 'opportunities_organization_id_id_contact_id_key'
      ) AS "opportunitiesContactKey"
  `;
  const messagesFound = {
    constraints: messages?.constraints ?? [],
    opportunitiesContactKey: messages?.opportunitiesContactKey ?? null,
  };
  findings.push(
    finding(
      "schema.messages",
      equal(messagesFound, EXPECTED_MESSAGES),
      `messages: ${messagesFound.constraints.length} constraints (expected: ${EXPECTED_MESSAGES.constraints.length}, exact definitions); opportunities (organization_id, id, contact_id) key: ${messagesFound.opportunitiesContactKey ?? "missing"}`,
    ),
  );

  // Toque de actividad (Hito 4): los dos triggers y su función.
  const [touch] = await tx<
    {
      triggers: string[] | null;
      securityDefiner: boolean | null;
      config: string[] | null;
      owner: string | null;
      executable: boolean | null;
    }[]
  >`
    SELECT
      (
        SELECT array_agg(t.tgenabled::text || ' ' || pg_get_triggerdef(t.oid) ORDER BY t.tgname)
        FROM pg_trigger t
        WHERE t.tgfoid = p.oid AND NOT t.tgisinternal
      ) AS triggers,
      p.prosecdef AS "securityDefiner", p.proconfig AS config,
      p.proowner::regrole::text AS owner,
      (
        has_function_privilege('authenticated', p.oid, 'EXECUTE')
        OR has_function_privilege('anon', p.oid, 'EXECUTE')
        OR has_function_privilege('app_runtime', p.oid, 'EXECUTE')
        OR EXISTS (
          SELECT FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
          WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
        )
      ) AS executable
    FROM (SELECT 1) AS one
    LEFT JOIN pg_proc p
      ON p.oid = to_regprocedure('private.touch_opportunity_activity()')
  `;
  const touchFound = {
    triggers: touch?.triggers ?? [],
    function: {
      securityDefiner: touch?.securityDefiner ?? null,
      config: touch?.config ?? null,
      owner: touch?.owner ?? null,
      executable: touch?.executable ?? null,
    },
  };
  findings.push(
    finding(
      "schema.activity-touch",
      equal(touchFound, EXPECTED_ACTIVITY_TOUCH),
      `activity triggers: ${list(touchFound.triggers)}; touch function: ${touchFound.function.owner === null ? "missing" : `SECURITY DEFINER=${touchFound.function.securityDefiner}, config=${list(touchFound.function.config ?? [])}, owner=${touchFound.function.owner}, EXECUTE granted=${touchFound.function.executable}`}`,
    ),
  );

  // Schema private y private.user_org_ids() (ADR-001 §4).
  const [privateSchema] = await tx<
    {
      exists: boolean;
      owner: string | null;
      authenticated: boolean;
      anon: boolean;
      runtime: boolean;
    }[]
  >`
    SELECT n.oid IS NOT NULL AS exists, n.nspowner::regrole::text AS owner,
      coalesce(has_schema_privilege('authenticated', n.oid, 'USAGE'), false) AS authenticated,
      coalesce(has_schema_privilege('anon', n.oid, 'USAGE'), false) AS anon,
      coalesce(has_schema_privilege('app_runtime', n.oid, 'USAGE'), false) AS runtime
    FROM (SELECT 1) AS one
    LEFT JOIN pg_namespace n ON n.nspname = 'private'
  `;
  findings.push(
    finding(
      "private.schema",
      privateSchema?.exists === true &&
        privateSchema.owner === "postgres" &&
        privateSchema.authenticated &&
        !privateSchema.anon &&
        !privateSchema.runtime,
      privateSchema?.exists
        ? `owner ${privateSchema.owner}; USAGE authenticated=${privateSchema.authenticated}, anon=${privateSchema.anon}, app_runtime=${privateSchema.runtime}`
        : "schema private missing",
    ),
  );

  const [fn] = await tx<
    {
      exists: boolean;
      securityDefiner: boolean;
      volatility: string;
      config: string[] | null;
      owner: string;
      returns: string;
      returnsSet: boolean;
      publicExecute: boolean;
      authenticated: boolean;
      anon: boolean;
      runtime: boolean;
    }[]
  >`
    SELECT true AS exists, p.prosecdef AS "securityDefiner",
      p.provolatile::text AS volatility, p.proconfig AS config,
      p.proowner::regrole::text AS owner, p.prorettype::regtype::text AS returns,
      p.proretset AS "returnsSet",
      EXISTS (
        SELECT FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
      ) AS "publicExecute",
      has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated,
      has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
      has_function_privilege('app_runtime', p.oid, 'EXECUTE') AS runtime
    FROM pg_proc p
    WHERE p.oid = to_regprocedure('private.user_org_ids()')
  `;
  findings.push(
    finding(
      "private.user_org_ids",
      fn?.exists === true &&
        fn.securityDefiner &&
        fn.volatility === "s" &&
        equal(fn.config, ['search_path=""']) &&
        fn.owner === "postgres" &&
        fn.returns === "uuid" &&
        fn.returnsSet &&
        !fn.publicExecute &&
        fn.authenticated &&
        !fn.anon &&
        !fn.runtime,
      fn
        ? `SECURITY DEFINER=${fn.securityDefiner}, volatility=${fn.volatility}, config=${list(fn.config ?? [])}, owner=${fn.owner}, EXECUTE PUBLIC=${fn.publicExecute} authenticated=${fn.authenticated} anon=${fn.anon} app_runtime=${fn.runtime}`
        : "private.user_org_ids() missing",
    ),
  );

  // app_runtime (ADR-001 §2, DEC-019).
  const [runtime] = await tx<
    {
      login: boolean;
      inherit: boolean;
      bypassRls: boolean;
      super: boolean;
      createRole: boolean;
      createDb: boolean;
      replication: boolean;
    }[]
  >`
    SELECT rolcanlogin AS login, rolinherit AS inherit, rolbypassrls AS "bypassRls",
      rolsuper AS super, rolcreaterole AS "createRole", rolcreatedb AS "createDb",
      rolreplication AS replication
    FROM pg_roles WHERE rolname = 'app_runtime'
  `;
  findings.push(
    finding(
      "app_runtime.attributes",
      equal(runtime, {
        login: true,
        inherit: false,
        bypassRls: false,
        super: false,
        createRole: false,
        createDb: false,
        replication: false,
      }),
      runtime
        ? `LOGIN=${runtime.login} INHERIT=${runtime.inherit} BYPASSRLS=${runtime.bypassRls} SUPERUSER=${runtime.super} CREATEROLE=${runtime.createRole} CREATEDB=${runtime.createDb} REPLICATION=${runtime.replication}`
        : "role app_runtime missing",
    ),
  );

  const memberships = await tx<
    { role: string; inherit: boolean; set: boolean; admin: boolean }[]
  >`
    SELECT m.roleid::regrole::text AS role, m.inherit_option AS inherit,
      m.set_option AS set, m.admin_option AS admin
    FROM pg_auth_members m
    WHERE m.member = (SELECT oid FROM pg_roles WHERE rolname = 'app_runtime')
    ORDER BY 1
  `;
  findings.push(
    finding(
      "app_runtime.membership",
      equal(memberships, [
        { role: "authenticated", inherit: false, set: true, admin: false },
      ]),
      `member of: ${list(memberships.map((m) => `${m.role} (INHERIT ${m.inherit}, SET ${m.set}, ADMIN ${m.admin})`))}`,
    ),
  );

  // Qué roles puede asumir o heredar app_runtime, por cualquier cadena.
  const reachable = await tx<{ role: string; set: boolean; usage: boolean }[]>`
    SELECT r.rolname AS role,
      pg_has_role('app_runtime', r.oid, 'SET') AS set,
      pg_has_role('app_runtime', r.oid, 'USAGE') AS usage
    FROM pg_roles r
    WHERE r.rolname <> 'app_runtime'
      AND EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_runtime')
      AND (pg_has_role('app_runtime', r.oid, 'SET')
        OR pg_has_role('app_runtime', r.oid, 'USAGE'))
    ORDER BY 1
  `;
  findings.push(
    finding(
      "app_runtime.assumable-roles",
      equal(reachable, [{ role: "authenticated", set: true, usage: false }]),
      `SET: ${list(reachable.filter((r) => r.set).map((r) => r.role))}; inherited: ${list(reachable.filter((r) => r.usage).map((r) => r.role))}`,
    ),
  );

  // Privilegios sobre las tablas de public (ADR-001 §3.6).
  const runtimePrivileges = await tablePrivileges(tx, "app_runtime");
  const anonPrivileges = await tablePrivileges(tx, "anon");
  const authenticatedPrivileges = await tablePrivileges(tx, "authenticated");
  findings.push(
    finding(
      "privileges.app_runtime",
      runtimePrivileges.length === 0,
      `app_runtime on public tables: ${list(runtimePrivileges)}`,
    ),
    finding(
      "privileges.anon",
      anonPrivileges.length === 0,
      `anon on public tables: ${list(anonPrivileges)}`,
    ),
    finding(
      "privileges.authenticated",
      equal(authenticatedPrivileges, AUTHENTICATED_PRIVILEGES),
      `authenticated on public tables: ${list(authenticatedPrivileges)} (expected: SELECT on every table, INSERT on contacts, opportunities, vehicles, opportunity_demand_facts, opportunity_notes and messages, UPDATE on opportunities and vehicles only; no DELETE)`,
    ),
  );

  // has_column_privilege también es verdadero con un UPDATE de tabla.
  const updateColumns = await tx<{ column: string }[]>`
    SELECT c.relname || '.' || a.attname AS column
    FROM pg_class c
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
    WHERE c.relnamespace = 'public'::regnamespace
      AND c.relkind IN ('r', 'p')
      AND has_column_privilege('authenticated', c.oid, a.attnum, 'UPDATE')
    ORDER BY 1
  `;
  findings.push(
    finding(
      "privileges.authenticated-update-columns",
      equal(
        updateColumns.map((u) => u.column),
        AUTHENTICATED_UPDATE_COLUMNS,
      ),
      `authenticated may update: ${list(updateColumns.map((u) => u.column))} (expected: ${list(AUTHENTICATED_UPDATE_COLUMNS)})`,
    ),
  );

  const uncovered = await tx<{ grant: string }[]>`
    SELECT p.privilege || ' ' || c.relname AS grant
    FROM pg_class c
    CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) AS p(privilege)
    WHERE c.relnamespace = 'public'::regnamespace
      AND c.relkind IN ('r', 'p')
      AND (
        has_table_privilege('authenticated', c.oid, p.privilege)
        OR (
          p.privilege IN ('SELECT', 'INSERT', 'UPDATE')
          AND has_any_column_privilege('authenticated', c.oid, p.privilege)
        )
      )
      AND NOT EXISTS (
        SELECT FROM pg_policies pol
        WHERE pol.schemaname = 'public' AND pol.tablename = c.relname
          AND pol.cmd IN (p.privilege, 'ALL')
          AND pol.roles && ARRAY['authenticated', 'public']::name[]
      )
    ORDER BY 1
  `;
  findings.push(
    finding(
      "privileges.policy-coverage",
      uncovered.length === 0,
      `authenticated privileges without policy: ${list(uncovered.map((u) => u.grant))}`,
    ),
  );

  // C-11: el ledger de demanda es append-only también para service_role.
  const serviceWrites = (await tablePrivileges(tx, "service_role")).filter(
    (grant) =>
      /^(UPDATE|DELETE|TRUNCATE) opportunity_demand_facts$/.test(grant),
  );
  // Y también la bitácora comercial (Hito 2) y los mensajes (Hito 4).
  const serviceNoteWrites = (await tablePrivileges(tx, "service_role")).filter(
    (grant) => /^(UPDATE|DELETE|TRUNCATE) opportunity_notes$/.test(grant),
  );
  const serviceMessageWrites = (
    await tablePrivileges(tx, "service_role")
  ).filter((grant) => /^(UPDATE|DELETE|TRUNCATE) messages$/.test(grant));
  findings.push(
    finding(
      "privileges.service_role-demand-facts",
      serviceWrites.length === 0,
      `service_role on opportunity_demand_facts: ${list(serviceWrites)} (expected: no UPDATE, DELETE or TRUNCATE)`,
    ),
    finding(
      "privileges.service_role-opportunity-notes",
      serviceNoteWrites.length === 0,
      `service_role on opportunity_notes: ${list(serviceNoteWrites)} (expected: no UPDATE, DELETE or TRUNCATE)`,
    ),
    finding(
      "privileges.service_role-messages",
      serviceMessageWrites.length === 0,
      `service_role on messages: ${list(serviceMessageWrites)} (expected: no UPDATE, DELETE or TRUNCATE)`,
    ),
  );

  const create = await tx<{ grant: string }[]>`
    SELECT r.rolname || ' CREATE ' || t.target AS grant
    FROM pg_roles r
    CROSS JOIN (VALUES ('database'), ('public'), ('private'), ('drizzle')) AS t(target)
    WHERE r.rolname IN ('anon', 'authenticated', 'app_runtime')
      AND CASE
        WHEN t.target = 'database'
          THEN has_database_privilege(r.oid, current_database(), 'CREATE')
        WHEN to_regnamespace(t.target) IS NULL THEN false
        ELSE has_schema_privilege(r.oid, to_regnamespace(t.target)::oid, 'CREATE')
      END
    ORDER BY 1
  `;
  findings.push(
    finding(
      "privileges.create",
      create.length === 0,
      `CREATE for anon/authenticated/app_runtime: ${list(create.map((c) => c.grant))}`,
    ),
  );

  const [securityDefiner] = await tx<{ functions: string[] | null }[]>`
    SELECT array_agg(oid::regprocedure::text ORDER BY 1) AS functions FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace AND prosecdef
  `;
  findings.push(
    finding(
      "public.security-definer",
      (securityDefiner?.functions ?? []).length === 0,
      `SECURITY DEFINER functions in public: ${list(securityDefiner?.functions ?? [])}`,
    ),
  );

  // Objetos nuevos de postgres en public: sin grants por defecto para la
  // Data API (ADR-001 §3.6), ni por schema ni globales.
  const defaults = await tx<{ entry: string }[]>`
    SELECT CASE WHEN d.defaclnamespace = 0 THEN '*'
        ELSE d.defaclnamespace::regnamespace::text END || ' '
      || d.defaclobjtype::text || ' ' || e.grantee::regrole::text || '='
      || e.privilege_type AS entry
    FROM pg_default_acl d
    CROSS JOIN LATERAL aclexplode(d.defaclacl) e
    WHERE d.defaclrole = 'postgres'::regrole
      AND (d.defaclnamespace = 0 OR d.defaclnamespace = 'public'::regnamespace)
      AND e.grantee IN ('anon'::regrole, 'authenticated'::regrole)
    ORDER BY 1
  `;
  findings.push(
    finding(
      "privileges.default-acl",
      defaults.length === 0,
      `postgres default privileges for anon/authenticated in public: ${list(defaults.map((d) => d.entry))}`,
    ),
  );

  const [graphql] = await tx<{ installed: boolean }[]>`
    SELECT EXISTS (SELECT FROM pg_extension WHERE extname = 'pg_graphql') AS installed
  `;
  findings.push(
    finding(
      "adr-001.pg_graphql",
      graphql?.installed === false,
      graphql?.installed
        ? "pg_graphql is installed"
        : "pg_graphql not installed",
    ),
  );

  return findings;
}

/**
 * Informativo (no falla): privilegios de service_role sobre las tablas de
 * la app. Los otorgan los default privileges de Supabase; app_runtime no
 * puede asumir service_role (app_runtime.assumable-roles).
 */
export async function serviceRolePrivileges(
  tx: TransactionSql,
): Promise<string[]> {
  return tablePrivileges(tx, "service_role");
}

/*
 * Data API (ADR-001 §3.3 y §3.4, DEC-022). El contrato no es un status
 * concreto: cómo responde una Data API deshabilitada, no disponible o no
 * autorizada depende de Supabase (E2 vio 503 PGRST002). El contrato es que
 * ninguna respuesta exitosa exponga tablas, datos o schema de Porandú. Solo
 * se registran status y categoría: nunca el cuerpo.
 */

/**
 * Tablas de la app; pg_graphql las expone como `<tabla>Collection`, con el
 * nombre inflectado en camelCase (`opportunityDemandFactsCollection`).
 */
const DATA_API_TABLES = [
  "organizations",
  "profiles",
  "memberships",
  "contacts",
  "opportunities",
  "vehicles",
  "opportunity_demand_facts",
  "opportunity_notes",
  "messages",
];
/** Nombres que pg_graphql daría a los tipos de la app. */
const GRAPHQL_APP_TYPES = [
  "Organizations",
  "Profiles",
  "Memberships",
  "MembershipRole",
  "Contacts",
  "Opportunities",
  "Vehicles",
  "OpportunityDemandFacts",
  "OpportunityNotes",
  "Messages",
];

/** Campo de colección de pg_graphql con nombres inflectados. */
export function graphqlCollection(table: string): string {
  return `${table.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())}Collection`;
}

export type DataApiProbeKind =
  "rest-table" | "rest-root" | "graphql-collection" | "graphql-schema";

export function responseCategory(status: number): string {
  if (status >= 200 && status < 300) return "success";
  if (status >= 300 && status < 400) return "redirect";
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 404) return "not found";
  if (status >= 400 && status < 500) return "rejected";
  return "unavailable";
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * ¿La respuesta expone algo de Porandú? Solo una respuesta exitosa puede:
 * - REST por tabla: cualquier éxito (aun vacío, confirma la tabla expuesta);
 * - REST raíz (OpenAPI): si menciona una tabla de la app;
 * - GraphQL por colección: si `data.<tabla>Collection` no es null;
 * - GraphQL introspección: si aparece un tipo de la app.
 */
export function exposesPoranduData(
  kind: DataApiProbeKind,
  status: number,
  body: string,
  table?: string,
): boolean {
  if (status < 200 || status >= 300) return false;
  if (kind === "rest-table") return true;
  if (kind === "rest-root") {
    return DATA_API_TABLES.some((name) => body.includes(name));
  }
  let data: Record<string, unknown> | null = null;
  try {
    data = record(record(JSON.parse(body))?.data);
  } catch {
    return false;
  }
  if (kind === "graphql-collection") {
    return table !== undefined && data?.[graphqlCollection(table)] != null;
  }
  const schema = record(data?.__schema);
  const types = Array.isArray(schema?.types) ? schema.types : [];
  return types.some((type) => {
    const name = record(type)?.name;
    return typeof name === "string" && GRAPHQL_APP_TYPES.includes(name);
  });
}

type ProbeResult = { label: string; status: number; exposed: boolean };

async function probe(
  label: string,
  kind: DataApiProbeKind,
  url: string,
  init: RequestInit,
  table?: string,
): Promise<ProbeResult> {
  const response = await fetch(url, {
    ...init,
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.text();
  return {
    label,
    status: response.status,
    exposed: exposesPoranduData(kind, response.status, body, table),
  };
}

function surfaceFinding(check: string, results: ProbeResult[]): Finding {
  const exposed = results.filter((r) => r.exposed);
  return finding(
    check,
    exposed.length === 0,
    results
      .map(
        (r) =>
          `${r.label}: ${r.status} ${responseCategory(r.status)}${r.exposed ? " (EXPOSES PORANDÚ DATA)" : ""}`,
      )
      .join(" · "),
  );
}

/**
 * La Data API no es una ruta lateral a las tablas de la app: ni con la
 * publishable key (anon) ni, si se pasa, con el access token de un usuario
 * sintético. Falla solo si una respuesta expone tablas, datos o schema.
 */
export async function probeDataApi(
  supabaseUrl: string,
  publishableKey: string,
  accessToken?: string,
): Promise<Finding[]> {
  const headers: Record<string, string> = { apikey: publishableKey };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const who = accessToken ? "authenticated" : "anon";
  const graphql = (query: string): RequestInit => ({
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const rest: RequestInit = {
    headers: { ...headers, Accept: "application/json" },
  };

  const restResults = [
    await probe("root", "rest-root", `${supabaseUrl}/rest/v1/`, rest),
  ];
  const graphqlResults = [
    await probe(
      "schema",
      "graphql-schema",
      `${supabaseUrl}/graphql/v1`,
      graphql("{ __schema { types { name } } }"),
    ),
  ];
  for (const table of DATA_API_TABLES) {
    restResults.push(
      await probe(
        table,
        "rest-table",
        `${supabaseUrl}/rest/v1/${table}?select=*&limit=1`,
        rest,
      ),
    );
    graphqlResults.push(
      await probe(
        table,
        "graphql-collection",
        `${supabaseUrl}/graphql/v1`,
        graphql(
          `{ ${graphqlCollection(table)}(first: 1) { edges { node { __typename } } } }`,
        ),
        table,
      ),
    );
  }
  return [
    surfaceFinding(`data-api.rest (${who})`, restResults),
    surfaceFinding(`data-api.graphql (${who})`, graphqlResults),
  ];
}

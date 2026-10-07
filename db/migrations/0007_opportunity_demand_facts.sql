-- Orden a mano (drizzle-kit lo genera después de la FK compuesta): la unique
-- (organization_id, id) de opportunities tiene que existir antes de la FK
-- opportunity_demand_facts_opportunity_fk que la usa. Es segura sobre datos
-- existentes: id ya es PK.
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_organization_id_id_key" UNIQUE("organization_id","id");--> statement-breakpoint
CREATE TABLE "opportunity_demand_facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"fact" text NOT NULL,
	"status" text NOT NULL,
	"source_kind" text NOT NULL,
	"recorded_by" uuid,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"target_fact_id" uuid,
	"previous_member_fact_id" uuid,
	"brand" text,
	"model" text,
	"year_min" smallint,
	"year_max" smallint,
	"amount" numeric(14, 2),
	"currency" text,
	"purchase_type" text,
	"trade_in" boolean,
	"evidence_text" text,
	CONSTRAINT "opportunity_demand_facts_scope_key" UNIQUE("organization_id","opportunity_id","fact","id"),
	CONSTRAINT "opportunity_demand_facts_scope_source_key" UNIQUE("organization_id","opportunity_id","fact","source_kind","id"),
	CONSTRAINT "opportunity_demand_facts_fact_check" CHECK ("opportunity_demand_facts"."fact" IN ('desired_vehicle', 'year_range', 'budget_max', 'purchase_type', 'trade_in_intent', 'down_payment')),
	CONSTRAINT "opportunity_demand_facts_status_check" CHECK ("opportunity_demand_facts"."status" IN ('detected', 'confirmed', 'corrected', 'rejected')),
	CONSTRAINT "opportunity_demand_facts_source_kind_check" CHECK ("opportunity_demand_facts"."source_kind" IN ('member')),
	CONSTRAINT "opportunity_demand_facts_currency_check" CHECK ("opportunity_demand_facts"."currency" IN ('PYG', 'USD')),
	CONSTRAINT "opportunity_demand_facts_purchase_type_check" CHECK ("opportunity_demand_facts"."purchase_type" IN ('cash', 'financed', 'undecided')),
	CONSTRAINT "opportunity_demand_facts_value_check" CHECK (CASE
        WHEN "opportunity_demand_facts"."status" = 'rejected' THEN num_nonnulls("opportunity_demand_facts"."brand", "opportunity_demand_facts"."model", "opportunity_demand_facts"."year_min", "opportunity_demand_facts"."year_max", "opportunity_demand_facts"."amount", "opportunity_demand_facts"."currency", "opportunity_demand_facts"."purchase_type", "opportunity_demand_facts"."trade_in") = 0
        WHEN "opportunity_demand_facts"."fact" = 'desired_vehicle' THEN num_nonnulls("opportunity_demand_facts"."brand", "opportunity_demand_facts"."model") >= 1 AND num_nonnulls("opportunity_demand_facts"."year_min", "opportunity_demand_facts"."year_max", "opportunity_demand_facts"."amount", "opportunity_demand_facts"."currency", "opportunity_demand_facts"."purchase_type", "opportunity_demand_facts"."trade_in") = 0
        WHEN "opportunity_demand_facts"."fact" = 'year_range' THEN num_nonnulls("opportunity_demand_facts"."year_min", "opportunity_demand_facts"."year_max") >= 1 AND coalesce("opportunity_demand_facts"."year_min" BETWEEN 1900 AND 2100, true) AND coalesce("opportunity_demand_facts"."year_max" BETWEEN 1900 AND 2100, true) AND coalesce("opportunity_demand_facts"."year_min" <= "opportunity_demand_facts"."year_max", true) AND num_nonnulls("opportunity_demand_facts"."brand", "opportunity_demand_facts"."model", "opportunity_demand_facts"."amount", "opportunity_demand_facts"."currency", "opportunity_demand_facts"."purchase_type", "opportunity_demand_facts"."trade_in") = 0
        WHEN "opportunity_demand_facts"."fact" = 'budget_max' THEN num_nonnulls("opportunity_demand_facts"."amount", "opportunity_demand_facts"."currency") = 2 AND "opportunity_demand_facts"."amount" > 0 AND ("opportunity_demand_facts"."currency" <> 'PYG' OR "opportunity_demand_facts"."amount" = trunc("opportunity_demand_facts"."amount")) AND num_nonnulls("opportunity_demand_facts"."brand", "opportunity_demand_facts"."model", "opportunity_demand_facts"."year_min", "opportunity_demand_facts"."year_max", "opportunity_demand_facts"."purchase_type", "opportunity_demand_facts"."trade_in") = 0
        WHEN "opportunity_demand_facts"."fact" = 'down_payment' THEN num_nonnulls("opportunity_demand_facts"."amount", "opportunity_demand_facts"."currency") = 2 AND "opportunity_demand_facts"."amount" >= 0 AND ("opportunity_demand_facts"."currency" <> 'PYG' OR "opportunity_demand_facts"."amount" = trunc("opportunity_demand_facts"."amount")) AND num_nonnulls("opportunity_demand_facts"."brand", "opportunity_demand_facts"."model", "opportunity_demand_facts"."year_min", "opportunity_demand_facts"."year_max", "opportunity_demand_facts"."purchase_type", "opportunity_demand_facts"."trade_in") = 0
        WHEN "opportunity_demand_facts"."fact" = 'purchase_type' THEN "opportunity_demand_facts"."purchase_type" IS NOT NULL AND num_nonnulls("opportunity_demand_facts"."brand", "opportunity_demand_facts"."model", "opportunity_demand_facts"."year_min", "opportunity_demand_facts"."year_max", "opportunity_demand_facts"."amount", "opportunity_demand_facts"."currency", "opportunity_demand_facts"."trade_in") = 0
        WHEN "opportunity_demand_facts"."fact" = 'trade_in_intent' THEN "opportunity_demand_facts"."trade_in" IS NOT NULL AND num_nonnulls("opportunity_demand_facts"."brand", "opportunity_demand_facts"."model", "opportunity_demand_facts"."year_min", "opportunity_demand_facts"."year_max", "opportunity_demand_facts"."amount", "opportunity_demand_facts"."currency", "opportunity_demand_facts"."purchase_type") = 0
        ELSE false
      END),
	CONSTRAINT "opportunity_demand_facts_status_target_check" CHECK (("opportunity_demand_facts"."status" NOT IN ('rejected', 'corrected') OR "opportunity_demand_facts"."target_fact_id" IS NOT NULL) AND ("opportunity_demand_facts"."status" <> 'detected' OR ("opportunity_demand_facts"."target_fact_id" IS NULL AND "opportunity_demand_facts"."previous_member_fact_id" IS NULL))),
	CONSTRAINT "opportunity_demand_facts_source_status_check" CHECK (("opportunity_demand_facts"."status" = 'detected') = ("opportunity_demand_facts"."source_kind" <> 'member')),
	CONSTRAINT "opportunity_demand_facts_member_author_check" CHECK ("opportunity_demand_facts"."source_kind" <> 'member' OR "opportunity_demand_facts"."recorded_by" IS NOT NULL),
	CONSTRAINT "opportunity_demand_facts_member_chain_check" CHECK ("opportunity_demand_facts"."source_kind" = 'member' OR "opportunity_demand_facts"."previous_member_fact_id" IS NULL),
	CONSTRAINT "opportunity_demand_facts_self_reference_check" CHECK (("opportunity_demand_facts"."target_fact_id" IS NULL OR "opportunity_demand_facts"."target_fact_id" <> "opportunity_demand_facts"."id") AND ("opportunity_demand_facts"."previous_member_fact_id" IS NULL OR "opportunity_demand_facts"."previous_member_fact_id" <> "opportunity_demand_facts"."id")),
	CONSTRAINT "opportunity_demand_facts_text_check" CHECK (("opportunity_demand_facts"."brand" IS NULL OR (char_length("opportunity_demand_facts"."brand") BETWEEN 1 AND 40 AND "opportunity_demand_facts"."brand" = btrim("opportunity_demand_facts"."brand") AND "opportunity_demand_facts"."brand" !~ '[[:cntrl:]]')) AND ("opportunity_demand_facts"."model" IS NULL OR (char_length("opportunity_demand_facts"."model") BETWEEN 1 AND 80 AND "opportunity_demand_facts"."model" = btrim("opportunity_demand_facts"."model") AND "opportunity_demand_facts"."model" !~ '[[:cntrl:]]')) AND ("opportunity_demand_facts"."evidence_text" IS NULL OR (char_length("opportunity_demand_facts"."evidence_text") BETWEEN 1 AND 500 AND "opportunity_demand_facts"."evidence_text" = btrim("opportunity_demand_facts"."evidence_text") AND "opportunity_demand_facts"."evidence_text" !~ '[[:cntrl:]]')))
);
--> statement-breakpoint
ALTER TABLE "opportunity_demand_facts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "opportunity_demand_facts" ADD CONSTRAINT "opportunity_demand_facts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_demand_facts" ADD CONSTRAINT "opportunity_demand_facts_recorded_by_profiles_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_demand_facts" ADD CONSTRAINT "opportunity_demand_facts_opportunity_fk" FOREIGN KEY ("organization_id","opportunity_id") REFERENCES "public"."opportunities"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_demand_facts" ADD CONSTRAINT "opportunity_demand_facts_target_fk" FOREIGN KEY ("organization_id","opportunity_id","fact","target_fact_id") REFERENCES "public"."opportunity_demand_facts"("organization_id","opportunity_id","fact","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_demand_facts" ADD CONSTRAINT "opportunity_demand_facts_previous_fk" FOREIGN KEY ("organization_id","opportunity_id","fact","source_kind","previous_member_fact_id") REFERENCES "public"."opportunity_demand_facts"("organization_id","opportunity_id","fact","source_kind","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "opportunity_demand_facts_member_root_key" ON "opportunity_demand_facts" USING btree ("organization_id","opportunity_id","fact") WHERE "opportunity_demand_facts"."source_kind" = 'member' AND "opportunity_demand_facts"."previous_member_fact_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "opportunity_demand_facts_member_next_key" ON "opportunity_demand_facts" USING btree ("organization_id","opportunity_id","fact","previous_member_fact_id") WHERE "opportunity_demand_facts"."source_kind" = 'member' AND "opportunity_demand_facts"."previous_member_fact_id" IS NOT NULL;--> statement-breakpoint
CREATE POLICY "opportunity_demand_facts_select_member" ON "opportunity_demand_facts" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("opportunity_demand_facts"."organization_id" IN (SELECT private.user_org_ids()));--> statement-breakpoint
CREATE POLICY "opportunity_demand_facts_insert_member" ON "opportunity_demand_facts" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("opportunity_demand_facts"."organization_id" IN (SELECT private.user_org_ids()) AND "opportunity_demand_facts"."source_kind" = 'member' AND "opportunity_demand_facts"."status" IN ('confirmed', 'corrected', 'rejected') AND "opportunity_demand_facts"."recorded_by" = (select auth.uid()) AND "opportunity_demand_facts"."recorded_at" = now());--> statement-breakpoint
-- Custom SQL (no lo genera drizzle-kit) · ADR-001 §3.6: grants explícitos.
-- Demanda de la oportunidad (H1.4, DEC-030): ledger append-only. 0000 ya
-- revocó los default privileges de anon y authenticated para lo que postgres
-- crea en public; igual se revoca sobre esta tabla, como en 0002 y 0004.
--
-- Diseño A (DEC-030 §9): authenticated recibe SELECT e INSERT de tabla,
-- cubiertos por las policies de arriba. Drizzle lista todas las columnas en
-- el INSERT (`default` para las que no recibe) y PostgreSQL exige INSERT
-- sobre cada columna listada, así que un grant por columna sin `id` o
-- `recorded_at` fallaría (42501): lo fijan las pruebas P0, P1 y P2. Los
-- valores que el cliente no elige los controla el WITH CHECK: organización
-- con membership activa, `source_kind = 'member'`, estado humano, autor =
-- auth.uid() y `recorded_at = now()`. RETURNING id usa el SELECT concedido.
--
-- Append-only: sin UPDATE ni DELETE (default deny) para anon,
-- authenticated y app_runtime, y tampoco para service_role (C-11): los
-- default privileges de Supabase le dan ALL sobre lo nuevo de public. El
-- owner (postgres) es la limitación documentada. app_runtime no recibe
-- nada: solo escribe asumiendo authenticated dentro de withTenant().
REVOKE ALL ON TABLE "public"."opportunity_demand_facts" FROM "anon", "authenticated";--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE "public"."opportunity_demand_facts" TO "authenticated";--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "public"."opportunity_demand_facts" FROM "service_role";--> statement-breakpoint
-- Custom SQL · postcondiciones de ADR-001 §3.6 sobre la base real, para toda
-- tabla de public: las de 0006, con opportunity_demand_facts entre las altas
-- aprobadas, más las de un ledger append-only: sin policies de UPDATE,
-- DELETE ni ALL sobre la tabla, sin UPDATE de authenticated en ninguna de
-- sus columnas (explícito, para que sobreviva cuando H1.6 amplíe las
-- ediciones aprobadas) y sin UPDATE, DELETE ni TRUNCATE de service_role. Si
-- alguna falla, la migración entera se revierte y no se aplica nada.
DO $$
BEGIN
  IF EXISTS (
    SELECT FROM pg_catalog.pg_class c
    WHERE c.relnamespace = 'public'::regnamespace
      AND c.relkind IN ('r', 'p')
      AND NOT c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'ADR-001: every table in public must have RLS enabled';
  END IF;

  IF EXISTS (
    SELECT FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_attribute a
      ON a.attrelid = c.oid AND a.attname = 'organization_id' AND NOT a.attisdropped
    WHERE c.relnamespace = 'public'::regnamespace
      AND c.relkind IN ('r', 'p')
      AND (
        NOT a.attnotnull
        OR NOT EXISTS (
          SELECT FROM pg_catalog.pg_constraint k
          WHERE k.conrelid = c.oid
            AND k.contype = 'f'
            AND k.conkey = ARRAY[a.attnum]
            AND k.confrelid = 'public.organizations'::regclass
        )
        OR NOT EXISTS (
          SELECT FROM pg_catalog.pg_index i
          WHERE i.indrelid = c.oid AND i.indkey[0] = a.attnum
        )
      )
  ) THEN
    RAISE EXCEPTION 'ADR-001: tenant-scoped tables need organization_id NOT NULL, a FK to organizations and an index leading with organization_id';
  END IF;

  IF EXISTS (
    SELECT FROM pg_catalog.pg_class c
    CROSS JOIN unnest(ARRAY['anon', 'app_runtime']) AS r(role)
    CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) AS p(privilege)
    WHERE c.relnamespace = 'public'::regnamespace
      AND c.relkind IN ('r', 'p')
      AND (
        has_table_privilege(r.role, c.oid, p.privilege)
        OR (
          p.privilege IN ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
          AND has_any_column_privilege(r.role, c.oid, p.privilege)
        )
      )
  ) THEN
    RAISE EXCEPTION 'ADR-001: anon and app_runtime must not have privileges on public tables';
  END IF;

  -- También los privilegios por columna (el UPDATE de vehicles lo es).
  IF EXISTS (
    SELECT FROM pg_catalog.pg_class c
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
        SELECT FROM pg_catalog.pg_policies pol
        WHERE pol.schemaname = 'public'
          AND pol.tablename = c.relname
          AND pol.cmd IN (p.privilege, 'ALL')
          AND pol.roles && ARRAY['authenticated', 'public']::name[]
      )
  ) THEN
    RAISE EXCEPTION 'ADR-001: every privilege of authenticated on public tables must be covered by a policy';
  END IF;

  IF EXISTS (
    SELECT FROM pg_catalog.pg_policies pol
    WHERE pol.schemaname = 'public'
      AND pol.cmd IN ('INSERT', 'UPDATE', 'ALL')
      AND pol.with_check IS NULL
  ) THEN
    RAISE EXCEPTION 'ADR-001: every write policy on public tables must have a WITH CHECK';
  END IF;

  -- Una policy de UPDATE sin USING no limita qué filas se pueden editar.
  IF EXISTS (
    SELECT FROM pg_catalog.pg_policies pol
    WHERE pol.schemaname = 'public'
      AND pol.cmd IN ('UPDATE', 'ALL')
      AND pol.qual IS NULL
  ) THEN
    RAISE EXCEPTION 'ADR-001: every update policy on public tables must have a USING';
  END IF;

  IF EXISTS (
    SELECT FROM pg_catalog.pg_class c
    CROSS JOIN unnest(ARRAY['DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) AS p(privilege)
    WHERE c.relnamespace = 'public'::regnamespace
      AND c.relkind IN ('r', 'p')
      AND (
        has_table_privilege('authenticated', c.oid, p.privilege)
        OR (
          p.privilege = 'REFERENCES'
          AND has_any_column_privilege('authenticated', c.oid, p.privilege)
        )
      )
  ) THEN
    RAISE EXCEPTION 'ADR-001: authenticated must not delete or truncate public tables';
  END IF;

  -- La única edición aprobada es la de H1.3C: vehicles.status (y su
  -- updated_at). Un UPDATE de tabla, o sobre cualquier otra columna o tabla,
  -- no pasa: has_column_privilege también es verdadero con un grant de tabla.
  IF EXISTS (
    SELECT FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_attribute a
      ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
    WHERE c.relnamespace = 'public'::regnamespace
      AND c.relkind IN ('r', 'p')
      AND has_column_privilege('authenticated', c.oid, a.attnum, 'UPDATE')
      AND NOT (c.relname = 'vehicles' AND a.attname IN ('status', 'updated_at'))
  ) THEN
    RAISE EXCEPTION 'ADR-001: authenticated may only update vehicles.status and vehicles.updated_at (H1.3C)';
  END IF;

  -- Las únicas altas aprobadas son las de H1.2 (contacts y opportunities),
  -- la de H1.3B (vehicles) y la de H1.4 (opportunity_demand_facts): ninguna
  -- otra tabla recibe INSERT sin una migración que lo apruebe.
  IF EXISTS (
    SELECT FROM pg_catalog.pg_class c
    WHERE c.relnamespace = 'public'::regnamespace
      AND c.relkind IN ('r', 'p')
      AND c.relname NOT IN ('contacts', 'opportunities', 'vehicles', 'opportunity_demand_facts')
      AND (
        has_table_privilege('authenticated', c.oid, 'INSERT')
        OR has_any_column_privilege('authenticated', c.oid, 'INSERT')
      )
  ) THEN
    RAISE EXCEPTION 'ADR-001: authenticated may only insert into contacts, opportunities, vehicles and opportunity_demand_facts (H1.4)';
  END IF;

  -- Ledger append-only (H1.4): ninguna policy de UPDATE, DELETE ni ALL.
  IF EXISTS (
    SELECT FROM pg_catalog.pg_policies pol
    WHERE pol.schemaname = 'public'
      AND pol.tablename = 'opportunity_demand_facts'
      AND pol.cmd IN ('UPDATE', 'DELETE', 'ALL')
  ) THEN
    RAISE EXCEPTION 'ADR-001: opportunity_demand_facts is append-only: no UPDATE, DELETE or ALL policies (H1.4)';
  END IF;

  -- Explícito para la tabla, aunque la regla de ediciones de arriba ya lo
  -- cubra hoy: sobrevive a que se amplíen las ediciones aprobadas.
  IF EXISTS (
    SELECT FROM pg_catalog.pg_attribute a
    WHERE a.attrelid = 'public.opportunity_demand_facts'::regclass
      AND a.attnum > 0
      AND NOT a.attisdropped
      AND has_column_privilege('authenticated', a.attrelid, a.attnum, 'UPDATE')
  ) THEN
    RAISE EXCEPTION 'ADR-001: authenticated must not update opportunity_demand_facts (H1.4)';
  END IF;

  -- C-11: append-only también frente a service_role.
  IF EXISTS (
    SELECT FROM unnest(ARRAY['UPDATE', 'DELETE', 'TRUNCATE']) AS p(privilege)
    WHERE has_table_privilege('service_role', 'public.opportunity_demand_facts', p.privilege)
      OR (
        p.privilege = 'UPDATE'
        AND has_any_column_privilege('service_role', 'public.opportunity_demand_facts', p.privilege)
      )
  ) THEN
    RAISE EXCEPTION 'ADR-001: service_role must not update, delete or truncate opportunity_demand_facts (H1.4)';
  END IF;
END
$$;

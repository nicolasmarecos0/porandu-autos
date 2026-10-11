-- Orden a mano (drizzle-kit lo genera después de la FK compuesta): la unique
-- (organization_id, id) de vehicles tiene que existir antes de la FK
-- opportunities_vehicle_fk que la usa. Es segura sobre datos existentes: id
-- ya es PK.
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_organization_id_id_key" UNIQUE("organization_id","id");--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "vehicle_id" uuid;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_vehicle_fk" FOREIGN KEY ("organization_id","vehicle_id") REFERENCES "public"."vehicles"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_vehicle_stage_check" CHECK ("opportunities"."vehicle_id" IS NULL OR "opportunities"."stage" IN ('negotiating', 'won', 'lost'));--> statement-breakpoint
CREATE INDEX "opportunities_organization_id_vehicle_id_idx" ON "opportunities" USING btree ("organization_id","vehicle_id") WHERE "opportunities"."vehicle_id" IS NOT NULL;--> statement-breakpoint
CREATE TABLE "opportunity_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"body" text NOT NULL,
	"recorded_by" uuid NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "opportunity_notes_body_check" CHECK (char_length("opportunity_notes"."body") BETWEEN 1 AND 1000 AND "opportunity_notes"."body" = btrim("opportunity_notes"."body", ' ' || chr(10)) AND translate("opportunity_notes"."body", chr(10), '') !~ '[[:cntrl:]]')
);
--> statement-breakpoint
ALTER TABLE "opportunity_notes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "opportunity_notes" ADD CONSTRAINT "opportunity_notes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_notes" ADD CONSTRAINT "opportunity_notes_recorded_by_profiles_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_notes" ADD CONSTRAINT "opportunity_notes_opportunity_fk" FOREIGN KEY ("organization_id","opportunity_id") REFERENCES "public"."opportunities"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "opportunity_notes_organization_id_opportunity_id_idx" ON "opportunity_notes" USING btree ("organization_id","opportunity_id","recorded_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE POLICY "opportunity_notes_select_member" ON "opportunity_notes" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("opportunity_notes"."organization_id" IN (SELECT private.user_org_ids()));--> statement-breakpoint
CREATE POLICY "opportunity_notes_insert_member" ON "opportunity_notes" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("opportunity_notes"."organization_id" IN (SELECT private.user_org_ids()) AND "opportunity_notes"."recorded_by" = (select auth.uid()) AND "opportunity_notes"."recorded_at" = now());
--> statement-breakpoint
-- Custom SQL (no lo genera drizzle-kit) · DEC-033 §3 amplía DEC-032 §4: el
-- trigger opportunities_stage_transition (misma función, mismo nombre) acepta
-- exactamente dos clases de UPDATE sobre opportunities:
--   1. un pase de etapa de la máquina que no toca la unidad vinculada
--      (la matriz de domains/opportunities/stages.ts, sin cambios);
--   2. un cambio de unidad vinculada (vehicle_id) sin pase, solo en
--      negotiating o won (VEHICLE_LINK_STAGES de
--      domains/opportunities/vehicle-link.ts).
-- Todo lo demás se rechaza con 23514: constraint
-- opportunities_stage_transition si el pase no existe o la UPDATE no cambia
-- ni la etapa ni la unidad (como en 0008), y opportunities_vehicle_link si
-- cambia la unidad en otra etapa o junto con un pase. Sigue valiendo para el
-- rol dueño. Que la unidad sea de la misma organización lo exige la FK
-- compuesta; que exista solo desde la negociación, el CHECK
-- opportunities_vehicle_stage_check. Fija `updated_at` con el reloj de la
-- base. SET search_path = '' y nada de tablas: solo mira OLD y NEW.
-- CREATE OR REPLACE conserva el owner y los privilegios (sin EXECUTE para
-- nadie); el REVOKE se repite igual, explícito.
CREATE OR REPLACE FUNCTION "private"."enforce_opportunity_stage_transition"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.stage IS DISTINCT FROM OLD.stage THEN
    IF NOT (
      (OLD.stage = 'new' AND NEW.stage IN ('qualifying', 'lost'))
      OR (OLD.stage = 'qualifying' AND NEW.stage IN ('negotiating', 'lost'))
      OR (OLD.stage = 'negotiating' AND NEW.stage IN ('won', 'lost'))
    ) THEN
      RAISE EXCEPTION 'opportunity stage cannot change from % to %', OLD.stage, NEW.stage
        USING ERRCODE = 'check_violation',
          TABLE = 'opportunities',
          CONSTRAINT = 'opportunities_stage_transition';
    END IF;
    IF NEW.vehicle_id IS DISTINCT FROM OLD.vehicle_id THEN
      RAISE EXCEPTION 'a stage change cannot change the linked vehicle'
        USING ERRCODE = 'check_violation',
          TABLE = 'opportunities',
          CONSTRAINT = 'opportunities_vehicle_link';
    END IF;
  ELSIF NEW.vehicle_id IS DISTINCT FROM OLD.vehicle_id THEN
    IF OLD.stage NOT IN ('negotiating', 'won') THEN
      RAISE EXCEPTION 'the linked vehicle cannot change in stage %', OLD.stage
        USING ERRCODE = 'check_violation',
          TABLE = 'opportunities',
          CONSTRAINT = 'opportunities_vehicle_link';
    END IF;
  ELSE
    RAISE EXCEPTION 'opportunity stage cannot change from % to %', OLD.stage, NEW.stage
      USING ERRCODE = 'check_violation',
        TABLE = 'opportunities',
        CONSTRAINT = 'opportunities_stage_transition';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "private"."enforce_opportunity_stage_transition"() FROM PUBLIC;--> statement-breakpoint
-- Custom SQL · ADR-001 §3.6: grants explícitos.
-- Unidad vinculada (DEC-033 §2): authenticated suma UPDATE sobre
-- opportunities.vehicle_id (por columna), cubierto por la única policy de
-- UPDATE (opportunities_update_stage) y validado por el trigger. El resto de
-- las columnas sigue sin UPDATE (42501) y DELETE sigue prohibido.
GRANT UPDATE ("vehicle_id") ON TABLE "public"."opportunities" TO "authenticated";--> statement-breakpoint
-- Bitácora comercial (DEC-033 §1): append-only, como la demanda (0007). 0000
-- ya revocó los default privileges de anon y authenticated para lo que
-- postgres crea en public; igual se revoca sobre esta tabla.
-- Diseño A (DEC-030 §9): authenticated recibe SELECT e INSERT de tabla,
-- porque Drizzle lista todas las columnas en el INSERT; lo que el cliente no
-- elige (organización con membership activa, autor = auth.uid(), reloj de la
-- base) lo controla el WITH CHECK. Sin UPDATE ni DELETE para anon,
-- authenticated y app_runtime, y tampoco para service_role (como C-11): los
-- default privileges de Supabase le dan ALL sobre lo nuevo de public. El
-- owner (postgres) es la limitación documentada. app_runtime no recibe nada:
-- solo escribe asumiendo authenticated dentro de withTenant().
REVOKE ALL ON TABLE "public"."opportunity_notes" FROM "anon", "authenticated";--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE "public"."opportunity_notes" TO "authenticated";--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "public"."opportunity_notes" FROM "service_role";--> statement-breakpoint
-- Custom SQL · postcondiciones de ADR-001 §3.6 sobre la base real, para toda
-- tabla de public: las de 0008, con opportunities.vehicle_id entre las
-- ediciones aprobadas, opportunity_notes entre las altas aprobadas y las de
-- un ledger append-only también para opportunity_notes. Si alguna falla, la
-- migración entera se revierte y no se aplica nada.
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

  -- También los privilegios por columna (los UPDATE de vehicles y
  -- opportunities lo son).
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

  -- Las únicas ediciones aprobadas son la de H1.3C (vehicles.status y su
  -- updated_at), la de H1.6 (opportunities.stage, loss_reason y su
  -- updated_at) y la del Hito 2 (opportunities.vehicle_id). Un UPDATE de
  -- tabla, o sobre cualquier otra columna o tabla, no pasa:
  -- has_column_privilege también es verdadero con un grant de tabla.
  IF EXISTS (
    SELECT FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_attribute a
      ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
    WHERE c.relnamespace = 'public'::regnamespace
      AND c.relkind IN ('r', 'p')
      AND has_column_privilege('authenticated', c.oid, a.attnum, 'UPDATE')
      AND NOT (c.relname = 'vehicles' AND a.attname IN ('status', 'updated_at'))
      AND NOT (c.relname = 'opportunities' AND a.attname IN ('stage', 'loss_reason', 'vehicle_id', 'updated_at'))
  ) THEN
    RAISE EXCEPTION 'ADR-001: authenticated may only update vehicles.status, vehicles.updated_at (H1.3C) and opportunities.stage, loss_reason, vehicle_id, updated_at (H1.6, Hito 2)';
  END IF;

  -- DEC-028 §6, DEC-032 §4, DEC-033 §3: una edición de opportunities se
  -- valida a nivel de base de datos. El UPDATE solo es seguro con el trigger
  -- BEFORE UPDATE FOR EACH ROW (tgtype 19) habilitado.
  IF NOT EXISTS (
    SELECT FROM pg_catalog.pg_trigger t
    WHERE t.tgrelid = 'public.opportunities'::regclass
      AND t.tgname = 'opportunities_stage_transition'
      AND NOT t.tgisinternal
      AND t.tgenabled = 'O'
      AND t.tgtype = 19
      AND t.tgfoid = 'private.enforce_opportunity_stage_transition()'::regprocedure
  ) THEN
    RAISE EXCEPTION 'DEC-032: opportunities need the enabled BEFORE UPDATE stage transition trigger';
  END IF;

  -- Las únicas altas aprobadas son las de H1.2 (contacts y opportunities),
  -- la de H1.3B (vehicles), la de H1.4 (opportunity_demand_facts) y la del
  -- Hito 2 (opportunity_notes): ninguna otra tabla recibe INSERT sin una
  -- migración que lo apruebe.
  IF EXISTS (
    SELECT FROM pg_catalog.pg_class c
    WHERE c.relnamespace = 'public'::regnamespace
      AND c.relkind IN ('r', 'p')
      AND c.relname NOT IN ('contacts', 'opportunities', 'vehicles', 'opportunity_demand_facts', 'opportunity_notes')
      AND (
        has_table_privilege('authenticated', c.oid, 'INSERT')
        OR has_any_column_privilege('authenticated', c.oid, 'INSERT')
      )
  ) THEN
    RAISE EXCEPTION 'ADR-001: authenticated may only insert into contacts, opportunities, vehicles, opportunity_demand_facts (H1.4) and opportunity_notes (Hito 2)';
  END IF;

  -- Ledgers append-only (H1.4 y Hito 2): ninguna policy de UPDATE, DELETE
  -- ni ALL.
  IF EXISTS (
    SELECT FROM pg_catalog.pg_policies pol
    WHERE pol.schemaname = 'public'
      AND pol.tablename IN ('opportunity_demand_facts', 'opportunity_notes')
      AND pol.cmd IN ('UPDATE', 'DELETE', 'ALL')
  ) THEN
    RAISE EXCEPTION 'ADR-001: opportunity_demand_facts and opportunity_notes are append-only: no UPDATE, DELETE or ALL policies';
  END IF;

  -- Explícito para las dos tablas, aunque la regla de ediciones de arriba ya
  -- lo cubra hoy: sobrevive a que se amplíen las ediciones aprobadas.
  IF EXISTS (
    SELECT FROM pg_catalog.pg_attribute a
    WHERE a.attrelid IN (
        'public.opportunity_demand_facts'::regclass,
        'public.opportunity_notes'::regclass
      )
      AND a.attnum > 0
      AND NOT a.attisdropped
      AND has_column_privilege('authenticated', a.attrelid, a.attnum, 'UPDATE')
  ) THEN
    RAISE EXCEPTION 'ADR-001: authenticated must not update opportunity_demand_facts or opportunity_notes';
  END IF;

  -- C-11: append-only también frente a service_role.
  IF EXISTS (
    SELECT FROM unnest(ARRAY['public.opportunity_demand_facts', 'public.opportunity_notes']) AS t(name)
    CROSS JOIN unnest(ARRAY['UPDATE', 'DELETE', 'TRUNCATE']) AS p(privilege)
    WHERE has_table_privilege('service_role', t.name, p.privilege)
      OR (
        p.privilege = 'UPDATE'
        AND has_any_column_privilege('service_role', t.name, p.privilege)
      )
  ) THEN
    RAISE EXCEPTION 'ADR-001: service_role must not update, delete or truncate opportunity_demand_facts or opportunity_notes';
  END IF;
END
$$;

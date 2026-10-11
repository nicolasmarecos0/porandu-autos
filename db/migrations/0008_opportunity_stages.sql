-- Custom SQL (no lo genera drizzle-kit) · DEC-032: las etapas de H1.6
-- reemplazan a las de B1 (qualified, test_drive, negotiation). Ningún flujo
-- de la aplicación pudo escribir otra etapa que `new` (la policy de INSERT la
-- exige y no había UPDATE), así que en una base real no hay filas para
-- reinterpretar. Si existiera alguna, la migración se detiene en vez de
-- adivinar a qué etapa nueva corresponde.
DO $$
BEGIN
  IF EXISTS (
    SELECT FROM public.opportunities WHERE stage <> 'new'
  ) THEN
    RAISE EXCEPTION 'DEC-032: opportunities in a stage other than new cannot be migrated automatically';
  END IF;
END
$$;--> statement-breakpoint
ALTER TABLE "opportunities" DROP CONSTRAINT "opportunities_stage_check";--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "loss_reason" text;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_loss_reason_check" CHECK ("opportunities"."loss_reason" IN ('price', 'vehicle_not_available', 'bought_elsewhere', 'no_response', 'unqualified', 'other'));--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_loss_reason_stage_check" CHECK (("opportunities"."stage" = 'lost' AND "opportunities"."loss_reason" IS NOT NULL) OR ("opportunities"."stage" <> 'lost' AND "opportunities"."loss_reason" IS NULL));--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_stage_check" CHECK ("opportunities"."stage" IN ('new', 'qualifying', 'negotiating', 'won', 'lost'));--> statement-breakpoint
CREATE POLICY "opportunities_update_stage" ON "opportunities" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("opportunities"."organization_id" IN (SELECT private.user_org_ids())) WITH CHECK ("opportunities"."organization_id" IN (SELECT private.user_org_ids()));
--> statement-breakpoint
-- Custom SQL · DEC-032 §4 / DEC-028 §6: el par etapa anterior → etapa nueva
-- se valida a nivel de base de datos con un trigger, no con policies por
-- transición (las policies permisivas de un mismo comando se combinan con OR
-- y cruzarían orígenes y destinos, DEC-028 §5). Espeja la máquina de
-- domains/opportunities/stages.ts (un test cruza las dos matrices):
--   new → qualifying | lost · qualifying → negotiating | lost ·
--   negotiating → won | lost · won y lost son terminales.
-- Toda UPDATE de opportunities es un cambio de etapa: una que no la cambie,
-- o que salga de una etapa terminal, se rechaza (23514,
-- constraint opportunities_stage_transition). Eso incluye al rol dueño: el
-- mantenimiento que necesite otra cosa deshabilita el trigger de forma
-- explícita en una migración revisada. También fija `updated_at` con el
-- reloj de la base, para que ninguna request pueda ponerlo a su gusto.
-- La coherencia con loss_reason (motivo si y solo si lost) la exige el CHECK.
-- SET search_path = '' y nada de tablas: solo mira OLD y NEW.
CREATE FUNCTION "private"."enforce_opportunity_stage_transition"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
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
  NEW.updated_at := now();
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "private"."enforce_opportunity_stage_transition"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "opportunities_stage_transition"
  BEFORE UPDATE ON "public"."opportunities"
  FOR EACH ROW EXECUTE FUNCTION "private"."enforce_opportunity_stage_transition"();--> statement-breakpoint
-- Custom SQL · ADR-001 §3.6: grants explícitos.
-- Cambio de etapa (H1.6): la única edición de opportunities. authenticated
-- recibe UPDATE solo sobre tres columnas: `stage` y `loss_reason` (la
-- transición) y `updated_at` (Drizzle lo incluye en cada update(),
-- columns.ts; el trigger lo fija con now()). Organización, contacto, origen,
-- legado de interés, last_activity_at, id y created_at siguen sin UPDATE: un
-- UPDATE que los toque falla por privilegios (42501), antes de RLS. La
-- policy opportunities_update_stage exige una organización con membership
-- activa del usuario de la request, antes y después. Sin DELETE (default
-- deny). app_runtime no recibe nada: solo escribe asumiendo authenticated
-- dentro de withTenant().
GRANT UPDATE ("stage", "loss_reason", "updated_at") ON TABLE "public"."opportunities" TO "authenticated";--> statement-breakpoint
-- Custom SQL · postcondiciones de ADR-001 §3.6 sobre la base real, para toda
-- tabla de public: las de 0007, con las ediciones aprobadas ampliadas a la de
-- H1.6 (opportunities.stage, loss_reason y updated_at), y la exigencia de que
-- esa edición pase por el trigger de transiciones (DEC-028 §6, DEC-032 §4).
-- Las del ledger append-only de H1.4 siguen intactas. Si alguna falla, la
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

  -- Las únicas ediciones aprobadas son la de H1.3C (vehicles.status y su
  -- updated_at) y la de H1.6 (opportunities.stage, loss_reason y su
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
      AND NOT (c.relname = 'opportunities' AND a.attname IN ('stage', 'loss_reason', 'updated_at'))
  ) THEN
    RAISE EXCEPTION 'ADR-001: authenticated may only update vehicles.status, vehicles.updated_at (H1.3C) and opportunities.stage, opportunities.loss_reason, opportunities.updated_at (H1.6)';
  END IF;

  -- DEC-028 §6: una edición de estado se valida a nivel de base de datos. El
  -- UPDATE de opportunities solo es seguro con el trigger BEFORE UPDATE FOR
  -- EACH ROW (tgtype 19) habilitado, que valida el par etapa anterior →
  -- etapa nueva.
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

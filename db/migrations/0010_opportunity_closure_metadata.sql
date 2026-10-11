-- Custom SQL (no lo genera drizzle-kit) · DEC-034 §10: precondición. Toda
-- oportunidad `won` tiene que traer su venta (CHECK
-- opportunities_won_closure_check) y toda `lost`, un motivo de la lista nueva
-- (DEC-034 §2 reemplaza la de DEC-032 §3). Una `won` anterior no tiene
-- metadatos, y un motivo que dejó de existir (vehicle_not_available,
-- bought_elsewhere, no_response, unqualified) no tiene un equivalente seguro:
-- la migración se detiene en vez de inventar una venta o reinterpretar un
-- motivo (como 0008). `price` y `other` existen en las dos listas y pasan.
DO $$
BEGIN
  IF EXISTS (
    SELECT FROM public.opportunities
    WHERE stage = 'won'
      OR (stage = 'lost' AND loss_reason NOT IN ('price', 'other'))
  ) THEN
    RAISE EXCEPTION 'DEC-034: closed opportunities without the new closure metadata cannot be migrated automatically';
  END IF;
END
$$;--> statement-breakpoint
-- Generado por drizzle-kit desde db/schema/opportunities.ts (DEC-034 §2, §3
-- y §5): la lista nueva de motivos de pérdida, los metadatos del cierre
-- (nulos en toda fila existente) y sus CHECKs con nombre.
ALTER TABLE "opportunities" DROP CONSTRAINT "opportunities_loss_reason_check";--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "loss_notes" text;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "sale_price" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "sale_currency" text;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "payment_method" text;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "delivery_status" text;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "delivery_date" date;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_loss_notes_check" CHECK (char_length("opportunities"."loss_notes") BETWEEN 1 AND 500 AND "opportunities"."loss_notes" = btrim("opportunities"."loss_notes", ' ' || chr(10)) AND translate("opportunities"."loss_notes", chr(10), '') !~ '[[:cntrl:]]');--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_loss_notes_stage_check" CHECK ("opportunities"."loss_notes" IS NULL OR "opportunities"."stage" = 'lost');--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_sale_currency_check" CHECK ("opportunities"."sale_currency" IN ('PYG', 'USD'));--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_sale_price_check" CHECK (("opportunities"."sale_price" IS NULL) = ("opportunities"."sale_currency" IS NULL) AND ("opportunities"."sale_price" IS NULL OR ("opportunities"."sale_price" > 0 AND ("opportunities"."sale_currency" <> 'PYG' OR "opportunities"."sale_price" = trunc("opportunities"."sale_price")))));--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_payment_method_check" CHECK ("opportunities"."payment_method" IN ('cash', 'financing', 'trade_in', 'mixed'));--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_delivery_status_check" CHECK ("opportunities"."delivery_status" IN ('scheduled', 'delivered'));--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_delivery_date_check" CHECK ("opportunities"."delivery_date" BETWEEN '2000-01-01' AND '2100-12-31');--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_won_closure_check" CHECK (("opportunities"."stage" = 'won' AND "opportunities"."vehicle_id" IS NOT NULL AND "opportunities"."sale_price" IS NOT NULL AND "opportunities"."sale_currency" IS NOT NULL AND "opportunities"."payment_method" IS NOT NULL AND "opportunities"."delivery_status" IS NOT NULL AND "opportunities"."delivery_date" IS NOT NULL) OR ("opportunities"."stage" <> 'won' AND "opportunities"."sale_price" IS NULL AND "opportunities"."sale_currency" IS NULL AND "opportunities"."payment_method" IS NULL AND "opportunities"."delivery_status" IS NULL AND "opportunities"."delivery_date" IS NULL));--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_loss_reason_check" CHECK ("opportunities"."loss_reason" IN ('price', 'vehicle_unavailable', 'competitor', 'financing_rejected', 'ghosted', 'other'));--> statement-breakpoint
-- Custom SQL · DEC-034 §5 amplía DEC-033 §3: el trigger
-- opportunities_stage_transition (misma función, mismo nombre) acepta
-- exactamente tres clases de UPDATE sobre opportunities:
--   1. un pase de etapa de la máquina que no toca la unidad vinculada
--      (la matriz de domains/opportunities/stages.ts, sin cambios), donde
--      los metadatos de cierre solo cambian si el pase cierra (`won` o
--      `lost`): se escriben con el pase, nunca después;
--   2. un cambio de unidad vinculada (vehicle_id) sin pase, solo en
--      negotiating (VEHICLE_LINK_STAGES de
--      domains/opportunities/vehicle-link.ts): en `won` la unidad es la
--      vendida y queda fija con el cierre;
--   3. nada más.
-- Todo lo demás se rechaza con 23514: constraint
-- opportunities_stage_transition si el pase no existe o la UPDATE no cambia
-- nada (como en 0008), opportunities_vehicle_link si cambia la unidad fuera
-- de negotiating o junto con un pase (como en 0009), y
-- opportunities_closure_immutable si cambia un metadato de cierre fuera del
-- pase que cierra. Sigue valiendo para el rol dueño. Que el cierre esté
-- completo (y la venta con su unidad) lo exigen los CHECKs; que la unidad
-- sea de la misma organización, la FK compuesta. Fija `updated_at` con el
-- reloj de la base. SET search_path = '' y nada de tablas: solo mira OLD y
-- NEW. CREATE OR REPLACE conserva el owner y los privilegios (sin EXECUTE
-- para nadie); el REVOKE se repite igual, explícito.
CREATE OR REPLACE FUNCTION "private"."enforce_opportunity_stage_transition"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  closure_changed boolean := (
    NEW.loss_reason, NEW.loss_notes, NEW.sale_price, NEW.sale_currency,
    NEW.payment_method, NEW.delivery_status, NEW.delivery_date
  ) IS DISTINCT FROM (
    OLD.loss_reason, OLD.loss_notes, OLD.sale_price, OLD.sale_currency,
    OLD.payment_method, OLD.delivery_status, OLD.delivery_date
  );
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
    IF closure_changed AND NEW.stage NOT IN ('won', 'lost') THEN
      RAISE EXCEPTION 'closure metadata can only be written by the update that closes the opportunity'
        USING ERRCODE = 'check_violation',
          TABLE = 'opportunities',
          CONSTRAINT = 'opportunities_closure_immutable';
    END IF;
  ELSIF NEW.vehicle_id IS DISTINCT FROM OLD.vehicle_id THEN
    IF OLD.stage <> 'negotiating' THEN
      RAISE EXCEPTION 'the linked vehicle cannot change in stage %', OLD.stage
        USING ERRCODE = 'check_violation',
          TABLE = 'opportunities',
          CONSTRAINT = 'opportunities_vehicle_link';
    END IF;
    IF closure_changed THEN
      RAISE EXCEPTION 'closure metadata can only be written by the update that closes the opportunity'
        USING ERRCODE = 'check_violation',
          TABLE = 'opportunities',
          CONSTRAINT = 'opportunities_closure_immutable';
    END IF;
  ELSIF closure_changed THEN
    RAISE EXCEPTION 'the closure of an opportunity in stage % cannot change', OLD.stage
      USING ERRCODE = 'check_violation',
        TABLE = 'opportunities',
        CONSTRAINT = 'opportunities_closure_immutable';
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
-- Cierre (DEC-034 §5): authenticated suma UPDATE sobre los metadatos del
-- cierre (por columna; loss_reason ya lo tenía desde 0008), cubierto por la
-- única policy de UPDATE (opportunities_update_stage) y validado por el
-- trigger y los CHECKs. El resto de las columnas sigue sin UPDATE (42501) y
-- DELETE sigue prohibido. app_runtime no recibe nada: solo escribe
-- asumiendo authenticated dentro de withTenant().
GRANT UPDATE ("loss_notes", "sale_price", "sale_currency", "payment_method", "delivery_status", "delivery_date") ON TABLE "public"."opportunities" TO "authenticated";--> statement-breakpoint
-- Custom SQL · postcondiciones de ADR-001 §3.6 sobre la base real, para toda
-- tabla de public: las de 0009, con los metadatos del cierre entre las
-- ediciones aprobadas, y las de DEC-034 §10: los CHECKs de cierre existen y
-- están validados, la función del trigger mantiene inmutable el cierre y la
-- unidad de la venta es de la misma organización (FK compuesta de 0009). Si
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
  -- updated_at), la del Hito 2 (opportunities.vehicle_id) y la de DEC-034
  -- (los metadatos del cierre). Un UPDATE de tabla, o sobre cualquier otra
  -- columna o tabla, no pasa: has_column_privilege también es verdadero con
  -- un grant de tabla.
  IF EXISTS (
    SELECT FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_attribute a
      ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
    WHERE c.relnamespace = 'public'::regnamespace
      AND c.relkind IN ('r', 'p')
      AND has_column_privilege('authenticated', c.oid, a.attnum, 'UPDATE')
      AND NOT (c.relname = 'vehicles' AND a.attname IN ('status', 'updated_at'))
      AND NOT (
        c.relname = 'opportunities'
        AND a.attname IN (
          'stage', 'loss_reason', 'vehicle_id', 'updated_at', 'loss_notes',
          'sale_price', 'sale_currency', 'payment_method', 'delivery_status',
          'delivery_date'
        )
      )
  ) THEN
    RAISE EXCEPTION 'ADR-001: authenticated may only update vehicles.status, vehicles.updated_at (H1.3C) and opportunities.stage, loss_reason, vehicle_id, updated_at and the closure metadata (H1.6, Hito 2, DEC-034)';
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

  -- DEC-034 §5: la función del trigger es la que mantiene inmutable el
  -- cierre (una versión anterior lo dejaría reescribir).
  IF NOT EXISTS (
    SELECT FROM pg_catalog.pg_proc p
    WHERE p.oid = 'private.enforce_opportunity_stage_transition()'::regprocedure
      AND position('opportunities_closure_immutable' in p.prosrc) > 0
  ) THEN
    RAISE EXCEPTION 'DEC-034: the stage transition trigger must keep the closure metadata immutable';
  END IF;

  -- DEC-034 §5: ninguna oportunidad se cierra sin sus metadatos. Los CHECKs
  -- de cierre existen y están validados sobre toda fila (NOT VALID no
  -- alcanza).
  IF (
    SELECT count(*) FROM pg_catalog.pg_constraint k
    WHERE k.conrelid = 'public.opportunities'::regclass
      AND k.contype = 'c'
      AND k.convalidated
      AND k.conname IN (
        'opportunities_won_closure_check',
        'opportunities_loss_reason_stage_check',
        'opportunities_loss_notes_stage_check',
        'opportunities_loss_reason_check',
        'opportunities_loss_notes_check',
        'opportunities_sale_price_check',
        'opportunities_sale_currency_check',
        'opportunities_payment_method_check',
        'opportunities_delivery_status_check',
        'opportunities_delivery_date_check'
      )
  ) <> 10 THEN
    RAISE EXCEPTION 'DEC-034: opportunities need the validated closure CHECK constraints';
  END IF;

  -- DEC-034 §3: la unidad de la venta es de la misma organización (FK
  -- compuesta de 0009, validada y RESTRICT).
  IF NOT EXISTS (
    SELECT FROM pg_catalog.pg_constraint k
    WHERE k.conrelid = 'public.opportunities'::regclass
      AND k.conname = 'opportunities_vehicle_fk'
      AND k.contype = 'f'
      AND k.convalidated
      AND k.confrelid = 'public.vehicles'::regclass
      AND k.confdeltype = 'r'
      AND k.conkey = ARRAY[
        (SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid = 'public.opportunities'::regclass AND attname = 'organization_id'),
        (SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid = 'public.opportunities'::regclass AND attname = 'vehicle_id')
      ]
      AND k.confkey = ARRAY[
        (SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid = 'public.vehicles'::regclass AND attname = 'organization_id'),
        (SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid = 'public.vehicles'::regclass AND attname = 'id')
      ]
  ) THEN
    RAISE EXCEPTION 'DEC-034: the sold vehicle must belong to the same organization (composite opportunities_vehicle_fk)';
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

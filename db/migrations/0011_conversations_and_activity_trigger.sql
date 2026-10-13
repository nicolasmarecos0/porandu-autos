-- Orden a mano (drizzle-kit lo genera después de la FK compuesta): la unique
-- (organization_id, id, contact_id) de opportunities tiene que existir antes
-- de la FK messages_opportunity_fk que la usa. Es segura sobre datos
-- existentes: id ya es PK.
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_organization_id_id_contact_id_key" UNIQUE("organization_id","id","contact_id");--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"opportunity_id" uuid,
	"channel" text NOT NULL,
	"direction" text NOT NULL,
	"content" text NOT NULL,
	"recorded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_channel_check" CHECK ("messages"."channel" IN ('whatsapp', 'email', 'manual')),
	CONSTRAINT "messages_direction_check" CHECK ("messages"."direction" IN ('inbound', 'outbound')),
	CONSTRAINT "messages_content_check" CHECK (char_length("messages"."content") BETWEEN 1 AND 4096 AND "messages"."content" = btrim("messages"."content", ' ' || chr(10)) AND translate("messages"."content", chr(10), '') !~ '[[:cntrl:]]')
);
--> statement-breakpoint
ALTER TABLE "messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_recorded_by_profiles_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_contact_fk" FOREIGN KEY ("organization_id","contact_id") REFERENCES "public"."contacts"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_opportunity_fk" FOREIGN KEY ("organization_id","opportunity_id","contact_id") REFERENCES "public"."opportunities"("organization_id","id","contact_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "messages_organization_id_opportunity_id_idx" ON "messages" USING btree ("organization_id","opportunity_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "messages_organization_id_contact_id_idx" ON "messages" USING btree ("organization_id","contact_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE POLICY "messages_select_member" ON "messages" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("messages"."organization_id" IN (SELECT private.user_org_ids()));--> statement-breakpoint
CREATE POLICY "messages_insert_member" ON "messages" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("messages"."organization_id" IN (SELECT private.user_org_ids()) AND "messages"."recorded_by" = (select auth.uid()) AND "messages"."created_at" = now());
--> statement-breakpoint
-- Custom SQL (no lo genera drizzle-kit) · DEC-036 §3 amplía DEC-032 §4,
-- DEC-033 §3 y DEC-034 §5: el trigger opportunities_stage_transition (misma
-- función, mismo nombre) acepta exactamente cuatro clases de UPDATE sobre
-- opportunities:
--   1. un pase de etapa de la máquina que no toca la unidad vinculada ni
--      `last_activity_at` (la matriz de domains/opportunities/stages.ts, sin
--      cambios), donde los metadatos de cierre solo cambian si el pase
--      cierra (`won` o `lost`);
--   2. un cambio de unidad vinculada (vehicle_id) sin pase, solo en
--      negotiating, que no toca `last_activity_at`;
--   3. un toque de actividad: solo cambia `last_activity_at`, avanza, vale
--      now() y viene del trigger de actividad de una nota o un mensaje
--      (pg_trigger_depth() > 1). No cambia `updated_at`: un toque no es una
--      edición de la oportunidad (DEC-036 §1);
--   4. nada más.
-- Todo lo demás se rechaza con 23514: constraint
-- opportunities_stage_transition si el pase no existe o la UPDATE no cambia
-- nada (como en 0008), opportunities_vehicle_link si cambia la unidad fuera
-- de negotiating o junto con un pase (como en 0009),
-- opportunities_closure_immutable si cambia un metadato de cierre fuera del
-- pase que cierra (como en 0010) y la nueva opportunities_activity_touch si
-- `last_activity_at` cambia de cualquier otra forma: un UPDATE directo, aun
-- del rol dueño, o junto con un pase o un cambio de unidad. Fija
-- `updated_at` con el reloj de la base en las clases 1 y 2. SET search_path
-- = '' y nada de tablas: solo mira OLD y NEW. CREATE OR REPLACE conserva el
-- owner y los privilegios (sin EXECUTE para nadie); el REVOKE se repite
-- igual, explícito.
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
  activity_changed boolean :=
    NEW.last_activity_at IS DISTINCT FROM OLD.last_activity_at;
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
    IF activity_changed THEN
      RAISE EXCEPTION 'a stage change cannot change last_activity_at'
        USING ERRCODE = 'check_violation',
          TABLE = 'opportunities',
          CONSTRAINT = 'opportunities_activity_touch';
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
    IF activity_changed THEN
      RAISE EXCEPTION 'a linked vehicle change cannot change last_activity_at'
        USING ERRCODE = 'check_violation',
          TABLE = 'opportunities',
          CONSTRAINT = 'opportunities_activity_touch';
    END IF;
  ELSIF closure_changed THEN
    RAISE EXCEPTION 'the closure of an opportunity in stage % cannot change', OLD.stage
      USING ERRCODE = 'check_violation',
        TABLE = 'opportunities',
        CONSTRAINT = 'opportunities_closure_immutable';
  ELSIF activity_changed THEN
    IF pg_trigger_depth() < 2
      OR NEW.last_activity_at <> now()
      OR NEW.last_activity_at <= OLD.last_activity_at
    THEN
      RAISE EXCEPTION 'last_activity_at only moves forward to now(), from the activity trigger of a new note or message'
        USING ERRCODE = 'check_violation',
          TABLE = 'opportunities',
          CONSTRAINT = 'opportunities_activity_touch';
    END IF;
    RETURN NEW;
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
-- Custom SQL · DEC-036 §1 y §2: el toque de actividad. Al insertar una nota
-- o un mensaje con oportunidad, su `last_activity_at` pasa a now() (el
-- reloj de la transacción, el mismo de recorded_at y created_at), solo si
-- avanza: dos registros en la misma transacción tocan una vez y una
-- transacción más vieja no la hace retroceder. Un mensaje sin oportunidad no
-- toca ninguna.
--
-- SECURITY DEFINER (owner postgres): authenticated no tiene UPDATE sobre
-- last_activity_at y no lo recibe. Vive en private (ADR-001 §3.6 prohíbe
-- SECURITY DEFINER solo en public; private.user_org_ids() es el precedente),
-- con search_path vacío y nombres calificados, y sin EXECUTE para nadie: una
-- función de trigger no se puede llamar directo. Solo toca la oportunidad
-- de la fila recién insertada (organization_id y opportunity_id de NEW), que
-- ya pasó la policy de INSERT (membership activa en esa organización) y la
-- FK compuesta: no cruza organizaciones. El trigger de transiciones valida
-- el toque (clase 3) también para el dueño.
CREATE FUNCTION "private"."touch_opportunity_activity"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.opportunity_id IS NOT NULL THEN
    UPDATE public.opportunities
    SET last_activity_at = now()
    WHERE organization_id = NEW.organization_id
      AND id = NEW.opportunity_id
      AND last_activity_at < now();
  END IF;
  RETURN NULL;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "private"."touch_opportunity_activity"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "opportunity_notes_touch_activity" AFTER INSERT ON "public"."opportunity_notes" FOR EACH ROW EXECUTE FUNCTION "private"."touch_opportunity_activity"();--> statement-breakpoint
CREATE TRIGGER "messages_touch_activity" AFTER INSERT ON "public"."messages" FOR EACH ROW EXECUTE FUNCTION "private"."touch_opportunity_activity"();--> statement-breakpoint
-- Custom SQL · ADR-001 §3.6: grants explícitos.
-- Mensajes (DEC-036 §5): append-only, como la demanda (0007) y la bitácora
-- (0009). 0000 ya revocó los default privileges de anon y authenticated
-- para lo que postgres crea en public; igual se revoca sobre esta tabla.
-- Diseño A (DEC-030 §9): authenticated recibe SELECT e INSERT de tabla,
-- porque Drizzle lista todas las columnas en el INSERT; lo que el cliente no
-- elige (organización con membership activa, autor = auth.uid(), reloj de la
-- base) lo controla el WITH CHECK. Sin UPDATE ni DELETE para anon,
-- authenticated y app_runtime, y tampoco para service_role (como C-11): los
-- default privileges de Supabase le dan ALL sobre lo nuevo de public. El
-- owner (postgres) es la limitación documentada. app_runtime no recibe nada:
-- solo escribe asumiendo authenticated dentro de withTenant().
REVOKE ALL ON TABLE "public"."messages" FROM "anon", "authenticated";--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE "public"."messages" TO "authenticated";--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "public"."messages" FROM "service_role";--> statement-breakpoint
-- Custom SQL · postcondiciones de ADR-001 §3.6 sobre la base real, para toda
-- tabla de public: las de 0010, con messages entre las altas aprobadas y
-- entre los ledgers append-only, y las de DEC-036: la función del trigger de
-- la oportunidad contiene la regla del toque, la función del toque es
-- SECURITY DEFINER de postgres, con search_path vacío y sin EXECUTE para
-- nadie, sus dos triggers existen habilitados y AFTER INSERT FOR EACH ROW, y
-- un mensaje es con un contacto y una oportunidad de la misma organización
-- (FKs compuestas validadas). Si alguna falla, la migración entera se
-- revierte y no se aplica nada.
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
  -- (los metadatos del cierre). El Hito 4 no agrega ninguna: el toque de
  -- actividad corre como dueño (DEC-036 §2) y last_activity_at sigue sin
  -- UPDATE para authenticated. Un UPDATE de tabla, o sobre cualquier otra
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

  -- DEC-036 §3: la función del trigger es la que valida el toque de
  -- actividad (una versión anterior lo rechazaría, y la recencia no se
  -- movería nunca).
  IF NOT EXISTS (
    SELECT FROM pg_catalog.pg_proc p
    WHERE p.oid = 'private.enforce_opportunity_stage_transition()'::regprocedure
      AND position('opportunities_activity_touch' in p.prosrc) > 0
  ) THEN
    RAISE EXCEPTION 'DEC-036: the stage transition trigger must validate the activity touch';
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

  -- DEC-036 §2: el toque corre como dueño. Tiene que ser SECURITY DEFINER
  -- de postgres (no de otro rol), con search_path vacío y sin EXECUTE para
  -- PUBLIC, anon, authenticated ni app_runtime.
  IF NOT EXISTS (
    SELECT FROM pg_catalog.pg_proc p
    WHERE p.oid = to_regprocedure('private.touch_opportunity_activity()')
      AND p.prosecdef
      AND p.proowner = 'postgres'::regrole
      AND p.proconfig = ARRAY['search_path=""']
      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('app_runtime', p.oid, 'EXECUTE')
      AND NOT EXISTS (
        SELECT FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
      )
  ) THEN
    RAISE EXCEPTION 'DEC-036: private.touch_opportunity_activity() must be SECURITY DEFINER owned by postgres, with an empty search_path and no EXECUTE for anyone';
  END IF;

  -- DEC-036 §1: una nota o un mensaje nuevos mueven la recencia. Los dos
  -- triggers AFTER INSERT FOR EACH ROW (tgtype 5) existen y están
  -- habilitados.
  IF (
    SELECT count(*) FROM pg_catalog.pg_trigger t
    WHERE NOT t.tgisinternal
      AND t.tgenabled = 'O'
      AND t.tgtype = 5
      AND t.tgfoid = to_regprocedure('private.touch_opportunity_activity()')
      AND (
        (t.tgrelid = 'public.opportunity_notes'::regclass AND t.tgname = 'opportunity_notes_touch_activity')
        OR (t.tgrelid = 'public.messages'::regclass AND t.tgname = 'messages_touch_activity')
      )
  ) <> 2 THEN
    RAISE EXCEPTION 'DEC-036: opportunity_notes and messages need the enabled AFTER INSERT activity triggers';
  END IF;

  -- DEC-036 §4: un mensaje es con un contacto de la misma organización y,
  -- si tiene oportunidad, con la de la misma organización y su contacto
  -- (FKs compuestas, validadas y RESTRICT).
  IF (
    SELECT count(*) FROM pg_catalog.pg_constraint k
    WHERE k.conrelid = 'public.messages'::regclass
      AND k.contype = 'f'
      AND k.convalidated
      AND k.confdeltype = 'r'
      AND (
        (k.conname = 'messages_contact_fk'
          AND k.confrelid = 'public.contacts'::regclass
          AND cardinality(k.conkey) = 2)
        OR (k.conname = 'messages_opportunity_fk'
          AND k.confrelid = 'public.opportunities'::regclass
          AND cardinality(k.conkey) = 3)
      )
  ) <> 2 THEN
    RAISE EXCEPTION 'DEC-036: messages need the composite contact and opportunity foreign keys';
  END IF;

  -- Las únicas altas aprobadas son las de H1.2 (contacts y opportunities),
  -- la de H1.3B (vehicles), la de H1.4 (opportunity_demand_facts), la del
  -- Hito 2 (opportunity_notes) y la del Hito 4 (messages): ninguna otra
  -- tabla recibe INSERT sin una migración que lo apruebe.
  IF EXISTS (
    SELECT FROM pg_catalog.pg_class c
    WHERE c.relnamespace = 'public'::regnamespace
      AND c.relkind IN ('r', 'p')
      AND c.relname NOT IN ('contacts', 'opportunities', 'vehicles', 'opportunity_demand_facts', 'opportunity_notes', 'messages')
      AND (
        has_table_privilege('authenticated', c.oid, 'INSERT')
        OR has_any_column_privilege('authenticated', c.oid, 'INSERT')
      )
  ) THEN
    RAISE EXCEPTION 'ADR-001: authenticated may only insert into contacts, opportunities, vehicles, opportunity_demand_facts (H1.4), opportunity_notes (Hito 2) and messages (Hito 4)';
  END IF;

  -- Ledgers append-only (H1.4, Hito 2 y Hito 4): ninguna policy de UPDATE,
  -- DELETE ni ALL.
  IF EXISTS (
    SELECT FROM pg_catalog.pg_policies pol
    WHERE pol.schemaname = 'public'
      AND pol.tablename IN ('opportunity_demand_facts', 'opportunity_notes', 'messages')
      AND pol.cmd IN ('UPDATE', 'DELETE', 'ALL')
  ) THEN
    RAISE EXCEPTION 'ADR-001: opportunity_demand_facts, opportunity_notes and messages are append-only: no UPDATE, DELETE or ALL policies';
  END IF;

  -- Explícito para las tres tablas, aunque la regla de ediciones de arriba
  -- ya lo cubra hoy: sobrevive a que se amplíen las ediciones aprobadas.
  IF EXISTS (
    SELECT FROM pg_catalog.pg_attribute a
    WHERE a.attrelid IN (
        'public.opportunity_demand_facts'::regclass,
        'public.opportunity_notes'::regclass,
        'public.messages'::regclass
      )
      AND a.attnum > 0
      AND NOT a.attisdropped
      AND has_column_privilege('authenticated', a.attrelid, a.attnum, 'UPDATE')
  ) THEN
    RAISE EXCEPTION 'ADR-001: authenticated must not update opportunity_demand_facts, opportunity_notes or messages';
  END IF;

  -- C-11: append-only también frente a service_role.
  IF EXISTS (
    SELECT FROM unnest(ARRAY['public.opportunity_demand_facts', 'public.opportunity_notes', 'public.messages']) AS t(name)
    CROSS JOIN unnest(ARRAY['UPDATE', 'DELETE', 'TRUNCATE']) AS p(privilege)
    WHERE has_table_privilege('service_role', t.name, p.privilege)
      OR (
        p.privilege = 'UPDATE'
        AND has_any_column_privilege('service_role', t.name, p.privilege)
      )
  ) THEN
    RAISE EXCEPTION 'ADR-001: service_role must not update, delete or truncate opportunity_demand_facts, opportunity_notes or messages';
  END IF;
END
$$;

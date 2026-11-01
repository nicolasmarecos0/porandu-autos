-- Orden a mano (drizzle-kit la genera después de la FK compuesta): la unique
-- (organization_id, id) de conversations tiene que existir antes de la FK
-- conversation_reads_conversation_fk que la usa. Es segura sobre datos
-- existentes: id ya es PK.
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_organization_id_id_key" UNIQUE("organization_id","id");--> statement-breakpoint
CREATE TABLE "conversation_reads" (
	"organization_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"read_up_to" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_reads_pkey" PRIMARY KEY("organization_id","conversation_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "conversation_reads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "conversation_reads" ADD CONSTRAINT "conversation_reads_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_reads" ADD CONSTRAINT "conversation_reads_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_reads" ADD CONSTRAINT "conversation_reads_conversation_fk" FOREIGN KEY ("organization_id","conversation_id") REFERENCES "public"."conversations"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "messages_organization_id_conversation_id_idx" ON "messages" USING btree ("organization_id","conversation_id","created_at") WHERE "messages"."conversation_id" IS NOT NULL;--> statement-breakpoint
CREATE POLICY "conversation_reads_select_own" ON "conversation_reads" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("conversation_reads"."organization_id" IN (SELECT private.user_org_ids()) AND "conversation_reads"."user_id" = (select auth.uid()));--> statement-breakpoint
-- Custom SQL (no lo genera drizzle-kit) · DEC-044 §2: marcar visto una
-- conversación. Es la única escritura de conversation_reads: los miembros
-- solo leen sus filas. Corre como dueño (SECURITY DEFINER, owner postgres),
-- con search_path vacío y EXECUTE solo para authenticated, dentro de
-- withTenant(). En una sola transacción:
--   1. sin usuario en los claims, 42501 (read_requires_user): la identidad
--      de la ingesta (DEC-039 §4) no lee. Sin todos los argumentos, 22004;
--   2. la organización tiene que estar entre las de membership activa del
--      usuario (private.user_org_ids()); si no, 42501 (read_not_member);
--   3. la conversación abierta de esa organización y un mensaje de ella; si
--      no, not_found, sin distinguir;
--   4. el cursor es el created_at (reloj de la base) de ese mensaje, nunca
--      now(), sent_at ni un reloj del cliente;
--   5. solo avanza (GREATEST, DEC-044 §2.5): marcar un mensaje más viejo, o
--      el mismo otra vez, no escribe nada (unchanged). Idempotente, también
--      con dos marcas simultáneas del mismo miembro (ON CONFLICT bajo el
--      bloqueo de la fila).
-- Devuelve el resultado (marked, unchanged o not_found) y el cursor vigente.
CREATE FUNCTION "private"."mark_conversation_read"(
  "p_organization_id" uuid,
  "p_conversation_id" uuid,
  "p_message_id" uuid
)
RETURNS TABLE (
  "outcome" text,
  "read_up_to" timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_user_id uuid;
  v_message_created_at timestamp with time zone;
  v_read_up_to timestamp with time zone;
BEGIN
  v_user_id := (SELECT auth.uid());
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'marking a conversation as read requires a user (read_requires_user)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_organization_id IS NULL OR p_conversation_id IS NULL
    OR p_message_id IS NULL
  THEN
    RAISE EXCEPTION 'every argument of a read mark is required'
      USING ERRCODE = 'null_value_not_allowed';
  END IF;

  IF NOT (p_organization_id IN (SELECT private.user_org_ids())) THEN
    RAISE EXCEPTION 'only an active member of the organization marks its conversations as read (read_not_member)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT m.created_at INTO v_message_created_at
  FROM public.conversations AS cv
  JOIN public.messages AS m
    ON m.organization_id = cv.organization_id
    AND m.conversation_id = cv.id
  WHERE cv.organization_id = p_organization_id
    AND cv.id = p_conversation_id
    AND cv.status = 'open'
    AND m.id = p_message_id;
  IF v_message_created_at IS NULL THEN
    RETURN QUERY SELECT 'not_found'::text, NULL::timestamp with time zone;
    RETURN;
  END IF;

  INSERT INTO public.conversation_reads AS r (organization_id,
    conversation_id, user_id, read_up_to, updated_at)
  VALUES (p_organization_id, p_conversation_id, v_user_id,
    v_message_created_at, now())
  ON CONFLICT (organization_id, conversation_id, user_id) DO UPDATE
  SET read_up_to = GREATEST(r.read_up_to, EXCLUDED.read_up_to),
    updated_at = now()
  WHERE r.read_up_to < EXCLUDED.read_up_to
  RETURNING r.read_up_to INTO v_read_up_to;

  IF v_read_up_to IS NOT NULL THEN
    RETURN QUERY SELECT 'marked'::text, v_read_up_to;
    RETURN;
  END IF;

  SELECT r.read_up_to INTO v_read_up_to
  FROM public.conversation_reads AS r
  WHERE r.organization_id = p_organization_id
    AND r.conversation_id = p_conversation_id
    AND r.user_id = v_user_id;
  RETURN QUERY SELECT 'unchanged'::text, v_read_up_to;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "private"."mark_conversation_read"(uuid, uuid, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "private"."mark_conversation_read"(uuid, uuid, uuid) TO "authenticated";--> statement-breakpoint
-- Custom SQL · ADR-001 §3.6: grants explícitos (DEC-044 §2.9). Los miembros
-- leen solo sus cursores (cubierto por conversation_reads_select_own); el
-- alta y el avance los hace private.mark_conversation_read(), como dueña.
-- Sin INSERT, UPDATE ni DELETE para authenticated. anon y app_runtime no
-- reciben nada.
REVOKE ALL ON TABLE "public"."conversation_reads" FROM "anon", "authenticated";--> statement-breakpoint
GRANT SELECT ON TABLE "public"."conversation_reads" TO "authenticated";--> statement-breakpoint
-- Custom SQL · postcondiciones de ADR-001 §3.6 sobre la base real, para toda
-- tabla de public: las de 0016, con conversation_reads leída por los
-- miembros (sin altas ni ediciones de authenticated), la de 0017 (el índice
-- de los cierres del dashboard) y las de DEC-044: conversation_reads tiene
-- solo la policy de lectura de las filas propias y el SELECT de
-- authenticated; su PK y sus FKs (la compuesta a la conversación, validada
-- y RESTRICT); la unique (organization_id, id) de conversations; el índice
-- parcial de los no leídos; y la función de marcar visto, SECURITY DEFINER
-- de postgres, con search_path vacío, EXECUTE solo para authenticated, las
-- reglas que exigen un miembro activo y el cursor que solo avanza. Si
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
  -- updated_at), la del Hito 2 (opportunities.vehicle_id), la de DEC-034
  -- (los metadatos del cierre), las del Hito 6 (DEC-038: organizations.name,
  -- default_currency y su updated_at; memberships.role, active y su
  -- updated_at), la del Hito 9 (DEC-041: test_drives.status y su
  -- updated_at) y la del Hito 10 (DEC-042: quotes.status y su updated_at).
  -- Un UPDATE de tabla, o sobre cualquier otra columna o tabla, no pasa:
  -- has_column_privilege también es verdadero con un grant de tabla.
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
      AND NOT (
        c.relname = 'organizations'
        AND a.attname IN ('name', 'default_currency', 'updated_at')
      )
      AND NOT (
        c.relname = 'memberships'
        AND a.attname IN ('role', 'active', 'updated_at')
      )
      AND NOT (
        c.relname = 'test_drives'
        AND a.attname IN ('status', 'updated_at')
      )
      AND NOT (
        c.relname = 'quotes'
        AND a.attname IN ('status', 'updated_at')
      )
  ) THEN
    RAISE EXCEPTION 'ADR-001: authenticated may only update vehicles.status, vehicles.updated_at (H1.3C), opportunities.stage, loss_reason, vehicle_id, updated_at and the closure metadata (H1.6, Hito 2, DEC-034), organizations.name, default_currency, updated_at and memberships.role, active, updated_at (Hito 6, DEC-038), test_drives.status, updated_at (Hito 9, DEC-041) and quotes.status, updated_at (Hito 10, DEC-042)';
  END IF;

  -- DEC-038 §4: la edición de memberships y de organizations se valida a
  -- nivel de base de datos. El UPDATE solo es seguro con sus triggers
  -- BEFORE UPDATE FOR EACH ROW (tgtype 19) habilitados.
  IF (
    SELECT count(*) FROM pg_catalog.pg_trigger t
    WHERE NOT t.tgisinternal
      AND t.tgenabled = 'O'
      AND t.tgtype = 19
      AND (
        (t.tgrelid = 'public.memberships'::regclass
          AND t.tgname = 'memberships_change_guard'
          AND t.tgfoid = to_regprocedure('private.enforce_membership_change()'))
        OR (t.tgrelid = 'public.organizations'::regclass
          AND t.tgname = 'organizations_update_guard'
          AND t.tgfoid = to_regprocedure('private.enforce_organization_update()'))
      )
  ) <> 2 THEN
    RAISE EXCEPTION 'DEC-038: memberships and organizations need their enabled BEFORE UPDATE guard triggers';
  END IF;

  -- DEC-038 §4: el trigger de memberships corre como dueño. Tiene que ser
  -- SECURITY DEFINER de postgres, con search_path vacío y sin EXECUTE para
  -- nadie.
  IF NOT EXISTS (
    SELECT FROM pg_catalog.pg_proc p
    WHERE p.oid = to_regprocedure('private.enforce_membership_change()')
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
    RAISE EXCEPTION 'DEC-038: private.enforce_membership_change() must be SECURITY DEFINER owned by postgres, with an empty search_path and no EXECUTE for anyone';
  END IF;

  -- DEC-038 §3, §4 y §6: las funciones que llama authenticated son SECURITY
  -- DEFINER de postgres, con search_path vacío y EXECUTE solo para
  -- authenticated (ni PUBLIC, ni anon, ni app_runtime).
  IF (
    SELECT count(*) FROM pg_catalog.pg_proc p
    WHERE p.oid IN (
        to_regprocedure('private.user_admin_org_ids()'),
        to_regprocedure('private.find_member_candidate(uuid, text)'),
        to_regprocedure('private.organization_members(uuid)')
      )
      AND p.prosecdef
      AND p.proowner = 'postgres'::regrole
      AND p.proconfig = ARRAY['search_path=""']
      AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('app_runtime', p.oid, 'EXECUTE')
      AND NOT EXISTS (
        SELECT FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
      )
  ) <> 3 THEN
    RAISE EXCEPTION 'DEC-038: private.user_admin_org_ids(), find_member_candidate() and organization_members() must be SECURITY DEFINER owned by postgres, with an empty search_path and EXECUTE only for authenticated';
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

  -- DEC-036 §4 y DEC-039 §10: un mensaje es con un contacto de la misma
  -- organización y, si tiene oportunidad o conversación, con las de la
  -- misma organización y su contacto (FKs compuestas, validadas y
  -- RESTRICT).
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
        OR (k.conname = 'messages_conversation_fk'
          AND k.confrelid = 'public.conversations'::regclass
          AND cardinality(k.conkey) = 3)
      )
  ) <> 3 THEN
    RAISE EXCEPTION 'DEC-039: messages need the composite contact, opportunity and conversation foreign keys';
  END IF;

  -- Las únicas altas aprobadas son las de H1.2 (contacts y opportunities),
  -- la de H1.3B (vehicles), la de H1.4 (opportunity_demand_facts), la del
  -- Hito 2 (opportunity_notes), la del Hito 4 (messages), la del Hito 6
  -- (memberships, DEC-038), la del Hito 9 (test_drives, DEC-041) y la del
  -- Hito 10 (quotes, DEC-042): ninguna otra tabla recibe INSERT sin una
  -- migración que lo apruebe.
  IF EXISTS (
    SELECT FROM pg_catalog.pg_class c
    WHERE c.relnamespace = 'public'::regnamespace
      AND c.relkind IN ('r', 'p')
      AND c.relname NOT IN ('contacts', 'opportunities', 'vehicles', 'opportunity_demand_facts', 'opportunity_notes', 'messages', 'memberships', 'test_drives', 'quotes')
      AND (
        has_table_privilege('authenticated', c.oid, 'INSERT')
        OR has_any_column_privilege('authenticated', c.oid, 'INSERT')
      )
  ) THEN
    RAISE EXCEPTION 'ADR-001: authenticated may only insert into contacts, opportunities, vehicles, opportunity_demand_facts (H1.4), opportunity_notes (Hito 2), messages (Hito 4), memberships (Hito 6), test_drives (Hito 9) and quotes (Hito 10)';
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

  -- ADR-001 §2 (DEC-039 §4 no lo cambia): app_runtime sigue LOGIN NOINHERIT
  -- NOBYPASSRLS y miembro solo de authenticated, WITH INHERIT FALSE y sin
  -- ADMIN OPTION. La ingesta no agrega roles ni memberships.
  IF EXISTS (
    SELECT FROM pg_catalog.pg_roles
    WHERE rolname = 'app_runtime'
      AND (rolsuper OR rolbypassrls OR rolinherit OR rolcreaterole
        OR rolcreatedb OR rolreplication OR NOT rolcanlogin)
  ) OR EXISTS (
    SELECT FROM pg_catalog.pg_auth_members
    WHERE member = 'app_runtime'::regrole
      AND (roleid <> 'authenticated'::regrole OR inherit_option OR admin_option)
  ) THEN
    RAISE EXCEPTION 'ADR-001: app_runtime must be LOGIN NOINHERIT NOBYPASSRLS and only a member of authenticated, WITH INHERIT FALSE and without ADMIN OPTION';
  END IF;

  -- DEC-039 §4 y §7: la ingesta corre como dueño. Tiene que ser SECURITY
  -- DEFINER de postgres, con search_path vacío, EXECUTE solo para
  -- authenticated (ni PUBLIC, ni anon, ni app_runtime) y la regla que
  -- rechaza una llamada con claims (una versión sin ella dejaría ingerir a
  -- un miembro).
  IF NOT EXISTS (
    SELECT FROM pg_catalog.pg_proc p
    WHERE p.oid = to_regprocedure('private.ingest_whatsapp_message(text, text, text, text, text, text, text, timestamp with time zone)')
      AND p.prosecdef
      AND p.proowner = 'postgres'::regrole
      AND p.proconfig = ARRAY['search_path=""']
      AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('app_runtime', p.oid, 'EXECUTE')
      AND NOT EXISTS (
        SELECT FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
      )
      AND position('ingestion_without_user' in p.prosrc) > 0
  ) THEN
    RAISE EXCEPTION 'DEC-039: private.ingest_whatsapp_message() must be SECURITY DEFINER owned by postgres, with an empty search_path, EXECUTE only for authenticated and the rule that rejects calls with claims';
  END IF;

  -- DEC-040 §4 (supersede DEC-039 §5 en la lectura): los miembros leen las
  -- líneas de su organización y nada más. Una sola policy, la de lectura de
  -- miembros, y ningún privilegio de authenticated sobre whatsapp_lines
  -- salvo SELECT: las altas, ediciones y bajas siguen siendo de
  -- provisioning.
  IF (
    SELECT count(*) FROM pg_catalog.pg_policies pol
    WHERE pol.schemaname = 'public' AND pol.tablename = 'whatsapp_lines'
  ) <> 1 OR NOT EXISTS (
    SELECT FROM pg_catalog.pg_policies pol
    WHERE pol.schemaname = 'public'
      AND pol.tablename = 'whatsapp_lines'
      AND pol.policyname = 'whatsapp_lines_select_member'
      AND pol.permissive = 'PERMISSIVE'
      AND pol.cmd = 'SELECT'
      AND pol.roles = ARRAY['authenticated']::name[]
      AND pol.qual = '(organization_id IN ( SELECT private.user_org_ids() AS user_org_ids))'
  ) OR EXISTS (
    SELECT FROM unnest(ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) AS p(privilege)
    WHERE has_table_privilege('authenticated', 'public.whatsapp_lines', p.privilege)
      OR (
        p.privilege IN ('INSERT', 'UPDATE', 'REFERENCES')
        AND has_any_column_privilege('authenticated', 'public.whatsapp_lines', p.privilege)
      )
  ) THEN
    RAISE EXCEPTION 'DEC-040: whatsapp_lines is read-only for members: only the whatsapp_lines_select_member policy and no write privileges for authenticated';
  END IF;

  -- DEC-040 §6: el envío corre como dueño. Tiene que ser SECURITY DEFINER
  -- de postgres, con search_path vacío, EXECUTE solo para authenticated (ni
  -- PUBLIC, ni anon, ni app_runtime) y la regla que exige un usuario (una
  -- versión sin ella dejaría escribir a la identidad sin claims).
  IF NOT EXISTS (
    SELECT FROM pg_catalog.pg_proc p
    WHERE p.oid = to_regprocedure('private.record_outbound_whatsapp_message(uuid, uuid, text, text, text)')
      AND p.prosecdef
      AND p.proowner = 'postgres'::regrole
      AND p.proconfig = ARRAY['search_path=""']
      AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('app_runtime', p.oid, 'EXECUTE')
      AND NOT EXISTS (
        SELECT FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
      )
      AND position('outbound_requires_user' in p.prosrc) > 0
      AND position('outbound_not_member' in p.prosrc) > 0
  ) THEN
    RAISE EXCEPTION 'DEC-040: private.record_outbound_whatsapp_message() must be SECURITY DEFINER owned by postgres, with an empty search_path, EXECUTE only for authenticated and the rules that require an active member';
  END IF;

  -- DEC-040 §7: un miembro registra a mano solo mensajes sin conversación.
  -- Los de una conversación los escriben las funciones de ingesta y de
  -- envío.
  IF NOT EXISTS (
    SELECT FROM pg_catalog.pg_policies pol
    WHERE pol.schemaname = 'public'
      AND pol.tablename = 'messages'
      AND pol.policyname = 'messages_insert_member'
      AND pol.cmd = 'INSERT'
      AND position('(conversation_id IS NULL)' in pol.with_check) > 0
  ) THEN
    RAISE EXCEPTION 'DEC-040: the member insert policy on messages must require conversation_id IS NULL';
  END IF;

  -- DEC-039 §6 y §10: un mensaje lo registró un miembro o lo ingirió la
  -- función (CHECK de origen validado), y la conversación es del mismo
  -- contacto y de la misma organización (FK compuesta validada).
  IF NOT EXISTS (
    SELECT FROM pg_catalog.pg_constraint k
    WHERE k.conrelid = 'public.messages'::regclass
      AND k.conname = 'messages_source_check'
      AND k.contype = 'c'
      AND k.convalidated
  ) OR NOT EXISTS (
    SELECT FROM pg_catalog.pg_constraint k
    WHERE k.conrelid = 'public.conversations'::regclass
      AND k.conname = 'conversations_contact_fk'
      AND k.contype = 'f'
      AND k.convalidated
      AND k.confdeltype = 'r'
      AND k.confrelid = 'public.contacts'::regclass
      AND cardinality(k.conkey) = 2
  ) THEN
    RAISE EXCEPTION 'DEC-039: messages need the validated source CHECK and conversations the composite contact foreign key';
  END IF;

  -- DEC-039 §8: la unicidad de la base es la autoridad de la idempotencia
  -- (un mensaje del proveedor, una fila) y de la conversación abierta (una
  -- por contacto y canal).
  IF (
    SELECT count(*) FROM pg_catalog.pg_index i
    JOIN pg_catalog.pg_class c ON c.oid = i.indexrelid
    WHERE c.relnamespace = 'public'::regnamespace
      AND i.indisunique
      AND i.indisvalid
      AND (
        (c.relname = 'messages_organization_id_external_id_key'
          AND i.indrelid = 'public.messages'::regclass)
        OR (c.relname = 'conversations_open_contact_channel_key'
          AND i.indrelid = 'public.conversations'::regclass)
      )
  ) <> 2 THEN
    RAISE EXCEPTION 'DEC-039: messages need the unique external id index and conversations the unique open conversation index';
  END IF;

  -- DEC-041 §3: un cambio de estado de una prueba de manejo se valida a
  -- nivel de base de datos. El UPDATE solo es seguro con el trigger BEFORE
  -- UPDATE FOR EACH ROW (tgtype 19) habilitado, y con la función que exige
  -- la matriz, la hora agendada y la inmutabilidad del resto de la fila.
  IF NOT EXISTS (
    SELECT FROM pg_catalog.pg_trigger t
    WHERE t.tgrelid = 'public.test_drives'::regclass
      AND t.tgname = 'test_drives_status_transition'
      AND NOT t.tgisinternal
      AND t.tgenabled = 'O'
      AND t.tgtype = 19
      AND t.tgfoid = to_regprocedure('private.enforce_test_drive_status_transition()')
  ) OR NOT EXISTS (
    SELECT FROM pg_catalog.pg_proc p
    WHERE p.oid = to_regprocedure('private.enforce_test_drive_status_transition()')
      AND NOT p.prosecdef
      AND p.proconfig = ARRAY['search_path=""']
      AND position('test_drives_status_transition' in p.prosrc) > 0
      AND position('test_drives_not_started' in p.prosrc) > 0
      AND position('test_drives_immutable' in p.prosrc) > 0
      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('app_runtime', p.oid, 'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'DEC-041: test_drives needs the enabled BEFORE UPDATE status transition trigger';
  END IF;

  -- DEC-041 §2: la prueba es de un cliente y de una unidad de la misma
  -- organización (FKs compuestas, validadas y RESTRICT).
  IF (
    SELECT count(*) FROM pg_catalog.pg_constraint k
    WHERE k.conrelid = 'public.test_drives'::regclass
      AND k.contype = 'f'
      AND k.convalidated
      AND k.confdeltype = 'r'
      AND cardinality(k.conkey) = 2
      AND (
        (k.conname = 'test_drives_opportunity_fk'
          AND k.confrelid = 'public.opportunities'::regclass)
        OR (k.conname = 'test_drives_vehicle_fk'
          AND k.confrelid = 'public.vehicles'::regclass)
      )
  ) <> 2 THEN
    RAISE EXCEPTION 'DEC-041: test_drives needs the composite opportunity and vehicle foreign keys';
  END IF;

  -- DEC-042 §5: el número y el estado de una cotización se validan a nivel
  -- de base de datos. Los dos triggers (BEFORE INSERT FOR EACH ROW, tgtype
  -- 7, y BEFORE UPDATE FOR EACH ROW, tgtype 19) existen y están
  -- habilitados, con sus funciones SECURITY INVOKER, search_path vacío, las
  -- reglas que exige DEC-042 y sin EXECUTE para nadie.
  IF (
    SELECT count(*) FROM pg_catalog.pg_trigger t
    WHERE t.tgrelid = 'public.quotes'::regclass
      AND NOT t.tgisinternal
      AND t.tgenabled = 'O'
      AND (
        (t.tgname = 'quotes_assign_number'
          AND t.tgtype = 7
          AND t.tgfoid = to_regprocedure('private.assign_quote_number()'))
        OR (t.tgname = 'quotes_status_transition'
          AND t.tgtype = 19
          AND t.tgfoid = to_regprocedure('private.enforce_quote_status_transition()'))
      )
  ) <> 2 OR (
    SELECT count(*) FROM pg_catalog.pg_proc p
    WHERE p.oid IN (
        to_regprocedure('private.assign_quote_number()'),
        to_regprocedure('private.enforce_quote_status_transition()')
      )
      AND NOT p.prosecdef
      AND p.proconfig = ARRAY['search_path=""']
      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('app_runtime', p.oid, 'EXECUTE')
  ) <> 2 OR NOT EXISTS (
    SELECT FROM pg_catalog.pg_proc p
    WHERE p.oid = to_regprocedure('private.enforce_quote_status_transition()')
      AND position('quotes_status_transition' in p.prosrc) > 0
      AND position('quotes_immutable' in p.prosrc) > 0
      AND position('quotes_expired' in p.prosrc) > 0
      AND position('quotes_opportunity_closed' in p.prosrc) > 0
      AND position('quotes_vehicle_unavailable' in p.prosrc) > 0
      AND position('quotes_discount_requires_admin' in p.prosrc) > 0
      AND position('quotes_approval_requires_user' in p.prosrc) > 0
  ) THEN
    RAISE EXCEPTION 'DEC-042: quotes need the enabled numbering and status transition triggers with their rules';
  END IF;

  -- DEC-042 §3: la cotización es de un cliente y de una unidad de la misma
  -- organización (FKs compuestas, validadas y RESTRICT).
  IF (
    SELECT count(*) FROM pg_catalog.pg_constraint k
    WHERE k.conrelid = 'public.quotes'::regclass
      AND k.contype = 'f'
      AND k.convalidated
      AND k.confdeltype = 'r'
      AND cardinality(k.conkey) = 2
      AND (
        (k.conname = 'quotes_opportunity_fk'
          AND k.confrelid = 'public.opportunities'::regclass)
        OR (k.conname = 'quotes_vehicle_fk'
          AND k.confrelid = 'public.vehicles'::regclass)
      )
  ) <> 2 THEN
    RAISE EXCEPTION 'DEC-042: quotes need the composite opportunity and vehicle foreign keys';
  END IF;

  -- DEC-042 §3: ningún total queda inconsistente con su lista y su
  -- descuento, ni los sellos con el estado. Los CHECKs existen y están
  -- validados.
  IF (
    SELECT count(*) FROM pg_catalog.pg_constraint k
    WHERE k.conrelid = 'public.quotes'::regclass
      AND k.contype = 'c'
      AND k.convalidated
      AND k.conname IN (
        'quotes_status_check',
        'quotes_currency_check',
        'quotes_discount_kind_check',
        'quotes_number_check',
        'quotes_list_price_check',
        'quotes_discount_check',
        'quotes_total_price_check',
        'quotes_valid_until_check',
        'quotes_notes_check',
        'quotes_approved_stamp_check',
        'quotes_sent_stamp_check',
        'quotes_decided_stamp_check'
      )
  ) <> 12 THEN
    RAISE EXCEPTION 'DEC-042: quotes need the validated price, discount, validity and stamp CHECK constraints';
  END IF;

  -- DEC-042 §2 y §5: un número por organización y a lo sumo una cotización
  -- aceptada por oportunidad (índices únicos válidos).
  IF (
    SELECT count(*) FROM pg_catalog.pg_index i
    JOIN pg_catalog.pg_class c ON c.oid = i.indexrelid
    WHERE i.indrelid = 'public.quotes'::regclass
      AND i.indisunique
      AND i.indisvalid
      AND (
        c.relname = 'quotes_organization_id_number_key'
        OR (c.relname = 'quotes_accepted_opportunity_key' AND i.indpred IS NOT NULL)
      )
  ) <> 2 THEN
    RAISE EXCEPTION 'DEC-042: quotes need the unique number per organization and the unique accepted quote per opportunity';
  END IF;

  -- DEC-043 §7 (0017): los cierres de un rango del Dashboard Directivo leen
  -- el índice parcial válido, no único, sobre (organization_id, updated_at)
  -- de las etapas won y lost.
  IF NOT EXISTS (
    SELECT FROM pg_catalog.pg_index i
    JOIN pg_catalog.pg_class c ON c.oid = i.indexrelid
    WHERE i.indrelid = 'public.opportunities'::regclass
      AND c.relname = 'opportunities_organization_id_closed_at_idx'
      AND c.relnamespace = 'public'::regnamespace
      AND i.indisvalid
      AND i.indisready
      AND NOT i.indisunique
      AND i.indnatts = 2
      AND i.indkey[0] = (
        SELECT a.attnum FROM pg_catalog.pg_attribute a
        WHERE a.attrelid = 'public.opportunities'::regclass
          AND a.attname = 'organization_id'
          AND NOT a.attisdropped
      )
      AND i.indkey[1] = (
        SELECT a.attnum FROM pg_catalog.pg_attribute a
        WHERE a.attrelid = 'public.opportunities'::regclass
          AND a.attname = 'updated_at'
          AND NOT a.attisdropped
      )
      AND pg_catalog.pg_get_expr(i.indpred, i.indrelid)
        = '(stage = ANY (ARRAY[''won''::text, ''lost''::text]))'
  ) THEN
    RAISE EXCEPTION 'DEC-043: opportunities need the valid partial index on (organization_id, updated_at) for won and lost closures';
  END IF;

  -- DEC-044 §2.1 y §2.9: cada miembro lee solo sus cursores, de las
  -- organizaciones con membership activa. Una sola policy, la de lectura de
  -- las filas propias, y ningún privilegio de authenticated sobre
  -- conversation_reads salvo SELECT: el alta y el avance los hace la función
  -- de marcar visto.
  IF (
    SELECT count(*) FROM pg_catalog.pg_policies pol
    WHERE pol.schemaname = 'public' AND pol.tablename = 'conversation_reads'
  ) <> 1 OR NOT EXISTS (
    SELECT FROM pg_catalog.pg_policies pol
    WHERE pol.schemaname = 'public'
      AND pol.tablename = 'conversation_reads'
      AND pol.policyname = 'conversation_reads_select_own'
      AND pol.permissive = 'PERMISSIVE'
      AND pol.cmd = 'SELECT'
      AND pol.roles = ARRAY['authenticated']::name[]
      AND pol.qual = '((organization_id IN ( SELECT private.user_org_ids() AS user_org_ids)) AND (user_id = ( SELECT auth.uid() AS uid)))'
  ) OR NOT has_table_privilege('authenticated', 'public.conversation_reads', 'SELECT')
  OR EXISTS (
    SELECT FROM unnest(ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) AS p(privilege)
    WHERE has_table_privilege('authenticated', 'public.conversation_reads', p.privilege)
      OR (
        p.privilege IN ('INSERT', 'UPDATE', 'REFERENCES')
        AND has_any_column_privilege('authenticated', 'public.conversation_reads', p.privilege)
      )
  ) THEN
    RAISE EXCEPTION 'DEC-044: conversation_reads is read-only for members and only their own rows: only the conversation_reads_select_own policy and no write privileges for authenticated';
  END IF;

  -- DEC-044 §2.3 y §2.9: un cursor por miembro y conversación (PK
  -- (organization_id, conversation_id, user_id)), de una conversación de la
  -- misma organización (FK compuesta validada y RESTRICT sobre la unique
  -- (organization_id, id) de conversations) y de un perfil (CASCADE: el
  -- cursor es estado del miembro).
  IF NOT EXISTS (
    SELECT FROM pg_catalog.pg_constraint k
    WHERE k.conrelid = 'public.conversation_reads'::regclass
      AND k.conname = 'conversation_reads_pkey'
      AND k.contype = 'p'
      AND k.conkey = ARRAY[
        (SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid = 'public.conversation_reads'::regclass AND attname = 'organization_id'),
        (SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid = 'public.conversation_reads'::regclass AND attname = 'conversation_id'),
        (SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid = 'public.conversation_reads'::regclass AND attname = 'user_id')
      ]
  ) OR NOT EXISTS (
    SELECT FROM pg_catalog.pg_constraint k
    WHERE k.conrelid = 'public.conversation_reads'::regclass
      AND k.conname = 'conversation_reads_conversation_fk'
      AND k.contype = 'f'
      AND k.convalidated
      AND k.confdeltype = 'r'
      AND k.confrelid = 'public.conversations'::regclass
      AND k.conkey = ARRAY[
        (SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid = 'public.conversation_reads'::regclass AND attname = 'organization_id'),
        (SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid = 'public.conversation_reads'::regclass AND attname = 'conversation_id')
      ]
      AND k.confkey = ARRAY[
        (SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid = 'public.conversations'::regclass AND attname = 'organization_id'),
        (SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid = 'public.conversations'::regclass AND attname = 'id')
      ]
  ) OR NOT EXISTS (
    SELECT FROM pg_catalog.pg_constraint k
    WHERE k.conrelid = 'public.conversation_reads'::regclass
      AND k.contype = 'f'
      AND k.convalidated
      AND k.confdeltype = 'c'
      AND k.confrelid = 'public.profiles'::regclass
      AND k.conkey = ARRAY[
        (SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid = 'public.conversation_reads'::regclass AND attname = 'user_id')
      ]
  ) OR NOT EXISTS (
    SELECT FROM pg_catalog.pg_constraint k
    JOIN pg_catalog.pg_index i ON i.indexrelid = k.conindid
    WHERE k.conrelid = 'public.conversations'::regclass
      AND k.conname = 'conversations_organization_id_id_key'
      AND k.contype = 'u'
      AND i.indisvalid
      AND k.conkey = ARRAY[
        (SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid = 'public.conversations'::regclass AND attname = 'organization_id'),
        (SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid = 'public.conversations'::regclass AND attname = 'id')
      ]
  ) THEN
    RAISE EXCEPTION 'DEC-044: conversation_reads needs its primary key (organization_id, conversation_id, user_id), the composite conversation foreign key and the profile foreign key';
  END IF;

  -- DEC-044 §2.9: los no leídos de la bandeja se cuentan sobre el índice
  -- parcial válido, no único, de (organization_id, conversation_id,
  -- created_at) de los mensajes de una conversación.
  IF NOT EXISTS (
    SELECT FROM pg_catalog.pg_index i
    JOIN pg_catalog.pg_class c ON c.oid = i.indexrelid
    WHERE i.indrelid = 'public.messages'::regclass
      AND c.relname = 'messages_organization_id_conversation_id_idx'
      AND c.relnamespace = 'public'::regnamespace
      AND i.indisvalid
      AND i.indisready
      AND NOT i.indisunique
      AND i.indnatts = 3
      AND i.indkey[0] = (
        SELECT a.attnum FROM pg_catalog.pg_attribute a
        WHERE a.attrelid = 'public.messages'::regclass
          AND a.attname = 'organization_id'
          AND NOT a.attisdropped
      )
      AND i.indkey[1] = (
        SELECT a.attnum FROM pg_catalog.pg_attribute a
        WHERE a.attrelid = 'public.messages'::regclass
          AND a.attname = 'conversation_id'
          AND NOT a.attisdropped
      )
      AND i.indkey[2] = (
        SELECT a.attnum FROM pg_catalog.pg_attribute a
        WHERE a.attrelid = 'public.messages'::regclass
          AND a.attname = 'created_at'
          AND NOT a.attisdropped
      )
      AND pg_catalog.pg_get_expr(i.indpred, i.indrelid)
        = '(conversation_id IS NOT NULL)'
  ) THEN
    RAISE EXCEPTION 'DEC-044: messages need the valid partial index on (organization_id, conversation_id, created_at) for the unread counters';
  END IF;

  -- DEC-044 §2.3, §2.5 y §2.9: marcar visto corre como dueño. Tiene que ser
  -- SECURITY DEFINER de postgres, con search_path vacío, EXECUTE solo para
  -- authenticated (ni PUBLIC, ni anon, ni app_runtime), las reglas que
  -- exigen un miembro activo (una versión sin ellas dejaría marcar a la
  -- identidad sin claims o a un ex miembro) y el cursor que solo avanza.
  IF NOT EXISTS (
    SELECT FROM pg_catalog.pg_proc p
    WHERE p.oid = to_regprocedure('private.mark_conversation_read(uuid, uuid, uuid)')
      AND p.prosecdef
      AND p.proowner = 'postgres'::regrole
      AND p.proconfig = ARRAY['search_path=""']
      AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('app_runtime', p.oid, 'EXECUTE')
      AND NOT EXISTS (
        SELECT FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
      )
      AND position('read_requires_user' in p.prosrc) > 0
      AND position('read_not_member' in p.prosrc) > 0
      AND position('GREATEST(r.read_up_to, EXCLUDED.read_up_to)' in p.prosrc) > 0
  ) THEN
    RAISE EXCEPTION 'DEC-044: private.mark_conversation_read() must be SECURITY DEFINER owned by postgres, with an empty search_path, EXECUTE only for authenticated, the rules that require an active member and a cursor that only advances';
  END IF;
END
$$;

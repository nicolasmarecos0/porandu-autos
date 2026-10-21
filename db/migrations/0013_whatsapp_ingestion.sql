CREATE TABLE "whatsapp_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"phone_number_id" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_lines_phone_number_id_key" UNIQUE("phone_number_id"),
	CONSTRAINT "whatsapp_lines_phone_number_id_check" CHECK ("whatsapp_lines"."phone_number_id" ~ '^[0-9]{1,32}$')
);
--> statement-breakpoint
ALTER TABLE "whatsapp_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"last_message_at" timestamp with time zone,
	"last_message_preview" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversations_organization_id_id_contact_id_key" UNIQUE("organization_id","id","contact_id"),
	CONSTRAINT "conversations_channel_check" CHECK ("conversations"."channel" IN ('whatsapp')),
	CONSTRAINT "conversations_status_check" CHECK ("conversations"."status" IN ('open', 'closed')),
	CONSTRAINT "conversations_last_message_check" CHECK (("conversations"."last_message_at" IS NULL) = ("conversations"."last_message_preview" IS NULL)),
	CONSTRAINT "conversations_last_message_preview_check" CHECK (char_length("conversations"."last_message_preview") BETWEEN 1 AND 160 AND "conversations"."last_message_preview" = btrim("conversations"."last_message_preview") AND "conversations"."last_message_preview" !~ '[[:cntrl:]]')
);
--> statement-breakpoint
ALTER TABLE "conversations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "recorded_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "conversation_id" uuid;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "whatsapp_lines" ADD CONSTRAINT "whatsapp_lines_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_contact_fk" FOREIGN KEY ("organization_id","contact_id") REFERENCES "public"."contacts"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "whatsapp_lines_organization_id_idx" ON "whatsapp_lines" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_open_contact_channel_key" ON "conversations" USING btree ("organization_id","contact_id","channel") WHERE "conversations"."status" = 'open';--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_fk" FOREIGN KEY ("organization_id","conversation_id","contact_id") REFERENCES "public"."conversations"("organization_id","id","contact_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "messages_organization_id_external_id_key" ON "messages" USING btree ("organization_id","external_id") WHERE "messages"."external_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_external_id_check" CHECK (char_length("messages"."external_id") BETWEEN 1 AND 256 AND "messages"."external_id" !~ '[[:space:][:cntrl:]]');--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_source_check" CHECK (("messages"."recorded_by" IS NOT NULL AND "messages"."conversation_id" IS NULL AND "messages"."external_id" IS NULL AND "messages"."sent_at" IS NULL) OR ("messages"."recorded_by" IS NULL AND "messages"."conversation_id" IS NOT NULL AND "messages"."external_id" IS NOT NULL AND "messages"."sent_at" IS NOT NULL AND "messages"."channel" = 'whatsapp' AND "messages"."direction" = 'inbound'));--> statement-breakpoint
CREATE POLICY "conversations_select_member" ON "conversations" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("conversations"."organization_id" IN (SELECT private.user_org_ids()));
--> statement-breakpoint
-- DEC-039 §7 y §8: la ingesta de un mensaje entrante de WhatsApp, en la
-- transacción de withIngestion(). La organización sale solo de la línea
-- receptora (whatsapp_lines.phone_number_id); ningún parámetro la elige.
--   1. la línea activa → su organización; si no hay, unknown_line sin
--      escribir nada;
--   2. el id del proveedor ya registrado en esa organización → duplicate;
--   3. el contacto de la organización con ese teléfono E.164, o uno nuevo
--      (ON CONFLICT DO NOTHING y relectura, DEC-024 §3). Un contacto
--      existente no cambia;
--   4. la conversación abierta del contacto por WhatsApp, o una nueva (ON
--      CONFLICT DO NOTHING y relectura);
--   5. la oportunidad abierta (new, qualifying o negotiating) del contacto,
--      solo si hay exactamente una (DEC-039 §9);
--   6. el INSERT del mensaje (inbound, whatsapp, sin autor). Un choque con
--      la unique de idempotencia es duplicate;
--   7. el último mensaje de la conversación, solo si este no es más viejo
--      (UPDATE condicional bajo el bloqueo de la fila);
--   8. el trigger messages_touch_activity mueve la recencia de la
--      oportunidad, si la hay (DEC-036 §1).
-- La unicidad de la base es la autoridad ante dos mensajes simultáneos del
-- mismo número (contacto y conversación) y ante entregas repetidas
-- (mensaje): el segundo espera la confirmación del primero en el índice y
-- reutiliza lo que dejó. Las FKs compuestas impiden cruzar organizaciones.
--
-- Identidad de sistema (DEC-039 §4): authenticated sin claims, la que fija
-- withIngestion(). Con claims (un miembro, por withTenant()) la función
-- rechaza la llamada con 42501 antes de leer nada: sin usuario no hay
-- membership, y un miembro no puede ingerir en nombre de una línea.
--
-- SECURITY DEFINER (owner postgres): authenticated sin claims no ve ni
-- escribe ninguna fila (RLS), así que escribe solo a través de esta
-- función. Vive en private (ADR-001 §3.6), con search_path vacío y nombres
-- calificados. EXECUTE solo para authenticated. `#variable_conflict
-- use_column`: las columnas de salida se llaman como las de las tablas, y
-- en las queries manda la columna.
CREATE FUNCTION "private"."ingest_whatsapp_message"(
  "p_phone_number_id" text,
  "p_external_id" text,
  "p_phone" text,
  "p_phone_normalized" text,
  "p_contact_name" text,
  "p_content" text,
  "p_preview" text,
  "p_sent_at" timestamp with time zone
)
RETURNS TABLE (
  "outcome" text,
  "organization_id" uuid,
  "contact_id" uuid,
  "conversation_id" uuid,
  "opportunity_id" uuid,
  "message_id" uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_organization_id uuid;
  v_contact_id uuid;
  v_conversation_id uuid;
  v_opportunity_id uuid;
  v_message_id uuid;
  v_open_opportunities uuid[];
BEGIN
  IF nullif(current_setting('request.jwt.claims', true), '') IS NOT NULL
    OR nullif(current_setting('request.jwt.claim.sub', true), '') IS NOT NULL
  THEN
    RAISE EXCEPTION 'the ingestion runs without a user: no claims allowed (ingestion_without_user)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_phone_number_id IS NULL OR p_external_id IS NULL OR p_phone IS NULL
    OR p_phone_normalized IS NULL OR p_contact_name IS NULL
    OR p_content IS NULL OR p_preview IS NULL OR p_sent_at IS NULL
  THEN
    RAISE EXCEPTION 'every argument of an inbound message is required'
      USING ERRCODE = 'null_value_not_allowed';
  END IF;

  SELECT l.organization_id INTO v_organization_id
  FROM public.whatsapp_lines AS l
  WHERE l.phone_number_id = p_phone_number_id
    AND l.active;
  IF v_organization_id IS NULL THEN
    RETURN QUERY SELECT 'unknown_line'::text, NULL::uuid, NULL::uuid,
      NULL::uuid, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;

  SELECT m.id, m.contact_id, m.conversation_id, m.opportunity_id
  INTO v_message_id, v_contact_id, v_conversation_id, v_opportunity_id
  FROM public.messages AS m
  WHERE m.organization_id = v_organization_id
    AND m.external_id = p_external_id;
  IF v_message_id IS NOT NULL THEN
    RETURN QUERY SELECT 'duplicate'::text, v_organization_id, v_contact_id,
      v_conversation_id, v_opportunity_id, v_message_id;
    RETURN;
  END IF;

  INSERT INTO public.contacts AS c (organization_id, name, phone, phone_normalized)
  VALUES (v_organization_id, p_contact_name, p_phone, p_phone_normalized)
  ON CONFLICT (organization_id, phone_normalized) WHERE phone_normalized IS NOT NULL
  DO NOTHING
  RETURNING c.id INTO v_contact_id;
  IF v_contact_id IS NULL THEN
    SELECT c.id INTO v_contact_id
    FROM public.contacts AS c
    WHERE c.organization_id = v_organization_id
      AND c.phone_normalized = p_phone_normalized;
  END IF;

  INSERT INTO public.conversations AS cv (organization_id, contact_id, channel)
  VALUES (v_organization_id, v_contact_id, 'whatsapp')
  ON CONFLICT (organization_id, contact_id, channel) WHERE status = 'open'
  DO NOTHING
  RETURNING cv.id INTO v_conversation_id;
  IF v_conversation_id IS NULL THEN
    SELECT cv.id INTO v_conversation_id
    FROM public.conversations AS cv
    WHERE cv.organization_id = v_organization_id
      AND cv.contact_id = v_contact_id
      AND cv.channel = 'whatsapp'
      AND cv.status = 'open';
  END IF;

  SELECT array_agg(o.id) INTO v_open_opportunities
  FROM public.opportunities AS o
  WHERE o.organization_id = v_organization_id
    AND o.contact_id = v_contact_id
    AND o.stage IN ('new', 'qualifying', 'negotiating');
  IF cardinality(v_open_opportunities) = 1 THEN
    v_opportunity_id := v_open_opportunities[1];
  END IF;

  INSERT INTO public.messages AS m (organization_id, contact_id,
    opportunity_id, conversation_id, channel, direction, content,
    external_id, sent_at)
  VALUES (v_organization_id, v_contact_id, v_opportunity_id,
    v_conversation_id, 'whatsapp', 'inbound', p_content, p_external_id,
    p_sent_at)
  ON CONFLICT (organization_id, external_id) WHERE external_id IS NOT NULL
  DO NOTHING
  RETURNING m.id INTO v_message_id;
  IF v_message_id IS NULL THEN
    SELECT m.id, m.contact_id, m.conversation_id, m.opportunity_id
    INTO v_message_id, v_contact_id, v_conversation_id, v_opportunity_id
    FROM public.messages AS m
    WHERE m.organization_id = v_organization_id
      AND m.external_id = p_external_id;
    RETURN QUERY SELECT 'duplicate'::text, v_organization_id, v_contact_id,
      v_conversation_id, v_opportunity_id, v_message_id;
    RETURN;
  END IF;

  UPDATE public.conversations AS cv
  SET last_message_at = p_sent_at,
    last_message_preview = p_preview,
    updated_at = now()
  WHERE cv.organization_id = v_organization_id
    AND cv.id = v_conversation_id
    AND (cv.last_message_at IS NULL OR cv.last_message_at <= p_sent_at);

  RETURN QUERY SELECT 'recorded'::text, v_organization_id, v_contact_id,
    v_conversation_id, v_opportunity_id, v_message_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "private"."ingest_whatsapp_message"(text, text, text, text, text, text, text, timestamp with time zone) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "private"."ingest_whatsapp_message"(text, text, text, text, text, text, text, timestamp with time zone) TO "authenticated";--> statement-breakpoint
-- Custom SQL · ADR-001 §3.6: grants explícitos (DEC-039 §5 y §6). 0000 ya
-- revocó los default privileges de anon y authenticated para lo que
-- postgres crea en public; igual se revoca sobre estas tablas.
-- whatsapp_lines: sin nada para authenticated (las da de alta el
-- provisioning). conversations: solo SELECT, cubierto por su policy; la
-- escribe solo la función de ingesta. anon y app_runtime no reciben nada.
REVOKE ALL ON TABLE "public"."whatsapp_lines", "public"."conversations" FROM "anon", "authenticated";--> statement-breakpoint
GRANT SELECT ON TABLE "public"."conversations" TO "authenticated";--> statement-breakpoint
-- Custom SQL · postcondiciones de ADR-001 §3.6 sobre la base real, para toda
-- tabla de public: las de 0012, con las FKs de los mensajes ampliadas a la
-- conversación, y las de DEC-039: app_runtime sigue siendo miembro solo de
-- authenticated (ADR-001 §2, sin roles nuevos); la función de ingesta es
-- SECURITY DEFINER de postgres, con search_path vacío, EXECUTE solo para
-- authenticated y la regla que rechaza las llamadas con claims;
-- whatsapp_lines no tiene policies ni privilegios de authenticated, y el
-- CHECK de origen de los mensajes, la FK de la conversación y las uniques
-- de idempotencia y de conversación abierta existen validados. Si alguna
-- falla, la migración entera se revierte y no se aplica nada.
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
  -- (los metadatos del cierre) y las del Hito 6 (DEC-038: organizations.name,
  -- default_currency y su updated_at; memberships.role, active y su
  -- updated_at). Un UPDATE de tabla, o sobre cualquier otra columna o tabla,
  -- no pasa: has_column_privilege también es verdadero con un grant de
  -- tabla.
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
  ) THEN
    RAISE EXCEPTION 'ADR-001: authenticated may only update vehicles.status, vehicles.updated_at (H1.3C), opportunities.stage, loss_reason, vehicle_id, updated_at and the closure metadata (H1.6, Hito 2, DEC-034), organizations.name, default_currency, updated_at and memberships.role, active, updated_at (Hito 6, DEC-038)';
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
  -- Hito 2 (opportunity_notes), la del Hito 4 (messages) y la del Hito 6
  -- (memberships, DEC-038): ninguna otra tabla recibe INSERT sin una
  -- migración que lo apruebe.
  IF EXISTS (
    SELECT FROM pg_catalog.pg_class c
    WHERE c.relnamespace = 'public'::regnamespace
      AND c.relkind IN ('r', 'p')
      AND c.relname NOT IN ('contacts', 'opportunities', 'vehicles', 'opportunity_demand_facts', 'opportunity_notes', 'messages', 'memberships')
      AND (
        has_table_privilege('authenticated', c.oid, 'INSERT')
        OR has_any_column_privilege('authenticated', c.oid, 'INSERT')
      )
  ) THEN
    RAISE EXCEPTION 'ADR-001: authenticated may only insert into contacts, opportunities, vehicles, opportunity_demand_facts (H1.4), opportunity_notes (Hito 2), messages (Hito 4) and memberships (Hito 6)';
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

  -- DEC-039 §5: las líneas son de provisioning. Ninguna policy y ningún
  -- privilegio de authenticated sobre whatsapp_lines.
  IF EXISTS (
    SELECT FROM pg_catalog.pg_policies pol
    WHERE pol.schemaname = 'public' AND pol.tablename = 'whatsapp_lines'
  ) OR EXISTS (
    SELECT FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) AS p(privilege)
    WHERE has_table_privilege('authenticated', 'public.whatsapp_lines', p.privilege)
      OR (
        p.privilege IN ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
        AND has_any_column_privilege('authenticated', 'public.whatsapp_lines', p.privilege)
      )
  ) THEN
    RAISE EXCEPTION 'DEC-039: whatsapp_lines is provisioning-only: no policies and no privileges for authenticated';
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
END
$$;

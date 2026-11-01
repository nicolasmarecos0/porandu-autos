CREATE TABLE "quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"number" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"currency" text NOT NULL,
	"list_price" numeric(14, 2) NOT NULL,
	"discount_kind" text DEFAULT 'none' NOT NULL,
	"discount_value" numeric(14, 2),
	"total_price" numeric(14, 2) NOT NULL,
	"valid_until" date NOT NULL,
	"notes" text,
	"created_by" uuid NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quotes_organization_id_number_key" UNIQUE("organization_id","number"),
	CONSTRAINT "quotes_status_check" CHECK ("quotes"."status" IN ('draft', 'approved', 'sent', 'accepted', 'rejected', 'withdrawn')),
	CONSTRAINT "quotes_currency_check" CHECK ("quotes"."currency" IN ('PYG', 'USD')),
	CONSTRAINT "quotes_discount_kind_check" CHECK ("quotes"."discount_kind" IN ('none', 'amount', 'percent')),
	CONSTRAINT "quotes_number_check" CHECK ("quotes"."number" > 0),
	CONSTRAINT "quotes_list_price_check" CHECK ("quotes"."list_price" > 0 AND ("quotes"."currency" <> 'PYG' OR "quotes"."list_price" = trunc("quotes"."list_price"))),
	CONSTRAINT "quotes_discount_check" CHECK (("quotes"."discount_kind" = 'none' AND "quotes"."discount_value" IS NULL) OR ("quotes"."discount_kind" = 'amount' AND "quotes"."discount_value" > 0 AND "quotes"."discount_value" * 100 <= 30 * "quotes"."list_price" AND ("quotes"."currency" <> 'PYG' OR "quotes"."discount_value" = trunc("quotes"."discount_value"))) OR ("quotes"."discount_kind" = 'percent' AND "quotes"."discount_value" > 0 AND "quotes"."discount_value" <= 30)),
	CONSTRAINT "quotes_total_price_check" CHECK ("quotes"."total_price" = CASE "quotes"."discount_kind" WHEN 'none' THEN "quotes"."list_price" WHEN 'amount' THEN "quotes"."list_price" - "quotes"."discount_value" ELSE round("quotes"."list_price" * (100 - "quotes"."discount_value") / 100, CASE WHEN "quotes"."currency" = 'PYG' THEN 0 ELSE 2 END) END),
	CONSTRAINT "quotes_valid_until_check" CHECK ("quotes"."valid_until" >= ("quotes"."created_at" AT TIME ZONE 'America/Asuncion')::date AND "quotes"."valid_until" <= ("quotes"."created_at" AT TIME ZONE 'America/Asuncion')::date + 30),
	CONSTRAINT "quotes_notes_check" CHECK (char_length("quotes"."notes") BETWEEN 1 AND 500 AND "quotes"."notes" = btrim("quotes"."notes", ' ' || chr(10)) AND translate("quotes"."notes", chr(10), '') !~ '[[:cntrl:]]'),
	CONSTRAINT "quotes_approved_stamp_check" CHECK (("quotes"."approved_by" IS NULL) = ("quotes"."approved_at" IS NULL) AND CASE WHEN "quotes"."status" = 'draft' THEN "quotes"."approved_at" IS NULL WHEN "quotes"."status" IN ('approved', 'sent', 'accepted', 'rejected') THEN "quotes"."approved_at" IS NOT NULL ELSE true END),
	CONSTRAINT "quotes_sent_stamp_check" CHECK (CASE WHEN "quotes"."status" IN ('draft', 'approved') THEN "quotes"."sent_at" IS NULL WHEN "quotes"."status" IN ('sent', 'accepted', 'rejected') THEN "quotes"."sent_at" IS NOT NULL ELSE true END),
	CONSTRAINT "quotes_decided_stamp_check" CHECK (("quotes"."decided_at" IS NOT NULL) = ("quotes"."status" IN ('accepted', 'rejected', 'withdrawn')))
);
--> statement-breakpoint
ALTER TABLE "quotes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_approved_by_profiles_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_opportunity_fk" FOREIGN KEY ("organization_id","opportunity_id") REFERENCES "public"."opportunities"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_vehicle_fk" FOREIGN KEY ("organization_id","vehicle_id") REFERENCES "public"."vehicles"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "quotes_organization_id_opportunity_id_idx" ON "quotes" USING btree ("organization_id","opportunity_id");--> statement-breakpoint
CREATE INDEX "quotes_organization_id_vehicle_id_idx" ON "quotes" USING btree ("organization_id","vehicle_id");--> statement-breakpoint
CREATE UNIQUE INDEX "quotes_accepted_opportunity_key" ON "quotes" USING btree ("organization_id","opportunity_id") WHERE "quotes"."status" = 'accepted';--> statement-breakpoint
CREATE POLICY "quotes_select_member" ON "quotes" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("quotes"."organization_id" IN (SELECT private.user_org_ids()));--> statement-breakpoint
CREATE POLICY "quotes_insert_member" ON "quotes" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("quotes"."organization_id" IN (SELECT private.user_org_ids()) AND "quotes"."created_by" = (select auth.uid()) AND "quotes"."status" = 'draft' AND "quotes"."approved_by" IS NULL AND "quotes"."approved_at" IS NULL AND "quotes"."sent_at" IS NULL AND "quotes"."decided_at" IS NULL AND "quotes"."created_at" = now() AND "quotes"."updated_at" = now() AND EXISTS (SELECT FROM "opportunities" WHERE "opportunities"."organization_id" = "quotes"."organization_id" AND "opportunities"."id" = "quotes"."opportunity_id" AND "opportunities"."stage" IN ('qualifying', 'negotiating')) AND EXISTS (SELECT FROM "vehicles" WHERE "vehicles"."organization_id" = "quotes"."organization_id" AND "vehicles"."id" = "quotes"."vehicle_id" AND "vehicles"."status" IN ('available', 'reserved') AND "vehicles"."price" = "quotes"."list_price" AND "vehicles"."currency" = "quotes"."currency"));--> statement-breakpoint
CREATE POLICY "quotes_update_member" ON "quotes" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("quotes"."organization_id" IN (SELECT private.user_org_ids())) WITH CHECK ("quotes"."organization_id" IN (SELECT private.user_org_ids()));
--> statement-breakpoint
-- Custom SQL (no lo genera drizzle-kit) · DEC-042 §5: número correlativo de
-- cotización por organización (1, 2, 3…). Reemplaza siempre el valor que
-- llegue en el INSERT. Un advisory lock de transacción por organización
-- serializa las altas simultáneas de la misma organización (no bloquea a
-- las demás), y cada sentencia de una función VOLATILE en READ COMMITTED
-- toma un snapshot nuevo: después del lock, max() ya ve la alta anterior.
-- La unique (organization_id, number) es el respaldo. SECURITY INVOKER: el
-- SELECT lo filtra RLS, así que solo cuenta las cotizaciones de la
-- organización si el usuario es miembro (si no lo es, el WITH CHECK
-- rechaza la fila igual). SET search_path = ''. Sin EXECUTE para nadie: la
-- llama el trigger.
CREATE FUNCTION "private"."assign_quote_number"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('public.quotes.number:' || NEW.organization_id::text, 0)
  );
  SELECT coalesce(max(q.number), 0) + 1
    INTO NEW.number
    FROM public.quotes q
    WHERE q.organization_id = NEW.organization_id;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "private"."assign_quote_number"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "quotes_assign_number"
BEFORE INSERT ON "public"."quotes"
FOR EACH ROW
EXECUTE FUNCTION "private"."assign_quote_number"();--> statement-breakpoint
-- Custom SQL · DEC-042 §2: el estado de una cotización cambia solo por la
-- matriz de domains/quotes/statuses.ts (QUOTE_TRANSITIONS):
--   draft    → approved | withdrawn
--   approved → sent | withdrawn
--   sent     → accepted | rejected | withdrawn
-- accepted, rejected y withdrawn son terminales. Todo lo demás (incluido
-- quedarse en el mismo estado) se rechaza con 23514, constraint
-- quotes_status_transition. Además, con el reloj de la base:
-- - aprobar, enviar o aceptar exige la validez vigente (día de Asunción,
--   quotes_expired) y la oportunidad en qualifying o negotiating
--   (quotes_opportunity_closed);
-- - aceptar exige la unidad available o reserved
--   (quotes_vehicle_unavailable);
-- - aprobar un descuento efectivo mayor al 10 % exige ser admin de la
--   organización (quotes_discount_requires_admin), y aprobar exige un
--   usuario (quotes_approval_requires_user: el rol dueño sin claims no
--   aprueba).
-- El resto de la fila es inmutable (quotes_immutable), también para el rol
-- dueño: las condiciones económicas no se corrigen, la cotización se anula
-- y se crea otra. Fija los sellos del ciclo (approved_by y approved_at,
-- sent_at, decided_at) y `updated_at`. SECURITY INVOKER: lee la oportunidad
-- y la unidad con RLS (las de la misma organización, por las FKs
-- compuestas). SET search_path = ''. Sin EXECUTE para nadie.
CREATE FUNCTION "private"."enforce_quote_status_transition"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  today date := (pg_catalog.now() AT TIME ZONE 'America/Asuncion')::date;
  opportunity_stage text;
  vehicle_status text;
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
    OR NEW.opportunity_id IS DISTINCT FROM OLD.opportunity_id
    OR NEW.vehicle_id IS DISTINCT FROM OLD.vehicle_id
    OR NEW.number IS DISTINCT FROM OLD.number
    OR NEW.currency IS DISTINCT FROM OLD.currency
    OR NEW.list_price IS DISTINCT FROM OLD.list_price
    OR NEW.discount_kind IS DISTINCT FROM OLD.discount_kind
    OR NEW.discount_value IS DISTINCT FROM OLD.discount_value
    OR NEW.total_price IS DISTINCT FROM OLD.total_price
    OR NEW.valid_until IS DISTINCT FROM OLD.valid_until
    OR NEW.notes IS DISTINCT FROM OLD.notes
    OR NEW.created_by IS DISTINCT FROM OLD.created_by
    OR NEW.approved_by IS DISTINCT FROM OLD.approved_by
    OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
    OR NEW.sent_at IS DISTINCT FROM OLD.sent_at
    OR NEW.decided_at IS DISTINCT FROM OLD.decided_at
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'only the status of a quote can change'
      USING ERRCODE = 'check_violation',
        TABLE = 'quotes',
        CONSTRAINT = 'quotes_immutable';
  END IF;

  IF NOT (
    (OLD.status = 'draft' AND NEW.status IN ('approved', 'withdrawn'))
    OR (OLD.status = 'approved' AND NEW.status IN ('sent', 'withdrawn'))
    OR (OLD.status = 'sent' AND NEW.status IN ('accepted', 'rejected', 'withdrawn'))
  ) THEN
    RAISE EXCEPTION 'quote status cannot change from % to %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation',
        TABLE = 'quotes',
        CONSTRAINT = 'quotes_status_transition';
  END IF;

  IF NEW.status IN ('approved', 'sent', 'accepted') THEN
    IF OLD.valid_until < today THEN
      RAISE EXCEPTION 'quote expired on %', OLD.valid_until
        USING ERRCODE = 'check_violation',
          TABLE = 'quotes',
          CONSTRAINT = 'quotes_expired';
    END IF;

    SELECT o.stage INTO opportunity_stage
      FROM public.opportunities o
      WHERE o.organization_id = OLD.organization_id
        AND o.id = OLD.opportunity_id;
    IF opportunity_stage IS NULL
      OR opportunity_stage NOT IN ('qualifying', 'negotiating')
    THEN
      RAISE EXCEPTION 'the opportunity of the quote is not open for quoting'
        USING ERRCODE = 'check_violation',
          TABLE = 'quotes',
          CONSTRAINT = 'quotes_opportunity_closed';
    END IF;
  END IF;

  IF NEW.status = 'accepted' THEN
    SELECT v.status INTO vehicle_status
      FROM public.vehicles v
      WHERE v.organization_id = OLD.organization_id
        AND v.id = OLD.vehicle_id;
    IF vehicle_status IS NULL
      OR vehicle_status NOT IN ('available', 'reserved')
    THEN
      RAISE EXCEPTION 'the quoted vehicle is no longer in stock'
        USING ERRCODE = 'check_violation',
          TABLE = 'quotes',
          CONSTRAINT = 'quotes_vehicle_unavailable';
    END IF;
  END IF;

  IF NEW.status = 'approved' THEN
    IF auth.uid() IS NULL THEN
      RAISE EXCEPTION 'a quote is approved by a user'
        USING ERRCODE = 'check_violation',
          TABLE = 'quotes',
          CONSTRAINT = 'quotes_approval_requires_user';
    END IF;

    IF (
      (OLD.discount_kind = 'amount' AND OLD.discount_value * 100 > 10 * OLD.list_price)
      OR (OLD.discount_kind = 'percent' AND OLD.discount_value > 10)
    ) AND OLD.organization_id NOT IN (SELECT private.user_admin_org_ids())
    THEN
      RAISE EXCEPTION 'a discount above 10%% must be approved by an admin'
        USING ERRCODE = 'check_violation',
          TABLE = 'quotes',
          CONSTRAINT = 'quotes_discount_requires_admin';
    END IF;

    NEW.approved_by := auth.uid();
    NEW.approved_at := pg_catalog.now();
  ELSIF NEW.status = 'sent' THEN
    NEW.sent_at := pg_catalog.now();
  ELSE
    NEW.decided_at := pg_catalog.now();
  END IF;

  NEW.updated_at := pg_catalog.now();
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "private"."enforce_quote_status_transition"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "quotes_status_transition"
BEFORE UPDATE ON "public"."quotes"
FOR EACH ROW
EXECUTE FUNCTION "private"."enforce_quote_status_transition"();--> statement-breakpoint
-- Custom SQL · ADR-001 §3.6: grants explícitos (DEC-042 §5). Diseño A
-- (DEC-030 §9): authenticated recibe SELECT e INSERT de tabla, porque
-- Drizzle lista todas las columnas en el INSERT; lo que el cliente no elige
-- (organización con membership activa, autor = auth.uid(), estado inicial,
-- sin sellos, reloj de la base, oportunidad cotizable y precio publicado de
-- la unidad) lo controla el WITH CHECK, y el número lo pisa el trigger.
-- UPDATE solo de `status` y `updated_at` (por columna), cubierto por
-- quotes_update_member y validado por el trigger, que también fija los
-- sellos. Sin DELETE: una cotización se anula. app_runtime no recibe nada.
REVOKE ALL ON TABLE "public"."quotes" FROM "anon", "authenticated";--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE "public"."quotes" TO "authenticated";--> statement-breakpoint
GRANT UPDATE ("status", "updated_at") ON TABLE "public"."quotes" TO "authenticated";--> statement-breakpoint
-- Custom SQL · postcondiciones de ADR-001 §3.6 sobre la base real, para toda
-- tabla de public: las de 0015, con quotes entre las altas aprobadas y
-- quotes.status y updated_at entre las ediciones aprobadas, y las de
-- DEC-042: los triggers de número y de estados habilitados con sus
-- funciones, las FKs compuestas, los CHECKs y los índices únicos de la
-- cotización. Si alguna falla, la migración entera se revierte y no se
-- aplica nada.
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
END
$$;

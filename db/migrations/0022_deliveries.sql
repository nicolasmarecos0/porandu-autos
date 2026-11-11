CREATE TABLE "deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"checklist" jsonb DEFAULT '{"keys":false,"manuals":false,"spare_tire":false,"cleaning":false,"documents":false}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_by" uuid NOT NULL,
	"completed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deliveries_organization_id_opportunity_id_key" UNIQUE("organization_id","opportunity_id"),
	CONSTRAINT "deliveries_organization_id_vehicle_id_key" UNIQUE("organization_id","vehicle_id"),
	CONSTRAINT "deliveries_status_check" CHECK ("deliveries"."status" IN ('pending', 'completed')),
	CONSTRAINT "deliveries_checklist_check" CHECK (jsonb_typeof("deliveries"."checklist") = 'object' AND "deliveries"."checklist" ?& ARRAY['keys', 'manuals', 'spare_tire', 'cleaning', 'documents']::text[] AND ("deliveries"."checklist" - ARRAY['keys', 'manuals', 'spare_tire', 'cleaning', 'documents']::text[]) = '{}'::jsonb AND jsonb_typeof("deliveries"."checklist" -> 'keys') = 'boolean' AND jsonb_typeof("deliveries"."checklist" -> 'manuals') = 'boolean' AND jsonb_typeof("deliveries"."checklist" -> 'spare_tire') = 'boolean' AND jsonb_typeof("deliveries"."checklist" -> 'cleaning') = 'boolean' AND jsonb_typeof("deliveries"."checklist" -> 'documents') = 'boolean'),
	CONSTRAINT "deliveries_completion_check" CHECK (("deliveries"."status" = 'completed') = ("deliveries"."completed_at" IS NOT NULL) AND ("deliveries"."completed_at" IS NULL) = ("deliveries"."completed_by" IS NULL) AND ("deliveries"."status" <> 'completed' OR "deliveries"."checklist" = '{"keys":true,"manuals":true,"spare_tire":true,"cleaning":true,"documents":true}'::jsonb)),
	CONSTRAINT "deliveries_scheduled_at_check" CHECK ("deliveries"."scheduled_at" >= '2000-01-01 00:00:00+00' AND "deliveries"."scheduled_at" < '2101-01-01 00:00:00+00')
);
--> statement-breakpoint
ALTER TABLE "deliveries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "vehicles" DROP CONSTRAINT "vehicles_status_check";--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_completed_by_profiles_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_opportunity_fk" FOREIGN KEY ("organization_id","opportunity_id") REFERENCES "public"."opportunities"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_vehicle_fk" FOREIGN KEY ("organization_id","vehicle_id") REFERENCES "public"."vehicles"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_status_check" CHECK ("vehicles"."status" IN ('in_preparation', 'available', 'reserved', 'sold', 'delivered'));--> statement-breakpoint
CREATE POLICY "deliveries_select_member" ON "deliveries" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("deliveries"."organization_id" IN (SELECT private.user_org_ids()));--> statement-breakpoint
CREATE POLICY "deliveries_insert_member" ON "deliveries" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("deliveries"."organization_id" IN (SELECT private.user_org_ids()) AND "deliveries"."created_by" = (select auth.uid()) AND "deliveries"."status" = 'pending' AND "deliveries"."completed_at" IS NULL AND "deliveries"."completed_by" IS NULL AND "deliveries"."checklist" = '{"keys":false,"manuals":false,"spare_tire":false,"cleaning":false,"documents":false}'::jsonb AND "deliveries"."created_at" = now() AND "deliveries"."updated_at" = now() AND EXISTS (SELECT FROM "opportunities" WHERE "opportunities"."organization_id" = "deliveries"."organization_id" AND "opportunities"."id" = "deliveries"."opportunity_id" AND "opportunities"."stage" = 'won' AND "opportunities"."vehicle_id" = "deliveries"."vehicle_id") AND EXISTS (SELECT FROM "vehicles" WHERE "vehicles"."organization_id" = "deliveries"."organization_id" AND "vehicles"."id" = "deliveries"."vehicle_id" AND "vehicles"."status" = 'sold'));--> statement-breakpoint
CREATE POLICY "deliveries_update_member" ON "deliveries" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("deliveries"."organization_id" IN (SELECT private.user_org_ids())) WITH CHECK ("deliveries"."organization_id" IN (SELECT private.user_org_ids()));--> statement-breakpoint
-- Custom SQL (no lo genera drizzle-kit) · Hito 21, DEC-053 §3: qué cambio
-- de una entrega vale se decide a nivel de base de datos con un trigger, no
-- con policies por transición (DEC-028 §5 y §6, como DEC-051 §3 y DEC-052
-- §6). Espeja domains/opportunities/deliveries.ts:
--   pending → pending (tildar el checklist o reprogramar) | completed
--   (completar la entrega). `completed` es terminal.
-- Todo lo demás se rechaza con 23514:
-- - la oportunidad, la unidad, el autor y los sellos son inmutables
--   (deliveries_immutable), también para el rol dueño: el sello de la
--   entrega lo fija este trigger;
-- - una entrega completada no cambia más (deliveries_completed);
-- - un UPDATE de una pendiente que no cambia ni el checklist ni la fecha
--   pactada, o que pide otro estado, no es un pase
--   (deliveries_status_transition);
-- - completar exige el checklist entero verificado
--   (deliveries_checklist_incomplete: la regla del fundador), un usuario
--   (deliveries_completion_requires_user: el rol dueño sin claims no
--   entrega), la misma fecha pactada y la unidad todavía vendida, leída
--   bloqueada (FOR SHARE; deliveries_vehicle_not_sold). Fija el sello de
--   quién y cuándo con auth.uid() y el reloj de la base;
-- - fija `updated_at` con el reloj de la base.
-- SECURITY INVOKER: lee la unidad con RLS (la de la misma organización, por
-- la FK compuesta). SET search_path = ''. Sin EXECUTE para nadie: lo llama
-- el trigger.
CREATE FUNCTION "private"."enforce_delivery_change"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  vehicle_status text;
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
    OR NEW.opportunity_id IS DISTINCT FROM OLD.opportunity_id
    OR NEW.vehicle_id IS DISTINCT FROM OLD.vehicle_id
    OR NEW.created_by IS DISTINCT FROM OLD.created_by
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.completed_at IS DISTINCT FROM OLD.completed_at
    OR NEW.completed_by IS DISTINCT FROM OLD.completed_by
  THEN
    RAISE EXCEPTION 'the opportunity, the vehicle, the author and the stamps of a delivery cannot change'
      USING ERRCODE = 'check_violation',
        TABLE = 'deliveries',
        CONSTRAINT = 'deliveries_immutable';
  END IF;

  IF OLD.status = 'completed' THEN
    RAISE EXCEPTION 'a completed delivery cannot change'
      USING ERRCODE = 'check_violation',
        TABLE = 'deliveries',
        CONSTRAINT = 'deliveries_completed';
  END IF;

  IF OLD.status <> 'pending'
    OR NEW.status NOT IN ('pending', 'completed')
    OR (
      NEW.status = 'pending'
      AND NEW.checklist IS NOT DISTINCT FROM OLD.checklist
      AND NEW.scheduled_at IS NOT DISTINCT FROM OLD.scheduled_at
    )
  THEN
    RAISE EXCEPTION 'delivery status cannot change from % to %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation',
        TABLE = 'deliveries',
        CONSTRAINT = 'deliveries_status_transition';
  END IF;

  IF NEW.status = 'completed' THEN
    IF NEW.checklist IS DISTINCT FROM '{"keys":true,"manuals":true,"spare_tire":true,"cleaning":true,"documents":true}'::jsonb THEN
      RAISE EXCEPTION 'a delivery is completed only with its whole checklist verified'
        USING ERRCODE = 'check_violation',
          TABLE = 'deliveries',
          CONSTRAINT = 'deliveries_checklist_incomplete';
    END IF;
    IF NEW.scheduled_at IS DISTINCT FROM OLD.scheduled_at THEN
      RAISE EXCEPTION 'a delivery is not rescheduled while it is completed'
        USING ERRCODE = 'check_violation',
          TABLE = 'deliveries',
          CONSTRAINT = 'deliveries_status_transition';
    END IF;
    IF auth.uid() IS NULL THEN
      RAISE EXCEPTION 'a delivery is completed by a user'
        USING ERRCODE = 'check_violation',
          TABLE = 'deliveries',
          CONSTRAINT = 'deliveries_completion_requires_user';
    END IF;
    SELECT v.status INTO vehicle_status
      FROM public.vehicles v
      WHERE v.organization_id = OLD.organization_id
        AND v.id = OLD.vehicle_id
      FOR SHARE;
    IF vehicle_status IS DISTINCT FROM 'sold' THEN
      RAISE EXCEPTION 'a delivery is completed only while its vehicle is sold'
        USING ERRCODE = 'check_violation',
          TABLE = 'deliveries',
          CONSTRAINT = 'deliveries_vehicle_not_sold';
    END IF;
    NEW.completed_at := pg_catalog.now();
    NEW.completed_by := auth.uid();
  END IF;

  NEW.updated_at := pg_catalog.now();
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "private"."enforce_delivery_change"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "deliveries_change_guard"
  BEFORE UPDATE ON "public"."deliveries"
  FOR EACH ROW EXECUTE FUNCTION "private"."enforce_delivery_change"();--> statement-breakpoint
-- Custom SQL · DEC-053 §4: completar la entrega y dar salida a la unidad
-- son un solo acto. completeDelivery() escribe las dos cosas en la misma
-- transacción (la entrega primero: el trigger de vehicles exige la entrega
-- completada para pasar la unidad a `delivered`); este constraint trigger,
-- diferido al COMMIT, lo exige también en la base: una UPDATE que completa
-- una entrega sin que su unidad quede `delivered` antes del COMMIT revierte
-- la transacción entera (23514, constraint
-- deliveries_completed_vehicle_delivered), aunque la aplicación tuviera un
-- bug. Solo mira el pase a `completed` (el WHEN). SECURITY INVOKER: lee la
-- unidad con RLS. SET search_path = ''. Sin EXECUTE para nadie.
CREATE FUNCTION "private"."enforce_completed_delivery_vehicle_delivered"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT FROM public.vehicles v
    WHERE v.organization_id = NEW.organization_id
      AND v.id = NEW.vehicle_id
      AND v.status = 'delivered'
  ) THEN
    RAISE EXCEPTION 'a delivery is completed only together with the exit of its vehicle'
      USING ERRCODE = 'check_violation',
        TABLE = 'deliveries',
        CONSTRAINT = 'deliveries_completed_vehicle_delivered';
  END IF;
  RETURN NULL;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "private"."enforce_completed_delivery_vehicle_delivered"() FROM PUBLIC;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "deliveries_completed_vehicle_delivered"
  AFTER UPDATE ON "public"."deliveries"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed')
  EXECUTE FUNCTION "private"."enforce_completed_delivery_vehicle_delivered"();--> statement-breakpoint
-- Custom SQL · DEC-053 §1 (amplía DEC-051 §3): la máquina de la unidad suma
-- `sold → delivered`, la salida del salón, y `delivered` es terminal. La
-- función del trigger vehicles_status_transition se reemplaza (CREATE OR
-- REPLACE, misma firma y mismo trigger) con la matriz de
-- domains/vehicles/lifecycle.ts (un test cruza los 25 pares):
--   in_preparation → available · available → reserved | sold ·
--   reserved → available | sold · sold → delivered · delivered es terminal.
-- Además de las reglas de 0020, una unidad pasa a `delivered` solo si su
-- entrega de la misma organización está completada
-- (vehicles_delivery_requires_completed): la salida nace del remito, nunca
-- de Stock.
CREATE OR REPLACE FUNCTION "private"."enforce_vehicle_status_transition"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
    OR NEW.brand IS DISTINCT FROM OLD.brand
    OR NEW.model IS DISTINCT FROM OLD.model
    OR NEW.version IS DISTINCT FROM OLD.version
    OR NEW.year IS DISTINCT FROM OLD.year
    OR NEW.km IS DISTINCT FROM OLD.km
    OR NEW.price IS DISTINCT FROM OLD.price
    OR NEW.currency IS DISTINCT FROM OLD.currency
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'only the status of a vehicle can change'
      USING ERRCODE = 'check_violation',
        TABLE = 'vehicles',
        CONSTRAINT = 'vehicles_immutable';
  END IF;

  IF NOT (
    (OLD.status = 'in_preparation' AND NEW.status = 'available')
    OR (OLD.status = 'available' AND NEW.status IN ('reserved', 'sold'))
    OR (OLD.status = 'reserved' AND NEW.status IN ('available', 'sold'))
    OR (OLD.status = 'sold' AND NEW.status = 'delivered')
  ) THEN
    RAISE EXCEPTION 'vehicle status cannot change from % to %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation',
        TABLE = 'vehicles',
        CONSTRAINT = 'vehicles_status_transition';
  END IF;

  IF NEW.status = 'sold' AND NOT EXISTS (
    SELECT FROM public.opportunities o
    WHERE o.organization_id = NEW.organization_id
      AND o.vehicle_id = NEW.id
      AND o.stage = 'won'
  ) THEN
    RAISE EXCEPTION 'a vehicle is sold only by closing as won the opportunity that has it linked'
      USING ERRCODE = 'check_violation',
        TABLE = 'vehicles',
        CONSTRAINT = 'vehicles_sale_requires_won';
  END IF;

  IF NEW.status = 'delivered' AND NOT EXISTS (
    SELECT FROM public.deliveries d
    WHERE d.organization_id = NEW.organization_id
      AND d.vehicle_id = NEW.id
      AND d.status = 'completed'
  ) THEN
    RAISE EXCEPTION 'a vehicle leaves the dealership only by completing its delivery'
      USING ERRCODE = 'check_violation',
        TABLE = 'vehicles',
        CONSTRAINT = 'vehicles_delivery_requires_completed';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END
$$;--> statement-breakpoint
-- Custom SQL · ADR-001 §3.6: grants explícitos (DEC-053 §3). Diseño A
-- (DEC-030 §9): authenticated recibe SELECT e INSERT de tabla, porque
-- Drizzle lista todas las columnas en el INSERT; lo que el cliente no elige
-- (organización con membership activa, autor = auth.uid(), estado inicial,
-- checklist sin verificar, sin sello, reloj de la base y la unidad vendida
-- de una oportunidad ganada) lo controla el WITH CHECK. UPDATE solo del
-- checklist, la fecha pactada, el estado y `updated_at`, por columna,
-- cubierto por deliveries_update_member y validado por el trigger, que
-- también fija el sello de la entrega. Sin DELETE. app_runtime no recibe
-- nada: solo escribe asumiendo authenticated dentro de withTenant().
REVOKE ALL ON TABLE "public"."deliveries" FROM "anon", "authenticated";--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE "public"."deliveries" TO "authenticated";--> statement-breakpoint
GRANT UPDATE ("status", "checklist", "scheduled_at", "updated_at") ON TABLE "public"."deliveries" TO "authenticated";--> statement-breakpoint
-- Custom SQL · postcondiciones de ADR-001 §3.6 sobre la base real, para toda
-- tabla de public: las de 0021, con deliveries entre las altas aprobadas y
-- su checklist, su fecha pactada, su estado y su updated_at entre las
-- ediciones aprobadas, toda unidad de una ganada vendida o entregada, y las
-- de la DEC-053: deliveries con una sola policy de UPDATE tenant-scoped y el
-- alta pendiente de la unidad vendida de una ganada, el trigger de cambios
-- habilitado y con sus reglas, el constraint trigger diferido que exige la
-- unidad entregada al completar, la regla de la salida en el trigger de
-- vehicles, el estado `delivered` en el CHECK de vehicles, las FKs
-- compuestas, los CHECKs validados y los índices únicos. Si alguna falla,
-- la migración entera se revierte y no se aplica nada.
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

  -- Las únicas ediciones aprobadas son la de H1.3C y el Hito 19
  -- (vehicles.status y su updated_at: el ciclo de vida de la unidad, que
  -- valida el trigger vehicles_status_transition), la de H1.6
  -- (opportunities.stage, loss_reason y su
  -- updated_at), la del Hito 2 (opportunities.vehicle_id), la de DEC-034
  -- (los metadatos del cierre), las del Hito 6 (DEC-038: organizations.name,
  -- default_currency y su updated_at; memberships.role, active y su
  -- updated_at), la del Hito 9 (DEC-041: test_drives.status y su
  -- updated_at), la del Hito 10 (DEC-042: quotes.status y su updated_at) y
  -- la del Hito 20 (DEC-052: la tasación, el estado, el ingreso al stock y
  -- el updated_at de trade_ins, que valida el trigger
  -- trade_ins_change_guard) y la del Hito 21 (DEC-053: el checklist, la
  -- fecha pactada, el estado y el updated_at de deliveries, que valida el
  -- trigger deliveries_change_guard).
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
      AND NOT (
        c.relname = 'trade_ins'
        AND a.attname IN (
          'status', 'currency', 'estimated_repair_cost', 'offer_price',
          'converted_vehicle_id', 'updated_at'
        )
      )
      AND NOT (
        c.relname = 'deliveries'
        AND a.attname IN ('status', 'checklist', 'scheduled_at', 'updated_at')
      )
  ) THEN
    RAISE EXCEPTION 'ADR-001: authenticated may only update vehicles.status, vehicles.updated_at (H1.3C), opportunities.stage, loss_reason, vehicle_id, updated_at and the closure metadata (H1.6, Hito 2, DEC-034), organizations.name, default_currency, updated_at and memberships.role, active, updated_at (Hito 6, DEC-038), test_drives.status, updated_at (Hito 9, DEC-041), quotes.status, updated_at (Hito 10, DEC-042) and trade_ins.status, currency, estimated_repair_cost, offer_price, converted_vehicle_id, updated_at (Hito 20, DEC-052) and deliveries.status, checklist, scheduled_at, updated_at (Hito 21, DEC-053)';
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
  -- (memberships, DEC-038), la del Hito 9 (test_drives, DEC-041), la del
  -- Hito 10 (quotes, DEC-042), la del Hito 20 (trade_ins, DEC-052) y la
  -- del Hito 21 (deliveries, DEC-053):
  -- ninguna otra tabla recibe INSERT sin una migración que lo apruebe.
  IF EXISTS (
    SELECT FROM pg_catalog.pg_class c
    WHERE c.relnamespace = 'public'::regnamespace
      AND c.relkind IN ('r', 'p')
      AND c.relname NOT IN ('contacts', 'opportunities', 'vehicles', 'opportunity_demand_facts', 'opportunity_notes', 'messages', 'memberships', 'test_drives', 'quotes', 'trade_ins', 'deliveries')
      AND (
        has_table_privilege('authenticated', c.oid, 'INSERT')
        OR has_any_column_privilege('authenticated', c.oid, 'INSERT')
      )
  ) THEN
    RAISE EXCEPTION 'ADR-001: authenticated may only insert into contacts, opportunities, vehicles, opportunity_demand_facts (H1.4), opportunity_notes (Hito 2), messages (Hito 4), memberships (Hito 6), test_drives (Hito 9), quotes (Hito 10), trade_ins (Hito 20) and deliveries (Hito 21)';
  END IF;

  -- Ledgers append-only (H1.4, Hito 2, Hito 4 e Hito 12C): ninguna policy
  -- de UPDATE, DELETE ni ALL.
  IF EXISTS (
    SELECT FROM pg_catalog.pg_policies pol
    WHERE pol.schemaname = 'public'
      AND pol.tablename IN ('opportunity_demand_facts', 'opportunity_notes', 'messages', 'message_statuses')
      AND pol.cmd IN ('UPDATE', 'DELETE', 'ALL')
  ) THEN
    RAISE EXCEPTION 'ADR-001: opportunity_demand_facts, opportunity_notes, messages and message_statuses are append-only: no UPDATE, DELETE or ALL policies';
  END IF;

  -- Explícito para las cuatro tablas, aunque la regla de ediciones de
  -- arriba ya lo cubra hoy: sobrevive a que se amplíen las ediciones
  -- aprobadas.
  IF EXISTS (
    SELECT FROM pg_catalog.pg_attribute a
    WHERE a.attrelid IN (
        'public.opportunity_demand_facts'::regclass,
        'public.opportunity_notes'::regclass,
        'public.messages'::regclass,
        'public.message_statuses'::regclass
      )
      AND a.attnum > 0
      AND NOT a.attisdropped
      AND has_column_privilege('authenticated', a.attrelid, a.attnum, 'UPDATE')
  ) THEN
    RAISE EXCEPTION 'ADR-001: authenticated must not update opportunity_demand_facts, opportunity_notes, messages or message_statuses';
  END IF;

  -- C-11: append-only también frente a service_role.
  IF EXISTS (
    SELECT FROM unnest(ARRAY['public.opportunity_demand_facts', 'public.opportunity_notes', 'public.messages', 'public.message_statuses']) AS t(name)
    CROSS JOIN unnest(ARRAY['UPDATE', 'DELETE', 'TRUNCATE']) AS p(privilege)
    WHERE has_table_privilege('service_role', t.name, p.privilege)
      OR (
        p.privilege = 'UPDATE'
        AND has_any_column_privilege('service_role', t.name, p.privilege)
      )
  ) THEN
    RAISE EXCEPTION 'ADR-001: service_role must not update, delete or truncate opportunity_demand_facts, opportunity_notes, messages or message_statuses';
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

  -- DEC-044 §3.3: los miembros leen los estados de entrega de sus
  -- organizaciones y no los escriben. Una sola policy, la de lectura de
  -- miembros, y ningún privilegio de authenticated sobre message_statuses
  -- salvo SELECT: el alta la hace la función de ingesta de estados.
  IF (
    SELECT count(*) FROM pg_catalog.pg_policies pol
    WHERE pol.schemaname = 'public' AND pol.tablename = 'message_statuses'
  ) <> 1 OR NOT EXISTS (
    SELECT FROM pg_catalog.pg_policies pol
    WHERE pol.schemaname = 'public'
      AND pol.tablename = 'message_statuses'
      AND pol.policyname = 'message_statuses_select_member'
      AND pol.permissive = 'PERMISSIVE'
      AND pol.cmd = 'SELECT'
      AND pol.roles = ARRAY['authenticated']::name[]
      AND pol.qual = '(organization_id IN ( SELECT private.user_org_ids() AS user_org_ids))'
  ) OR NOT has_table_privilege('authenticated', 'public.message_statuses', 'SELECT')
  OR EXISTS (
    SELECT FROM unnest(ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) AS p(privilege)
    WHERE has_table_privilege('authenticated', 'public.message_statuses', p.privilege)
      OR (
        p.privilege IN ('INSERT', 'UPDATE', 'REFERENCES')
        AND has_any_column_privilege('authenticated', 'public.message_statuses', p.privilege)
      )
  ) THEN
    RAISE EXCEPTION 'DEC-044: message_statuses is read-only for members: only the message_statuses_select_member policy and no write privileges for authenticated';
  END IF;

  -- DEC-044 §3.1 y §3.3: un estado por mensaje (PK (organization_id,
  -- message_id, status), la autoridad de la idempotencia), de los cuatro del
  -- contrato (CHECK validado), de un mensaje de la misma organización (FK
  -- compuesta validada y RESTRICT sobre la unique (organization_id, id) de
  -- messages).
  IF NOT EXISTS (
    SELECT FROM pg_catalog.pg_constraint k
    WHERE k.conrelid = 'public.message_statuses'::regclass
      AND k.conname = 'message_statuses_pkey'
      AND k.contype = 'p'
      AND k.conkey = ARRAY[
        (SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid = 'public.message_statuses'::regclass AND attname = 'organization_id'),
        (SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid = 'public.message_statuses'::regclass AND attname = 'message_id'),
        (SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid = 'public.message_statuses'::regclass AND attname = 'status')
      ]
  ) OR NOT EXISTS (
    SELECT FROM pg_catalog.pg_constraint k
    WHERE k.conrelid = 'public.message_statuses'::regclass
      AND k.conname = 'message_statuses_status_check'
      AND k.contype = 'c'
      AND k.convalidated
  ) OR NOT EXISTS (
    SELECT FROM pg_catalog.pg_constraint k
    WHERE k.conrelid = 'public.message_statuses'::regclass
      AND k.conname = 'message_statuses_message_fk'
      AND k.contype = 'f'
      AND k.convalidated
      AND k.confdeltype = 'r'
      AND k.confrelid = 'public.messages'::regclass
      AND k.conkey = ARRAY[
        (SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid = 'public.message_statuses'::regclass AND attname = 'organization_id'),
        (SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid = 'public.message_statuses'::regclass AND attname = 'message_id')
      ]
      AND k.confkey = ARRAY[
        (SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid = 'public.messages'::regclass AND attname = 'organization_id'),
        (SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid = 'public.messages'::regclass AND attname = 'id')
      ]
  ) OR NOT EXISTS (
    SELECT FROM pg_catalog.pg_constraint k
    JOIN pg_catalog.pg_index i ON i.indexrelid = k.conindid
    WHERE k.conrelid = 'public.messages'::regclass
      AND k.conname = 'messages_organization_id_id_key'
      AND k.contype = 'u'
      AND i.indisvalid
      AND k.conkey = ARRAY[
        (SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid = 'public.messages'::regclass AND attname = 'organization_id'),
        (SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid = 'public.messages'::regclass AND attname = 'id')
      ]
  ) THEN
    RAISE EXCEPTION 'DEC-044: message_statuses needs its primary key (organization_id, message_id, status), the validated status CHECK and the composite message foreign key';
  END IF;

  -- DEC-044 §3.3 y DEC-039 §4: la ingesta de estados corre como dueño.
  -- Tiene que ser SECURITY DEFINER de postgres, con search_path vacío,
  -- EXECUTE solo para authenticated (ni PUBLIC, ni anon, ni app_runtime), la
  -- regla que rechaza una llamada con claims (una versión sin ella dejaría a
  -- un miembro registrar estados) y la búsqueda solo entre los salientes.
  IF NOT EXISTS (
    SELECT FROM pg_catalog.pg_proc p
    WHERE p.oid = to_regprocedure('private.ingest_whatsapp_status(text, text, text, timestamp with time zone)')
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
      AND position('m.direction = ''outbound''' in p.prosrc) > 0
  ) THEN
    RAISE EXCEPTION 'DEC-044: private.ingest_whatsapp_status() must be SECURITY DEFINER owned by postgres, with an empty search_path, EXECUTE only for authenticated, the rule that rejects calls with claims and the lookup among outbound messages only';
  END IF;

  -- DEC-028 §5 y §6 (DEC-051 §3): vehicles tiene una sola policy
  -- de UPDATE (ninguna ALL), permisiva, de authenticated y tenant-scoped en
  -- USING y WITH CHECK. Una segunda policy permisiva se combinaría con OR y
  -- cruzaría orígenes y destinos: los pares viven en el trigger.
  IF (
    SELECT count(*) FROM pg_catalog.pg_policies pol
    WHERE pol.schemaname = 'public'
      AND pol.tablename = 'vehicles'
      AND pol.cmd IN ('UPDATE', 'ALL')
  ) <> 1 OR NOT EXISTS (
    SELECT FROM pg_catalog.pg_policies pol
    WHERE pol.schemaname = 'public'
      AND pol.tablename = 'vehicles'
      AND pol.policyname = 'vehicles_update_status'
      AND pol.permissive = 'PERMISSIVE'
      AND pol.cmd = 'UPDATE'
      AND pol.roles = ARRAY['authenticated']::name[]
      AND pol.qual = '(organization_id IN ( SELECT private.user_org_ids() AS user_org_ids))'
      AND pol.with_check = '(organization_id IN ( SELECT private.user_org_ids() AS user_org_ids))'
  ) THEN
    RAISE EXCEPTION 'DEC-051: vehicles needs exactly one UPDATE policy, vehicles_update_status, tenant-scoped in USING and WITH CHECK';
  END IF;

  -- DEC-051 §3: el estado de una unidad se valida a nivel de base
  -- de datos. El UPDATE solo es seguro con el trigger BEFORE UPDATE FOR EACH
  -- ROW (tgtype 19) habilitado, y con la función que exige la matriz, la
  -- inmutabilidad del resto de la fila y la venta solo con una oportunidad
  -- ganada: SECURITY INVOKER, search_path vacío y sin EXECUTE para nadie.
  IF NOT EXISTS (
    SELECT FROM pg_catalog.pg_trigger t
    WHERE t.tgrelid = 'public.vehicles'::regclass
      AND t.tgname = 'vehicles_status_transition'
      AND NOT t.tgisinternal
      AND t.tgenabled = 'O'
      AND t.tgtype = 19
      AND t.tgfoid = to_regprocedure('private.enforce_vehicle_status_transition()')
  ) OR NOT EXISTS (
    SELECT FROM pg_catalog.pg_proc p
    WHERE p.oid = to_regprocedure('private.enforce_vehicle_status_transition()')
      AND NOT p.prosecdef
      AND p.proconfig = ARRAY['search_path=""']
      AND position('vehicles_status_transition' in p.prosrc) > 0
      AND position('vehicles_immutable' in p.prosrc) > 0
      AND position('vehicles_sale_requires_won' in p.prosrc) > 0
      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('app_runtime', p.oid, 'EXECUTE')
      AND NOT EXISTS (
        SELECT FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
      )
  ) THEN
    RAISE EXCEPTION 'DEC-051: vehicles needs the enabled BEFORE UPDATE status transition trigger with its rules';
  END IF;

  -- DEC-051 §4: ganar una oportunidad y vender su unidad son un
  -- solo acto. El constraint trigger AFTER UPDATE FOR EACH ROW (tgtype 17),
  -- diferido al COMMIT, existe, está habilitado y su función (SECURITY
  -- INVOKER, search_path vacío, sin EXECUTE para nadie) exige la unidad
  -- vendida.
  IF NOT EXISTS (
    SELECT FROM pg_catalog.pg_trigger t
    WHERE t.tgrelid = 'public.opportunities'::regclass
      AND t.tgname = 'opportunities_won_vehicle_sold'
      AND NOT t.tgisinternal
      AND t.tgenabled = 'O'
      AND t.tgtype = 17
      AND t.tgconstraint <> 0
      AND t.tgdeferrable
      AND t.tginitdeferred
      AND t.tgfoid = to_regprocedure('private.enforce_won_vehicle_sold()')
  ) OR NOT EXISTS (
    SELECT FROM pg_catalog.pg_proc p
    WHERE p.oid = to_regprocedure('private.enforce_won_vehicle_sold()')
      AND NOT p.prosecdef
      AND p.proconfig = ARRAY['search_path=""']
      AND position('opportunities_won_vehicle_sold' in p.prosrc) > 0
      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('app_runtime', p.oid, 'EXECUTE')
      AND NOT EXISTS (
        SELECT FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
      )
  ) THEN
    RAISE EXCEPTION 'DEC-051: opportunities need the enabled deferred constraint trigger that sells the linked vehicle of a won opportunity';
  END IF;

  -- DEC-051 §5 (DEC-053 §1): toda unidad vinculada a una oportunidad
  -- ganada está vendida, o ya entregada (DEC-034 §3: es la unidad que se
  -- vendió).
  IF EXISTS (
    SELECT FROM public.opportunities o
    JOIN public.vehicles v
      ON v.organization_id = o.organization_id AND v.id = o.vehicle_id
    WHERE o.stage = 'won' AND v.status NOT IN ('sold', 'delivered')
  ) THEN
    RAISE EXCEPTION 'DEC-051: every vehicle linked to a won opportunity must be sold or delivered';
  END IF;

  -- DEC-052 §3 (DEC-028 §5 y §6): trade_ins tiene una sola policy de
  -- UPDATE (ninguna ALL), permisiva, de authenticated y tenant-scoped en
  -- USING y WITH CHECK: qué cambio vale lo decide su trigger. Y una sola
  -- de alta, la de un miembro activo como autor, pendiente, sin tasación ni
  -- ingreso, con el reloj de la base y para una oportunidad abierta.
  IF (
    SELECT count(*) FROM pg_catalog.pg_policies pol
    WHERE pol.schemaname = 'public'
      AND pol.tablename = 'trade_ins'
      AND pol.cmd IN ('UPDATE', 'ALL')
  ) <> 1 OR NOT EXISTS (
    SELECT FROM pg_catalog.pg_policies pol
    WHERE pol.schemaname = 'public'
      AND pol.tablename = 'trade_ins'
      AND pol.policyname = 'trade_ins_update_member'
      AND pol.permissive = 'PERMISSIVE'
      AND pol.cmd = 'UPDATE'
      AND pol.roles = ARRAY['authenticated']::name[]
      AND pol.qual = '(organization_id IN ( SELECT private.user_org_ids() AS user_org_ids))'
      AND pol.with_check = '(organization_id IN ( SELECT private.user_org_ids() AS user_org_ids))'
  ) OR (
    SELECT count(*) FROM pg_catalog.pg_policies pol
    WHERE pol.schemaname = 'public'
      AND pol.tablename = 'trade_ins'
      AND pol.cmd IN ('INSERT', 'ALL')
  ) <> 1 OR NOT EXISTS (
    SELECT FROM pg_catalog.pg_policies pol
    WHERE pol.schemaname = 'public'
      AND pol.tablename = 'trade_ins'
      AND pol.policyname = 'trade_ins_insert_member'
      AND pol.permissive = 'PERMISSIVE'
      AND pol.cmd = 'INSERT'
      AND pol.roles = ARRAY['authenticated']::name[]
      AND position('(organization_id IN ( SELECT private.user_org_ids() AS user_org_ids))' in pol.with_check) > 0
      AND position('(created_by = ( SELECT auth.uid() AS uid))' in pol.with_check) > 0
      AND position('(status = ''pending''::text)' in pol.with_check) > 0
      AND position('(offer_price IS NULL)' in pol.with_check) > 0
      AND position('(converted_vehicle_id IS NULL)' in pol.with_check) > 0
      AND position('(opportunities.stage = ANY (ARRAY[''new''::text, ''qualifying''::text, ''negotiating''::text]))' in pol.with_check) > 0
  ) THEN
    RAISE EXCEPTION 'DEC-052: trade_ins needs exactly one UPDATE policy, trade_ins_update_member, tenant-scoped in USING and WITH CHECK, and one INSERT policy for a pending trade-in of an open opportunity';
  END IF;

  -- DEC-052 §3: un cambio de una toma se valida a nivel de base de datos.
  -- El UPDATE solo es seguro con el trigger BEFORE UPDATE FOR EACH ROW
  -- (tgtype 19) habilitado, y con la función que exige la matriz, la
  -- inmutabilidad del usado, la oportunidad abierta (bloqueada FOR SHARE),
  -- el valor de toma para aceptar, el admin para tasar y el ingreso solo
  -- con el cierre Ganada: SECURITY INVOKER, search_path vacío y sin EXECUTE
  -- para nadie.
  IF NOT EXISTS (
    SELECT FROM pg_catalog.pg_trigger t
    WHERE t.tgrelid = 'public.trade_ins'::regclass
      AND t.tgname = 'trade_ins_change_guard'
      AND NOT t.tgisinternal
      AND t.tgenabled = 'O'
      AND t.tgtype = 19
      AND t.tgfoid = to_regprocedure('private.enforce_trade_in_change()')
  ) OR NOT EXISTS (
    SELECT FROM pg_catalog.pg_proc p
    WHERE p.oid = to_regprocedure('private.enforce_trade_in_change()')
      AND NOT p.prosecdef
      AND p.proconfig = ARRAY['search_path=""']
      AND position('trade_ins_immutable' in p.prosrc) > 0
      AND position('trade_ins_intake' in p.prosrc) > 0
      AND position('trade_ins_opportunity_closed' in p.prosrc) > 0
      AND position('trade_ins_offer_required' in p.prosrc) > 0
      AND position('trade_ins_status_transition' in p.prosrc) > 0
      AND position('trade_ins_appraisal_requires_user' in p.prosrc) > 0
      AND position('trade_ins_appraisal_requires_admin' in p.prosrc) > 0
      AND position('FOR SHARE' in p.prosrc) > 0
      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('app_runtime', p.oid, 'EXECUTE')
      AND NOT EXISTS (
        SELECT FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
      )
  ) THEN
    RAISE EXCEPTION 'DEC-052: trade_ins needs the enabled BEFORE UPDATE change guard trigger with its rules';
  END IF;

  -- DEC-052 §5: ganar una oportunidad con una toma aceptada y hacerla
  -- entrar al stock son un solo acto. El constraint trigger AFTER UPDATE
  -- FOR EACH ROW (tgtype 17), diferido al COMMIT, existe, está habilitado y
  -- su función (SECURITY INVOKER, search_path vacío, sin EXECUTE para
  -- nadie) exige el ingreso.
  IF NOT EXISTS (
    SELECT FROM pg_catalog.pg_trigger t
    WHERE t.tgrelid = 'public.opportunities'::regclass
      AND t.tgname = 'opportunities_won_trade_in_stocked'
      AND NOT t.tgisinternal
      AND t.tgenabled = 'O'
      AND t.tgtype = 17
      AND t.tgconstraint <> 0
      AND t.tgdeferrable
      AND t.tginitdeferred
      AND t.tgfoid = to_regprocedure('private.enforce_won_trade_in_stocked()')
  ) OR NOT EXISTS (
    SELECT FROM pg_catalog.pg_proc p
    WHERE p.oid = to_regprocedure('private.enforce_won_trade_in_stocked()')
      AND NOT p.prosecdef
      AND p.proconfig = ARRAY['search_path=""']
      AND position('opportunities_won_trade_in_stocked' in p.prosrc) > 0
      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('app_runtime', p.oid, 'EXECUTE')
      AND NOT EXISTS (
        SELECT FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
      )
  ) THEN
    RAISE EXCEPTION 'DEC-052: opportunities need the enabled deferred constraint trigger that stocks the accepted trade-in of a won opportunity';
  END IF;

  -- DEC-052 §2 y §5: la toma es de una oportunidad de la misma
  -- organización y, convertida, de una unidad de la misma organización
  -- (FKs compuestas, validadas y RESTRICT).
  IF (
    SELECT count(*) FROM pg_catalog.pg_constraint k
    WHERE k.conrelid = 'public.trade_ins'::regclass
      AND k.contype = 'f'
      AND k.convalidated
      AND k.confdeltype = 'r'
      AND cardinality(k.conkey) = 2
      AND (
        (k.conname = 'trade_ins_opportunity_fk'
          AND k.confrelid = 'public.opportunities'::regclass)
        OR (k.conname = 'trade_ins_converted_vehicle_fk'
          AND k.confrelid = 'public.vehicles'::regclass)
      )
  ) <> 2 THEN
    RAISE EXCEPTION 'DEC-052: trade_ins needs the composite opportunity and converted vehicle foreign keys';
  END IF;

  -- DEC-052 §2: ninguna toma queda con un usado inválido, una tasación a
  -- medias o fuera de su estado, aceptada sin valor de toma o convertida
  -- sin estar aceptada. Los CHECKs existen y están validados.
  IF (
    SELECT count(*) FROM pg_catalog.pg_constraint k
    WHERE k.conrelid = 'public.trade_ins'::regclass
      AND k.contype = 'c'
      AND k.convalidated
      AND k.conname IN (
        'trade_ins_status_check',
        'trade_ins_currency_check',
        'trade_ins_brand_check',
        'trade_ins_model_check',
        'trade_ins_version_check',
        'trade_ins_year_check',
        'trade_ins_km_check',
        'trade_ins_plate_check',
        'trade_ins_offer_price_check',
        'trade_ins_repair_cost_check',
        'trade_ins_appraisal_check',
        'trade_ins_accepted_offer_check',
        'trade_ins_converted_check'
      )
  ) <> 13 THEN
    RAISE EXCEPTION 'DEC-052: trade_ins needs the validated vehicle, appraisal, acceptance and intake CHECK constraints';
  END IF;

  -- DEC-052 §2 y §5: a lo sumo una toma vigente por oportunidad y una toma
  -- por unidad del stock (índices únicos válidos).
  IF (
    SELECT count(*) FROM pg_catalog.pg_index i
    JOIN pg_catalog.pg_class c ON c.oid = i.indexrelid
    WHERE i.indrelid = 'public.trade_ins'::regclass
      AND i.indisunique
      AND i.indisvalid
      AND (
        (c.relname = 'trade_ins_active_opportunity_key' AND i.indpred IS NOT NULL)
        OR c.relname = 'trade_ins_organization_id_converted_vehicle_id_key'
      )
  ) <> 2 THEN
    RAISE EXCEPTION 'DEC-052: trade_ins needs the unique active trade-in per opportunity and the unique converted vehicle';
  END IF;

  -- DEC-053 §1: `delivered` es un estado de la unidad (CHECK validado con
  -- los cinco estados), y el trigger de vehicles exige la entrega
  -- completada para la salida (la función de 0022, no la de 0020).
  IF NOT EXISTS (
    SELECT FROM pg_catalog.pg_constraint k
    WHERE k.conrelid = 'public.vehicles'::regclass
      AND k.contype = 'c'
      AND k.convalidated
      AND k.conname = 'vehicles_status_check'
      AND pg_catalog.pg_get_constraintdef(k.oid) = 'CHECK ((status = ANY (ARRAY[''in_preparation''::text, ''available''::text, ''reserved''::text, ''sold''::text, ''delivered''::text])))'
  ) OR NOT EXISTS (
    SELECT FROM pg_catalog.pg_proc p
    WHERE p.oid = to_regprocedure('private.enforce_vehicle_status_transition()')
      AND position('vehicles_delivery_requires_completed' in p.prosrc) > 0
      AND position('(OLD.status = ''sold'' AND NEW.status = ''delivered'')' in p.prosrc) > 0
  ) THEN
    RAISE EXCEPTION 'DEC-053: vehicles need the delivered status and the status transition rule that requires a completed delivery';
  END IF;

  -- DEC-053 §3 (DEC-028 §5 y §6): deliveries tiene una sola policy de
  -- UPDATE (ninguna ALL), permisiva, de authenticated y tenant-scoped en
  -- USING y WITH CHECK: qué cambio vale lo decide su trigger. Y una sola
  -- de alta, la de un miembro activo como autor, pendiente, sin nada
  -- verificado ni sello, con el reloj de la base y para la unidad vendida
  -- de una oportunidad ganada.
  IF (
    SELECT count(*) FROM pg_catalog.pg_policies pol
    WHERE pol.schemaname = 'public'
      AND pol.tablename = 'deliveries'
      AND pol.cmd IN ('UPDATE', 'ALL')
  ) <> 1 OR NOT EXISTS (
    SELECT FROM pg_catalog.pg_policies pol
    WHERE pol.schemaname = 'public'
      AND pol.tablename = 'deliveries'
      AND pol.policyname = 'deliveries_update_member'
      AND pol.permissive = 'PERMISSIVE'
      AND pol.cmd = 'UPDATE'
      AND pol.roles = ARRAY['authenticated']::name[]
      AND pol.qual = '(organization_id IN ( SELECT private.user_org_ids() AS user_org_ids))'
      AND pol.with_check = '(organization_id IN ( SELECT private.user_org_ids() AS user_org_ids))'
  ) OR (
    SELECT count(*) FROM pg_catalog.pg_policies pol
    WHERE pol.schemaname = 'public'
      AND pol.tablename = 'deliveries'
      AND pol.cmd IN ('INSERT', 'ALL')
  ) <> 1 OR NOT EXISTS (
    SELECT FROM pg_catalog.pg_policies pol
    WHERE pol.schemaname = 'public'
      AND pol.tablename = 'deliveries'
      AND pol.policyname = 'deliveries_insert_member'
      AND pol.permissive = 'PERMISSIVE'
      AND pol.cmd = 'INSERT'
      AND pol.roles = ARRAY['authenticated']::name[]
      AND position('(organization_id IN ( SELECT private.user_org_ids() AS user_org_ids))' in pol.with_check) > 0
      AND position('(created_by = ( SELECT auth.uid() AS uid))' in pol.with_check) > 0
      AND position('(status = ''pending''::text)' in pol.with_check) > 0
      AND position('(completed_at IS NULL)' in pol.with_check) > 0
      AND position('(opportunities.stage = ''won''::text)' in pol.with_check) > 0
      AND position('(opportunities.vehicle_id = deliveries.vehicle_id)' in pol.with_check) > 0
      AND position('(vehicles.status = ''sold''::text)' in pol.with_check) > 0
  ) THEN
    RAISE EXCEPTION 'DEC-053: deliveries needs exactly one UPDATE policy, deliveries_update_member, tenant-scoped in USING and WITH CHECK, and one INSERT policy for a pending delivery of the sold vehicle of a won opportunity';
  END IF;

  -- DEC-053 §3: un cambio de una entrega se valida a nivel de base de datos.
  -- El UPDATE solo es seguro con el trigger BEFORE UPDATE FOR EACH ROW
  -- (tgtype 19) habilitado, y con la función que exige la matriz, la
  -- inmutabilidad, el checklist entero para completar, un usuario y la
  -- unidad vendida (bloqueada FOR SHARE): SECURITY INVOKER, search_path
  -- vacío y sin EXECUTE para nadie.
  IF NOT EXISTS (
    SELECT FROM pg_catalog.pg_trigger t
    WHERE t.tgrelid = 'public.deliveries'::regclass
      AND t.tgname = 'deliveries_change_guard'
      AND NOT t.tgisinternal
      AND t.tgenabled = 'O'
      AND t.tgtype = 19
      AND t.tgfoid = to_regprocedure('private.enforce_delivery_change()')
  ) OR NOT EXISTS (
    SELECT FROM pg_catalog.pg_proc p
    WHERE p.oid = to_regprocedure('private.enforce_delivery_change()')
      AND NOT p.prosecdef
      AND p.proconfig = ARRAY['search_path=""']
      AND position('deliveries_immutable' in p.prosrc) > 0
      AND position('deliveries_completed' in p.prosrc) > 0
      AND position('deliveries_status_transition' in p.prosrc) > 0
      AND position('deliveries_checklist_incomplete' in p.prosrc) > 0
      AND position('deliveries_completion_requires_user' in p.prosrc) > 0
      AND position('deliveries_vehicle_not_sold' in p.prosrc) > 0
      AND position('FOR SHARE' in p.prosrc) > 0
      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('app_runtime', p.oid, 'EXECUTE')
      AND NOT EXISTS (
        SELECT FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
      )
  ) THEN
    RAISE EXCEPTION 'DEC-053: deliveries needs the enabled BEFORE UPDATE change guard trigger with its rules';
  END IF;

  -- DEC-053 §4: completar la entrega y dar salida a la unidad son un solo
  -- acto. El constraint trigger AFTER UPDATE FOR EACH ROW (tgtype 17),
  -- diferido al COMMIT, existe, está habilitado y su función (SECURITY
  -- INVOKER, search_path vacío, sin EXECUTE para nadie) exige la unidad
  -- entregada.
  IF NOT EXISTS (
    SELECT FROM pg_catalog.pg_trigger t
    WHERE t.tgrelid = 'public.deliveries'::regclass
      AND t.tgname = 'deliveries_completed_vehicle_delivered'
      AND NOT t.tgisinternal
      AND t.tgenabled = 'O'
      AND t.tgtype = 17
      AND t.tgconstraint <> 0
      AND t.tgdeferrable
      AND t.tginitdeferred
      AND t.tgfoid = to_regprocedure('private.enforce_completed_delivery_vehicle_delivered()')
  ) OR NOT EXISTS (
    SELECT FROM pg_catalog.pg_proc p
    WHERE p.oid = to_regprocedure('private.enforce_completed_delivery_vehicle_delivered()')
      AND NOT p.prosecdef
      AND p.proconfig = ARRAY['search_path=""']
      AND position('deliveries_completed_vehicle_delivered' in p.prosrc) > 0
      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('app_runtime', p.oid, 'EXECUTE')
      AND NOT EXISTS (
        SELECT FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
      )
  ) THEN
    RAISE EXCEPTION 'DEC-053: deliveries need the enabled deferred constraint trigger that requires the delivered vehicle of a completed delivery';
  END IF;

  -- DEC-053 §2: la entrega es de una oportunidad y de una unidad de la
  -- misma organización (FKs compuestas, validadas y RESTRICT).
  IF (
    SELECT count(*) FROM pg_catalog.pg_constraint k
    WHERE k.conrelid = 'public.deliveries'::regclass
      AND k.contype = 'f'
      AND k.convalidated
      AND k.confdeltype = 'r'
      AND cardinality(k.conkey) = 2
      AND (
        (k.conname = 'deliveries_opportunity_fk'
          AND k.confrelid = 'public.opportunities'::regclass)
        OR (k.conname = 'deliveries_vehicle_fk'
          AND k.confrelid = 'public.vehicles'::regclass)
      )
  ) <> 2 THEN
    RAISE EXCEPTION 'DEC-053: deliveries needs the composite opportunity and vehicle foreign keys';
  END IF;

  -- DEC-053 §1: ninguna entrega queda con un estado inválido, un checklist
  -- deforme, completada sin su sello o sin todo verificado, ni con una
  -- fecha fuera de rango. Los CHECKs existen y están validados.
  IF (
    SELECT count(*) FROM pg_catalog.pg_constraint k
    WHERE k.conrelid = 'public.deliveries'::regclass
      AND k.contype = 'c'
      AND k.convalidated
      AND k.conname IN (
        'deliveries_status_check',
        'deliveries_checklist_check',
        'deliveries_completion_check',
        'deliveries_scheduled_at_check'
      )
  ) <> 4 THEN
    RAISE EXCEPTION 'DEC-053: deliveries needs the validated status, checklist, completion and schedule CHECK constraints';
  END IF;

  -- DEC-053 §1: una entrega por oportunidad y una por unidad (índices
  -- únicos válidos).
  IF (
    SELECT count(*) FROM pg_catalog.pg_index i
    JOIN pg_catalog.pg_class c ON c.oid = i.indexrelid
    WHERE i.indrelid = 'public.deliveries'::regclass
      AND i.indisunique
      AND i.indisvalid
      AND c.relname IN (
        'deliveries_organization_id_opportunity_id_key',
        'deliveries_organization_id_vehicle_id_key'
      )
  ) <> 2 THEN
    RAISE EXCEPTION 'DEC-053: deliveries needs the unique delivery per opportunity and per vehicle';
  END IF;
END
$$;

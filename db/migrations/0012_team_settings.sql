-- Custom SQL (no lo genera drizzle-kit) · DEC-038 §4: las funciones de
-- soporte van primero, porque las policies de escritura de organizations y
-- memberships las usan.
--
-- Organizaciones donde el usuario de la request es admin con membership
-- activa. Mismo patrón que private.user_org_ids() (0001, ADR-001 §4):
-- SECURITY DEFINER (lee memberships sin re-evaluar su policy), STABLE,
-- search_path vacío y nombres calificados. EXECUTE solo para authenticated.
CREATE FUNCTION "private"."user_admin_org_ids"()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT m.organization_id
  FROM public.memberships AS m
  WHERE m.user_id = (SELECT auth.uid())
    AND m.active
    AND m.role = 'admin'
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "private"."user_admin_org_ids"() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "private"."user_admin_org_ids"() TO "authenticated";--> statement-breakpoint
-- DEC-038 §3: el usuario al que un admin invita, por email. El email vive en
-- auth.users y no se duplica en profiles (DEC-018), y authenticated no lee
-- auth.users: por eso es SECURITY DEFINER (owner postgres). Solo responde a
-- un admin activo de la organización pedida (si no, 42501, sin buscar nada)
-- y solo devuelve el id de un usuario con perfil (sin perfil no puede tener
-- membership) cuyo email coincide exactamente, sin distinguir mayúsculas.
-- Ninguna coincidencia, o más de una, es NULL. No crea cuentas ni perfiles
-- ni envía nada: el alta de cuentas sigue fuera (DEC-020, DEC-038 §3).
CREATE FUNCTION "private"."find_member_candidate"("p_organization_id" uuid, "p_email" text)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  candidates uuid[];
BEGIN
  IF p_organization_id IS NULL
    OR p_organization_id NOT IN (SELECT private.user_admin_org_ids())
  THEN
    RAISE EXCEPTION 'only an active admin of the organization can look up members'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT array_agg(p.id) INTO candidates
  FROM public.profiles AS p
  JOIN auth.users AS u ON u.id = p.id
  WHERE u.email IS NOT NULL
    AND lower(u.email) = lower(btrim(p_email));
  IF cardinality(candidates) = 1 THEN
    RETURN candidates[1];
  END IF;
  RETURN NULL;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "private"."find_member_candidate"(uuid, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "private"."find_member_candidate"(uuid, text) TO "authenticated";--> statement-breakpoint
-- DEC-038 §6 (amplía DEC-019): la lista del equipo. profiles sigue
-- mostrando solo el perfil propio, y auth.users no se expone: esta función
-- devuelve, a un miembro activo de la organización pedida, solo el nombre y
-- el email de los miembros activos de esa organización. A cualquier otro
-- usuario no le devuelve nada. SECURITY DEFINER (owner postgres), STABLE,
-- search_path vacío. EXECUTE solo para authenticated.
CREATE FUNCTION "private"."organization_members"("p_organization_id" uuid)
RETURNS TABLE (
  "membership_id" uuid,
  "user_id" uuid,
  "full_name" text,
  "email" text,
  "role" public.membership_role,
  "joined_at" timestamp with time zone
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT m.id, m.user_id, p.full_name, u.email::text, m.role, m.created_at
  FROM public.memberships AS m
  JOIN public.profiles AS p ON p.id = m.user_id
  LEFT JOIN auth.users AS u ON u.id = m.user_id
  WHERE m.organization_id = p_organization_id
    AND m.active
    AND p_organization_id IN (SELECT private.user_org_ids())
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "private"."organization_members"(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "private"."organization_members"(uuid) TO "authenticated";--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "default_currency" text DEFAULT 'PYG' NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_name_check" CHECK (char_length("organizations"."name") BETWEEN 1 AND 120 AND "organizations"."name" = btrim("organizations"."name") AND "organizations"."name" !~ '[[:cntrl:]]');--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_default_currency_check" CHECK ("organizations"."default_currency" IN ('PYG', 'USD'));--> statement-breakpoint
CREATE POLICY "organizations_update_admin" ON "organizations" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("organizations"."id" IN (SELECT private.user_admin_org_ids())) WITH CHECK ("organizations"."id" IN (SELECT private.user_admin_org_ids()));--> statement-breakpoint
CREATE POLICY "memberships_insert_admin" ON "memberships" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("memberships"."organization_id" IN (SELECT private.user_admin_org_ids()) AND "memberships"."active" AND "memberships"."created_at" = now() AND "memberships"."updated_at" = now());--> statement-breakpoint
CREATE POLICY "memberships_update_admin" ON "memberships" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("memberships"."organization_id" IN (SELECT private.user_admin_org_ids())) WITH CHECK ("memberships"."organization_id" IN (SELECT private.user_admin_org_ids()));
--> statement-breakpoint
-- Custom SQL · DEC-038 §4: el trigger de cambios de memberships. Rechaza
-- con 23514 (constraint nombrada):
--   - memberships_identity_immutable: mover una membership de organización
--     o de usuario, o cambiar su id o su alta;
--   - memberships_self_change: que el usuario de la request cambie su propia
--     membership (nadie se degrada ni se quita a sí mismo). Sin claims
--     (provisioning con el rol dueño) auth.uid() es NULL y no aplica;
--   - memberships_last_admin: que un pedido con identidad (claims) deje la
--     organización sin admin activo. Bloquea la fila de la organización (FOR
--     NO KEY UPDATE, que no choca con las FKs) antes de contar: dos admins
--     que se degradan a la vez se serializan y el segundo ve el cambio del
--     primero. Sin claims (provisioning con el rol dueño) no aplica: revocar
--     de inmediato una cuenta comprometida, aunque sea el único admin, tiene
--     que seguir siendo posible (ADR-001 §4, A-09).
-- Fija updated_at con el reloj de la base. SECURITY DEFINER (owner
-- postgres): bloquea y cuenta sin depender de los privilegios ni de las
-- policies del usuario. Sin EXECUTE para nadie: una función de trigger no
-- se puede llamar directo.
CREATE FUNCTION "private"."enforce_membership_change"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF (NEW.id, NEW.organization_id, NEW.user_id, NEW.created_at)
    IS DISTINCT FROM (OLD.id, OLD.organization_id, OLD.user_id, OLD.created_at)
  THEN
    RAISE EXCEPTION 'a membership cannot change its organization, user, id or creation date'
      USING ERRCODE = 'check_violation',
        TABLE = 'memberships',
        CONSTRAINT = 'memberships_identity_immutable';
  END IF;
  IF OLD.user_id = (SELECT auth.uid()) THEN
    RAISE EXCEPTION 'a member cannot change their own membership'
      USING ERRCODE = 'check_violation',
        TABLE = 'memberships',
        CONSTRAINT = 'memberships_self_change';
  END IF;
  IF OLD.role = 'admin' AND OLD.active
    AND NOT (NEW.role = 'admin' AND NEW.active)
    AND (SELECT auth.uid()) IS NOT NULL
  THEN
    PERFORM FROM public.organizations AS o
    WHERE o.id = OLD.organization_id
    FOR NO KEY UPDATE;
    IF NOT EXISTS (
      SELECT FROM public.memberships AS m
      WHERE m.organization_id = OLD.organization_id
        AND m.id <> OLD.id
        AND m.role = 'admin'
        AND m.active
    ) THEN
      RAISE EXCEPTION 'an organization needs at least one active admin'
        USING ERRCODE = 'check_violation',
          TABLE = 'memberships',
          CONSTRAINT = 'memberships_last_admin';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "private"."enforce_membership_change"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "memberships_change_guard" BEFORE UPDATE ON "public"."memberships" FOR EACH ROW EXECUTE FUNCTION "private"."enforce_membership_change"();--> statement-breakpoint
-- DEC-038 §2: la edición de una organización solo cambia el nombre y la
-- moneda por defecto (grant por columna); updated_at lo fija la base. No es
-- SECURITY DEFINER: solo mira OLD y NEW.
CREATE FUNCTION "private"."enforce_organization_update"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF (NEW.id, NEW.created_at) IS DISTINCT FROM (OLD.id, OLD.created_at) THEN
    RAISE EXCEPTION 'an organization cannot change its id or creation date'
      USING ERRCODE = 'check_violation',
        TABLE = 'organizations',
        CONSTRAINT = 'organizations_identity_immutable';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "private"."enforce_organization_update"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "organizations_update_guard" BEFORE UPDATE ON "public"."organizations" FOR EACH ROW EXECUTE FUNCTION "private"."enforce_organization_update"();--> statement-breakpoint
-- Custom SQL · ADR-001 §3.6: grants explícitos (DEC-038 §4).
-- organizations: UPDATE por columna, solo name, default_currency y
-- updated_at (Drizzle lo incluye en cada update(); el trigger lo pisa con
-- now()). Sin INSERT ni DELETE.
-- memberships: INSERT de tabla (diseño A, DEC-030 §9: Drizzle lista todas
-- las columnas), con WITH CHECK de admin, activa y reloj de la base, y
-- UPDATE por columna de role, active y updated_at. Sin DELETE: revocar es
-- active = false (DEC-018). anon y app_runtime no reciben nada.
GRANT UPDATE ("name", "default_currency", "updated_at") ON TABLE "public"."organizations" TO "authenticated";--> statement-breakpoint
GRANT INSERT ON TABLE "public"."memberships" TO "authenticated";--> statement-breakpoint
GRANT UPDATE ("role", "active", "updated_at") ON TABLE "public"."memberships" TO "authenticated";--> statement-breakpoint
-- Custom SQL · postcondiciones de ADR-001 §3.6 sobre la base real, para toda
-- tabla de public: las de 0011, con memberships entre las altas aprobadas y
-- organizations (name, default_currency, updated_at) y memberships (role,
-- active, updated_at) entre las ediciones aprobadas, y las de DEC-038: las
-- tres funciones que reciben EXECUTE de authenticated son SECURITY DEFINER
-- de postgres, con search_path vacío y EXECUTE solo para authenticated; la
-- función del trigger de memberships es SECURITY DEFINER de postgres, con
-- search_path vacío y sin EXECUTE para nadie; los dos triggers BEFORE UPDATE
-- FOR EACH ROW existen habilitados, y memberships y organizations no se
-- borran. Si alguna falla, la migración entera se revierte y no se aplica
-- nada.
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
END
$$;

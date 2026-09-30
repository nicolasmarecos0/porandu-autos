-- Custom SQL (no lo genera drizzle-kit) · ADR-001 §2 y §4: tenant isolation.
-- Rol de runtime app_runtime: LOGIN NOINHERIT NOBYPASSRLS, sin privilegios
-- directos y sin password (se fija fuera de las migraciones). Los roles son
-- del cluster: si app_runtime ya existe no se recrea, y las postcondiciones
-- del final rechazan la migración si sus atributos no son los de ADR-001.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_runtime') THEN
    CREATE ROLE "app_runtime" LOGIN NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;--> statement-breakpoint
-- Puede asumir authenticated (SET LOCAL ROLE en withTenant), pero no hereda
-- sus privilegios: sin asumirlo no lee ni escribe ninguna tabla.
GRANT "authenticated" TO "app_runtime" WITH INHERIT FALSE, SET TRUE;--> statement-breakpoint
-- Schema no expuesto para las funciones de soporte de RLS.
CREATE SCHEMA "private";--> statement-breakpoint
GRANT USAGE ON SCHEMA "private" TO "authenticated";--> statement-breakpoint
-- Organizaciones con membership activa del usuario de la request. SECURITY
-- DEFINER: corre como su owner (postgres, BYPASSRLS) y lee memberships sin
-- re-evaluar su policy, lo que evita la recursión. search_path vacío y
-- nombres calificados.
CREATE FUNCTION "private"."user_org_ids"()
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
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "private"."user_org_ids"() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "private"."user_org_ids"() TO "authenticated";--> statement-breakpoint
-- Solo lectura en H0: sin grants ni policies de escritura (default deny).
-- Todo grant de authenticated está cubierto por una policy (ADR-001 §3.6).
GRANT SELECT ON TABLE "public"."organizations", "public"."profiles", "public"."memberships" TO "authenticated";--> statement-breakpoint
CREATE POLICY "organizations_select_member" ON "organizations" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("organizations"."id" IN (SELECT private.user_org_ids()));--> statement-breakpoint
CREATE POLICY "profiles_select_own" ON "profiles" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("profiles"."id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "memberships_select_member" ON "memberships" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("memberships"."organization_id" IN (SELECT private.user_org_ids()));--> statement-breakpoint
-- Custom SQL · postcondiciones de ADR-001 §3.6 sobre la base real (no solo
-- en los tests). Si alguna falla, la migración entera se revierte.
DO $$
BEGIN
  IF EXISTS (
    SELECT FROM pg_catalog.pg_roles
    WHERE rolname = 'app_runtime'
      AND (rolsuper OR rolbypassrls OR rolinherit OR rolcreaterole
        OR rolcreatedb OR rolreplication OR NOT rolcanlogin)
  ) THEN
    RAISE EXCEPTION 'ADR-001: app_runtime must be LOGIN NOINHERIT NOBYPASSRLS, without superuser, CREATEROLE, CREATEDB or REPLICATION';
  END IF;

  IF EXISTS (
    SELECT FROM pg_catalog.pg_auth_members
    WHERE member = 'app_runtime'::regrole
      AND (roleid <> 'authenticated'::regrole OR inherit_option OR admin_option)
  ) THEN
    RAISE EXCEPTION 'ADR-001: app_runtime may only be a member of authenticated, WITH INHERIT FALSE and without ADMIN OPTION';
  END IF;

  IF EXISTS (
    SELECT FROM unnest(ARRAY['anon', 'authenticated', 'app_runtime']) AS r(role)
    WHERE has_database_privilege(r.role, current_database(), 'CREATE')
      OR has_schema_privilege(r.role, 'public', 'CREATE')
      OR has_schema_privilege(r.role, 'private', 'CREATE')
  ) THEN
    RAISE EXCEPTION 'ADR-001: anon, authenticated and app_runtime must not create objects';
  END IF;
END
$$;

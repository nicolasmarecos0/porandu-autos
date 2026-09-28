-- Spike ADR-001 · función de membership y policies RLS.
-- Se aplica con la credencial de migración (`postgres`) vía drizzle-kit migrate.

-- Organizaciones con membership ACTIVA del usuario de la request (auth.uid()).
-- SECURITY DEFINER: corre como su owner (`postgres`, BYPASSRLS), así que lee
-- memberships sin re-evaluar la policy de memberships (evita recursión 42P17).
-- search_path vacío y nombres calificados: nadie puede redirigir un nombre.
-- Se usa como `organization_id IN (SELECT private.user_org_ids())`, que el
-- planner evalúa una vez por statement (InitPlan) y no una vez por fila.
CREATE OR REPLACE FUNCTION private.user_org_ids()
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
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.user_org_ids() FROM PUBLIC, anon;
--> statement-breakpoint
GRANT USAGE ON SCHEMA private TO authenticated;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.user_org_ids() TO authenticated;
--> statement-breakpoint

-- H0 solo lee: no hay policies de escritura (default deny) y authenticated
-- tampoco tiene grants de escritura. Nadie puede auto-agregarse a otra org.
CREATE POLICY organizations_select_member ON public.organizations
  FOR SELECT TO authenticated
  USING (id IN (SELECT private.user_org_ids()));
--> statement-breakpoint
CREATE POLICY profiles_select_own ON public.profiles
  FOR SELECT TO authenticated
  USING (id = (SELECT auth.uid()));
--> statement-breakpoint
CREATE POLICY memberships_select_member ON public.memberships
  FOR SELECT TO authenticated
  USING (organization_id IN (SELECT private.user_org_ids()));

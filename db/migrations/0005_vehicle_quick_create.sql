CREATE POLICY "vehicles_insert_member" ON "vehicles" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("vehicles"."organization_id" IN (SELECT private.user_org_ids()) AND "vehicles"."status" = 'in_preparation');--> statement-breakpoint
-- Custom SQL (no lo genera drizzle-kit) · ADR-001 §3.6: grants explícitos.
-- Alta rápida de vehículos (H1.3B): authenticated recibe INSERT sobre
-- vehicles, cubierto por la policy de arriba, cuyo WITH CHECK exige una
-- organización con membership activa del usuario de la request y el estado
-- inicial `in_preparation` (el CHECK de status no cambia: los cambios de
-- estado serán policies de UPDATE). Sigue sin UPDATE ni DELETE (default
-- deny). app_runtime no recibe nada: solo escribe asumiendo authenticated
-- dentro de withTenant().
GRANT INSERT ON TABLE "public"."vehicles" TO "authenticated";--> statement-breakpoint
-- Custom SQL · postcondiciones de ADR-001 §3.6 sobre la base real, para toda
-- tabla de public (no solo vehicles): las de 0004, con vehicles entre las
-- altas aprobadas. Si alguna falla, la migración entera se revierte y no se
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

  IF EXISTS (
    SELECT FROM pg_catalog.pg_class c
    CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) AS p(privilege)
    WHERE c.relnamespace = 'public'::regnamespace
      AND c.relkind IN ('r', 'p')
      AND has_table_privilege('authenticated', c.oid, p.privilege)
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

  IF EXISTS (
    SELECT FROM pg_catalog.pg_class c
    CROSS JOIN unnest(ARRAY['UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) AS p(privilege)
    WHERE c.relnamespace = 'public'::regnamespace
      AND c.relkind IN ('r', 'p')
      AND (
        has_table_privilege('authenticated', c.oid, p.privilege)
        OR (
          p.privilege IN ('UPDATE', 'REFERENCES')
          AND has_any_column_privilege('authenticated', c.oid, p.privilege)
        )
      )
  ) THEN
    RAISE EXCEPTION 'ADR-001: authenticated must not update, delete or truncate public tables (H1.2 and H1.3B only add inserts)';
  END IF;

  -- Las únicas altas aprobadas son las de H1.2 (contacts y opportunities) y
  -- la de H1.3B (vehicles): ninguna otra tabla recibe INSERT sin una
  -- migración que lo apruebe.
  IF EXISTS (
    SELECT FROM pg_catalog.pg_class c
    WHERE c.relnamespace = 'public'::regnamespace
      AND c.relkind IN ('r', 'p')
      AND c.relname NOT IN ('contacts', 'opportunities', 'vehicles')
      AND (
        has_table_privilege('authenticated', c.oid, 'INSERT')
        OR has_any_column_privilege('authenticated', c.oid, 'INSERT')
      )
  ) THEN
    RAISE EXCEPTION 'ADR-001: authenticated may only insert into contacts, opportunities and vehicles (H1.3B)';
  END IF;
END
$$;

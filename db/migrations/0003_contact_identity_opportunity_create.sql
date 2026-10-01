ALTER TABLE "contacts" ADD COLUMN "phone_normalized" text;--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_organization_id_phone_normalized_key" ON "contacts" USING btree ("organization_id","phone_normalized") WHERE "contacts"."phone_normalized" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_phone_normalized_check" CHECK ("contacts"."phone_normalized" IS NULL OR ("contacts"."phone" IS NOT NULL AND "contacts"."phone_normalized" ~ '^\+[1-9][0-9]{1,14}$'));--> statement-breakpoint
CREATE POLICY "contacts_insert_member" ON "contacts" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("contacts"."organization_id" IN (SELECT private.user_org_ids()));--> statement-breakpoint
CREATE POLICY "opportunities_insert_member" ON "opportunities" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("opportunities"."organization_id" IN (SELECT private.user_org_ids()));
--> statement-breakpoint
-- Custom SQL (no lo genera drizzle-kit) · ADR-001 §3.6: grants explícitos.
-- Alta de contactos y oportunidades (H1.2): authenticated recibe INSERT,
-- cubierto por las policies de arriba, cuyo WITH CHECK exige una
-- organización con membership activa del usuario de la request. Sigue sin
-- UPDATE ni DELETE (default deny). app_runtime no recibe nada: solo escribe
-- asumiendo authenticated dentro de withTenant().
-- No se backfillea phone_normalized de los contactos existentes: la
-- normalización es del código, no del SQL.
GRANT INSERT ON TABLE "public"."contacts", "public"."opportunities" TO "authenticated";--> statement-breakpoint
-- Custom SQL · postcondiciones de ADR-001 §3.6 sobre la base real, para toda
-- tabla de public (no solo las de esta migración), más las de las primeras
-- escrituras. Si alguna falla, la migración entera se revierte y no se
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

  -- Una policy de escritura sin WITH CHECK no limita la fila escrita
  -- (ADR-001 §4): toda alta tiene que quedar dentro de una organización con
  -- membership activa.
  IF EXISTS (
    SELECT FROM pg_catalog.pg_policies pol
    WHERE pol.schemaname = 'public'
      AND pol.cmd IN ('INSERT', 'UPDATE', 'ALL')
      AND pol.with_check IS NULL
  ) THEN
    RAISE EXCEPTION 'ADR-001: every write policy on public tables must have a WITH CHECK';
  END IF;

  -- H1.2 solo habilita altas: authenticated no modifica, borra ni vacía
  -- ninguna tabla de public.
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
    RAISE EXCEPTION 'ADR-001: authenticated must not update, delete or truncate public tables (H1.2 only adds inserts)';
  END IF;
END
$$;

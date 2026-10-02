CREATE TABLE "vehicles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"brand" text NOT NULL,
	"model" text NOT NULL,
	"version" text,
	"year" smallint NOT NULL,
	"km" integer,
	"price" numeric(14, 2),
	"currency" text,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicles_status_check" CHECK ("vehicles"."status" IN ('in_preparation', 'available', 'reserved', 'sold')),
	CONSTRAINT "vehicles_currency_check" CHECK ("vehicles"."currency" IN ('PYG', 'USD')),
	CONSTRAINT "vehicles_price_check" CHECK (("vehicles"."price" IS NULL) = ("vehicles"."currency" IS NULL) AND ("vehicles"."price" IS NULL OR ("vehicles"."price" > 0 AND ("vehicles"."currency" <> 'PYG' OR "vehicles"."price" = trunc("vehicles"."price"))))),
	CONSTRAINT "vehicles_year_check" CHECK ("vehicles"."year" BETWEEN 1900 AND 2100),
	CONSTRAINT "vehicles_km_check" CHECK ("vehicles"."km" IS NULL OR "vehicles"."km" >= 0)
);
--> statement-breakpoint
ALTER TABLE "vehicles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vehicles_organization_id_created_at_idx" ON "vehicles" USING btree ("organization_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE POLICY "vehicles_select_member" ON "vehicles" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("vehicles"."organization_id" IN (SELECT private.user_org_ids()));--> statement-breakpoint
-- Custom SQL (no lo genera drizzle-kit) · ADR-001 §3.6: grants explícitos.
-- 0000 ya revocó los default privileges de anon y authenticated para lo que
-- postgres crea en public; igual se revoca sobre esta tabla, como en 0002.
-- Solo lectura en H1.3A: authenticated recibe SELECT, cubierto por la policy
-- de arriba. Sin grants ni policies de escritura (default deny): el alta y la
-- edición de vehículos no están aprobadas todavía. app_runtime no recibe
-- nada: solo lee asumiendo authenticated dentro de withTenant().
REVOKE ALL ON TABLE "public"."vehicles" FROM "anon", "authenticated";--> statement-breakpoint
GRANT SELECT ON TABLE "public"."vehicles" TO "authenticated";--> statement-breakpoint
-- Custom SQL · postcondiciones de ADR-001 §3.6 sobre la base real, para toda
-- tabla de public (no solo vehicles): las de 0003 y, además, que las únicas
-- altas sean las de H1.2. Si alguna falla, la migración entera se revierte y
-- no se aplica nada.
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
    RAISE EXCEPTION 'ADR-001: authenticated must not update, delete or truncate public tables (H1.2 only adds inserts)';
  END IF;

  -- Las únicas altas aprobadas son las de H1.2 (contacts y opportunities):
  -- vehicles es de solo lectura en H1.3A, y ninguna otra tabla recibe INSERT
  -- sin una migración que lo apruebe.
  IF EXISTS (
    SELECT FROM pg_catalog.pg_class c
    WHERE c.relnamespace = 'public'::regnamespace
      AND c.relkind IN ('r', 'p')
      AND c.relname NOT IN ('contacts', 'opportunities')
      AND (
        has_table_privilege('authenticated', c.oid, 'INSERT')
        OR has_any_column_privilege('authenticated', c.oid, 'INSERT')
      )
  ) THEN
    RAISE EXCEPTION 'ADR-001: authenticated may only insert into contacts and opportunities (H1.3A: vehicles is read-only)';
  END IF;
END
$$;

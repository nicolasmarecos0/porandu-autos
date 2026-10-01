CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"city" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contacts_organization_id_id_key" UNIQUE("organization_id","id")
);
--> statement-breakpoint
ALTER TABLE "contacts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "opportunities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"stage" text NOT NULL,
	"source" text NOT NULL,
	"interest_model" text,
	"interest_version" text,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "opportunities_stage_check" CHECK ("opportunities"."stage" IN ('new', 'qualified', 'test_drive', 'negotiation')),
	CONSTRAINT "opportunities_source_check" CHECK ("opportunities"."source" IN ('whatsapp', 'meta_ads', 'web', 'showroom', 'referral'))
);
--> statement-breakpoint
ALTER TABLE "opportunities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_organization_id_contact_id_contacts_fk" FOREIGN KEY ("organization_id","contact_id") REFERENCES "public"."contacts"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "opportunities_organization_id_last_activity_at_idx" ON "opportunities" USING btree ("organization_id","last_activity_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "opportunities_organization_id_contact_id_idx" ON "opportunities" USING btree ("organization_id","contact_id");--> statement-breakpoint
CREATE POLICY "contacts_select_member" ON "contacts" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("contacts"."organization_id" IN (SELECT private.user_org_ids()));--> statement-breakpoint
CREATE POLICY "opportunities_select_member" ON "opportunities" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("opportunities"."organization_id" IN (SELECT private.user_org_ids()));
--> statement-breakpoint
-- Custom SQL (no lo genera drizzle-kit) · ADR-001 §3.6: grants explícitos.
-- 0000 ya revocó los default privileges de anon y authenticated para lo que
-- postgres crea en public; igual se revoca sobre estas tablas, como en 0000.
-- Solo lectura en H1.1: authenticated recibe SELECT, cubierto por las
-- policies de arriba. Sin grants ni policies de escritura (default deny).
-- app_runtime no recibe nada: solo lee asumiendo authenticated en withTenant.
REVOKE ALL ON TABLE "public"."contacts", "public"."opportunities" FROM "anon", "authenticated";--> statement-breakpoint
GRANT SELECT ON TABLE "public"."contacts", "public"."opportunities" TO "authenticated";--> statement-breakpoint
-- Custom SQL · postcondiciones de ADR-001 §3.6 sobre la base real, para toda
-- tabla de public (no solo las de esta migración). Si alguna falla, la
-- migración entera se revierte y no se aplica nada.
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
END
$$;

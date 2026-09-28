-- Spike ADR-001 · roles y grants.
-- Se aplica con la credencial de migración (`postgres`) vía drizzle-kit migrate.
-- No contiene passwords: la de app_runtime se fija fuera de banda
-- (harness de tests en E0/E1; operador en E2).

-- Schema privado para funciones de seguridad. No está en la Data API.
CREATE SCHEMA IF NOT EXISTS private;
--> statement-breakpoint
REVOKE ALL ON SCHEMA private FROM PUBLIC;
--> statement-breakpoint

-- Rol de runtime (hipótesis D1): LOGIN, sin BYPASSRLS, sin herencia y sin
-- privilegios propios. Sin `SET ROLE authenticated` no puede leer ni escribir
-- ninguna tabla de la aplicación (falla cerrado).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    CREATE ROLE app_runtime WITH LOGIN NOINHERIT NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;
--> statement-breakpoint

-- Q1: app_runtime puede ASUMIR authenticated (SET ROLE) pero no hereda sus
-- privilegios. Si Supabase no permite este grant desde `postgres`, la
-- migración falla acá y el resultado queda registrado en RESULTS.md.
GRANT authenticated TO app_runtime WITH INHERIT FALSE, SET TRUE;
--> statement-breakpoint

-- Hipótesis D3: grants explícitos. Supabase otorga por defecto ALL a
-- anon/authenticated sobre las tablas nuevas de `public`; se revocan y se
-- otorga solo lo que H0 necesita (lectura).
REVOKE ALL ON TABLE public.organizations, public.profiles, public.memberships FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT ON TABLE public.organizations, public.profiles, public.memberships TO authenticated;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;
--> statement-breakpoint

-- Ni el runtime ni los roles de la Data API pueden crear objetos en `public`.
REVOKE CREATE ON SCHEMA public FROM PUBLIC, anon, authenticated;

-- E0 · shim mínimo de Supabase sobre PostgreSQL vanilla.
-- SOLO para iterar el harness sin Docker. NO es evidencia para ADR-001:
--   - acá `postgres` es un rol creado por el shim (no el de Supabase);
--   - la membresía de postgres en authenticated la otorga el shim, así que
--     E0 no puede responder Q1;
--   - no hay GoTrue, PostgREST ni Supavisor.
-- Se ejecuta como superusuario `supabase_admin`, antes de las migraciones.

CREATE ROLE postgres WITH LOGIN PASSWORD 'postgres' CREATEROLE CREATEDB BYPASSRLS;
CREATE ROLE anon NOLOGIN NOINHERIT;
CREATE ROLE authenticated NOLOGIN NOINHERIT;
CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
GRANT anon, authenticated, service_role TO postgres WITH ADMIN OPTION;

CREATE SCHEMA auth AUTHORIZATION supabase_admin;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;
GRANT USAGE ON SCHEMA auth TO postgres, anon, authenticated, service_role;
GRANT SELECT, INSERT, DELETE, REFERENCES ON auth.users TO postgres;

-- En Supabase `postgres` puede crear schemas (drizzle-kit crea `drizzle`; la
-- migración 0001 crea `private`).
GRANT CREATE ON DATABASE postgres TO postgres;
GRANT ALL ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
-- Imita el default de Supabase ("Automatically expose new tables").
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON TABLES TO anon, authenticated, service_role;

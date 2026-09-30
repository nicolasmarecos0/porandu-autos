-- Mínimo de Supabase del que depende la migración, sobre PostgreSQL vanilla.
-- Solo para tests: se ejecuta como superusuario en cada base de prueba, antes
-- de las migraciones. No es Supabase: no hay GoTrue, PostgREST ni Supavisor.

-- Supabase Auth. profiles.id referencia auth.users(id).
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
-- Lo mínimo para que postgres cree la FK: si la migración funciona con esto,
-- también funciona con los privilegios más amplios que postgres tiene en Supabase.
GRANT USAGE ON SCHEMA auth TO postgres;
GRANT REFERENCES ON auth.users TO postgres;

-- postgres crea tablas en public (y drizzle-kit, su schema `drizzle`).
GRANT USAGE, CREATE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- Default de Supabase: todo objeto nuevo de public nace con ALL para los
-- roles de la Data API. La migración tiene que revocarlo (ADR-001 §3.6).
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;

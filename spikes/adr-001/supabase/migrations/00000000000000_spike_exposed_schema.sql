-- Bootstrap del CONTROL POSITIVO de la Data API (test 60-data-api), no de la app.
--
-- PostgREST no arranca si un schema listado en [api].schemas no existe, y
-- `supabase start` falla el health check. Este archivo lo aplica la CLI antes
-- de levantar PostgREST. Solo crea el schema vacío; la tabla de control la crea
-- el harness de tests.
--
-- Las tablas de la aplicación NO se crean acá: su única fuente son las
-- migraciones de drizzle-kit en spikes/adr-001/migrations.
CREATE SCHEMA IF NOT EXISTS spike_exposed;

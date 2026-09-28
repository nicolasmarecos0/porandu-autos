# Spike ADR-001 · validación empírica de la arquitectura A

> **Experimental. No es código de producto y no se mergea (PR-0).**
> Autorizado solo para producir evidencia. ADR-001 sigue abierta y ninguna
> hipótesis D1–D20 queda aprobada por este spike.

## Qué prueba

La cadena de la arquitectura A:

```
app_runtime ─▶ pooler en modo transacción ─▶ BEGIN
            ─▶ set_config('request.jwt.claims', <claims verificados>, true)
            ─▶ set_config('role', 'authenticated', true)      (≡ SET LOCAL ROLE)
            ─▶ RLS: organization_id IN (SELECT private.user_org_ids())
            ─▶ aislamiento A/B ─▶ COMMIT/ROLLBACK sin residuos
```

y además que la falla es cerrada, que `postgres` solo migra y que el navegador
no tiene una Data API lateral hacia las tablas de la aplicación.

## Entornos

| Entorno | Qué es | Cuenta como evidencia |
|---|---|---|
| E0 | PostgreSQL local + shim mínimo de Supabase (`e0/`) | **No.** Solo sirve para iterar el harness sin Docker |
| **E1** | Supabase local real (CLI + Docker) en GitHub Actions | **Sí** |
| E2 | Proyecto Supabase de staging | No ejecutado (lo configura el fundador más adelante) |
| E3 | Preview de Vercel | No ejecutado |

## Estructura

```
supabase/config.toml       Supabase local de E1: public NO expuesto, pooler en modo transacción, signup off
supabase/migrations/       solo crea el schema vacío del control positivo (PostgREST lo exige al arrancar)
drizzle.config.ts          Único lugar que lee la credencial de migración (SPIKE_MIGRATION_URL)
src/schema.ts              organizations, profiles, memberships (RLS habilitado desde la creación)
migrations/0000_tables     generada por drizzle-kit
migrations/0001_roles_grants   app_runtime, grant de authenticated (Q1), grants explícitos
migrations/0002_rls_policies   private.user_org_ids() y policies de lectura
src/runtime.ts             conexión app_runtime (factory: directa o pooler)
src/tenant.ts              withTenant / withUser: única puerta de datos
src/tenant-context.ts      resolveTenant(): prototipo de requireTenant() sin Next
src/claims.ts              verifyAccessToken() con auth.getClaims(token)
src/actions.ts             patrón de mutación: input estricto, la org sale del contexto
test/support/              env, conexiones crudas, fixtures (global-setup), HS256 para E0
test/00…90                 matriz (ver abajo)
scripts/summarize.mts      resumen Markdown para el workflow
e0/                        shim local (no evidencia)
```

## Mapa de criterios

| Criterio | Tests |
|---|---|
| C1 · A nunca accede a B (y viceversa) | `20-rls-matrix` (S-10…S-32, conexión directa y pooler), `40-app-isolation` (A-01…A-09) |
| C2 · sin contexto falla cerrado | `30-fail-closed` (S-40…S-43, A-10), S-31 |
| C3 · catálogo (RLS en toda tabla, grant ⇒ policy) | `00-catalog` (S-60…S-65) |
| C4 · compatible con el pooler en modo transacción | `20`, `30`, `40`, `50` sobre la conexión `pooler` |
| C5 · latencia (solo medición, sin umbral) | `80-latency` |
| C6 · claims/rol no sobreviven a la transacción | `50-pooler-leak` (S-50, P3 con 600 transacciones, control negativo local) |
| C7 · `postgres` migra, nunca en runtime | `70-runtime-vs-migration` (M-1…M-4), S-43 |
| C8 · sin Data API lateral | `60-data-api` (PostgREST + GraphQL, con control positivo) |
| C9 · Q1: `grant authenticated to app_runtime` en Supabase | migración 0001 + `00-catalog` (Q1) |

## Guardas del experimento

- El control negativo de fuga (`set_config(..., false)` de sesión) corre **solo
  contra hosts loopback** (E0/E1). Nunca contra staging.
- La latencia se mide y se reporta; **no hay umbral** que haga fallar el spike.
- El workflow no usa secrets: la password de `app_runtime` es efímera y se
  genera en el runner.

## Cómo correrlo

**E1 (evidencia):** push a `spike/h0-saas-foundation` con cambios en
`spikes/adr-001/**` dispara `.github/workflows/spike-adr-001.yml`. En una máquina
con Docker se pueden reproducir los mismos pasos que el workflow
(`supabase start --workdir spikes/adr-001`, `drizzle-kit migrate`, `vitest run`).

**E0 (solo iteración, usuario no-root):**

```bash
E0_DATA_DIR=/tmp/adr001-e0/data bash spikes/adr-001/e0/start.sh
export SPIKE_TARGET=e0 \
  SPIKE_MIGRATION_URL=postgresql://postgres:postgres@127.0.0.1:55432/postgres \
  SPIKE_APP_RUNTIME_PASSWORD=e0-runtime-pw \
  SPIKE_RUNTIME_URL=postgresql://app_runtime:e0-runtime-pw@127.0.0.1:55432/postgres \
  SPIKE_JWT_SECRET=e0-local-secret-at-least-32-characters
pnpm exec drizzle-kit migrate --config spikes/adr-001/drizzle.config.ts
pnpm exec vitest run --config spikes/adr-001/vitest.config.mts
```

El global setup no es idempotente: cada corrida necesita una base recién creada.

## Diferencias deliberadas con el producto previsto

- `src/runtime.ts` es una factory (para comparar directa vs pooler); el producto
  tendría un único `db/client.ts` server-only construido desde el env.
- `src/actions.ts` valida a mano porque Zod no está autorizado en el spike; el
  producto usaría `z.object(...).strict()`.
- `resolveTenant()` recibe la org solicitada como argumento; en el producto sale
  de una cookie httpOnly dentro de `requireTenant()`.
- `tenant_probe` y `spike_exposed` existen solo en las bases de test.

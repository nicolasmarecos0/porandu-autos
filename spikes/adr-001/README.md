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
| **E1** | Supabase local real (CLI + Docker) en GitHub Actions | **Sí.** Ejecutado (corrida de referencia: [run 36493339590](https://github.com/nicolasmarecos0/porandu-autos/actions/runs/36493339590)) |
| **E2** | Proyecto Supabase de staging (`sa-east-1`) | **Sí.** Ejecutado en staging `sa-east-1` ([run 36590229247](https://github.com/nicolasmarecos0/porandu-autos/actions/runs/36590229247)): tenant isolation validado en cloud |
| E3 | Preview de Vercel | Pendiente, solo para latencia, pool y serverless |

Resultados por criterio, hallazgos y recomendación: [`RESULTS.md`](RESULTS.md).

## Estructura

```
RESULTS.md                 resultados de E1 y E2 por criterio, hallazgos, recomendación y pendientes de E3
supabase/config.toml       Supabase local de E1: public NO expuesto (ni en extra_search_path), pooler en modo transacción, signup off
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
test/support/staging.ts    E2: deriva en proceso las URLs de staging desde los secrets
test/00…90                 matriz (ver abajo)
scripts/summarize.mts      resumen Markdown para el workflow
scripts/e2-preflight.mjs   E2: valida los secrets sin imprimir valores
scripts/e2-cleanup.mjs     E2: borra lo sintético y anula la password de app_runtime
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
| C8 · sin Data API lateral | `60-data-api` (E1: PostgREST; GraphQL con pg_graphql deshabilitado y habilitado; reproducción SQL del mecanismo de `search_path`; controles positivos. E2: Data API de staging deshabilitada, sin habilitar nada) |
| C9 · Q1: `grant authenticated to app_runtime` en Supabase | migración 0001 + `00-catalog` (Q1) |
| D8 · signup cerrado, login con password abierto | `45-auth-config` (E1/E2) |

## Guardas del experimento

- El control negativo de fuga (`set_config(..., false)` de sesión) corre **solo
  contra hosts loopback** (E0/E1). Nunca contra staging: los dos tests que lo
  hacen exigen `127.0.0.1`/`localhost` y target e0/e1.
- La latencia se mide y se reporta; **no hay umbral** que haga fallar el spike.
- E1 no usa secrets. En E2 los secrets entran paso a paso, las URLs se derivan
  dentro de Node y la password de `app_runtime` es efímera (se genera en el
  runner y la limpieza la anula).
- E2 no habilita extensiones ni cambia la configuración de la Data API de staging.

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

**E2 (staging, disparo deliberado):** push de un tag `adr-001-e2-*` dispara
`.github/workflows/spike-adr-001-e2.yml`. Requiere 5 Repository secrets:
`STAGING_SUPABASE_URL`, `STAGING_PUBLISHABLE_KEY`, `STAGING_SECRET_KEY`,
`STAGING_DB_PASSWORD` y `STAGING_SESSION_POOLER_URL` (este último tal como lo
muestra Supabase, con `[YOUR-PASSWORD]` sin reemplazar). La corrida de E2 ya
ejecutada usó la rama temporal `spike/adr-001-e2-run`, que solo cambia este
disparo por un push a esa rama, porque el entorno de Claude Code no puede pushear tags.

Orden de provisioning, sin que nadie arme connection strings:

1. **Preflight:** valida los 5 secrets (claves nuevas, mismo project ref). No imprime valores.
2. **Limpieza previa:** borra restos sintéticos de una corrida interrumpida.
3. **Migraciones con `postgres`** (pooler en modo sesión, 5432). Crean `app_runtime` **sin password**, aplican el grant de Q1, las grants y las policies.
4. **Global setup (con `postgres`):** fija en `app_runtime` una password **efímera**, generada en el runner y enmascarada.
5. **Runtime:** con esa password se deriva en proceso `app_runtime.<ref>` por 5432 (sesión) y 6543 (transacción).
6. **Limpieza final:** borra usuarios `@adr001.test`, organizaciones `ADR-001 spike …` y `tenant_probe`, y **anula la password de `app_runtime`**.

Efecto persistente en staging: el schema del spike (tablas `organizations`,
`profiles`, `memberships`, enum, schema `private` y su función, policies, rol
`app_runtime` sin password, schema `drizzle` con el historial de migraciones).
Antes de aplicar las migraciones reales del producto (PR-5) staging tendrá que
resetearse o recibir una migración de limpieza.

## Diferencias deliberadas con el producto previsto

- `src/runtime.ts` es una factory (para comparar directa vs pooler); el producto
  tendría un único `db/client.ts` server-only construido desde el env.
- `src/actions.ts` valida a mano porque Zod no está autorizado en el spike; el
  producto usaría `z.object(...).strict()`.
- `resolveTenant()` recibe la org solicitada como argumento; en el producto sale
  de una cookie httpOnly dentro de `requireTenant()`.
- `tenant_probe` y `spike_exposed` existen solo en las bases de test.
- En E2 las conexiones usan `sslmode=require` (TLS sin verificar la CA). El
  producto debería usar `verify-full` con el certificado de Supabase.

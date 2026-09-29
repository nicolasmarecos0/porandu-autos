# Spike ADR-001 · resultados de E1 y E2

> **Experimental.** E1 (Supabase local) y E2 (proyecto Supabase de staging,
> `sa-east-1`) están ejecutados. E3 (Vercel) no.
> El fundador aceptó E2 como evidencia suficiente para cerrar ADR-001 en lo
> relativo a tenant isolation. La aprobación formal todavía **no** está
> registrada en el Decisions Log, y este documento no convierte ninguna
> hipótesis D1–D20 en decisión.

## Recomendación para ADR-001

**La arquitectura A queda recomendada para aprobación** en lo relativo a tenant
isolation. Todos los criterios de aislamiento pasaron en E1 y se confirmaron en
cloud en E2.

| Pieza                            | Qué es                                                                                                                                                                                           |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `app_runtime`                    | Rol de runtime de mínimo privilegio: `LOGIN NOINHERIT NOBYPASSRLS`, sin grants directos, miembro de `authenticated` `WITH INHERIT FALSE, SET TRUE` (Q1).                                         |
| Drizzle                          | `drizzle-orm` para queries y `drizzle-kit` para migraciones SQL versionadas; `postgres-js` con `prepare: false`.                                                                                 |
| `withTenant`                     | Única puerta de datos: una transacción con `set_config('request.jwt.claims', <claims verificados>, true)` y `set_config('role', 'authenticated', true)`. Sin `withTenant`, falla cerrado.        |
| RLS                              | Habilitado en toda tabla. Policies `organization_id IN (SELECT private.user_org_ids())`; la función es `SECURITY DEFINER`, `STABLE` y con `search_path = ''`, y se evalúa una vez por statement. |
| Supavisor en modo transacción    | El runtime se conecta como `app_runtime.<project_ref>` por el puerto 6543. Sin residuos de claims ni de rol entre transacciones.                                                                 |
| Credencial de migración separada | `postgres` solo aplica migraciones (`drizzle-kit`, pooler en modo sesión 5432). Nunca se usa en runtime; `src/` no la referencia.                                                                |

**Condiciones de la recomendación:**

1. **Data API deshabilitada en H0.** Ver [Hallazgo 4](#hallazgo-4--con-la-data-api-deshabilitada-los-endpoints-siguen-respondiendo-503).
2. **`pg_graphql` no se habilita.** Ver [Hallazgo 1](#hallazgo-1--graphql-es-una-data-api-lateral-con-la-configuración-por-defecto) y [Hallazgo 5](#hallazgo-5--pg_graphql-no-está-instalado-en-staging).
3. **El runtime nunca usa `SET` de sesión ni `set_config(..., false)`.** Solo las formas `LOCAL` dentro de `withTenant`. Ver [Hallazgo 2](#hallazgo-2--supavisor-en-modo-transacción-no-limpia-el-estado-de-sesión-entre-clientes).
4. **E3 queda pendiente** para latencia (C5 / D19), tamaño de pool y comportamiento serverless (Vercel Fluid, JWKS). No cambia el mecanismo de aislamiento.

## Entorno E1

| Componente   | Versión observada                                                            |
| ------------ | ---------------------------------------------------------------------------- |
| Runner       | GitHub Actions `ubuntu-latest`                                               |
| Supabase CLI | 2.118.0 (`supabase/setup-cli`)                                               |
| Postgres     | 17.6 (`supabase/postgres:17.6.1.171`)                                        |
| Pooler       | Supavisor 2.9.13, modo transacción, `default_pool_size = 5`                  |
| Auth         | GoTrue v2.197.0, JWT **ES256** (asimétrico, con `kid`)                       |
| Claves       | `sb_publishable_…` y `sb_secret_…` (formato nuevo)                           |
| Runtime      | `app_runtime` directo (54322) y vía pooler (`app_runtime.pooler-dev`, 54329) |

**Corrida de referencia:** [run 36493339590](https://github.com/nicolasmarecos0/porandu-autos/actions/runs/36493339590), commit `2463b37`: **150 pass · 0 fail · 1 skip**.

## Resultado por criterio (E1)

| Criterio                                                                                        | E1                                              | Evidencia                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **C1** · A nunca lee ni modifica datos de B (ni B los de A)                                     | **PASS**                                        | S-10…S-32 en ambos sentidos, por conexión directa **y** por pooler: SELECT cruzado 0 filas, INSERT cruzado 42501, UPDATE/DELETE cruzados 0 filas, mover una fila a otra org rechazado por `WITH CHECK`, auto-agregarse a otra org 42501. A-01…A-09 por la capa de aplicación (directa y pooler). A-03: un contexto falsificado `{uA, org B}` sigue sin ver B.                                             |
| **C2** · sin `withTenant` falla cerrado                                                         | **PASS**                                        | S-40: `app_runtime` sin `SET ROLE` → `42501 permission denied` en las 4 tablas (directa y pooler). S-40b: los claims solos no dan acceso. A-10: Drizzle sobre el runtime sin `withTenant` → 42501. S-41: `app_runtime` no puede asumir `service_role`, `postgres`, `anon` ni `supabase_admin`. S-42: `anon` → 42501. S-31: `authenticated` sin claims nunca ve filas.                                     |
| **C3** · catálogo                                                                               | **PASS**                                        | S-60: toda tabla de `public` tiene RLS. S-61: todo privilegio de `authenticated` está cubierto por una policy; toda tabla con `organization_id` tiene NOT NULL, FK e índice líder. S-62/S-63: `app_runtime` sin super, bypassrls ni herencia, y sin grants directos; `anon` sin privilegios; sin `security definer` en `public`. S-64: meta-cobertura.                                                    |
| **C4** · compatible con el pooler en modo transacción                                           | **PASS (local)**                                | Toda la matriz (C1, C2, C6, C7) corre también por Supavisor local. El rol custom autentica por el pooler (`ok:app_runtime`). Supavisor cloud: confirmado en E2. **No probado:** Vercel (E3).                                                                                                                                                                                                              |
| **C5** · latencia                                                                               | **MEDIDA, sin umbral**                          | Ver tabla abajo. No se aplica ningún gate.                                                                                                                                                                                                                                                                                                                                                                |
| **C6** · claims y rol no sobreviven a la transacción                                            | **PASS**                                        | S-50: después de COMMIT, ROLLBACK y error, la conexión vuelve a `app_runtime` sin claims. P3: 600 transacciones (480 commit, 60 rollback, 60 error) con **0 residuos** y **0 inconsistencias**, tanto por conexión directa (8 backends) como por pooler (6 backends, todos reutilizados entre usuarios distintos). El control negativo de sesión detecta la contaminación.                                |
| **C7** · `postgres` migra, nunca en runtime                                                     | **PASS**                                        | `drizzle-kit migrate` corrió con `postgres`. M-1: DDL con `postgres`. M-2/M-3: `session_user = current_user = app_runtime` y, con el runtime ocupado, ningún backend del runtime es `postgres`. S-43: ni `app_runtime` ni `authenticated` pueden crear objetos. M-4: `src/` no referencia la credencial de migración.                                                                                     |
| **C8** · sin Data API lateral                                                                   | **PASS con configuración; FAIL con el default** | **PostgREST:** `public` y `private` no expuestos (PGRST205, PGRST106, PGRST202); el POST no escribe nada; el control positivo sí sirve datos filtrados por RLS. **GraphQL:** ver [Hallazgo 1](#hallazgo-1--graphql-es-una-data-api-lateral-con-la-configuración-por-defecto). Con pg_graphql habilitado y `extra_search_path` por defecto (incluye `public`), `authenticated` **lee tablas de `public`**. |
| **C9** · Q1: `GRANT authenticated TO app_runtime WITH INHERIT FALSE, SET TRUE` desde `postgres` | **PASS (imagen local)**                         | La migración 0001 se aplicó con `postgres`. `pg_auth_members` muestra `inherit=false, set=true, admin=false`. Confirmado en el proyecto cloud (E2).                                                                                                                                                                                                                                                       |

Además:

- S-65 confirma el hecho R1: en Supabase `postgres` tiene `rolbypassrls = true`, `rolsuper = false` y es owner de las tablas.
- S-04: la policy `organization_id IN (SELECT private.user_org_ids())` se planifica como `hashed SubPlan` y se ejecuta **una vez por statement** (`Actual Loops = 1`), no una vez por fila.

## Latencia (C5, corrida de referencia E1, ms, 400 iteraciones)

La base corre en el mismo host que los tests: los números muestran el **costo relativo** de `withTenant`, no la latencia Vercel → Supabase.

| Conexión | B0 `select 1`         | W0 `withTenant(select 1)` | B1 PK como `postgres` sin tx | W1 `withTenant(PK + RLS)` | Overhead wrapper (W0−B0) | Overhead total (W1−B1) |
| -------- | --------------------- | ------------------------- | ---------------------------- | ------------------------- | ------------------------ | ---------------------- |
| Directa  | p50 0.318 · p95 0.438 | p50 1.273 · p95 1.503     | p50 0.527 · p95 0.636        | p50 1.773 · p95 2.167     | +0.955 · +1.065          | **+1.246 · +1.531**    |
| Pooler   | p50 0.467 · p95 0.581 | p50 1.950 · p95 2.284     | p50 0.815 · p95 0.949        | p50 2.547 · p95 3.311     | +1.483 · +1.703          | **+1.732 · +2.362**    |

Lectura: `withTenant` agrega tres round trips (BEGIN, `set_config`, COMMIT). Con una latencia de red _r_ entre Vercel y Supabase, el overhead esperado es del orden de 3·_r_. El número decisivo sale de E3 en la misma región. La corrida 3 dio valores del mismo orden (overhead total por pooler +1.459 · +2.145).

## Hallazgos: diferencias entre lo esperado y lo observado

### Hallazgo 1 · GraphQL es una Data API lateral con la configuración por defecto

- **Observado** ([run 36492948474](https://github.com/nicolasmarecos0/porandu-autos/actions/runs/36492948474), HTTP): con pg_graphql habilitado, uA consultó `organizationsCollection` por `/graphql/v1` y recibió su organización, aunque `public` **no** está en los schemas expuestos de PostgREST.
- **Mecanismo** (reproducido a nivel SQL en la corrida de referencia): PostgREST ejecuta `graphql_public.graphql()` con `search_path = graphql_public + extra_search_path`, y pg_graphql refleja las tablas de ese `search_path`.
  - Con `graphql_public, public, extensions` (el default), uA lee `organizations` y `tenant_probe`.
  - Sin `public`, ninguna tabla de la app queda reflejada.
- **Contención:** RLS sigue aplicando. uA solo vio su organización y sus filas, sin cruce de tenant. Pero es un canal que saltea las reglas de la aplicación (rol, validación, aprobación humana). Con grants de escritura, pg_graphql también genera mutaciones; eso es inferencia, no se probó.
- **`anon`:** no ve nada, porque no tiene grants.
- **En E1 local pg_graphql viene deshabilitado.** Con la extensión apagada, el chequeo de GraphQL es trivialmente verde; por eso la suite la habilita explícitamente.
- **Mitigación probada:** sacar `public` de `extra_search_path` (config del spike). La corrida de referencia pasa con esa config, con control positivo por GraphQL (`tenant_probe_exposedCollection` devuelve la fila de uA).
- **Implicancia para D3:** "no exponer `public`" no alcanza. Hace falta, además, pg_graphql deshabilitado **y/o** `public` fuera de `extra_search_path`. Decisión pendiente del fundador.

### Hallazgo 2 · Supavisor en modo transacción no limpia el estado de sesión entre clientes

Control negativo sobre el pooler local (observacional, solo loopback): un `set_config(..., false)` de sesión se vio en **30 de 30** consultas de **otros** clientes del pooler. El patrón `LOCAL` de `withTenant` no deja residuos (C6). La consecuencia es que **cualquier** `SET` o `set_config(..., false)` de sesión en código de runtime sería una fuga entre usuarios, y la seguridad depende de usar solo la forma `LOCAL`.

Sanity check en E0 (no es evidencia): cambiando `withTenant` a `set_config(..., false)`, P3 falla con 599 residuos en 600 transacciones. El detector funciona.

### Hallazgo 3 · `[auth.email] enable_signup = false` deshabilita el login con email

[Run 36491910139](https://github.com/nicolasmarecos0/porandu-autos/actions/runs/36491910139): con esa opción, `signInWithPassword` falla con "Email logins are disabled". El signup público se bloquea con `[auth] enable_signup = false` manteniendo el proveedor email habilitado; los usuarios se crean con la Admin API. Es relevante para D8.

### Otras diferencias menores

- **JWT local ES256:** `getClaims()` verifica localmente vía JWKS. No se puede fabricar un token vencido con firma válida, así que A-14b quedó **skipped**. El token adulterado sí se rechaza (A-14a).
- **PostgREST no arranca** si un schema de `[api].schemas` no existe. Solo afecta al spike: el schema de control se crea con una migración de la CLI.
- **pg_graphql local no ofrece introspección** (`Unknown field "__schema"`). La prueba consulta colecciones directamente.
- **`REVOKE CREATE ON SCHEMA public`:** en E0 emite el warning 01006; en Supabase se aplica sin warning.
- **Pooler:** 6 backends distintos con `default_pool_size = 5`.
- **`[inbucket]`** está deprecado en la CLI 2.118; se usa `[local_smtp]`.

## Historial de corridas E1

| Run                                                                                      | Commit    | Resultado             | Causa                                                                       |
| ---------------------------------------------------------------------------------------- | --------- | --------------------- | --------------------------------------------------------------------------- |
| [36491568824](https://github.com/nicolasmarecos0/porandu-autos/actions/runs/36491568824) | `443899f` | fail                  | PostgREST no arrancó: faltaba el schema de control (bootstrap del spike)    |
| [36491910139](https://github.com/nicolasmarecos0/porandu-autos/actions/runs/36491910139) | `3c63e46` | fail                  | Hallazgo 3 (login por email deshabilitado). Las migraciones y Q1 ya pasaban |
| [36492154447](https://github.com/nicolasmarecos0/porandu-autos/actions/runs/36492154447) | `ea9ed15` | pass (145/1 skip)     | Verde, pero con el chequeo de GraphQL vacío (extensión deshabilitada)       |
| [36492612639](https://github.com/nicolasmarecos0/porandu-autos/actions/runs/36492612639) | `9dcc3e7` | fail                  | Diseño del test: pg_graphql no permite introspección                        |
| [36492948474](https://github.com/nicolasmarecos0/porandu-autos/actions/runs/36492948474) | `6a30655` | fail                  | **Hallazgo 1** (GraphQL lateral con `public` en `extra_search_path`)        |
| [36493339590](https://github.com/nicolasmarecos0/porandu-autos/actions/runs/36493339590) | `2463b37` | **pass (150/1 skip)** | Reproducción SQL del hallazgo + mitigación probada                          |

## Preguntas que E1 no puede responder (requieren E2 o E3)

1. **Q1 en cloud:** ¿el `postgres` del proyecto de staging puede ejecutar el mismo `GRANT … WITH INHERIT FALSE, SET TRUE`?
2. **Supavisor cloud:** autenticación de `app_runtime.<project_ref>` en 6543, prepared statements desactivados y ausencia de residuos con el patrón `LOCAL`. El control negativo de sesión **no** se ejecuta contra staging.
3. **Defaults del proyecto cloud:** ¿pg_graphql viene habilitado? ¿`extra_search_path` incluye `public`? ¿Cómo interactúan el toggle "Automatically expose new tables" y los _exposed schemas_ con el Hallazgo 1?
4. **Latencia real** Vercel → Supabase en la misma región (E3), para fijar D19.
5. **Token vencido con firma válida:** requiere un `jwt_expiry` corto o esperar el vencimiento.
6. **JWKS en cloud:** fetch, caché y rotación de claves en `getClaims()`.
7. **Pooling con Vercel Fluid:** tamaño de pool y límites de conexión.
8. **Operación:** rotación de la password de `app_runtime` y dónde vive (secrets de Vercel/CI).

## E2 · resultados (staging, `sa-east-1`)

### Entorno E2

| Componente  | Observado                                                                                                                               |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Runner      | GitHub Actions `ubuntu-24.04`, región Azure `westus`                                                                                    |
| Proyecto    | Supabase cloud de staging, `sa-east-1`. Data API deshabilitada, proveedor email habilitado, signup público deshabilitado                |
| Postgres    | 17.6                                                                                                                                    |
| Pooler      | Supavisor cloud: modo sesión (5432) para migraciones, harness y la conexión `sesion`; modo transacción (6543) para la conexión `pooler` |
| Auth        | JWT **ES256** (con `kid`), verificado por `getClaims()` contra el JWKS real de staging                                                  |
| Claves      | `sb_publishable_…` y `sb_secret_…` (formato nuevo)                                                                                      |
| Runtime     | `app_runtime.<project_ref>` por 5432 (sesión) y 6543 (transacción). Sin conexión directa: el runner no tiene IPv6                       |
| Extensiones | `pg_stat_statements`, `pgcrypto`, `plpgsql`, `supabase_vault`, `uuid-ossp`. **Sin `pg_graphql`**                                        |
| TLS         | `sslmode=require` (sin verificar la CA)                                                                                                 |

### Corrida

**[Run 36590229247](https://github.com/nicolasmarecos0/porandu-autos/actions/runs/36590229247): 142 pass · 2 fail · 25 skip** (169 tests, 725,6 s).

- **Commit:** `8c0b967` en la rama temporal `spike/adr-001-e2-run`. Es `0c1b441` con un único cambio: el workflow de E2 se dispara con push a esa rama en lugar de un tag, porque el entorno de Claude Code solo puede pushear ramas. La lógica, el harness y los tests son los de `0c1b441`. En `spike/h0-saas-foundation` el workflow sigue disparándose por tag.
- **Los 2 fail son solo de medición de latencia (C5)**, por timeout: `80-latency` excedió los 120 s del test en las dos conexiones. Cada round trip del runner (EE. UU.) a `sa-east-1` cuesta ~183 ms (inferido de los tests de un solo statement, S-40: 183–185 ms). Con 66 iteraciones (60 + 6 de calentamiento) de ~10 round trips cada una, la medición necesita ~121 s. C5 no tiene umbral y ningún criterio de aislamiento falló.
- **Los 25 skip** son esperados: los bloques exclusivos de E1 (Data API local, GraphQL con `pg_graphql` habilitado, controles negativos de sesión), el mecanismo de GraphQL (requiere `pg_graphql` instalado y E2 no lo habilita) y A-14b (token vencido con firma válida, imposible con ES256).
- **El control negativo de contaminación de sesión no se ejecutó contra staging**, por diseño.
- **Pasos del workflow:** preflight, limpieza previa, migraciones y limpieza final OK. Ningún secret apareció en el log.
- Por decisión del fundador, E2 no se vuelve a correr solo para obtener un workflow verde.

### Resultado por criterio (cloud)

| Criterio                            | E2                                | Evidencia                                                                                                                                                                                                                                                                                          |
| ----------------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **C1** · aislamiento A/B            | **Confirmado**                    | S-10…S-32 en ambos sentidos y A-01…A-09 y A-13, por el pooler en modo sesión (5432) **y** en modo transacción (6543). A-03: el contexto falsificado `{uA, org B}` sigue sin ver B.                                                                                                                 |
| **C2** · falla cerrada              | **Confirmado**                    | S-40 (4 tablas), S-40b, S-40c, S-41 (`service_role`, `postgres`, `anon`, `supabase_admin`), S-42 (`anon`), S-43 y A-10, por las dos conexiones.                                                                                                                                                    |
| **C3** · catálogo                   | **Confirmado**                    | S-60…S-65. Hecho R1 en cloud: `postgres` con `rolbypassrls = true`, `rolsuper = false`, `rolcreaterole = true` y owner de las tablas.                                                                                                                                                              |
| **C4** · pooler en modo transacción | **Confirmado en Supavisor cloud** | `app_runtime.<project_ref>` autentica en 6543 (`ok:app_runtime`) sin configurar nada en Supavisor, y toda la matriz corre por esa conexión. Falta Vercel (E3).                                                                                                                                     |
| **C5** · latencia                   | **Pendiente para E3**             | Timeout de la medición; `latency.json` vacío. El número útil (Vercel → Supabase en la misma región) sale de E3.                                                                                                                                                                                    |
| **C6** · sin residuos               | **Confirmado**                    | S-50: después de COMMIT, ROLLBACK y error, la conexión vuelve a `app_runtime` sin claims. P3: 600 transacciones (480 commit, 60 rollback, 60 error) con **0 residuos** y **0 inconsistencias**, en sesión (8 backends) y en transacción (16 backends), todos compartidos entre usuarios distintos. |
| **C7** · `postgres` solo migra      | **Confirmado**                    | `drizzle-kit migrate` con `postgres` por 5432. M-1…M-4: los backends del runtime son `app_runtime` y ninguno es `postgres`. S-43.                                                                                                                                                                  |
| **C8** · sin Data API lateral       | **Confirmado**                    | 30 requests (`anon` y uA) a `/rest/v1` y `/graphql/v1`: ninguno devolvió filas ni escribió nada. Todos respondieron `503 PGRST002`. Ver [Hallazgo 4](#hallazgo-4--con-la-data-api-deshabilitada-los-endpoints-siguen-respondiendo-503).                                                            |
| **C9** · Q1                         | **Confirmado**                    | El `postgres` del proyecto cloud creó `app_runtime` y aplicó el grant. `pg_auth_members`: `inherit=false, set=true, admin=false`.                                                                                                                                                                  |
| **D8** · signup cerrado             | **Confirmado**                    | `signUp` con la publishable key falla; los usuarios creados con la Admin API inician sesión con email y password.                                                                                                                                                                                  |

Además, en cloud: S-01…S-04 (`user_org_ids()` evaluada una vez por statement) y A-14a (token adulterado rechazado) pasan.

### Diferencias con E1

- **Conexión:** sin conexión directa (el runner no tiene IPv6); la conexión que en E1 era "directa" es, en E2, el pooler en modo sesión (5432).
- **Data API:** en E1, PostgREST rechazaba con errores específicos (PGRST205, PGRST106, PGRST202). En staging, todo request responde `503 PGRST002`.
- **`pg_graphql`:** en staging no está instalado; en E1 la suite lo habilitaba para probar el Hallazgo 1.
- **Pooler:** 16 backends en modo transacción en cloud, contra 6 en el Supavisor local.
- **`authenticator`:** en cloud no tiene settings `pgrst.*` en el rol; la configuración de PostgREST no se ve desde la base.
- **Latencia:** en E1 se midió; en E2 no hay números.

### Hallazgo 4 · Con la Data API deshabilitada, los endpoints siguen respondiendo 503

- **Observado:** con la Data API configurada como deshabilitada, `/rest/v1` y `/graphql/v1` no desaparecen (no hay 404). Los 30 requests respondieron `503 PGRST002` ("Could not query the database for the schema cache. Retrying.") durante ~50 s.
- **Causa probable, no confirmada:** es el efecto de la Data API deshabilitada. Se puede verificar en los logs de PostgREST del dashboard de Supabase, alrededor de las 15:27 UTC del 2026-09-29.
- **Alcance del test:** C8 prueba que no salen datos, pero no distingue entre "deshabilitada por configuración" y "caída".
- **Implicancia:** el aislamiento no depende de este estado, porque lo sostienen los grants y RLS. Aun así, la Data API deshabilitada es una condición de la recomendación.

### Hallazgo 5 · `pg_graphql` no está instalado en staging

La vía lateral del [Hallazgo 1](#hallazgo-1--graphql-es-una-data-api-lateral-con-la-configuración-por-defecto) hoy no existe en staging. Reaparece si alguien habilita `pg_graphql` o vuelve a exponer `public` (incluido `extra_search_path`) al reactivar la Data API. Por eso "`pg_graphql` no se habilita" es una condición de la recomendación.

### Preguntas de E1: qué respondió E2

| Pregunta                      | E2                                                                                                                                                                                        |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 · Q1 en cloud               | **Respondida:** el grant se aplica con el `postgres` del proyecto y queda `inherit=false, set=true, admin=false`.                                                                         |
| 2 · Supavisor cloud           | **Respondida:** `app_runtime.<ref>` autentica en 5432 y 6543, funciona con `prepare: false` y P3 da 0 residuos.                                                                           |
| 3 · Defaults cloud            | **Respondida para este proyecto:** `pg_graphql` no está instalado y la Data API deshabilitada responde `503 PGRST002` (Hallazgos 4 y 5). `extra_search_path` no es visible desde la base. |
| 4 · Latencia real             | **Pendiente (E3).**                                                                                                                                                                       |
| 5 · Token vencido             | **Pendiente:** staging firma con ES256.                                                                                                                                                   |
| 6 · JWKS en cloud             | **Parcial:** `getClaims()` verificó contra el JWKS real de staging en todos los tests con claims. Caché y rotación: pendientes (E3).                                                      |
| 7 · Pooling Vercel Fluid      | **Pendiente (E3).**                                                                                                                                                                       |
| 8 · Password de `app_runtime` | **Pendiente:** en el spike es efímera por corrida y queda anulada; el esquema operativo del producto sigue abierto.                                                                       |

### Estado persistente en staging

La limpieza final borró todo lo sintético:

- los 5 usuarios `@adr001.test` y, en cascada, sus `profiles`;
- las 2 organizaciones `ADR-001 spike …` y sus memberships;
- la tabla `tenant_probe` (`spike_ddl_check` la crea y la borra el propio M-1).

También anuló la password de `app_runtime`. No se habilitó ninguna extensión y no se tocó la configuración de la Data API.

**Queda en staging** (hay que resetear staging o aplicar una migración de limpieza antes de las migraciones reales, PR-5):

- **Tablas:** `public.organizations`, `public.profiles` y `public.memberships`, vacías, más el enum `public.membership_role`. Tienen RLS habilitado y las policies `organizations_select_member`, `profiles_select_own` y `memberships_select_member`.
- **Función:** schema `private` con `private.user_org_ids()`. `authenticated` tiene `USAGE` sobre el schema y `EXECUTE` sobre la función.
- **Rol:** `app_runtime` (`LOGIN NOINHERIT NOBYPASSRLS`) con **password NULL**, así que nadie puede loguearse con él. Es miembro de `authenticated` `WITH INHERIT FALSE, SET TRUE`.
- **Grants:** sobre las 3 tablas, `anon` no tiene privilegios y `authenticated` solo tiene `SELECT`.
- **Privilegios por defecto:** las tablas, secuencias y funciones que cree `postgres` en `public` a partir de ahora no dan privilegios a `anon` ni a `authenticated`. Además, `REVOKE CREATE ON SCHEMA public FROM PUBLIC, anon, authenticated`. Cambia el comportamiento por defecto de Supabase para las migraciones futuras.
- **Historial de migraciones:** schema `drizzle` con `__drizzle_migrations` (3 entradas).

### Pendiente para E3

- **Latencia:** Vercel → Supabase en la misma región (C5 / D19).
- **Pool:** tamaño y límites de conexión con Vercel Fluid.
- **JWKS:** caché y rotación en serverless.
- **Token:** vencido con firma válida (A-14b).
- **TLS:** `verify-full` con el certificado de Supabase.
- **`app_runtime`:** dónde vive la password y cómo se rota.
- **Data API:** confirmar la causa del `503 PGRST002` (Hallazgo 4).

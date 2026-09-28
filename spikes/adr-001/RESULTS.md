# Spike ADR-001 · resultados de E1

> **Experimental.** Esta evidencia no aprueba ADR-001 ni ninguna hipótesis
> D1–D20. Nada de esto se registró en el Decisions Log ni en la Build Baseline.
> E2 (staging) está preparado pero no se ejecutó; E3 (Vercel) tampoco.

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

## Resultado por criterio

| Criterio                                                                                        | E1                                              | Evidencia                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **C1** · A nunca lee ni modifica datos de B (ni B los de A)                                     | **PASS**                                        | S-10…S-32 en ambos sentidos, por conexión directa **y** por pooler: SELECT cruzado 0 filas, INSERT cruzado 42501, UPDATE/DELETE cruzados 0 filas, mover una fila a otra org rechazado por `WITH CHECK`, auto-agregarse a otra org 42501. A-01…A-09 por la capa de aplicación (directa y pooler). A-03: un contexto falsificado `{uA, org B}` sigue sin ver B.                                             |
| **C2** · sin `withTenant` falla cerrado                                                         | **PASS**                                        | S-40: `app_runtime` sin `SET ROLE` → `42501 permission denied` en las 4 tablas (directa y pooler). S-40b: los claims solos no dan acceso. A-10: Drizzle sobre el runtime sin `withTenant` → 42501. S-41: `app_runtime` no puede asumir `service_role`, `postgres`, `anon` ni `supabase_admin`. S-42: `anon` → 42501. S-31: `authenticated` sin claims nunca ve filas.                                     |
| **C3** · catálogo                                                                               | **PASS**                                        | S-60: toda tabla de `public` tiene RLS. S-61: todo privilegio de `authenticated` está cubierto por una policy; toda tabla con `organization_id` tiene NOT NULL, FK e índice líder. S-62/S-63: `app_runtime` sin super, bypassrls ni herencia, y sin grants directos; `anon` sin privilegios; sin `security definer` en `public`. S-64: meta-cobertura.                                                    |
| **C4** · compatible con el pooler en modo transacción                                           | **PASS (local)**                                | Toda la matriz (C1, C2, C6, C7) corre también por Supavisor local. El rol custom autentica por el pooler (`ok:app_runtime`). **No probado:** Supavisor cloud (E2) ni Vercel (E3).                                                                                                                                                                                                                         |
| **C5** · latencia                                                                               | **MEDIDA, sin umbral**                          | Ver tabla abajo. No se aplica ningún gate.                                                                                                                                                                                                                                                                                                                                                                |
| **C6** · claims y rol no sobreviven a la transacción                                            | **PASS**                                        | S-50: después de COMMIT, ROLLBACK y error, la conexión vuelve a `app_runtime` sin claims. P3: 600 transacciones (480 commit, 60 rollback, 60 error) con **0 residuos** y **0 inconsistencias**, tanto por conexión directa (8 backends) como por pooler (6 backends, todos reutilizados entre usuarios distintos). El control negativo de sesión detecta la contaminación.                                |
| **C7** · `postgres` migra, nunca en runtime                                                     | **PASS**                                        | `drizzle-kit migrate` corrió con `postgres`. M-1: DDL con `postgres`. M-2/M-3: `session_user = current_user = app_runtime` y, con el runtime ocupado, ningún backend del runtime es `postgres`. S-43: ni `app_runtime` ni `authenticated` pueden crear objetos. M-4: `src/` no referencia la credencial de migración.                                                                                     |
| **C8** · sin Data API lateral                                                                   | **PASS con configuración; FAIL con el default** | **PostgREST:** `public` y `private` no expuestos (PGRST205, PGRST106, PGRST202); el POST no escribe nada; el control positivo sí sirve datos filtrados por RLS. **GraphQL:** ver [Hallazgo 1](#hallazgo-1--graphql-es-una-data-api-lateral-con-la-configuración-por-defecto). Con pg_graphql habilitado y `extra_search_path` por defecto (incluye `public`), `authenticated` **lee tablas de `public`**. |
| **C9** · Q1: `GRANT authenticated TO app_runtime WITH INHERIT FALSE, SET TRUE` desde `postgres` | **PASS (imagen local)**                         | La migración 0001 se aplicó con `postgres`. `pg_auth_members` muestra `inherit=false, set=true, admin=false`. Falta confirmarlo en el proyecto cloud (E2).                                                                                                                                                                                                                                                |

Además:

- S-65 confirma el hecho R1: en Supabase `postgres` tiene `rolbypassrls = true`, `rolsuper = false` y es owner de las tablas.
- S-04: la policy `organization_id IN (SELECT private.user_org_ids())` se planifica como `hashed SubPlan` y se ejecuta **una vez por statement** (`Actual Loops = 1`), no una vez por fila.

## Latencia (C5, corrida de referencia, ms, 400 iteraciones)

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

## E2 · estado: preparado, no ejecutado

Workflow `.github/workflows/spike-adr-001-e2.yml`, disparado solo por un tag `adr-001-e2-*`. Cómo responde cada pregunta de la sección anterior:

| Pregunta                      | Cómo la cubre E2                                                                                                                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1 · Q1 en cloud               | La migración 0001 se aplica con `postgres` en staging; `00-catalog` (Q1) lee `pg_auth_members`.                                                                                            |
| 2 · Supavisor cloud           | Toda la matriz corre por `app_runtime.<ref>` en 6543 (transacción) y 5432 (sesión); P3 exige 0 residuos. **Sin** control negativo de sesión.                                               |
| 3 · Defaults cloud            | `meta.json` registra las extensiones instaladas (¿pg_graphql?) y la config del rol `authenticator`. `60-data-api` (E2) verifica que REST y GraphQL no devuelvan datos, sin habilitar nada. |
| 4 · Latencia real             | **No se responde:** el runner de GitHub está en EE. UU. y staging en sa-east-1. Se mide igual (60 iteraciones) para ver el overhead en round trips; el número útil sale de E3.             |
| 5 · Token vencido             | Sigue sin cubrirse si staging firma con ES256.                                                                                                                                             |
| 6 · JWKS en cloud             | `getClaims()` verifica contra el JWKS real de staging en todos los tests con claims. Rotación de claves: no cubierta.                                                                      |
| 7 · Pooling Vercel Fluid      | No se cubre (E3).                                                                                                                                                                          |
| 8 · Password de `app_runtime` | En el spike es efímera por corrida y queda anulada al final; el esquema operativo del producto sigue abierto.                                                                              |

Notas:

- En E2, TLS con `sslmode=require` (sin verificar la CA).
- El schema del spike queda en staging después de correr E2 (ver README).

# ADR-001 — Tenant isolation y SaaS foundation

- **Estado:** Aceptada · 2026-09-29
- **Principio:** DEC-006 (aceptada el 2026-09-21). Este ADR define su implementación.
- **Autoridad:** nivel 2 según DEC-002, registrada en el [Decisions Log](../05_DECISIONS_LOG.md#adr-001--tenant-isolation-y-saas-foundation). Prevalece sobre la Build Baseline, `CLAUDE.md`, el Master Context y los blueprints.
- **Evidencia:** entornos E1 y E2 del spike de ADR-001, documentados en [`spikes/adr-001/RESULTS.md`](https://github.com/nicolasmarecos0/porandu-autos/blob/318f33af1fd3210e35ddcd74617adbad4623c0a1/spikes/adr-001/RESULTS.md) (rama `spike/h0-saas-foundation`, commit `318f33a`). El spike es experimental: su código, workflows, tests y scripts no forman parte del producto.
- **Pendiente:** E3, solo para los puntos operativos de §7. E3 no vuelve a validar el aislamiento. Además, dos follow-ups no bloqueantes (§7).
- **Implementación:** H0.4 (migración `0000_saas_core_schema`, [DEC-018](../05_DECISIONS_LOG.md#dec-018--h04-saas-core-schema)) y H0.5 (migración `0001_tenant_isolation` y `db/tenant.ts`, [DEC-019](../05_DECISIONS_LOG.md#dec-019--h05-tenant-isolation)), mergeados en `main`. Staging ya no tiene residuos de E2 y está listo para `0000` y `0001` (§9).

---

## 1. Contexto

DEC-006 exige multi-tenancy real desde Hito 0, con aislamiento en la base de datos (RLS) y en la capa de aplicación, sin queries tenant-agnostic accidentales.

El riesgo concreto es el acceso directo de Drizzle a Postgres. En Supabase, `postgres` tiene `BYPASSRLS` y es owner de las tablas (confirmado en E1 y E2). Una conexión de runtime con esa credencial ignora RLS, y el aislamiento quedaría librado a la disciplina del código.

La entrada ADR-001 del 2026-09-21 dejó la implementación como hipótesis, a validar con un spike que es gate de B1 (Build Baseline §9, commit 6). E1 (Supabase local) y E2 (proyecto Supabase de staging, `sa-east-1`) validaron el aislamiento. El fundador aceptó esa evidencia como suficiente para cerrar ADR-001 en lo relativo a tenant isolation.

---

## 2. Decisión: arquitectura aprobada

| Pieza | Decisión |
|---|---|
| **Base de datos y ORM** | PostgreSQL en Supabase. Drizzle: `drizzle-orm` para queries y `drizzle-kit` para migraciones SQL versionadas, con el driver `postgres` (postgres-js). |
| **Rol de runtime `app_runtime`** | La aplicación se conecta siempre como `app_runtime`: rol `LOGIN NOINHERIT NOBYPASSRLS`, sin privilegios directos sobre tablas y miembro de `authenticated` `WITH INHERIT FALSE, SET TRUE`. Puede asumir `authenticated`, pero no hereda sus privilegios: sin asumirlo no lee ni escribe ninguna tabla de la aplicación. |
| **Credencial de migración** | `postgres` es una credencial separada y exclusiva para aplicar migraciones con `drizzle-kit`. No se usa en runtime y el código de runtime no la referencia. |
| **`withTenant()`** | Boundary transaccional y única puerta de acceso a datos tenant-scoped. Abre una transacción, fija en ella la identidad de la request, ejecuta las queries y termina en COMMIT o ROLLBACK. Recibe un contexto de tenant cuya organización ya fue validada contra las memberships activas del usuario. Sin `withTenant`, el acceso falla cerrado. |
| **Contexto JWT verificado** | Los claims se obtienen de un access token verificado por Supabase Auth (firma y expiración) y se inyectan como `request.jwt.claims`. Nunca provienen de datos del cliente sin verificar. RLS los lee a través de `auth.uid()`. |
| **`SET LOCAL ROLE authenticated`** | Dentro de la transacción, `withTenant` asume `authenticated` con alcance local. El rol está fijo en el código; no se toma del token. |
| **`set_config(..., true)`** | Claims y rol se fijan únicamente con alcance de transacción. Al COMMIT, ROLLBACK o error, la conexión vuelve a ser `app_runtime` sin claims. |
| **RLS** | Es la barrera de aislamiento. Las policies restringen cada fila a las organizaciones donde el usuario de la request tiene membership activa. El patrón de referencia aprobado para H0 es `organization_id IN (SELECT private.user_org_ids())` (§4), porque es el mecanismo que validaron E1 y E2. |
| **Filtros explícitos por `organization_id`** | Defense in depth en la capa de aplicación: las queries filtran por la organización del contexto validado y las escrituras toman `organization_id` de ese contexto, nunca del input del cliente. No reemplazan a RLS. |
| **Supavisor en modo transacción** | El runtime se conecta por el pooler Supavisor en modo transacción (puerto 6543, usuario `app_runtime.<project_ref>`), sin prepared statements con nombre. |

---

## 3. Reglas obligatorias

1. **El runtime nunca usa `postgres`.** Ningún camino de runtime se conecta con la credencial de migración.
2. **El runtime nunca usa `SET` de sesión ni `set_config(..., false)`.** Solo `SET LOCAL` o `set_config(..., true)` dentro de `withTenant`. Supavisor en modo transacción no limpia el estado de sesión entre clientes (Hallazgo 2): cualquier estado de sesión sería una fuga entre usuarios.
3. **La Data API permanece deshabilitada en H0** (`/rest/v1` y `/graphql/v1`). El navegador no tiene un acceso lateral a las tablas de la aplicación.
4. **`pg_graphql` no se habilita en H0.** Con `pg_graphql` habilitado y `public` en `extra_search_path` (el default), `authenticated` lee tablas de `public` por `/graphql/v1` aunque `public` no esté expuesto (Hallazgo 1).
5. **Ninguna tabla de aplicación en `public` queda sin RLS.**
6. **Las migraciones y los privilegios preservan el aislamiento multi-tenant.** Como mínimo, mantienen las invariantes de catálogo que E1 y E2 verificaron (C3):
   - toda tabla de `public` tiene RLS habilitado;
   - todo privilegio de `authenticated` sobre `public` está cubierto por una policy;
   - toda tabla tenant-scoped (propiedad de una organización, identificada por su columna `organization_id`) declara `organization_id` `NOT NULL`, con FK a `organizations` e índice que empieza por `organization_id`. No aplica a tablas que no pertenecen a una organización, como `organizations` (la raíz del tenant) o `profiles` (propia de cada usuario);
   - `app_runtime` no es superuser, no tiene `BYPASSRLS` ni herencia y no tiene privilegios directos;
   - ni `anon` ni `app_runtime` tienen privilegios sobre las tablas de `public`;
   - no hay funciones `SECURITY DEFINER` en `public`;
   - ni `app_runtime` ni `authenticated` pueden crear objetos.

   Los grants son explícitos: se revocan los privilegios por defecto que Supabase otorga a `anon` y `authenticated` sobre objetos nuevos de `public`, y se otorga solo lo que cada tabla necesita.

Cambiar cualquiera de estas reglas requiere una decisión nueva en el Decisions Log.

---

## 4. Forma validada (referencia para H0)

Así se implementó cada pieza en E1 y E2. Es la referencia para H0, no código para copiar: H0 la implementa en `db/` con sus propios tests de aislamiento (Build Baseline §7 y §8). Lo que se aparte de esta forma no está cubierto por la evidencia de E1/E2.

- **`withTenant()`**
  - Una transacción por llamada. Su primer statement ejecuta juntos `set_config('request.jwt.claims', <claims verificados>, true)` y `set_config('role', 'authenticated', true)`, equivalente a `SET LOCAL ROLE authenticated`.
  - Los claims viajan como parámetro, nunca interpolados como SQL crudo (A-13).
  - Rechaza un contexto cuyo `sub` no coincide con el usuario del contexto.
  - Para leer las memberships propias antes de elegir organización se usa una variante con la misma mecánica, sin organización (`withUser` en el spike).
- **Resolución del tenant**
  - La organización solicitada por el cliente es solo una preferencia. En cada request se valida contra las memberships **activas** del usuario, leídas con filtro explícito por su `user_id`.
  - Sin memberships activas no hay acceso. Con varias y sin una elección válida, el usuario debe seleccionar organización.
  - Un `organization_id` enviado en el input se rechaza y no se escribe nada (A-05). Una organización ajena o inválida nunca se devuelve (A-06).
  - Un contexto falsificado (usuario A con la organización B) no ve datos de B (A-03). Una membership revocada tiene efecto inmediato, incluso con un contexto viejo (A-09).
- **Verificación de claims**
  - `auth.getClaims(token)` de Supabase Auth verifica firma y expiración localmente contra el JWKS del proyecto (JWT ES256 con `kid` en E1 y E2).
  - Se exigen `sub` y `role = authenticated`.
  - Un token adulterado se rechaza (A-14a).
- **Policies RLS**
  - Forma: `organization_id IN (SELECT private.user_org_ids())`. `private.user_org_ids()` devuelve las organizaciones con membership activa de `auth.uid()`.
  - La función es `SECURITY DEFINER`, `STABLE`, con `search_path = ''` y nombres calificados. Vive en el schema `private`, que no está expuesto, y `EXECUTE` se otorga solo a `authenticated`. Al correr como su owner, lee `memberships` sin re-evaluar la policy de `memberships`, lo que evita la recursión.
  - El planner la evalúa una vez por statement, no una vez por fila (S-04).
  - Una policy de escritura usa la misma condición en `USING` y `WITH CHECK`: mover una fila a otra organización se rechaza.
  - Sin una necesidad de escritura no hay grants ni policies de escritura (default deny).
  - `private.user_org_ids()` reemplaza a `is_member(organization_id)`, la hipótesis previa de la entrada del 2026-09-21 y de la Build Baseline §7, en todo lo que se contradigan. `is_member()` no se probó.
- **Conexión de runtime**
  - postgres-js con `prepare: false`, porque Supavisor en modo transacción no soporta prepared statements con nombre.
- **Migraciones**
  - `drizzle-kit migrate` con `postgres` por una conexión en modo sesión (en E2, Supavisor en el puerto 5432).
  - `GRANT authenticated TO app_runtime WITH INHERIT FALSE, SET TRUE` se aplica con el `postgres` del proyecto, en local y en cloud (C9).
  - La migración crea `app_runtime` sin password. La password se fija fuera de las migraciones.

---

## 5. Evidencia

| Entorno | Qué es | Corrida | Resultado |
|---|---|---|---|
| **E1** | Supabase local en GitHub Actions: CLI 2.118.0, Postgres 17.6, Supavisor 2.9.13 en modo transacción | [run 36493339590](https://github.com/nicolasmarecos0/porandu-autos/actions/runs/36493339590) · commit `2463b37` | 150 pass · 0 fail · 1 skip |
| **E2** | Proyecto Supabase de staging, `sa-east-1`: Postgres 17.6, Supavisor cloud (5432 y 6543), Data API deshabilitada, JWKS real | [run 36590229247](https://github.com/nicolasmarecos0/porandu-autos/actions/runs/36590229247) · commit `8c0b967` | 142 pass · 2 fail · 25 skip |

En E2, el commit `8c0b967` (rama temporal `spike/adr-001-e2-run`) es `0c1b441` con un único cambio: el disparo del workflow. Los 2 fail son la medición de latencia (C5), que excedió el timeout del test por el round trip del runner (EE. UU.) a `sa-east-1`. **Ningún criterio de aislamiento falló.** Los 25 skip son esperados: bloques exclusivos de E1, el mecanismo de GraphQL (staging no tiene `pg_graphql`) y A-14b.

| Criterio | E1 | E2 |
|---|---|---|
| **C1** · A nunca lee ni modifica datos de B (ni B los de A) | PASS, por conexión directa y por pooler | Confirmado, por pooler en modo sesión y en modo transacción |
| **C2** · sin `withTenant` falla cerrado | PASS: `42501` sin `SET ROLE`. `app_runtime` no puede asumir `service_role`, `postgres`, `anon` ni `supabase_admin` | Confirmado |
| **C3** · catálogo (RLS en toda tabla, grant ⇒ policy) | PASS | Confirmado |
| **C4** · compatible con el pooler en modo transacción | PASS en Supavisor local | Confirmado en Supavisor cloud: `app_runtime.<project_ref>` autentica en 6543 |
| **C5** · latencia (solo medición, sin umbral) | Medida (ver abajo) | Sin datos por timeout de la medición → E3 |
| **C6** · claims y rol no sobreviven a la transacción | PASS: 600 transacciones, 0 residuos | Confirmado: 600 transacciones, 0 residuos, 16 backends compartidos entre usuarios |
| **C7** · `postgres` migra, nunca en runtime | PASS | Confirmado |
| **C8** · sin Data API lateral | PASS con configuración; FAIL con el default (Hallazgo 1) | Confirmado: con la Data API deshabilitada, ningún request devolvió ni escribió datos |
| **C9** · `GRANT authenticated TO app_runtime WITH INHERIT FALSE, SET TRUE` | PASS | Confirmado con el `postgres` del proyecto cloud |

**Latencia (E1, base en el mismo host, 400 iteraciones).** `withTenant` agrega tres round trips (BEGIN, `set_config`, COMMIT). Overhead total p50 · p95: +1.246 · +1.531 ms por conexión directa y +1.732 · +2.362 ms por pooler. Con una latencia de red _r_ entre Vercel y Supabase, el overhead esperado es del orden de 3·_r_. El número decisivo sale de E3.

**Hallazgos que fundamentan las reglas**
- **Hallazgo 1 · GraphQL como Data API lateral** (reglas 3 y 4). En E1, con `pg_graphql` habilitado y el `extra_search_path` por defecto, un usuario leyó su organización por `/graphql/v1` aunque `public` no estaba expuesto. RLS contuvo el cruce de tenant, pero el canal saltea las reglas de la aplicación. Sacar `public` de `extra_search_path` lo cierra.
- **Hallazgo 2 · Supavisor no limpia el estado de sesión** (regla 2). En el pooler local, un `set_config(..., false)` se vio en 30 de 30 consultas de otros clientes. El control negativo corrió solo contra loopback, nunca contra staging.
- **Hallazgo 4 · Con la Data API deshabilitada, los endpoints responden `503 PGRST002`.** `/rest/v1` y `/graphql/v1` no desaparecen. C8 prueba que no salen datos, pero no distingue "deshabilitada" de "caída", y la causa no está confirmada. El aislamiento no depende de ese estado: lo sostienen los grants y RLS. Confirmar la causa es un follow-up no bloqueante (§7).
- **Hallazgo 5 · `pg_graphql` no está instalado en staging** (regla 4). La vía del Hallazgo 1 reaparece si se habilita `pg_graphql` o si, al reactivar la Data API, se vuelve a exponer `public` (incluido `extra_search_path`).

**No ejecutado en E1/E2:** A-14b (token vencido con firma válida). Con ES256 no se puede fabricar ese token. Queda como follow-up no bloqueante (§7).

---

## 6. Resultado frente a la hipótesis original

Hipótesis de la entrada del 2026-09-21:

| # | Hipótesis | Resultado |
|---|---|---|
| 1 | RLS en toda tabla con `organization_id`, con policies basadas en `is_member(organization_id)` sobre `auth.uid()` y `memberships` | **Validada con otra forma de policy.** RLS en toda tabla de `public` (C3). Las policies validadas usan `private.user_org_ids()` (§4); `is_member()` no se probó y queda reemplazada. |
| 2 | `withTenant(ctx, fn)`: transacción con `set local role authenticated`, claims en `request.jwt.claims` y organización ya validada contra la membership | **Validada** (C1, C2, C6). Claims y rol se fijan con `set_config(..., true)`. |
| 3 | Cliente de DB server-only, no importable fuera de `db/` (ESLint `no-restricted-imports`) | **No cubierta por el spike.** Sigue como regla de `CLAUDE.md` §3 y de la Build Baseline §7 (commit 7). |
| 4 | Service role reservado para webhooks y jobs futuros, en un módulo separado y con `organization_id` explícito | **No cubierta por el spike.** Sigue como previsión de la Build Baseline §7; este ADR no la aprueba. |

Criterios de aceptación:

| Criterio | Resultado |
|---|---|
| Con dos organizaciones y dos usuarios, A no lee, inserta, actualiza ni borra datos de B a través de `withTenant`, contra Postgres real | Cumplido: C1 en E1 y E2 |
| Una query sin contexto de tenant falla o devuelve cero filas | Cumplido: falla con `42501` (C2) |
| Un test verifica que toda tabla con `organization_id` tenga RLS | Cumplido: C3, sobre toda tabla de `public` |
| El pooler y Vercel son compatibles con transacciones con `set local` | Pooler: cumplido en Supavisor local y cloud (C4, C6). Vercel: pendiente (E3) |
| El overhead de latencia es aceptable para P1 | Pendiente (E3). E1 midió el costo relativo; no hay umbral aprobado |

---

## 7. Pendientes

**E3** (preview de Vercel contra Supabase en la misma región, con el runtime oficial de H0) queda pendiente únicamente para:

1. **Latencia real y topología de deployment** Vercel → Supabase en la misma región, incluido el overhead de `withTenant`.
2. **Runtime oficial por Supavisor en modo transacción, pool y serverless:** el cliente de H0 (`db/client.ts`) por el pooler cloud (puerto 6543, usuario `app_runtime.<project_ref>`) desde las funciones de Vercel, con tamaño de pool, límites de conexión y comportamiento de las conexiones. E2 ya validó el pooler cloud con el spike (C4, C6).
3. **Verificación de claims en el runtime oficial:** integrar la verificación de H0.6 contra el JWKS del proyecto en las funciones de Vercel y probarla, con fetch, caché y rotación de claves. E2 ya validó tokens contra el JWKS real de staging (§4 y §5): no queda pendiente demostrar que la verificación contra JWKS funciona.
4. **TLS `verify-full`** con el certificado de Supabase. E2 usó `sslmode=require` (TLS sin verificar la CA).
5. **Credencial real de `app_runtime`** en staging y en el runtime: dónde vive y cómo se rota. Staging no tiene hoy `app_runtime`: lo crea `0001`, sin password, y la password se fija fuera de las migraciones. En el spike fue efímera por corrida y quedó anulada al terminar.

E3 no vuelve a validar el aislamiento, que ya validaron E1 y E2 y que el harness de PostgreSQL 17 cubre en CI (DEC-019). Si un resultado de E3 obliga a cambiar alguna pieza de §2 o alguna regla de §3, se registra en este ADR y se consulta al fundador antes de cambiarla.

**Follow-ups no bloqueantes.** No son requisito para aprobar este ADR ni forman parte de E3:

1. **Token vencido con firma válida (A-14b).** No se pudo ejecutar en E1/E2 porque con ES256 no se puede fabricar ese token. El rechazo de un token adulterado sí se probó (A-14a).
2. **Causa del `503 PGRST002`** con la Data API deshabilitada (Hallazgo 4). No afecta el aislamiento, que sostienen los grants y RLS.

---

## 8. Fuera del alcance

- **Implementación de H0.** Este ADR no crea tablas, migraciones, roles ni configuración de Supabase. H0 implementa esta arquitectura en `db/` siguiendo la Build Baseline §9.
- **Código del spike.** Es experimental y no se trae a `main`: ni código, ni workflows, ni tests, ni scripts.
- **Service role / secret key** para webhooks y jobs (hipótesis 4): no se valida ni se aprueba aquí.
- **Umbral de latencia:** no hay umbral aprobado.
- **Configuración de Auth** (signup público cerrado, alta de usuarios): el spike la ejercitó, pero no forma parte de este ADR. El login sigue rigiéndose por DEC-012.
- **Otras hipótesis del spike** que no figuran en §2 y §3 no quedan aprobadas.

---

## 9. Consecuencias

- `withTenant()` sobre RLS es el mecanismo aprobado al que remiten DEC-016 y `CLAUDE.md` §3. En Hito 1, los loaders que hoy leen `mocks/` pasan a la capa de datos a través de `withTenant`.
- El runtime y las migraciones usan credenciales distintas. H0 las configura por separado y ambas son server-only.
- Staging (actualizado el 2026-09-30): la limpieza del schema que dejó E2 ya se ejecutó y verificó, y la elección entre reset y limpieza ya no está abierta.
  - No quedan las tablas `organizations`, `profiles` y `memberships`, el enum `membership_role`, el schema `private`, el historial ni el schema experimental de Drizzle, ni el rol `app_runtime`.
  - `public` volvió al baseline limpio, con ACL y default privileges restaurados y verificados. Los objetos administrados por Supabase quedaron intactos.
  - Staging está listo para las migraciones oficiales `0000` y `0001` (DEC-018 y DEC-019).
- La Build Baseline no se reescribe. Este ADR prevalece sobre la Build Baseline §7 ("Aislamiento de tenant") en lo que difiere (DEC-002), y cierra el gate del commit 6 (§9) y el punto abierto de §10.

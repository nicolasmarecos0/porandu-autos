# Porandú Autos

**Automotive Revenue OS / Sales Intelligence Platform** para playas, showrooms y concesionarias.
Porandú conecta inventario, conversaciones, intención de compra y operación comercial para ayudar a vender más vehículos.

> Estado: **Build Baseline B1**, que cubre Hito 0 (Foundation) y el Vertical Slice visual sobre mock data. **Hito 1 en curso:** H1.1 lleva la cola de Opportunities a PostgreSQL real (ver "Opportunities con datos reales (H1.1)"), H1.2 agrega el alta manual de oportunidades (ver "Alta de oportunidades (H1.2)") y H1.3A lleva la Stock List a PostgreSQL real, de solo lectura (ver "Stock con datos reales (H1.3A)").
> Alcance vigente: [`docs/03_BUILD_BASELINE_B1.md`](docs/03_BUILD_BASELINE_B1.md)

---

## Documentación

| Doc | Contenido |
|---|---|
| [`docs/00_MASTER_CONTEXT.md`](docs/00_MASTER_CONTEXT.md) | Contexto maestro del producto |
| [`docs/01_TECHNICAL_BLUEPRINT_v1.1.md`](docs/01_TECHNICAL_BLUEPRINT_v1.1.md) | Baseline técnica y alcance de P1 |
| [`docs/02_VISUAL_PRODUCT_BLUEPRINT_v0.1.md`](docs/02_VISUAL_PRODUCT_BLUEPRINT_v0.1.md) | Baseline visual y de producto |
| [`docs/03_BUILD_BASELINE_B1.md`](docs/03_BUILD_BASELINE_B1.md) | Build Baseline vigente |
| [`docs/05_DECISIONS_LOG.md`](docs/05_DECISIONS_LOG.md) | Decisiones y ADRs posteriores a las baselines |
| [`CLAUDE.md`](CLAUDE.md) | Reglas para agentes de IA en este repo |

Ante un conflicto entre documentos, aplica la jerarquía de autoridad de **DEC-002** en el Decisions Log.

---

## Stack

- Next.js (App Router) con TypeScript strict
- Tailwind CSS con design tokens propios y primitivas Radix
- Supabase: PostgreSQL, Auth y Storage
- Drizzle ORM y drizzle-kit
- Zod
- Vitest y Playwright
- GitHub Actions
- Vercel (staging)
- pnpm y Node 24 LTS

La arquitectura es un monolito modular multi-tenant.

---

## Requisitos

- Node 24 (ver `.nvmrc`)
- pnpm, que puede activarse vía corepack con `corepack enable`
- Docker, necesario para Supabase local

## Setup local

```bash
pnpm install
pnpm sb:start          # levanta Supabase local (Docker)
pnpm sb:status         # muestra URL y keys locales
cp .env.example .env.local
# completar .env.local (ver "Variables de entorno")
pnpm db:migrate        # usa MIGRATION_DATABASE_URL (rol postgres)
pnpm dev               # http://localhost:3000
```

La migración crea el rol `app_runtime` **sin password**. En local, fijala con la credencial de migración y usala en `RUNTIME_DATABASE_URL` (nunca en un archivo versionado):

```bash
psql "<MIGRATION_DATABASE_URL local>" -c "ALTER ROLE app_runtime PASSWORD '<password-local>'"
```

En staging, la password vive en el GitHub secret `STAGING_RUNTIME_DB_PASSWORD` y la fija el workflow Staging DB (ver "Staging DB (H0.8)"). Su uso desde Vercel queda para H0.9/E3.

Para detener Supabase local: `pnpm sb:stop`.

## Variables de entorno

Ver `.env.example`, que solo contiene placeholders. **Nunca commitear `.env*` con valores reales**: `.gitignore` ignora todo `.env*` salvo `.env.example`.

| Variable | Uso | Rol DB | Expuesta al browser |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | URL del proyecto Supabase | — | Sí |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publishable key (`sb_publishable_…`) | — | Sí |
| `RUNTIME_DATABASE_URL` | Conexión Postgres de la aplicación (runtime) | `app_runtime` | **No**, server-only |
| `MIGRATION_DATABASE_URL` | Conexión Postgres de `drizzle-kit` (migraciones) | `postgres` | **No**, solo tooling |

Separación runtime / migraciones (ADR-001):

- El runtime lee **solo** `RUNTIME_DATABASE_URL`, a través de `lib/env.server.ts` (`import "server-only"`). La validación rechaza cualquier rol distinto de `app_runtime`. En staging apunta a Supavisor en modo transacción (puerto 6543, usuario `app_runtime.<project_ref>`).
- `MIGRATION_DATABASE_URL` la usa únicamente `drizzle-kit`. En staging apunta a Supavisor en modo sesión (puerto 5432, usuario `postgres.<project_ref>`). ESLint prohíbe leerla desde código de la aplicación.
- No existe un `DATABASE_URL` genérico: ninguna herramienta puede tomar la credencial equivocada por defecto.
- Las variables públicas se leen con `lib/env.public.ts`. Solo lo que lleva prefijo `NEXT_PUBLIC_` llega al browser; una variable server-only nunca lleva ese prefijo.
- En H0 no hay secret key ni service role de Supabase aprobados para la aplicación (ADR-001 §8), así que no forman parte del contrato. La única excepción es operacional y fuera de la app: `STAGING_SECRET_KEY` en el workflow Staging DB (DEC-022).

## Scripts

| Script | Acción |
|---|---|
| `pnpm dev` | Servidor de desarrollo |
| `pnpm build` / `pnpm start` | Build y ejecución de producción |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | ESLint |
| `pnpm format` / `pnpm format:check` | Prettier |
| `pnpm test` | Vitest (unit e integración), una sola corrida |
| `pnpm test:watch` | Vitest en modo watch |
| `pnpm test:db` | Migraciones, schema y aislamiento de tenant contra un PostgreSQL 17 desechable (ver "Base de datos") |
| `pnpm test:staging` | Acceptance contra el Supabase de staging. Solo lo corre el workflow Staging DB, nunca CI ni una máquina local |
| `pnpm test:e2e` | Playwright |
| `pnpm db:generate` | Genera una migración desde el schema de Drizzle (no se conecta a la base) |
| `pnpm db:migrate` | Aplica las migraciones con `MIGRATION_DATABASE_URL` (rol `postgres`) |
| `pnpm sb:start` / `sb:stop` / `sb:status` | Supabase local |

Antes de abrir un PR deben pasar: `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm build`.

## Base de datos

- El schema de Drizzle vive en `db/schema/` y las migraciones en `db/migrations/` (única fuente). `db:generate` y `db:migrate` leen `MIGRATION_DATABASE_URL` del entorno o de `.env.local`; la variable del entorno prevalece.
- Las migraciones apuntan a Supabase: dependen de `auth.users`, `auth.uid()` y de los roles `anon` y `authenticated`. No hay `db:studio`: la credencial `postgres` es exclusiva para aplicar migraciones (ADR-001).
- `0001_tenant_isolation` verifica al final las invariantes de ADR-001 §3.6 sobre la base real (atributos y memberships de `app_runtime`, nadie más que `postgres` crea objetos) y, si alguna falla, no aplica nada. `0002_opportunities_persistence` hace lo mismo con las de tablas, sobre toda tabla de `public`: RLS habilitado, `organization_id` NOT NULL con FK e índice líder, ningún privilegio de `anon` ni `app_runtime`, y todo privilegio de `authenticated` cubierto por una policy. `0003_contact_identity_opportunity_create` repite esas y agrega las de las primeras escrituras: toda policy de escritura tiene `WITH CHECK` y `authenticated` no tiene UPDATE, DELETE ni TRUNCATE sobre ninguna tabla. `0004_vehicles_stock_persistence` repite las de `0003` y agrega que `authenticated` solo da de alta en `contacts` y `opportunities` (`vehicles` es de solo lectura). `drizzle-kit migrate` sale con código 1 sin imprimir el error de Postgres: la causa queda en el log de la base.
- `pnpm test:db` aplica las migraciones desde cero, con `pnpm db:migrate`, sobre un PostgreSQL 17 **local y desechable**, nunca sobre staging. El harness crea los roles y el mínimo de Supabase que la migración necesita (`tests/db/support/`), le fija a `app_runtime` una password aleatoria por corrida y prueba el aislamiento a través de `withUser()`/`withTenant()`: tenant A vs B, memberships inactivas, roles y grants de catálogo, y que rol y claims no dejan residuos entre transacciones. También prueba Tenant Resolution de punta a punta (`requireTenant()`, selector y revocación), los loaders de Opportunities y de Stock (`requireTenant()` → `withTenant()` → RLS) y el alta de oportunidades (Server Action, deduplicación por teléfono, concurrencia, atomicidad y RLS de escritura) contra la base real, y que `0004` se aplica sobre una base en H1.2 (como staging hoy) sin tocar sus datos. El superusuario del servidor no puede ser `postgres`, porque en Supabase `postgres` no es superuser:

```bash
docker run -d --rm --name porandu-pg17 -p 127.0.0.1:55432:5432 \
  -e POSTGRES_USER=test_admin -e POSTGRES_HOST_AUTH_METHOD=trust postgres:17
TEST_ADMIN_DATABASE_URL=postgresql://test_admin@127.0.0.1:55432/postgres pnpm test:db
docker stop porandu-pg17
```

---

## Staging DB (H0.8)

El workflow manual **Staging DB** (`.github/workflows/staging-db.yml`) opera la base del proyecto Supabase de staging con el código y las migraciones de `main`: preflight, migraciones oficiales, credencial de `app_runtime`, verificación y acceptance. Sirve para cada migración futura de staging. La lógica vive en `scripts/staging/` (Node 24 ejecuta los `.mts` sin build) y en `tests/staging/`.

**Garantías**

- Solo `workflow_dispatch` desde `main`, con el environment `staging` (aprobación del fundador) y un job a la vez.
- Antes de conectar valida el destino: el project ref tiene que coincidir entre `vars.STAGING_PROJECT_REF`, el input `confirm_project_ref`, `STAGING_SUPABASE_URL` y el usuario del Session pooler, que tiene que ser el de Supabase en `sa-east-1`. Cualquier otro proyecto aborta.
- Cada paso recibe solo los secrets que usa. Las URLs con credenciales se arman en memoria y nunca se imprimen; los errores nombran variables, no valores.
- Cada operación corre primero el preflight de solo lectura (transacción `READ ONLY`): PostgreSQL 17, base `postgres`, rol `postgres` sin superuser, dependencias de Supabase, `pg_graphql` ausente, historial de drizzle igual a un prefijo exacto de `db/migrations` (mismos hashes) y `public` igual a lo que dejan esas migraciones (snapshot de drizzle-kit). Sin historial, tampoco puede existir `private` ni `app_runtime`. Ante cualquier diferencia aborta y la nombra: no limpia nada ni usa `CASCADE`.
- `migrate` usa solo la credencial `postgres` y aplica con `pnpm db:migrate` (drizzle-kit). Exige declarar las migraciones pendientes (`expected_migrations`) y que coincidan exactamente. drizzle-kit aplica todas las pendientes en una sola transacción.
- `provision-runtime` fija la password de `app_runtime` desde `STAGING_RUNTIME_DB_PASSWORD`, que no puede ser la de `postgres`. La hashea en el runner (SCRAM-SHA-256) y a la base solo llega el verificador: Supabase registra los `ALTER ROLE` en el log de Postgres, y con este método el texto plano nunca queda ahí.
- El acceptance del runtime no recibe la credencial de `postgres`. Contra staging nunca corren controles negativos de sesión: todo intento de cambiar rol o claims es local a una transacción.
- **Data API:** el contrato no es un status concreto. Ninguna request REST o GraphQL, con la publishable key o con el token de un usuario sintético, puede devolver tablas, datos o schema de la app: cualquier respuesta exitosa que los exponga hace fallar la verificación. Las respuestas de API deshabilitada, no disponible o no autorizada pueden variar según Supabase y todas pasan; solo se registran status y categoría. La comprobación fuerte de que no hay vía lateral es el acceptance Auth → Tenant con datos sintéticos.

**`STAGING_SECRET_KEY` (excepción operacional, DEC-022).** Solo en GitHub Actions, solo en el environment `staging` y solo para la Supabase Auth Admin API: crear y eliminar usuarios sintéticos en `auth-tenant-acceptance` y `cleanup-synthetic`. Nunca en el runtime, en Vercel ni en el navegador, y nunca para queries de producto ni la Data API. En el código, el cliente con la secret key no sale de `scripts/staging/synthetic.mts`, que solo expone crear y eliminar usuarios (los sintéticos se buscan con una lectura SQL de `auth.users`), y ningún módulo de la aplicación puede importar `scripts/`.

**Operaciones** (input `operation`)

| Operación | Qué hace | Secrets |
|---|---|---|
| `preflight` | Solo el preflight | `STAGING_SUPABASE_URL`, `STAGING_SESSION_POOLER_URL`, `STAGING_DB_PASSWORD` |
| `migrate` | Preflight → `pnpm db:migrate` → historial exacto → verificación | los anteriores y `STAGING_PUBLISHABLE_KEY` |
| `provision-runtime` | Preflight → password de `app_runtime` → login por 6543 → acceptance del runtime | los de `preflight` y `STAGING_RUNTIME_DB_PASSWORD` |
| `verify` | Verificación de catálogo (roles, grants, RLS, policies, `private`) y de la Data API (ninguna respuesta expone datos ni schema de la app) | los de `preflight` y `STAGING_PUBLISHABLE_KEY` |
| `runtime-acceptance` | `app_runtime` por Supavisor 6543 con `db/tenant.ts`: falla cerrado, contexto limpio tras COMMIT/ROLLBACK/error, no asume otros roles | `STAGING_RUNTIME_DB_PASSWORD` (sin la de `postgres`) |
| `auth-tenant-acceptance` | Supabase Auth real → `getClaims()` → memberships → `requireTenant()` → `withTenant()` → RLS, con usuarios y organizaciones sintéticos que se borran al terminar | todos, incluida `STAGING_SECRET_KEY` (solo Auth Admin API) |
| `cleanup-synthetic` | Borra datos sintéticos de corridas interrumpidas | los de `preflight` y `STAGING_SECRET_KEY` |

Los datos sintéticos llevan dos marcas: email `synthetic-<clave>-<corrida>@porandu-synthetic.test` con `app_metadata.porandu_synthetic`, y organizaciones `SYNTHETIC H0 <corrida> · <clave>`. La limpieza solo borra filas con esas marcas, en orden explícito (memberships → organizaciones → profiles → usuarios de Auth) y nunca el schema, las migraciones ni `app_runtime`. Si una organización sintética tiene miembros reales, no borra nada.

**Configuración en GitHub (una vez)**

- Environment `staging`: required reviewer (el fundador) y deployment branches solo `main`.
- Variable `STAGING_PROJECT_REF` (no secreta): el project ref de staging.
- Secrets: `STAGING_SUPABASE_URL`, `STAGING_SESSION_POOLER_URL` (el string del Session pooler; puede conservar `[YOUR-PASSWORD]`), `STAGING_DB_PASSWORD`, `STAGING_PUBLISHABLE_KEY`, `STAGING_SECRET_KEY` y `STAGING_RUNTIME_DB_PASSWORD` (32 a 128 caracteres de `[A-Za-z0-9._~-]`, por ejemplo `openssl rand -hex 32`).

**Runbook de una migración**

1. `preflight`: revisar el estado y las migraciones pendientes.
2. `migrate` con `expected_migrations` igual a los tags pendientes (primer rollout: `0000_saas_core_schema,0001_tenant_isolation`; H1.1: `0002_opportunities_persistence`; H1.2: `0003_contact_identity_opportunity_create`; H1.3A: `0004_vehicles_stock_persistence`). Incluye la verificación de catálogo; `verify` la repite sola cuando haga falta.
3. Primer rollout o rotación: `provision-runtime`.
4. `auth-tenant-acceptance` cuando cambie Auth, Tenant Resolution o el aislamiento.

**`RUNTIME_DATABASE_URL` de staging.** `postgresql://app_runtime.<project_ref>:<password>@aws-<n>-sa-east-1.pooler.supabase.com:6543/postgres?sslmode=require`, con la password URL-encoded. El workflow la arma en memoria. Dónde se configura para el runtime desplegado (Vercel) es H0.9/E3; nunca va a un archivo del repositorio.

**Rotación de `app_runtime`.** Actualizar el secret `STAGING_RUNTIME_DB_PASSWORD`, correr `provision-runtime` y actualizar `RUNTIME_DATABASE_URL` donde corra el runtime. Entre esos dos pasos el runtime desplegado no puede conectarse.

`pnpm test:db` valida este tooling contra el PostgreSQL 17 desechable (`tests/db/staging-tooling.test.ts`), incluido el mismo spec del acceptance del runtime. Los acceptance de `tests/staging/` solo corren en el workflow.

## Estructura

```text
app/          Rutas (App Router). (auth)/ y (app)/ con el shell
components/   UI: ui/ (primitivas + tokens) y componentes por área
domains/      Tipos y lógica pura por dominio (sin React ni DB)
db/           Schema Drizzle, migraciones y acceso tenant-scoped (queries/: loaders)
mocks/        Fixtures tipados para el vertical slice (Opportunities: solo referencia de tests)
lib/          env, auth, logger y utilidades de infraestructura
supabase/     Configuración de Supabase local
scripts/      Tooling operativo (staging/: workflow Staging DB). La app no lo importa
tests/        unit/, db/ (PostgreSQL real), staging/ (acceptance en staging), e2e/
docs/         Baselines, Build Baseline y Decisions Log
```

## Autenticación (H0.6)

Supabase Auth con email + password (DEC-012), solo del lado del servidor:

- `lib/supabase/server.ts` crea, por request, un cliente de `@supabase/ssr` que solo expone `auth`, con `NEXT_PUBLIC_SUPABASE_URL` y la publishable key. No hay cliente de Supabase en el navegador, ni secret key, ni service role.
- La identidad sale de `requireUser()` / `getAuthenticatedUser()` (`lib/auth/session.ts`), que usan `auth.getClaims()`: firma verificada contra el JWKS del proyecto y expiración. Nunca `getSession()`. `lib/auth/claims.ts` exige `sub` UUID y `role = authenticated`, rechaza usuarios anónimos y solo deja pasar los claims obligatorios de Supabase: ninguna organización sale de los claims.
- `/login` (Server Component) llama a la Server Action `signIn`. `signOut` (botón "Cerrar sesión" del shell) revoca la sesión actual y vuelve a `/login`. No hay registro público, magic link, OAuth ni reset de password.
- `proxy.ts` (la convención de Next 16 que reemplaza a `middleware.ts`) refresca las cookies de sesión (`HttpOnly`, `SameSite=Lax`, `Secure` en producción) y manda a `/login` las navegaciones sin usuario verificado. No consulta Postgres ni resuelve tenant, y no es la barrera de autorización.
- El layout de `(app)` exige un usuario verificado y además resuelve el tenant (ver "Tenant Resolution (H0.7)").
- Un login exitoso y `signOut` borran la cookie de organización activa: la preferencia no se hereda entre cuentas. Un login fallido no la toca.

## Tenant Resolution (H0.7)

Completa la cadena `AuthenticatedUser → memberships activas → organización activa → TenantContext confiable → withTenant()`:

- **Memberships propias:** `listActiveMemberships()` (`db/queries/memberships.ts`) es la única query que corre con `withUser()`. Filtra explícitamente `user_id` del usuario verificado y `active = true`, y devuelve solo `organizationId`, nombre de la organización y rol.
- **`requireTenant()`** (`lib/tenant/session.ts`): verifica al usuario (`requireUser()`), lee sus memberships activas y la cookie de organización, y resuelve:
  - 0 memberships activas → `/no-access`;
  - 1 → esa organización, con o sin cookie (una cookie ajena o vieja no bloquea ni concede otro tenant);
  - 2+ → la de la cookie solo si coincide con una membership activa; si no → `/select-organization`.

  El rol sale siempre de la membership en la base. Nunca del JWT, la cookie, un formulario o la query string.
- **`TenantContext` opaco:** `{ userId, claims, organizationId, role }`. Solo lo emite `resolveTenant()` (`lib/tenant/resolution.ts`): el tipo lleva una marca no exportada y cada contexto emitido queda registrado y congelado. `withTenant()` rechaza cualquier otro objeto (un objeto plano, un `AuthenticatedUser`, una copia con otra organización) aunque tenga la forma correcta o se fuerce con `as`.
- **Cookie `porandu-active-organization`:** solo el UUID de la organización elegida. `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` en producción y 400 días (como la sesión). No es una credencial: cada request la valida contra las memberships activas, así que no se firma.
- **`/select-organization`:** lista solo las memberships activas del usuario. La Server Action `selectOrganization` trata el `organizationId` como input no confiable: valida el UUID, vuelve a leer las memberships activas y solo entonces escribe la cookie (con el UUID de la base) y redirige a `/cockpit`. Cualquier otro campo del formulario se ignora, y una organización inexistente, ajena o inactiva da el mismo error genérico.
- **`/no-access`:** usuario autenticado sin memberships activas. Solo informa y permite cerrar sesión.
- **Revocación:** pasar una membership a `active = false` (o borrarla) corta el acceso desde el request siguiente, aunque la cookie siga ahí. RLS además deja sin datos a un contexto emitido antes.
- **Guardas de ESLint:** `withUser()` solo se importa en `db/queries/memberships.ts` y `resolveTenant()` solo en `lib/tenant/session.ts` (los tests pueden usar ambos).

**El layout no sustituye la validación junto a los datos.** El layout de `(app)` llama a `requireTenant()` como gate de UX, pero no se vuelve a renderizar en cada navegación ni le pasa el contexto a las páginas. En Hito 1, todo loader o Server Action tenant-scoped obtiene su propio contexto y se lo pasa a `withTenant()`:

```ts
const ctx = await requireTenant();
return withTenant(ctx, (tx) =>
  tx.select().from(table).where(eq(table.organizationId, ctx.organizationId)),
);
```

`cache()` de React deduplica `requireUser()` y `requireTenant()` dentro del render de una misma request: la segunda llamada no repite la verificación de claims ni las queries. No es una caché persistente ni compartida entre usuarios o requests, y en Server Actions no memoriza. El contexto no se serializa: no se pasa a Client Components ni como argumento de una Server Action (que llama a `requireTenant()` por su cuenta).

## Acceso a datos y tenant isolation

Implementa ADR-001 (`db/tenant.ts` y la migración `0001_tenant_isolation`):

- El runtime se conecta como `app_runtime`, que no tiene privilegios directos: toda query fuera del boundary falla cerrado (`42501`).
- `withUser(ctx, fn)` y `withTenant(ctx, fn)` abren una transacción que fija los claims y el rol `authenticated` con `set_config(..., true)`. Al terminar, la conexión vuelve a ser `app_runtime` sin claims. Nunca se usa `SET` de sesión ni `set_config(..., false)`.
- RLS limita cada fila a las organizaciones con membership activa del usuario (`private.user_org_ids()`). Las queries tenant-scoped filtran además por `ctx.organizationId`.
- Lectura: `organizations`, `memberships`, `contacts`, `opportunities` y `vehicles` de las organizaciones del usuario, y su propio `profiles`.
- Escritura (H1.2): solo INSERT en `contacts` y `opportunities`, con policies cuyo `WITH CHECK` exige una organización con membership activa; la de `opportunities` exige además `stage = 'new'`. No hay UPDATE ni DELETE en ninguna tabla, ni INSERT en `vehicles`.
- ESLint impide importar `db/client` fuera de `db/tenant.ts` (y de dos archivos de test).
- `withTenant()` no resuelve ni valida la organización activa: recibe un contexto confiable (claims verificados y organización ya validada). Los claims verificados llegan con Supabase Auth (H0.6); la organización activa la resuelve y valida Tenant Resolution (H0.7) con `requireTenant()` (DEC-019). `withTenant()` solo acepta un `TenantContext` emitido por Tenant Resolution.

## Opportunities con datos reales (H1.1)

`/opportunities` es la primera superficie de producto respaldada por PostgreSQL:

```text
request → requireTenant() → TenantContext → withTenant() → query con filtro
explícito por organización → RLS → ViewModel de Opportunities
```

- **Loader:** `getOpportunityQueue()` (`db/queries/opportunities.ts`) pide su propio contexto con `requireTenant()`, lee dentro de `withTenant()`, filtra por `ctx.organizationId` (defensa en profundidad: con varias memberships activas, RLS deja ver todas sus organizaciones) y devuelve el ViewModel que ya usa la UI. La página no conoce Drizzle.
- **Persistido (`0002_opportunities_persistence`):** `contacts` (nombre, teléfono, ciudad) y `opportunities` (contacto de la misma organización por FK compuesta, etapa, origen, modelo y versión buscados, última actividad). Etapa y origen se validan con un CHECK, no con un enum: esos conjuntos todavía no están cerrados por producto.
- **Derivado:** iniciales, teléfono enmascarado, minutos desde la última actividad y urgencia de la cola.
- **Sin dato (no se persiste ni se inventa):** Porandú Score y sub-scores, NBA, ¿Por qué ahora?, Top Match, alternativa, trade-in, responsable, `● En vivo` y el resumen de la última actividad. La UI no los muestra hasta que exista su fuente.
- **Reglas temporales de presentación:** la urgencia (Actuar ahora / Durante el día / En seguimiento) sale de las bandas de recencia de B1 §3.2 (`bucketFromRecency()`); la recencia se presenta en `America/Asuncion` (las organizaciones todavía no tienen zona horaria); el anillo usa la composición conceptual del Master Context §10 (40/30/30), que no es la fórmula del producto (DEC-004).
- **Una sola fuente:** `mocks/opportunities.ts` ya no tiene loader. Sus fixtures quedan como referencia del contrato visual de B1 para los tests, y ESLint impide importarlos fuera de `tests/`.
- **Guardas de ESLint:** páginas y componentes no importan Drizzle, `db/schema` ni `db/tenant` (leen con los loaders de `db/queries/`); `domains/` no depende de `db/`, `mocks/`, Drizzle, React ni Next (DEC-016).
- Con 0 oportunidades la página muestra un estado vacío; no hay seeds en runtime.

## Alta de oportunidades (H1.2)

"Nueva oportunidad" (columna izquierda de `/opportunities`) abre un drawer lateral con el formulario mínimo: nombre, teléfono y ciudad del contacto; origen, modelo y versión buscados. Es la primera escritura de producto:

```text
Server Action createOpportunity() → requireTenant() → validación en el
servidor → withTenant() (una transacción): contacto resuelto o nuevo +
oportunidad → RLS (WITH CHECK) → revalidar /opportunities
```

- **Una sola puerta:** `createOpportunity()` (`lib/opportunities/actions.ts`). ESLint impide importar la escritura (`db/queries/create-opportunity.ts`) desde cualquier otro módulo, y la UI no conoce Drizzle, el schema ni el boundary.
- **Qué acepta el servidor:** `name`, `phone`, `city`, `source`, `interestModel` e `interestVersion`. Cualquier otro campo del payload se ignora. La organización sale del `TenantContext`; la etapa es siempre `new`, fijada por el código y exigida por el `WITH CHECK` de la policy de INSERT (el CHECK de `stage` sigue admitiendo todas las etapas: las transiciones serán policies de UPDATE); timestamps y recencia los pone la base (`last_activity_at = now()` es una regla temporal del alta manual). Nombre, teléfono y origen son obligatorios; los textos tienen largo máximo y se normalizan (NFC, sin caracteres de control).
- **Origen:** `whatsapp`, `meta_ads`, `web`, `showroom` o `referral` (el CHECK de la base). La carga manual no es un origen comercial.
- **Teléfono:** se guarda tal como se cargó (`phone`) y en E.164 (`phone_normalized`), normalizado con `libphonenumber-js` (metadata completa) en `lib/contacts/phone.ts`, que es server-only. Sin prefijo internacional se interpreta como de Paraguay; con `+<código>` conserva su país. Un número inválido se rechaza antes de escribir. La librería no llega al bundle del navegador.
- **Identidad del contacto:** índice único parcial `(organization_id, phone_normalized)`: el mismo teléfono es un solo contacto por organización, y puede repetirse en otra. El alta inserta el contacto con `ON CONFLICT DO NOTHING` sobre ese índice y, si ya existía, lo reutiliza sin modificar su nombre ni su ciudad. Dos altas concurrentes con el mismo teléfono terminan en un contacto: la unicidad de la base es la autoridad. Un mismo contacto puede tener varias oportunidades.
- **Atomicidad:** contacto y oportunidad en una sola transacción `withTenant()`. Si la oportunidad falla, el contacto nuevo no queda. El error vuelve al formulario sin detalles de la base y con lo cargado, para reintentar.
- **Sin backfill:** los contactos existentes sin `phone_normalized` no se tocan ni participan de la deduplicación.
- **UX:** sin wizard. Mientras guarda, el botón muestra "Creando…" y el drawer no se cierra. Los errores se marcan por campo (es-PY) y el foco vuelve al primero a corregir. Al crear, el drawer se cierra, la cola se revalida, la oportunidad nueva queda seleccionada y un aviso dice si se usó un contacto existente.

## Stock con datos reales (H1.3A)

`/stock` deja de ser un placeholder de B1: la Stock List lee PostgreSQL real, de solo lectura.

```text
request → requireTenant() → TenantContext → withTenant() → query con filtro
explícito por organización → RLS → ViewModel de Stock
```

- **Loader:** `getStockList()` (`db/queries/vehicles.ts`) pide su propio contexto con `requireTenant()`, lee dentro de `withTenant()`, filtra por `ctx.organizationId` (defensa en profundidad) y ordena por ingreso, el más reciente primero (`created_at DESC`, `id` como desempate). La página no conoce Drizzle.
- **Persistido (`0004_vehicles_stock_persistence`):** `vehicles` con marca, modelo, versión, año, km, precio y moneda, y estado. Precio `numeric(14, 2)`: exacto, se lee como texto y nunca pasa por float; precio y moneda (`PYG` o `USD`) van juntos, el precio es positivo y en guaraníes no tiene decimales. Estado y moneda usan CHECK, no enum: el estado es el mínimo de P1 del TB §10 (`in_preparation`, `available`, `reserved`, `sold`).
- **Derivado:** formato de precio ("USD 49.900", "Gs. 150.000.000") y de km ("0 km", "142.000 km"), sin conversión entre monedas.
- **Sin dato (no se persiste ni se inventa):** versión, km o precio ausentes se muestran "Sin dato". No hay fotos (ni reales ni representación), matches, interesados, demanda, sucursal ni trade-in.
- **Solo lectura:** sin alta, edición ni transiciones de estado. `authenticated` solo tiene SELECT sobre `vehicles`.
- **Una sola fuente:** no hay fixtures de stock. ESLint impide que la página, sus componentes y su loader importen `mocks/`.
- Con 0 vehículos la página muestra un estado vacío; no hay seeds en runtime.
- `0004` no se aplica a staging en esta rama: va después del merge con `preflight → migrate → verify`.

## Convenciones

- Código, rutas, DB e identificadores en inglés. Copy de UI en español es-PY (DEC-011).
- Commits con Conventional Commits (`feat:`, `fix:`, `chore:`, `test:`, `docs:`, `spike:`).
- Trabajo en ramas y PR a `main` con CI en verde.
- Multi-tenancy: ver DEC-006 y ADR-001. Nunca se accede a datos tenant-scoped fuera del mecanismo aprobado.

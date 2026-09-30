# Porandú Autos

**Automotive Revenue OS / Sales Intelligence Platform** para playas, showrooms y concesionarias.
Porandú conecta inventario, conversaciones, intención de compra y operación comercial para ayudar a vender más vehículos.

> Estado: **Build Baseline B1**, que cubre Hito 0 (Foundation) y el Vertical Slice visual sobre mock data.
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

En staging, dónde vive y cómo se rota esa credencial queda para E3 (ADR-001 §7).

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
- En H0 no hay secret key ni service role de Supabase aprobados (ADR-001 §8), así que no forman parte del contrato.

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
| `pnpm test:e2e` | Playwright |
| `pnpm db:generate` | Genera una migración desde el schema de Drizzle (no se conecta a la base) |
| `pnpm db:migrate` | Aplica las migraciones con `MIGRATION_DATABASE_URL` (rol `postgres`) |
| `pnpm sb:start` / `sb:stop` / `sb:status` | Supabase local |

Antes de abrir un PR deben pasar: `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm build`.

## Base de datos

- El schema de Drizzle vive en `db/schema/` y las migraciones en `db/migrations/` (única fuente). `db:generate` y `db:migrate` leen `MIGRATION_DATABASE_URL` del entorno o de `.env.local`; la variable del entorno prevalece.
- Las migraciones apuntan a Supabase: dependen de `auth.users`, `auth.uid()` y de los roles `anon` y `authenticated`. No hay `db:studio`: la credencial `postgres` es exclusiva para aplicar migraciones (ADR-001).
- `0001_tenant_isolation` verifica al final las invariantes de ADR-001 §3.6 sobre la base real (atributos y memberships de `app_runtime`, nadie más que `postgres` crea objetos) y, si alguna falla, no aplica nada. `drizzle-kit migrate` sale con código 1 sin imprimir el error de Postgres: la causa queda en el log de la base.
- `pnpm test:db` aplica las migraciones desde cero, con `pnpm db:migrate`, sobre un PostgreSQL 17 **local y desechable**, nunca sobre staging. El harness crea los roles y el mínimo de Supabase que la migración necesita (`tests/db/support/`), le fija a `app_runtime` una password aleatoria por corrida y prueba el aislamiento a través de `withUser()`/`withTenant()`: tenant A vs B, memberships inactivas, roles y grants de catálogo, y que rol y claims no dejan residuos entre transacciones. El superusuario del servidor no puede ser `postgres`, porque en Supabase `postgres` no es superuser:

```bash
docker run -d --rm --name porandu-pg17 -p 127.0.0.1:55432:5432 \
  -e POSTGRES_USER=test_admin -e POSTGRES_HOST_AUTH_METHOD=trust postgres:17
TEST_ADMIN_DATABASE_URL=postgresql://test_admin@127.0.0.1:55432/postgres pnpm test:db
docker stop porandu-pg17
```

---

## Estructura

```text
app/          Rutas (App Router). (auth)/ y (app)/ con el shell
components/   UI: ui/ (primitivas + tokens) y componentes por área
domains/      Tipos y lógica pura por dominio (sin React ni DB)
db/           Schema Drizzle, migraciones y acceso tenant-scoped
mocks/        Fixtures tipados para el vertical slice
lib/          env, auth, logger y utilidades de infraestructura
supabase/     Configuración de Supabase local
tests/        unit/, db/ (PostgreSQL real), tenant/, e2e/
docs/         Baselines, Build Baseline y Decisions Log
```

## Acceso a datos y tenant isolation

Implementa ADR-001 (`db/tenant.ts` y la migración `0001_tenant_isolation`):

- El runtime se conecta como `app_runtime`, que no tiene privilegios directos: toda query fuera del boundary falla cerrado (`42501`).
- `withUser(ctx, fn)` y `withTenant(ctx, fn)` abren una transacción que fija los claims y el rol `authenticated` con `set_config(..., true)`. Al terminar, la conexión vuelve a ser `app_runtime` sin claims. Nunca se usa `SET` de sesión ni `set_config(..., false)`.
- RLS limita cada fila a las organizaciones con membership activa del usuario (`private.user_org_ids()`). Las queries tenant-scoped filtran además por `ctx.organizationId`.
- En H0 solo hay lectura: `organizations` y `memberships` de las organizaciones del usuario, y su propio `profiles`. No hay grants ni policies de escritura.
- ESLint impide importar `db/client` fuera de `db/tenant.ts` (y de dos archivos de test).
- `withTenant()` no resuelve ni valida la organización activa: recibe un contexto confiable (claims verificados y organización ya validada). Los claims verificados llegan con Supabase Auth (H0.6); resolver y validar la organización activa contra las memberships activas corresponde a Tenant Resolution (H0.7), mediante `requireTenant()` (DEC-019).

## Convenciones

- Código, rutas, DB e identificadores en inglés. Copy de UI en español es-PY (DEC-011).
- Commits con Conventional Commits (`feat:`, `fix:`, `chore:`, `test:`, `docs:`, `spike:`).
- Trabajo en ramas y PR a `main` con CI en verde.
- Multi-tenancy: ver DEC-006 y ADR-001. Nunca se accede a datos tenant-scoped fuera del mecanismo aprobado.

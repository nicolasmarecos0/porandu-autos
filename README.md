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
| `pnpm test:e2e` | Playwright |
| `pnpm db:generate` | Genera una migración desde el schema de Drizzle |
| `pnpm db:migrate` | Aplica las migraciones |
| `pnpm db:studio` | Drizzle Studio |
| `pnpm sb:start` / `sb:stop` / `sb:status` | Supabase local |

Antes de abrir un PR deben pasar: `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm build`.

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
tests/        unit/, tenant/, e2e/
docs/         Baselines, Build Baseline y Decisions Log
```

## Convenciones

- Código, rutas, DB e identificadores en inglés. Copy de UI en español es-PY (DEC-011).
- Commits con Conventional Commits (`feat:`, `fix:`, `chore:`, `test:`, `docs:`, `spike:`).
- Trabajo en ramas y PR a `main` con CI en verde.
- Multi-tenancy: ver DEC-006 y ADR-001. Nunca se accede a datos tenant-scoped fuera del mecanismo aprobado.

# Porandú Autos

**Automotive Revenue OS / Sales Intelligence Platform** para playas, showrooms y concesionarias.
Porandú conecta inventario, conversaciones, intención de compra y operación comercial para ayudar a vender más vehículos.

> Estado: **Build Baseline B1**, que cubre Hito 0 (Foundation) y el Vertical Slice visual sobre mock data. **Hito 1 en curso.** Completados: H1.1 lleva la cola de Opportunities a PostgreSQL real (ver "Opportunities con datos reales (H1.1)"), H1.2 agrega el alta manual de oportunidades (ver "Alta de oportunidades (H1.2)"), H1.3A lleva la Stock List a PostgreSQL real (ver "Stock con datos reales (H1.3A)"), H1.3B agrega el alta rápida de unidades desde Stock (ver "Alta rápida de unidades (H1.3B)") y H1.3C permite marcar disponible una unidad en preparación (ver "Disponibilidad de unidades (H1.3C)").
> **H1.3C completado (DEC-028):** transición controlada `in_preparation → available`, migración `0006_vehicle_availability` con su RLS y privilegios (policy `vehicles_update_mark_available` y UPDATE por columna), aplicada en staging con Runtime Acceptance 12/12 y Auth → Tenant Acceptance 11/11.
> Alcance vigente: [`docs/03_BUILD_BASELINE_B1.md`](docs/03_BUILD_BASELINE_B1.md)
> **H1.4 — Demand Contract / Current Truth (DEC-029, DEC-030):** lo que busca cada cliente como 6 facts tipados en el ledger append-only `opportunity_demand_facts` (`0007_opportunity_demand_facts`), con Current Truth derivado, la card "Busca" con edición y el detalle `/opportunities/[id]` (ver "Demand Contract y Current Truth (H1.4)"). `0007` se aplica a staging después del merge.
> **H1.6 — Opportunity Stages (DEC-032):** etapas comerciales `new → qualifying → negotiating → won`, con `lost` (y su motivo) desde cualquier etapa abierta. La máquina de estados vive en el dominio y la exige la base con un trigger (`0008_opportunity_stages`); el panel "Etapa" de `/opportunities/[id]` ofrece solo los pases permitidos (ver "Opportunity Stages (H1.6)"). `0008` se aplica a staging después del merge.
> **Hito 2 — Bitácora comercial y unidad vinculada (DEC-033):** notas append-only por oportunidad (`opportunity_notes`) y la unidad del stock que se negocia (`opportunities.vehicle_id`), que se elige desde las tarjetas de match En negociación sin cambiar el stock (`0009_opportunity_notes_vehicle_link`, ver "Bitácora y unidad vinculada (Hito 2)"). `0009` se aplica a staging después del merge.
> **Hito 2A — Cierre comercial (DEC-034):** ganar o perder una oportunidad es un solo acto con sus metadatos: la venta (unidad vinculada, precio final con su moneda, forma de pago y entrega) o la pérdida (motivo estructurado y notas). Puerta `closeOpportunity()`, CHECKs y trigger en la base, inmutables una vez cerrada, y la tarjeta "Cierre" en `/opportunities/[id]` (`0010_opportunity_closure_metadata`, ver "Cierre comercial (DEC-034)"). `0010` se aplica a staging después del merge.
> **Hito 3 — Motor de inteligencia (DEC-035):** recencia, Porandú Score (el Health Score de la oportunidad) con su desglose y Next Best Action, derivados en cada lectura por un motor puro (`domains/scoring/engine.ts`) y mostrados en la cola de `/opportunities`. Sin migraciones ni persistencia (ver "Motor de inteligencia (Hito 3)").
> **Hito 4 — Conversaciones y actividad (DEC-036):** mensajes registrados por oportunidad (`messages`, recibidos o enviados por WhatsApp, email u otro medio, sin integración con proveedores) con la puerta `addMessage()`, un trigger que mueve `last_activity_at` con cada nota o mensaje nuevo y el muro "Actividad" en `/opportunities/[id]` (`0011_conversations_and_activity_trigger`, ver "Conversaciones y actividad (Hito 4)"). `0011` se aplica a staging después del merge.
> **Hito 6 — Configuración y equipo (DEC-038):** `/settings` permite a un admin editar el nombre y la moneda por defecto del concesionario, invitar por email a una cuenta de Porandú existente, cambiar roles y quitar accesos. Los sellers ven General y Equipo de solo lectura. RLS, privilegios por columna y un trigger de guarda imponen las mismas reglas en la base (ver "Configuración y equipo (Hito 6)").
>
> **Hito 5 — Dashboard directivo (DEC-037):** `/intelligence` muestra las métricas del mes en curso (Asunción) para la gerencia: pipeline comercial con win rate, salud del inventario derivada de las unidades vinculadas, atención por recencia y las oportunidades en riesgo. Se agregan en PostgreSQL en cada request, por `getExecutiveDashboard()` (`requireTenant()` → `withTenant()`). Sin migraciones ni persistencia (ver "Dashboard directivo (Hito 5)").

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
| `WHATSAPP_APP_SECRET` | Secreto con el que el proveedor firma el webhook de WhatsApp (DEC-039), al menos 32 caracteres | — | **No**, server-only |

Separación runtime / migraciones (ADR-001):

- El runtime lee **solo** `RUNTIME_DATABASE_URL`, a través de `lib/env.server.ts` (`import "server-only"`). La validación rechaza cualquier rol distinto de `app_runtime`. En staging apunta a Supavisor en modo transacción (puerto 6543, usuario `app_runtime.<project_ref>`).
- `MIGRATION_DATABASE_URL` la usa únicamente `drizzle-kit`. En staging apunta a Supavisor en modo sesión (puerto 5432, usuario `postgres.<project_ref>`). ESLint prohíbe leerla desde código de la aplicación.
- No existe un `DATABASE_URL` genérico: ninguna herramienta puede tomar la credencial equivocada por defecto.
- Las variables públicas se leen con `lib/env.public.ts`. Solo lo que lleva prefijo `NEXT_PUBLIC_` llega al browser; una variable server-only nunca lleva ese prefijo.
- En H0 no hay secret key ni service role de Supabase aprobados para la aplicación (ADR-001 §8), así que no forman parte del contrato. La única excepción es operacional y fuera de la app: `STAGING_SECRET_KEY` en el workflow Staging DB (DEC-022).
- `WHATSAPP_APP_SECRET` (Hito 7) solo verifica la firma de `POST /api/webhooks/whatsapp`, con `getWhatsAppEnv()` de `lib/env.server.ts`. No es obligatoria para arrancar la app: sin ella, el webhook falla cerrado con `503` y el resto funciona igual.

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
- `0001_tenant_isolation` verifica al final las invariantes de ADR-001 §3.6 sobre la base real (atributos y memberships de `app_runtime`, nadie más que `postgres` crea objetos) y, si alguna falla, no aplica nada. `0002_opportunities_persistence` hace lo mismo con las de tablas, sobre toda tabla de `public`: RLS habilitado, `organization_id` NOT NULL con FK e índice líder, ningún privilegio de `anon` ni `app_runtime`, y todo privilegio de `authenticated` cubierto por una policy. `0003_contact_identity_opportunity_create` repite esas y agrega las de las primeras escrituras: toda policy de escritura tiene `WITH CHECK` y `authenticated` no tiene UPDATE, DELETE ni TRUNCATE sobre ninguna tabla. `0004_vehicles_stock_persistence` repite las de `0003` y agrega que `authenticated` solo da de alta en `contacts` y `opportunities` (`vehicles` es de solo lectura en H1.3A). `0005_vehicle_quick_create` repite las de `0004`, con `vehicles` entre las altas aprobadas. `0006_vehicle_availability` repite las de `0005`, extiende la cobertura por policy a los privilegios por columna, exige `USING` en toda policy de UPDATE y admite como única edición `vehicles.status` y `vehicles.updated_at`. `0007_opportunity_demand_facts` repite las de `0006`, con `opportunity_demand_facts` entre las altas aprobadas, y agrega que esa tabla es append-only: sin policies de UPDATE, DELETE ni ALL, sin UPDATE de `authenticated` y sin UPDATE, DELETE ni TRUNCATE de `service_role`. `0008_opportunity_stages` se detiene si hay oportunidades en una etapa que no es `new` (no las reinterpreta), repite las de `0007` con `opportunities.stage`, `loss_reason` y `updated_at` entre las ediciones aprobadas, y exige que el trigger de transiciones `opportunities_stage_transition` exista, esté habilitado y sea `BEFORE UPDATE FOR EACH ROW`. `0009_opportunity_notes_vehicle_link` repite las de `0008` con `opportunities.vehicle_id` entre las ediciones aprobadas y `opportunity_notes` entre las altas aprobadas, y agrega las de un ledger append-only para `opportunity_notes`. `0010_opportunity_closure_metadata` se detiene si hay una oportunidad `won` (sin metadatos de venta) o `lost` con un motivo que ya no existe (no las reinterpreta), repite las de `0009` con los metadatos del cierre entre las ediciones aprobadas y exige que los CHECKs de cierre existan validados, que la función del trigger mantenga inmutable el cierre y que la FK compuesta de la unidad exista. `0011_conversations_and_activity_trigger` repite las de `0010` con `messages` entre las altas aprobadas y los ledgers append-only, y exige que la función del trigger de transiciones contenga la regla del toque de actividad, que `private.touch_opportunity_activity()` sea `SECURITY DEFINER` de `postgres` con `search_path` vacío y sin EXECUTE para nadie, que sus dos triggers `AFTER INSERT FOR EACH ROW` existan habilitados y que las FKs compuestas de los mensajes existan validadas. `0012_team_settings` se detiene si una organización tiene un nombre fuera del CHECK nuevo (no lo reescribe), repite las de `0011` con `memberships` entre las altas aprobadas y `organizations.name`, `default_currency`, `updated_at` y `memberships.role`, `active`, `updated_at` entre las ediciones aprobadas, y exige los triggers de guarda `BEFORE UPDATE FOR EACH ROW` habilitados, la función de la guarda de memberships `SECURITY DEFINER` sin EXECUTE para nadie y las tres funciones de equipo `SECURITY DEFINER` de `postgres` con EXECUTE solo para `authenticated`. `0013_whatsapp_ingestion` repite las de `0012`, con las FKs compuestas de los mensajes ampliadas a la conversación, y exige que `app_runtime` siga siendo miembro solo de `authenticated`, que `private.ingest_whatsapp_message()` sea `SECURITY DEFINER` de `postgres` con `search_path` vacío, EXECUTE solo para `authenticated` y la regla que rechaza las llamadas con claims, que `whatsapp_lines` no tenga policies ni privilegios de `authenticated` y que el CHECK de origen de los mensajes, la FK de la conversación y las uniques de idempotencia y de conversación abierta existan validados. `drizzle-kit migrate` sale con código 1 sin imprimir el error de Postgres: la causa queda en el log de la base.
- `pnpm test:db` aplica las migraciones desde cero, con `pnpm db:migrate`, sobre un PostgreSQL 17 **local y desechable**, nunca sobre staging. El harness crea los roles y el mínimo de Supabase que la migración necesita (`tests/db/support/`), le fija a `app_runtime` una password aleatoria por corrida y prueba el aislamiento a través de `withUser()`/`withTenant()`: tenant A vs B, memberships inactivas, roles y grants de catálogo, y que rol y claims no dejan residuos entre transacciones. También prueba Tenant Resolution de punta a punta (`requireTenant()`, selector y revocación), los loaders de Opportunities y de Stock (`requireTenant()` → `withTenant()` → RLS), el alta de oportunidades (Server Action, deduplicación por teléfono, concurrencia, atomicidad y RLS de escritura) el alta rápida de unidades (Server Action, admin y seller, estado forzado, organización no inyectable, validaciones y RLS de escritura) y la disponibilidad de unidades (Server Action, admin y seller, membership inactiva, cross-tenant, destino fijo, solo desde `in_preparation`, columnas y DELETE prohibidos, RLS de transición, carreras concurrentes y la Stock List después) y la demanda (H1.4: append-only para todos los roles, RLS de lectura y alta, el SQL de Drizzle contra los grants, cadena humana, compare-and-set, carreras y un deadlock reales, el alta con demanda en una transacción y el detalle `/opportunities/[id]`) y Match v0 (H1.5: solo unidades `available` de la organización activa, aislamiento entre organizaciones y contexto falsificado, Top Match y alternativa reales, los tres "sin dato" y ninguna escritura) y las etapas (H1.6: Server Action con admin y seller, membership inactiva, cross-tenant, motivo de pérdida obligatorio, los 25 pares del trigger cruzados con el dominio, columnas y DELETE prohibidos, `updated_at` con el reloj de la base, `last_activity_at` intacto y carreras reales sobre la fila bloqueada) y la bitácora y la unidad vinculada (Hito 2: Server Actions con admin y seller, membership inactiva, cross-tenant, autor y reloj de la base, append-only para todos los roles, CHECK del texto, unidad disponible y match vigente, FK compuesta, el CHECK y el trigger cruzados con el dominio, el stock intacto y carreras reales sobre la fila bloqueada) y el cierre comercial (DEC-034: Server Action con admin y seller, membership inactiva, cross-tenant, los CHECKs de cierre y la inmutabilidad por el boundary y para el rol dueño y el superusuario, dinero exacto, columnas y RLS del UPDATE y carreras reales entre ganar, perder y desvincular) y los mensajes y la actividad (Hito 4: Server Action con admin y seller, membership inactiva, cross-tenant y contexto falsificado, autor y reloj de la base, contacto de la oportunidad, FKs compuestas, CHECKs, append-only para todos los roles, el toque de `last_activity_at` con notas y mensajes en todas las etapas, solo hacia adelante y con una transacción vieja que confirma después, el rechazo de todo otro UPDATE de `last_activity_at` incluso del rol dueño, y la cola que vuelve a Activa) y el Dashboard directivo (Hito 5: conteos de cuatro organizaciones sin cruces, usuario con varias organizaciones, contexto falsificado y mutantes sin el filtro explícito y sin RLS, bordes del mes de Asunción y de la recencia, atención igual a la de la cola, el tope de la lista en riesgo y ninguna escritura) y la configuración y el equipo (Hito 6: un seller no muta nada ni por las Server Actions, ni por la capa de escritura, ni con SQL crudo como `authenticated`; contextos falsificados de admin; invitar, reactivar, cambiar rol y revocar como admin; la membership propia, el último admin con una carrera real entre dos admins, la identidad inmutable, `updated_at` de la base y la lista del equipo sin exponer `profiles` ni `auth.users`) y la ingesta de WhatsApp (Hito 7: el tenant solo por la línea receptora, líneas desconocidas o inactivas sin escribir nada, contacto y conversación reutilizados o creados, el último mensaje que no retrocede, idempotencia por el id del proveedor, carreras simultáneas y deterministas con otra transacción abierta, el muro y la recencia de la oportunidad abierta única, la identidad sin claims que no ve ni escribe nada por sí misma, un miembro que no puede ingerir, los CHECKs y el webhook firmado de punta a punta) contra la base real, y que `0006` se aplica sobre una base en H1.3B, `0007` sobre una en H1.3C, `0008` sobre una en H1.4, `0009` sobre una en H1.6, `0010` sobre una en el Hito 2, `0011` sobre una en el Hito 2A, `0012` sobre una en el Hito 5 y `0013` sobre una en el Hito 6 sin tocar sus datos (con sus precondiciones, sus postcondiciones e idempotencia: volver a migrar no aplica nada y revertir la última sola vuelve al catálogo anterior). El superusuario del servidor no puede ser `postgres`, porque en Supabase `postgres` no es superuser:

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
| `auth-tenant-acceptance` | Supabase Auth real → `getClaims()` → memberships → `requireTenant()` → `withTenant()` → RLS, y el equipo del Hito 6 (lista con el email de `auth.users`, invitación por email, RBAC y la guarda de la membership propia), con usuarios y organizaciones sintéticos que se borran al terminar | todos, incluida `STAGING_SECRET_KEY` (solo Auth Admin API) |
| `cleanup-synthetic` | Borra datos sintéticos de corridas interrumpidas | los de `preflight` y `STAGING_SECRET_KEY` |

Los datos sintéticos llevan dos marcas: email `synthetic-<clave>-<corrida>@porandu-synthetic.test` con `app_metadata.porandu_synthetic`, y organizaciones `SYNTHETIC H0 <corrida> · <clave>`. La limpieza solo borra filas con esas marcas, en orden explícito (memberships → organizaciones → profiles → usuarios de Auth) y nunca el schema, las migraciones ni `app_runtime`. Si una organización sintética tiene miembros reales, no borra nada.

**Configuración en GitHub (una vez)**

- Environment `staging`: required reviewer (el fundador) y deployment branches solo `main`.
- Variable `STAGING_PROJECT_REF` (no secreta): el project ref de staging.
- Secrets: `STAGING_SUPABASE_URL`, `STAGING_SESSION_POOLER_URL` (el string del Session pooler; puede conservar `[YOUR-PASSWORD]`), `STAGING_DB_PASSWORD`, `STAGING_PUBLISHABLE_KEY`, `STAGING_SECRET_KEY` y `STAGING_RUNTIME_DB_PASSWORD` (32 a 128 caracteres de `[A-Za-z0-9._~-]`, por ejemplo `openssl rand -hex 32`).

**Runbook de una migración**

1. `preflight`: revisar el estado y las migraciones pendientes.
2. `migrate` con `expected_migrations` igual a los tags pendientes (primer rollout: `0000_saas_core_schema,0001_tenant_isolation`; H1.1: `0002_opportunities_persistence`; H1.2: `0003_contact_identity_opportunity_create`; H1.3A: `0004_vehicles_stock_persistence`; H1.3B: `0005_vehicle_quick_create`; H1.3C: `0006_vehicle_availability`; H1.4: `0007_opportunity_demand_facts`; H1.6: `0008_opportunity_stages`, o `0007_opportunity_demand_facts,0008_opportunity_stages` si `0007` todavía no se aplicó; Hito 2: `0009_opportunity_notes_vehicle_link`; Hito 2A: `0010_opportunity_closure_metadata`; Hito 4: `0011_conversations_and_activity_trigger`; Hito 6: `0012_team_settings`; Hito 7: `0013_whatsapp_ingestion`, o con las anteriores que falten, en orden). Incluye la verificación de catálogo; `verify` la repite sola cuando haga falta.
3. Primer rollout o rotación: `provision-runtime`.
4. `auth-tenant-acceptance` cuando cambie Auth, Tenant Resolution, el aislamiento o la gestión del equipo.

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
- Lectura: `organizations`, `memberships`, `contacts`, `opportunities`, `vehicles`, `opportunity_demand_facts`, `opportunity_notes` y `messages` de las organizaciones del usuario, y su propio `profiles`.
- Escritura: INSERT en `contacts` y `opportunities` (H1.2), en `vehicles` (H1.3B) y en `opportunity_demand_facts` (H1.4), con policies cuyo `WITH CHECK` exige una organización con membership activa; la de `opportunities` exige además `stage = 'new'`; la de `vehicles`, `status = 'in_preparation'`, y la de `opportunity_demand_facts`, `source_kind = 'member'`, un estado humano, `recorded_by = auth.uid()` y `recorded_at = now()`. Fuera de la transición de H1.3C (`vehicles.status`), no hay UPDATE ni DELETE en ninguna tabla.
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
- **Sin dato (no se persiste ni se inventa):** Porandú Score y sub-scores, NBA, ¿Por qué ahora?, Top Match, alternativa, trade-in, responsable, `● En vivo` y el resumen de la última actividad. La UI no los muestra hasta que exista su fuente. Desde Hito 3 (DEC-035), el Porandú Score, sus sub-scores y la NBA los deriva el motor de inteligencia (ver "Motor de inteligencia (Hito 3)"); siguen sin persistirse.
- **Reglas temporales de presentación:** la urgencia (Actuar ahora / Durante el día / En seguimiento) sale de las bandas de recencia de B1 §3.2 (`bucketFromRecency()`); la recencia se presenta en `America/Asuncion` (las organizaciones todavía no tienen zona horaria); el anillo usa la composición conceptual del Master Context §10 (40/30/30), que no es la fórmula del producto (DEC-004).
- **Una sola fuente:** `mocks/opportunities.ts` ya no tiene loader. Sus fixtures quedan como referencia del contrato visual de B1 para los tests, y ESLint impide importarlos fuera de `tests/`.
- **Guardas de ESLint:** páginas y componentes no importan Drizzle, `db/schema` ni `db/tenant` (leen con los loaders de `db/queries/`); `domains/` no depende de `db/`, `mocks/`, Drizzle, React ni Next (DEC-016).
- Con 0 oportunidades la página muestra un estado vacío; no hay seeds en runtime.

## Alta de oportunidades (H1.2)

"Nueva oportunidad" (columna izquierda de `/opportunities`) abre un drawer lateral con el formulario mínimo: nombre, teléfono y ciudad del contacto; origen y, desde H1.4, lo que busca (antes, modelo y versión buscados). Es la primera escritura de producto:

```text
Server Action createOpportunity() → requireTenant() → validación en el
servidor → withTenant() (una transacción): contacto resuelto o nuevo +
oportunidad → RLS (WITH CHECK) → revalidar /opportunities
```

- **Una sola puerta:** `createOpportunity()` (`lib/opportunities/actions.ts`). ESLint impide importar la escritura (`db/queries/create-opportunity.ts`) desde cualquier otro módulo, y la UI no conoce Drizzle, el schema ni el boundary.
- **Qué acepta el servidor:** `name`, `phone`, `city`, `source` y, desde H1.4, los campos de "Lo que busca" (ver "Demand Contract y Current Truth (H1.4)"), que reemplazan a `interestModel` e `interestVersion`. Cualquier otro campo del payload se ignora. La organización sale del `TenantContext`; la etapa es siempre `new`, fijada por el código y exigida por el `WITH CHECK` de la policy de INSERT (el CHECK de `stage` admite todas las etapas; los pases los gobierna H1.6, ver "Opportunity Stages (H1.6)"); timestamps y recencia los pone la base (`last_activity_at = now()` es una regla temporal del alta manual). Nombre, teléfono y origen son obligatorios; los textos tienen largo máximo y se normalizan (NFC, sin caracteres de control).
- **Origen:** `whatsapp`, `meta_ads`, `web`, `showroom` o `referral` (el CHECK de la base). La carga manual no es un origen comercial.
- **Teléfono:** se guarda tal como se cargó (`phone`) y en E.164 (`phone_normalized`), normalizado con `libphonenumber-js` (metadata completa) en `lib/contacts/phone.ts`, que es server-only. Sin prefijo internacional se interpreta como de Paraguay; con `+<código>` conserva su país. Un número inválido se rechaza antes de escribir. La librería no llega al bundle del navegador.
- **Identidad del contacto:** índice único parcial `(organization_id, phone_normalized)`: el mismo teléfono es un solo contacto por organización, y puede repetirse en otra. El alta inserta el contacto con `ON CONFLICT DO NOTHING` sobre ese índice y, si ya existía, lo reutiliza sin modificar su nombre ni su ciudad. Dos altas concurrentes con el mismo teléfono terminan en un contacto: la unicidad de la base es la autoridad. Un mismo contacto puede tener varias oportunidades.
- **Atomicidad:** contacto y oportunidad en una sola transacción `withTenant()`. Si la oportunidad falla, el contacto nuevo no queda. El error vuelve al formulario sin detalles de la base y con lo cargado, para reintentar.
- **Sin backfill:** los contactos existentes sin `phone_normalized` no se tocan ni participan de la deduplicación.
- **UX:** sin wizard. Mientras guarda, el botón muestra "Creando…" y el drawer no se cierra. Los errores se marcan por campo (es-PY) y el foco vuelve al primero a corregir. Al crear, el drawer se cierra, la cola se revalida, la oportunidad nueva queda seleccionada y un aviso dice si se usó un contacto existente.

## Stock con datos reales (H1.3A)

`/stock` deja de ser un placeholder de B1: la Stock List lee PostgreSQL real, de solo lectura, con la superficie aprobada Stock Surface v0.1.

```text
request → requireTenant() → TenantContext → withTenant() → query con filtro
explícito por organización → RLS → ViewModel de Stock
```

- **Loader:** `getStockList()` (`db/queries/vehicles.ts`) pide su propio contexto con `requireTenant()`, lee dentro de `withTenant()`, filtra por `ctx.organizationId` (defensa en profundidad) y ordena por ingreso, el más reciente primero (`created_at DESC`, `id` como desempate). La página no conoce Drizzle.
- **Persistido (`0004_vehicles_stock_persistence`):** `vehicles` con marca, modelo, versión, año, km, precio y moneda, y estado. Precio `numeric(14, 2)`: exacto, se lee como texto y nunca pasa por float; precio y moneda (`PYG` o `USD`) van juntos, el precio es positivo y en guaraníes no tiene decimales. Estado y moneda usan CHECK, no enum: el estado es el mínimo de P1 del TB §10 (`in_preparation`, `available`, `reserved`, `sold`).
- **Derivado:** formato de precio ("USD 49.900", "Gs. 150.000.000") y de km ("0 km", "142.000 km"), sin conversión entre monedas; conteos por estado y agrupado (`domains/vehicles/stock.ts`).
- **Superficie (Stock Surface v0.1, `components/stock/`):**
  - Encabezado con el total de unidades y, si hay alguna, un medidor segmentado y los conteos por estado, derivados de la lista. A la derecha, la acción "Nueva unidad" (H1.3B).
  - Izquierda: las unidades agrupadas por estado (disponibles → en preparación → reservadas → vendidas), como filas-unidad con el color del estado. Dentro de cada grupo se respeta el orden del loader. Las vendidas siguen visibles, separadas y atenuadas como operaciones cerradas.
  - Derecha: contexto persistente de la unidad seleccionada (identidad, estado, precio, km, año, lugar para fotos reales y recorrido). Compradores potenciales y próxima acción se muestran como "Sin dato" hasta que existan sus motores. Selección por click o ↑/↓.
  - Con 0 unidades: "Stock · 0 unidades", sin medidor ni conteos, estado vacío a la izquierda (invita a cargar la primera con «Nueva unidad») y rail neutral.
- **Sin dato (no se persiste ni se inventa):** versión, km o precio ausentes se muestran "Sin dato". No hay fotos (ni reales ni representación: el rail muestra que la unidad todavía no tiene fotos), matches, interesados, demanda, sucursal ni trade-in.
- **Solo lectura en H1.3A:** sin alta, edición ni transiciones de estado. H1.3B agrega solo el alta rápida y H1.3C solo la transición `in_preparation → available` (ver abajo); la edición de datos y el resto de las transiciones siguen fuera.
- **Una sola fuente:** no hay fixtures de stock. ESLint impide que la página, sus componentes y su loader importen `mocks/`.
- Con 0 vehículos la página muestra un estado vacío; no hay seeds en runtime.
- `0004` no se aplica a staging en esta rama: va después del merge con `preflight → migrate → verify`.

## Alta rápida de unidades (H1.3B)

"Nueva unidad" (encabezado de `/stock`) abre un drawer lateral con el formulario corto: marca, modelo y año, obligatorios; versión, kilometraje y precio con su moneda, opcionales. Es la primera escritura de inventario:

```text
Server Action createVehicle() → requireTenant() → validación en el
servidor → withTenant(): INSERT → RLS (WITH CHECK) → revalidar /stock
```

- **Una sola puerta:** `createVehicle()` (`lib/vehicles/actions.ts`). ESLint impide importar la escritura (`db/queries/create-vehicle.ts`) desde cualquier otro módulo, y la UI no conoce Drizzle, el schema ni el boundary. Ni la escritura ni la acción tienen fixtures.
- **Qué acepta el servidor:** `brand`, `model`, `version`, `year`, `km`, `price` y `currency`. Cualquier otro campo del payload (organización, estado, id, timestamps) se ignora. La organización sale del `TenantContext`; el estado es siempre `in_preparation`, fijado por el código y exigido por el `WITH CHECK` de la policy de INSERT (el CHECK de `status` sigue admitiendo los cuatro estados: los cambios de estado serán policies de UPDATE); el id y los timestamps los pone la base.
- **Validación (`lib/vehicles/new-vehicle.ts`, en el servidor):** marca y modelo obligatorios y no vacíos (texto de una línea normalizado: NFC, sin caracteres de control); marca, modelo y versión con un largo máximo (40, 80 y 80), que es un límite defensivo de implementación y no una regla de producto: la base no limita esos textos; año entero de cuatro dígitos dentro del rango del CHECK (1900–2100); km entero ≥ 0 (0 es una unidad 0 km, vacío es sin dato) hasta el máximo de `integer`; precio y moneda juntos o ninguno; precio > 0, exacto (texto decimal, nunca float) y dentro de `numeric(14, 2)`; en guaraníes, sin decimales; moneda `PYG` o `USD`. Los CHECK de la base exigen lo mismo.
- **Números en es-PY:** km y precio se escriben como los muestra Stock: punto para los miles y coma para los decimales ("142.000", "150.000.000", "32.990,50"), o sin separadores. Un punto que no separa miles ("49900.50", "1.5") es ambiguo y se rechaza: nunca se lee como decimal.
- **Autorización:** dar de alta exige `membership activa AND role IN ('admin', 'seller')`. Hoy `membership_role` contiene exactamente esos dos valores, así que `requireTenant()` (solo emite contextos de memberships activas `admin | seller`) y la policy de INSERT (organización con membership activa) la cumplen sin un chequeo de rol adicional. Un test falla si se agrega un rol al enum: un rol nuevo no puede crear unidades sin revisar explícitamente esta regla, `createVehicle()` y `vehicles_insert_member`.
- **Escritura (`0005_vehicle_quick_create`):** policy `vehicles_insert_member` (`WITH CHECK`: organización con membership activa y `status = 'in_preparation'`) y `GRANT INSERT ON vehicles` a `authenticated`. Sin UPDATE ni DELETE en ninguna tabla; `app_runtime` no recibe nada.
- **UX:** sin wizard. El estado inicial se muestra ("En preparación") pero no se elige. Mientras guarda, el botón muestra "Creando…" y el drawer no se cierra. Los errores se marcan por campo (es-PY) y el foco vuelve al primero a corregir; una falla al guardar no expone detalles y conserva lo cargado. Al crear, el drawer se cierra, la lista se revalida, la unidad nueva queda seleccionada (primera de "En preparación") y un aviso confirma el alta.
- **Fuera de H1.3B:** fotos, edición, cambio de estado, borrado, matches, compradores potenciales, financiación, VIN/chapa, sucursal, transmisión, combustible, color y trade-in. La entrega (`min_down_payment`, DEC-025) tampoco entra: su semántica en P1 no está definida de forma inequívoca en los documentos oficiales.
- `0005` no se aplica a staging en esta rama: va después del merge con `preflight → migrate → verify` (`expected_migrations = 0005_vehicle_quick_create`).

## Disponibilidad de unidades (H1.3C)

En el rail de Stock, una unidad **En preparación** muestra "Marcar disponible". Una confirmación breve ("Marcar unidad como disponible · La unidad quedará lista para vender.") nombra la unidad y el cambio; al confirmar, la unidad pasa a **Disponibles**. Es la única transición de estado aprobada:

```text
Server Action markVehicleAvailable() → requireTenant() → validación del id →
withTenant(): UPDATE … WHERE id AND organization_id AND status = 'in_preparation'
→ RLS (USING: en preparación · WITH CHECK: disponible) → revalidar /stock
```

- **Una sola puerta:** `markVehicleAvailable()` (`lib/vehicles/actions.ts`). ESLint impide importar la escritura (`db/queries/mark-vehicle-available.ts`) desde cualquier otro módulo. La regla de UI (`canMarkAvailable()`, `domains/vehicles/availability.ts`) solo decide si se muestra la acción.
- **Qué acepta el servidor:** solo `vehicleId` (un UUID). Organización, estado de destino y datos de la unidad del pedido se ignoran: el destino es siempre `available`, el origen exigido es `in_preparation` y la organización sale del `TenantContext`.
- **Falla de forma segura:** una unidad inexistente o de otra organización es `not_found` (sin revelar nada del otro tenant); una que ya no está en preparación es `unchanged`, con su estado real. En ninguno de los dos casos cambia nada; `/stock` se revalida igual para mostrar el estado real.
- **Concurrencia:** el UPDATE depende del estado actual. Si dos personas marcan la misma unidad casi a la vez, la segunda espera el lock de la fila, re-evalúa el `WHERE` sobre la versión ya confirmada y no actualiza nada: una sola transición, sin error ni sobrescritura. Si otra persona la reservó en el medio, tampoco se pisa.
- **Autorización:** la misma del alta: `membership activa AND role IN ('admin', 'seller')`, que hoy cumple todo contexto que emite `requireTenant()`. Un test falla si se agrega un rol.
- **Escritura (`0006_vehicle_availability`):** policy `vehicles_update_mark_available` (`USING`: organización con membership activa y `status = 'in_preparation'`; `WITH CHECK`: la misma organización y `status = 'available'`) y `GRANT UPDATE (status, updated_at) ON vehicles` a `authenticated`, por columna: marca, modelo, versión, año, km, precio, moneda, organización, id y `created_at` siguen sin UPDATE (42501). `updated_at` (lo pone Drizzle) solo se puede escribir dentro de la transición, porque la policy exige el cambio de estado. Sin DELETE; `app_runtime` y `anon` no reciben nada.
- **Una sola policy de UPDATE:** PostgreSQL combina las policies permisivas de un mismo comando con OR, por separado para `USING` y `WITH CHECK`. Con una sola, el par `in_preparation → available` es exacto; una segunda transición necesita otro mecanismo (no otra policy permisiva). Un test de catálogo lo vigila.
- **Match Engine:** no existe todavía y la UI no lo menciona. El resultado `became_available` de la escritura es la única señal de que este pedido hizo la transición (una vez por unidad): es el punto donde Hito 3 engancha "vehicle became available → matching", sin reescribir la transición.
- **UX:** la confirmación abre con el foco en "Cancelar", no se cierra con un click afuera y, mientras marca ("Marcando…"), tampoco con Escape. Al terminar se cierra, la unidad aparece en Disponibles y sigue seleccionada, los conteos y el medidor se recalculan, la fila se desplaza a la vista y el foco vuelve a la lista. Un aviso confirma el resultado ("Unidad disponible: …, lista para vender."), o explica que no se hizo ningún cambio si ya estaba disponible o en otro estado. Una falla inesperada deja la confirmación abierta para reintentar, sin detalles de la base. La confirmación usa `@radix-ui/react-alert-dialog` (patrón WAI-ARIA alertdialog).
- **Fuera de H1.3C:** reservar, liberar una reserva, vender, volver a preparación, editar datos de la unidad, borrar, matches, compradores potenciales y jobs.
- `0006_vehicle_availability` se aplicó a staging después del merge (PR #22): Runtime Acceptance 12/12 y Auth → Tenant Acceptance 11/11, sin migraciones pendientes.

## Demand Contract y Current Truth (H1.4)

Lo que busca cada cliente, estructurado y con historial (DEC-029, DEC-030). Cada oportunidad tiene un contrato cerrado de 6 facts, todos opcionales: lo que no se sabe es "Sin dato" (DEC-005).

| Fact | Valor | Copy |
|---|---|---|
| `desired_vehicle` | `{ brand?, model? }`: un solo vehículo, sin versión | "Toyota Hilux", "Toyota · modelo sin definir" |
| `year_range` | `{ min?, max? }`, de 1900 a 2100 | "Desde 2022", "Hasta 2020", "2018 a 2021" |
| `budget_max` | precio total máximo, `> 0` | "Hasta Gs. 250.000.000" |
| `purchase_type` | `cash`, `financed` o `undecided` | Contado, Financiado, A definir |
| `trade_in_intent` | `true` o `false` | Sí, No |
| `down_payment` | efectivo inicial, sin el usado, `≥ 0` | "Gs. 50.000.000", "Sin entrega inicial" |

Dinero: `PYG` o `USD`, guaraníes sin decimales, `numeric(14,2)`, sin conversión.

```text
Alta o drawer "Lo que busca" → Server Action (createOpportunity / recordDemand)
→ requireTenant() → validación en el dominio → withTenant(): ledger actual →
planDemandCapture() → INSERT de las filas nuevas → RLS (WITH CHECK)
→ revalidar /opportunities y /opportunities/[id]
```

- **Ledger append-only:** `opportunity_demand_facts` guarda una fila inmutable por afirmación. Current Truth no se persiste: lo deriva por fact, en cada lectura, el resolver puro `resolveDemand()` (`domains/demand/`). Se persisten `confirmed`, `corrected` y `rejected` (`detected` queda reservado para H2a); `unknown` es derivado, con su motivo.
- **Actos humanos:** un cambio del cliente es un nuevo `confirmed`, con el valor anterior como `target` ("Antes: …"); un error de carga es `corrected` (checkbox "Fue un error de carga"); vaciar un campo es Quitar (`rejected`, error de carga).
- **Prioridad humana y concurrencia:** cadena lineal por (oportunidad, fact) con `previous_member_fact_id` y dos índices únicos parciales, y compare-and-set con el último acto que vio el usuario. Si otro miembro cambió el dato mientras se editaba, no se escribe nada (`stale`) y el drawer muestra el valor actual. Un 23505 sobre la cadena o un deadlock (40P01) se re-planifican una vez y terminan en `unchanged` o `stale`. La tabla no admite `ON CONFLICT`.
- **Una sola escritura:** `db/queries/demand-facts.ts`, que usan el alta (en su misma transacción: si la demanda falla, no quedan ni el contacto ni la oportunidad) y la Server Action `recordDemand()` (`lib/opportunities/actions.ts`). ESLint impide importarla desde otro lado. El cliente nunca envía estado, fuente, autor, fecha, organización ni id. Autorización: membership activa con rol `admin` o `seller`; cualquier miembro edita la demanda que cargó otro.
- **Base (`0007_opportunity_demand_facts`):**
  - FKs RESTRICT: (organización, oportunidad), `target` y `previous` dentro de la misma oportunidad y fact, y `recorded_by` → `profiles` (C-9).
  - CHECKs con nombre para la forma de cada fact, el estado, la fuente, la cadena y los textos (marca ≤ 40, modelo ≤ 80, nota ≤ 500).
  - RLS: SELECT con membership activa; INSERT con membership activa, `source_kind = 'member'`, estado humano, `recorded_by = auth.uid()` y `recorded_at = now()`. Sin policies de UPDATE, DELETE ni ALL.
  - Grants: `authenticated` recibe SELECT e INSERT de tabla (diseño A: Drizzle lista todas las columnas en el INSERT; lo fijan las pruebas P0, P1 y P2), `service_role` pierde UPDATE, DELETE y TRUNCATE, y `anon` y `app_runtime` no reciben nada.
  - `opportunities` recibe `UNIQUE (organization_id, id)`, destino de la FK compuesta.
- **UI:**
  - Alta: "Lo que busca" reemplaza a "Modelo buscado" y "Versión": marca y modelo, y pago, entrega inicial, usado, presupuesto y años detrás de "Agregar pago, presupuesto y más (opcional)".
  - `/opportunities`: el vehículo de la cola y la card "Busca" salen de Current Truth. "Editar" abre el drawer "Lo que busca", precargado con lo vigente, que envía solo lo modificado, con una "Nota de la edición" opcional. A la cola solo llega un resumen por oportunidad: sin notas, historial ni ids de usuario.
  - `/opportunities/[id]` ("Ver historial"): cada fact con su valor, estado, explicación (autor "Vos" u "Otro miembro", fecha en hora de Asunción, "Antes: …", nota) e historial. Un id inválido, de otra organización o inexistente da 404.
- **Legado:** `interest_model` e `interest_version` quedan congelados, de solo lectura y sin backfill. Se muestran como "Dato anterior" solo mientras nunca se cargó un vehículo.
- Cargar la demanda no modifica `last_activity_at`. Los logs registran solo `{ name, code, constraint_name }`: nunca valores ni notas.
- **Limitaciones conocidas:** las notas son inmutables y H1.4 no tiene redacción (C-14): no deben incluir datos personales. Un autor con historial no se puede borrar de Auth (C-9): la baja es `active = false`.
- **Fuera de H1.4:** WhatsApp, Meta/BSP, extracción por IA, OCR, jobs, webhooks, Match, `stock_matches`, `trade_ins`, hechos del vehículo, import CSV y conversaciones completas.
- **Secuencia (DEC-029):** H1.4 → H1.5 Match v0 (consume un `DemandSnapshot` por oportunidad) → H1.6 — Opportunity Stages → H2a → ADR-002 → H2b.
- `0007` no se aplica a staging en esta rama: va después del merge con `preflight → migrate → verify` (`expected_migrations = 0007_opportunity_demand_facts`). H1.4 se cierra con `9da9cc1` (cierre documental de H1.3C) ya en `main` (C-13).

## Match v0 (H1.5)

Qué unidad del stock ofrecerle a cada cliente, determinista y explicable (DEC-029 §7, DEC-031). Sin tablas, migraciones, jobs ni IA: los matches se calculan en memoria en cada lectura de `/opportunities/[id]`.

```text
/opportunities/[id] → requireTenant() → withTenant(): oportunidad, ledger y unidades
`available` de la organización activa → RLS → resolveDemand() → demandSnapshot()
→ findMatchesForDemand() → Top Match y alternativa
```

| Criterio | Puntos |
|---|---|
| Marca y modelo coinciden | 45 |
| Solo modelo: la demanda no tiene marca y el modelo coincide | 35 |
| Solo marca: la demanda no tiene modelo y la marca coincide | 35 |
| Misma marca, otro modelo | 0, con la razón "Misma marca, modelo alternativo" |
| Año dentro del rango (extremos incluidos; el ausente queda abierto) | 25 |
| Precio menor o igual al presupuesto | 30 |
| Precio sobre el presupuesto en menos del 10 % | 10 |

- **Motor puro** en `domains/match/` (`evaluateMatch()`, `findMatchesForDemand()`): consume el `DemandSnapshot` de `domains/demand/` y no conoce la base, React ni Next. Match desde 40 de 100.
- **Elegibilidad:** solo unidades `available`; una marca distinta descalifica. Marca y modelo se comparan sin espacios en los bordes ni mayúsculas.
- **Sin dato no penaliza (DEC-005):** un fact Unknown suma 0 y no descalifica. Presupuesto y precio en monedas distintas no se convierten: no suman, no descalifican y no dan razón de precio. Los montos se comparan exactos, en centavos.
- **Explicable:** cada match trae su puntaje por dimensión y sus razones en es-PY.
- **Rail "Matches en stock"** en `/opportunities/[id]`: el Top Match y la alternativa (los dos mejores puntajes) con precio, km, puntaje y razones. Si la demanda no tiene vehículo, años ni presupuesto, si la organización no tiene unidades disponibles o si ninguna llega a 40, dice cuál de los tres casos es, sin fixtures. Sin silueta: el inventario no registra la carrocería.
- **Aislamiento:** `selectMatchCandidates()` (`db/queries/vehicles.ts`) corre en la transacción del detalle con filtro explícito por organización y `status = 'available'` sobre RLS. El motor falla cerrado si recibe unidades de más de una organización.
- **Solo lectura:** calcular matches no modifica `last_activity_at`, el ledger ni el stock.
- **Fuera de H1.5:** persistir matches (`stock_matches`), matches en la cola de `/opportunities` y en Stock, recalcular ante `became_available` (DEC-028 §7) y notificaciones.

## Opportunity Stages (H1.6)

Las etapas del ciclo comercial de una oportunidad y sus pases (DEC-032). No es el Lifecycle de posventa.

```text
new ──► qualifying ──► negotiating ──► won  (con la venta, DEC-034)
 │          │               │
 └──────────┴───────────────┴────────► lost (con motivo y notas, DEC-034)
```

| Etapa | Copy | Terminal |
|---|---|---|
| `new` | Nueva: consulta sin calificar | No |
| `qualifying` | En calificación: relevando qué busca | No |
| `negotiating` | En negociación: propuesta activa | No |
| `won` | Ganada: venta concretada | Sí |
| `lost` | Perdida, con motivo obligatorio | Sí |

Desde DEC-034, los pases a `won` y `lost` (cerrar) van por `closeOpportunity()` con sus metadatos: ver "Cierre comercial (DEC-034)". `changeOpportunityStage()` queda para los avances y a un cierre responde `closure_required`.

```text
changeOpportunityStage() → requireTenant() → leer el pedido → withTenant():
SELECT … FOR UPDATE → planStageChange() → UPDATE … AND stage = <la leída>
→ RLS (opportunities_update_stage) + trigger de transiciones → revalidar
```

- **Dominio puro** en `domains/opportunities/stages.ts`: etapas, matriz de pases (`canTransition()`, `nextStages()`) y `planStageChange()`. Sin saltos, sin vuelta atrás, sin salida de una etapa terminal. Pedir la etapa actual es `unchanged`, sin escribir.
- **Motivo de pérdida:** obligatorio al pasar a `lost`, de una lista cerrada que desde DEC-034 es `price`, `vehicle_unavailable`, `competitor`, `financing_rejected`, `ghosted` y `other` (`domains/opportunities/closure.ts`). Existe si y solo si la etapa es `lost` (CHECK) y no se reescribe.
- **Puerta de los avances:** la Server Action `changeOpportunityStage()` (`lib/opportunities/actions.ts`). El pedido trae solo `opportunityId` y `stage`; la etapa de origen la lee el servidor de la fila bloqueada. ESLint impide importar `db/queries/change-opportunity-stage.ts` desde otro módulo.
- **Respuestas:**
  - `changed`.
  - `unchanged`: ya estaba en esa etapa.
  - `invalid_transition`: el pase no existe; devuelve la etapa real.
  - `closure_required`: el pase cierra la oportunidad y va por `closeOpportunity()` (DEC-034).
  - `invalid`: la etapa no existe.
  - `not_found`: inexistente o de otra organización, sin distinguir.
  - `failed`: sin detalles de la base.
- **Base (`0008_opportunity_stages`):**
  - El CHECK de etapas, `loss_reason` con su CHECK de valores y el de coherencia con `lost`.
  - Una sola policy de UPDATE tenant-scoped.
  - El trigger `BEFORE UPDATE` `opportunities_stage_transition`, que llama a `private.enforce_opportunity_stage_transition()`: valida el par anterior → nuevo con la matriz del dominio y fija `updated_at = now()`. Rechaza con `23514`.
  - `authenticated` recibe UPDATE solo sobre `stage`, `loss_reason` y `updated_at`. Toda UPDATE de `opportunities` tiene que ser un pase válido, también la del rol dueño.
- **Concurrencia:** el `FOR UPDATE` serializa los pedidos sobre una misma oportunidad. El segundo ve la etapa ya confirmada: nunca dos pases iguales, nunca ganada y perdida a la vez.
- **Recencia:** cambiar de etapa no toca `last_activity_at` (es la interacción con el cliente) ni el orden de la cola.
- **UI:**
  - Panel "Etapa" en `/opportunities/[id]`: un stepper con la etapa actual y solo los pases permitidos. Avanzar es un click; ganar y perder abren la confirmación con los datos del cierre (DEC-034).
  - Una oportunidad cerrada no ofrece acciones; su cierre lo muestra la tarjeta "Cierre".
  - El encabezado y la card de la cola muestran la etapa con su color.
- **Fuera de H1.6:** la venta como entidad (`won` no crea una venta ni marca una unidad `sold`), el historial de etapas, reabrir o retroceder una oportunidad, filtrar u ocultar las cerradas en la cola y las métricas de conversión (el win rate del mes llega con el Hito 5, ver "Dashboard directivo (Hito 5)").
- `0008` no se aplica a staging en esta rama: va después del merge con `preflight → migrate → verify`, con `expected_migrations = 0008_opportunity_stages` (o `0007_opportunity_demand_facts,0008_opportunity_stages` si `0007` todavía no se aplicó).

## Bitácora y unidad vinculada (Hito 2)

Qué pasó en la negociación y qué unidad del stock se está negociando (DEC-033), en `/opportunities/[id]`. No es el Lifecycle de posventa ni la venta como entidad.

```text
addOpportunityNote() → requireTenant() → normalizar y validar → withTenant():
la oportunidad en la organización activa → INSERT append-only → RLS (WITH CHECK)
→ revalidar /opportunities/[id]

linkOpportunityVehicle() → requireTenant() → leer el pedido → withTenant():
SELECT … FOR UPDATE → unidad y demanda vigente → planVehicleLink() → UPDATE
→ RLS + FK compuesta + CHECK de etapa + trigger → revalidar /opportunities/[id]
```

- **Dominio puro** en `domains/opportunities/`:
  - `notes.ts`: normalización (NFC, `\r\n` → `\n`, espacios repetidos, a lo sumo una línea en blanco seguida), validación (1 a 1000 caracteres, contados como `char_length`). Desde el Hito 4, las notas se muestran en el muro de actividad (`activityTimeline()` de `domains/conversations/timeline.ts`).
  - `vehicle-link.ts`: en qué etapas se cambia la unidad (`negotiating`; desde DEC-034 ya no en `won`) y en cuáles puede existir (más `won` y `lost`), y `planVehicleLink()`: `link`, `unlink`, `unchanged`, `stage_not_allowed`, `vehicle_not_found`, `vehicle_not_available` y `not_a_match`.
- **Bitácora (`opportunity_notes`):** una fila inmutable por nota, en cualquier etapa. Autor y fecha los fija la base (`recorded_by = auth.uid()`, `recorded_at = now()`). Nunca se edita ni se borra. Desde el Hito 4 (DEC-036) una nota nueva mueve `last_activity_at` (trigger de la base) y la cola se revalida.
- **Unidad vinculada (`opportunities.vehicle_id`):**
  - Se elige, cambia o quita solo En negociación. Ganada la exige y la deja fija (es la vendida, DEC-034 §4); Perdida conserva la que había. Las dos la muestran de solo lectura. Nueva y En calificación no tienen unidad.
  - Tiene que ser de la organización activa, estar disponible y ser un match de la demanda vigente (Match v0, al menos 40 puntos). El servidor lo recalcula.
  - Vincular no reserva ni vende la unidad: el stock no cambia, y Ganada sigue sin crear la venta.
  - Dos pedidos a la vez se serializan con el bloqueo de la fila: gana el último.
- **Puertas únicas:** las Server Actions `addOpportunityNote()` y `linkOpportunityVehicle()` (`lib/opportunities/actions.ts`). ESLint impide importar `db/queries/record-opportunity-note.ts` y `db/queries/link-opportunity-vehicle.ts` desde otro módulo. El pedido trae solo la oportunidad y el texto, o la oportunidad y la unidad (vacía para quitarla).
- **Respuestas:**
  - Notas: `recorded`, `invalid` (vacía o demasiado larga, con lo tipeado), `not_found` y `failed`.
  - Unidad: `linked`, `unlinked`, `unchanged`, `stage_not_allowed` (con la etapa real), `vehicle_not_found` (inexistente o de otra organización, sin distinguir), `vehicle_not_available`, `not_a_match`, `invalid`, `not_found` y `failed`.
- **Base (`0009_opportunity_notes_vehicle_link`):**
  - `vehicles` recibe `UNIQUE (organization_id, id)` y `opportunities` recibe `vehicle_id`, su FK compuesta RESTRICT, el CHECK `opportunities_vehicle_stage_check` y un índice parcial.
  - La función del trigger `opportunities_stage_transition` acepta un pase de etapa válido que no toca la unidad, o un cambio de unidad En negociación o Ganada sin pase (desde `0010`, solo En negociación). Todo lo demás se rechaza con `23514` (`opportunities_stage_transition` u `opportunities_vehicle_link`), también para el rol dueño. Sigue habiendo una sola policy de UPDATE.
  - `authenticated` recibe UPDATE sobre `opportunities.vehicle_id` y SELECT e INSERT de tabla sobre `opportunity_notes` (diseño A). `service_role` pierde UPDATE, DELETE y TRUNCATE sobre las notas. `anon` y `app_runtime` no reciben nada.
- **UI:**
  - Panel "Notas": formulario con contador y la bitácora, de la nota más reciente a la más vieja. Desde el Hito 4 es el panel "Actividad", con los mensajes en el mismo muro.
  - Las tarjetas de match ofrecen "Vincular a la negociación" En negociación; la vinculada se marca. La tarjeta "Unidad en negociación" muestra la unidad y permite quitarla; "Unidad de la venta" y "Unidad que se negociaba" son de solo lectura. Antes de negociar, el rail avisa desde cuándo se puede vincular.
  - Vincular es un click, sin confirmación: es reversible y no tiene efecto económico.
- **Limitaciones conocidas:** las notas son inmutables y no tienen redacción, como la demanda (C-14): no deben incluir datos personales. Un autor con notas no se puede borrar de Auth: la baja es `active = false`. El vínculo no guarda quién ni cuándo lo cambió.
- **Fuera de este bloque:** editar o borrar notas, adjuntos, menciones, tareas, el historial del vínculo, reservar o vender la unidad, la venta como entidad, mostrar notas o unidad en la cola y en Stock, y el Lifecycle de posventa.
- `0009` no se aplica a staging en esta rama: va después del merge con `preflight → migrate → verify`, con `expected_migrations = 0009_opportunity_notes_vehicle_link` (o con `0008_opportunity_stages` delante si `0008` todavía no se aplicó).

## Cierre comercial (DEC-034)

Cómo se cerró una oportunidad: la venta o la pérdida, con sus datos, en `/opportunities/[id]`. Es el cierre del ciclo comercial, no la venta como entidad ni el Lifecycle de posventa.

```text
closeOpportunity() → requireTenant() → leer y validar el pedido (Zod) →
withTenant(): SELECT … FOR UPDATE (etapa y unidad) → planOpportunityClosure()
→ UPDATE … AND stage = <la leída> AND vehicle_id = <la leída>
→ RLS (opportunities_update_stage) + CHECKs de cierre + trigger → revalidar
```

| Resultado | Datos | Obligatorios |
|---|---|---|
| `won` (Ganada) | unidad vinculada (la vendida), `sale_price` + `sale_currency`, `payment_method`, `delivery_status` + `delivery_date` | Todos |
| `lost` (Perdida) | `loss_reason`, `loss_notes` | El motivo |

- **Dominio puro** en `domains/opportunities/closure.ts`: las listas (motivos `price`, `vehicle_unavailable`, `competitor`, `financing_rejected`, `ghosted`, `other`; formas de pago `cash`, `financing`, `trade_in`, `mixed`; entrega `scheduled` o `delivered`), `parseClosure()` con Zod, `planOpportunityClosure()` y el resumen de la tarjeta.
  - Precio en formato es-PY ("47.500", "32.990,50") con `parseAmount()` de `domains/money.ts`: decimal exacto, mayor que cero, `PYG` sin decimales, sin FX. No tiene que coincidir con el precio publicado.
  - Entrega: con `delivered`, la fecha es hoy o antes; con `scheduled`, hoy o después ("hoy" en Asunción). La base la acota entre 2000-01-01 y 2100-12-31.
  - Notas: de 1 a 500 caracteres, normalizadas como las de la bitácora. Vacías son `NULL`.
- **Puerta única:** la Server Action `closeOpportunity()` (`lib/opportunities/actions.ts`). El pedido trae `opportunityId`, `outcome` y los campos de ese resultado; los del otro resultado se ignoran. Etapa de origen, unidad, organización, usuario y reloj los fija el servidor. ESLint impide importar `db/queries/close-opportunity.ts` desde otro módulo.
- **Respuestas:**
  - `closed`.
  - `unchanged`: ya estaba cerrada así; los metadatos no se reescriben.
  - `invalid_transition`: el cierre no existe desde la etapa real (p. ej. ya estaba cerrada con el otro resultado, o ganar sin negociar); devuelve la etapa real.
  - `vehicle_required`: ganar sin unidad vinculada.
  - `invalid`: errores por campo, con lo cargado (acotado).
  - `invalid_outcome`, `not_found` (inexistente o de otra organización, sin distinguir) y `failed` (sin detalles de la base ni valores en los logs).
- **Inmutable:** cerrada, ni la etapa ni sus metadatos cambian, para ningún rol (no existe un rol `owner` y nada habilita editarlos). La unidad vendida queda fija.
- **Base (`0010_opportunity_closure_metadata`):**
  - Columnas `loss_notes`, `sale_price` (`numeric(14,2)`), `sale_currency`, `payment_method`, `delivery_status` y `delivery_date` (`date`) en `opportunities`, nulas en toda fila existente. Sin tabla nueva: RLS, la única policy de UPDATE y la FK compuesta de la unidad ya cubren el cierre.
  - CHECKs con nombre: `opportunities_won_closure_check` (la venta completa, con unidad, si y solo si `won`), `opportunities_loss_reason_stage_check`, `opportunities_loss_notes_stage_check` y los de valores de cada columna.
  - La función del trigger `opportunities_stage_transition` solo deja escribir los metadatos en el pase que cierra; después rechaza con `23514` y constraint `opportunities_closure_immutable`. La unidad solo cambia En negociación (`opportunities_vehicle_link`). Vale también para el rol dueño y el superusuario.
  - `authenticated` suma UPDATE por columna sobre los seis metadatos. DELETE sigue prohibido; `anon` y `app_runtime` no reciben nada.
  - Precondición: si hay una oportunidad `won` o una `lost` con un motivo que ya no existe, se detiene (corregirla es un mantenimiento explícito, con el trigger deshabilitado en una transacción).
- **Concurrencia:** el `FOR UPDATE` serializa los pedidos: nunca ganada y perdida, nunca dos cierres, nunca una venta sin unidad si alguien la desvincula a la vez.
- **Recencia y stock:** cerrar actualiza `updated_at` (lo fija el trigger) y no `last_activity_at`. La unidad vendida sigue `available`: vender la unidad no forma parte de este bloque.
- **UI:**
  - "Marcar como ganada" y "Marcar como perdida" abren una confirmación (alertdialog de Radix) con su formulario: Ganada muestra la unidad vendida y pide precio y moneda, forma de pago, entrega y fecha (acotada según el estado); Perdida pide el motivo y notas opcionales con contador. Sin unidad vinculada, avisa que hay que vincularla y no ofrece confirmar.
  - Valida en el navegador con la misma validación del dominio y marca cada campo con su error; el servidor la repite.
  - La tarjeta "Cierre" muestra el resultado y sus datos, de solo lectura.
- **Fuera de este bloque:** la venta como entidad, marcar la unidad `sold` o reservarla, editar o corregir un cierre, registrar la entrega efectiva de una venta programada, reabrir, quién cerró, mostrar el cierre en la cola o en Stock, métricas, comisiones y documentos de la venta.
- `0010` no se aplica a staging en esta rama: va después del merge con `preflight → migrate → verify`, con `expected_migrations = 0010_opportunity_closure_metadata` (o con las anteriores que falten delante, en orden). Si staging tuviera oportunidades cerradas que no cumplen la precondición, la migración se detiene y hay que decidir cómo corregirlas.

## Motor de inteligencia (Hito 3)

Recencia, Porandú Score y Next Best Action de cada oportunidad (DEC-035). Estado derivado: se calcula en cada lectura de la cola de `/opportunities` y nunca se persiste. Sin tablas, migraciones, jobs ni IA.

```text
getOpportunityQueue(now) → requireTenant() → withTenant(): cola (con
vehicle_id), ledger de demanda, unidades disponibles (una vez) y última nota
de cada oportunidad, con filtro por organización → RLS →
evaluateOpportunity(): recencia → Porandú Score + explicación → NBA
```

- **Motor puro** en `domains/scoring/engine.ts`: `evaluateRecency()`, `stockFit()` (Match v0 contra el stock: Top Match, `no_match`, `no_demand` o `no_stock`), `scoreOpportunity()`, `nextBestAction()` y `evaluateOpportunity()`. Recibe `now` explícito: determinista y testeable con cualquier combinación de fechas y etapas.
- **Recencia** desde `last_activity_at`: Activa (menos de 2 días), Enfriándose (de 2 a 5) e Inactiva (más de 5). No reemplaza los emojis de B1 (minutos) ni la urgencia de la cola.
- **Porandú Score v0** (el Health Score del pedido, 0–100):

| Sub-score | Peso | v0 |
|---|---|---|
| Intent | 40 % | Sin dato: llega con las conversaciones |
| Vehicle Fit | 30 % | Unidad vinculada 100 · si no, Top Match v0 (40–100) · ninguna coincide 0 · sin demanda o sin stock, sin dato |
| Deal Readiness | 30 % | Nueva 20 · En calificación 45 · En negociación 75 · Ganada 100 · Perdida 0 |

  - Base: promedio ponderado de los sub-scores conocidos (el dato faltante no penaliza, DEC-005); la cobertura es la suma de sus pesos.
  - Inactividad: Enfriándose −15, Inactiva −40. Resultado redondeado y acotado entre 0 y 100.
  - Cerradas: Ganada 100, Perdida 0, sin penalización.
  - Cada score lleva su explicación: el motivo de cada sub-score, las penalizaciones y el resultado.
- **Next Best Action** (primera regla que se cumple; las dos siguientes son las secundarias):
  1. Inactiva → "Retomar contacto urgente" (la única urgente, en rojo).
  2. En negociación sin unidad vinculada → "Vincular unidad de stock".
  3. Sin notas o con la última de hace 2 días o más → "Registrar actualización de contacto".
  4. Enfriándose → "Hacer seguimiento".
  5. Si no, "Sostener el seguimiento". Una cerrada no tiene NBA. Ninguna cambia condiciones económicas.
- **UI** (columna "Decisión" de `/opportunities`): el strip con el Porandú Score real, la cobertura y la penalización; el desglose en el tooltip del anillo (también en la cola); "¿Qué hacer?" con la NBA real y la recencia en verde, ámbar o rojo. `/opportunities/[id]` no los repite (DEC-017).
- **Solo lectura:** calcular no toca `last_activity_at`, `updated_at`, notas ni stock. La cola usa de Match v0 solo el puntaje del Top Match, sin mostrar tarjetas.
- **Limitación (corregida en el Hito 4):** hasta DEC-036 nada actualizaba `last_activity_at` después del alta, y toda oportunidad abierta pasaba a Inactiva a los 5 días aunque el vendedor anotara. Desde `0011` una nota o un mensaje nuevos la mueven (ver "Conversaciones y actividad (Hito 4)"). La demanda, la etapa y la unidad siguen sin moverla.
- **Fuera de este bloque:** persistir scores, recalcular por eventos, Intent desde conversaciones, los drivers de "¿Por qué ahora?", reemplazar la urgencia de la cola, ejecutar la NBA desde la tarjeta, notificaciones y el módulo Intelligence (desde el Hito 5, `/intelligence` muestra el Dashboard directivo).

## Conversaciones y actividad (Hito 4)

Los mensajes que se cruzan con el cliente y la recencia que mueven (DEC-036), en `/opportunities/[id]`. Un miembro registra lo que ya pasó por WhatsApp, email u otro medio: no hay integración con proveedores, y registrar no envía ni recibe nada.

```text
addMessage() → requireTenant() → leer y validar el pedido (Zod) → withTenant():
la oportunidad en la organización activa (y su contacto) → INSERT append-only
→ RLS (WITH CHECK) + FKs compuestas + CHECKs → trigger de actividad
→ revalidar /opportunities y /opportunities/[id]

INSERT en opportunity_notes o messages → AFTER INSERT →
private.touch_opportunity_activity() → last_activity_at = now() (solo avanza)
→ trigger de transiciones (toque válido)
```

- **Dominio puro** en `domains/conversations/`:
  - `messages.ts`: canales `whatsapp`, `email` y `manual` ("Otro medio"), direcciones `inbound` ("Recibido del cliente") y `outbound` ("Enviado al cliente"), texto de 1 a 4096 caracteres normalizado como una nota y `parseMessage()` con Zod.
  - `timeline.ts`: `activityTimeline()` combina notas y mensajes en un solo muro, del más reciente al más viejo, con desempate determinista y el autor como "Vos" u "Otro miembro".
- **Mensajes (`messages`):** una fila inmutable por mensaje, tenant-scoped por `organization_id`.
  - `contact_id` es obligatorio y `opportunity_id`, opcional. La FK compuesta `(organization_id, opportunity_id, contact_id)` exige que la oportunidad sea de la misma organización y de ese contacto (nueva `UNIQUE (organization_id, id, contact_id)` en `opportunities`).
  - `channel` y `direction` son `text` + CHECK. `recorded_by = auth.uid()` y `created_at = now()` los exige la policy de INSERT.
  - Nunca se edita ni se borra, para ningún rol de la app (tampoco `service_role`).
- **Recencia (supersede DEC-033 §6):** una nota o un mensaje con oportunidad nuevos mueven `last_activity_at` a `now()`, desde la base:
  - `private.touch_opportunity_activity()` es `SECURITY DEFINER` (owner `postgres`), con `search_path` vacío y sin EXECUTE para nadie. `authenticated` sigue sin UPDATE sobre `last_activity_at`.
  - Solo avanza: dos registros en una transacción tocan una vez, y una transacción vieja que confirma después no la hace retroceder. Un mensaje sin oportunidad no toca ninguna.
  - Toca en cualquier etapa, también cerrada, y no cambia `updated_at`, la etapa, la unidad ni el cierre.
  - El trigger de transiciones admite el toque como cuarta clase de UPDATE y rechaza cualquier otro cambio de `last_activity_at` con `23514` y constraint `opportunities_activity_touch`, también del rol dueño.
  - La demanda, la etapa, el cierre, la unidad vinculada y los matches siguen sin moverla.
- **Puerta única:** la Server Action `addMessage()` (`lib/conversations/actions.ts`). ESLint impide importar `db/queries/record-message.ts` desde otro módulo. El pedido trae solo `opportunityId`, `channel`, `direction` y `content`. Organización, contacto, autor y reloj no salen del pedido.
- **Respuestas:** `recorded`, `invalid` (errores por campo, con lo cargado acotado), `not_found` (inexistente o de otra organización, sin distinguir) y `failed` (sin detalles de la base ni valores en los logs).
- **Base (`0011_conversations_and_activity_trigger`):** la tabla con sus FKs, CHECKs, índices, RLS y grants (SELECT e INSERT de tabla para `authenticated`, diseño A), la función del toque con sus dos triggers y la función del trigger de transiciones ampliada. No toca filas existentes: las notas anteriores no mueven la recencia (sin backfill).
- **UI:** el panel "Notas" pasa a ser "Actividad":
  - Un selector "Nota / Mensaje" elige el formulario. El de mensajes pide canal (WhatsApp por defecto), dirección y texto con contador, valida con el mismo esquema Zod antes de enviar y aclara que registrar no envía nada.
  - El muro muestra notas y mensajes juntos, con su tipo ("Nota", "Mensaje recibido" o "Mensaje enviado" y el canal), el autor y la fecha de Asunción.
  - Registrar una nota o un mensaje revalida también la cola: la oportunidad vuelve a Activa y sube.
- **Limitaciones conocidas:** los mensajes son inmutables y sin redacción, como las notas y la demanda (C-14): no deben incluir datos personales que haya que borrar. La NBA "Registrar actualización de contacto" (DEC-035) sigue mirando solo las notas.
- **Fuera de este bloque:** enviar o recibir por WhatsApp o email (webhooks, Cloud API, BSP: H2b, previa ADR-002), la extracción asistida (H2a), IA, la superficie `/conversations` (inbox), mensajes sin oportunidad desde la UI, adjuntos, plantillas, estados de entrega o lectura, editar o borrar mensajes e Intent desde conversaciones.
- `0011` no se aplica a staging en esta rama: va después del merge con `preflight → migrate → verify`, con `expected_migrations = 0011_conversations_and_activity_trigger` (o con las anteriores que falten delante, en orden).

## Dashboard directivo (Hito 5)

`/intelligence` deja de ser un placeholder de B1: muestra el Dashboard directivo (DEC-037), lo que la gerencia necesita ver del mes en curso sin recorrer la cola ni el stock. Las métricas se agregan en PostgreSQL en cada request, sobre las tablas transaccionales: no hay tablas de métricas, snapshots, vistas materializadas ni jobs, y nada se persiste. El home sigue siendo el Cockpit (`/` redirige a `/cockpit`).

```text
getExecutiveDashboard(now) → requireTenant() → TenantContext → withTenant():
conteos de oportunidades · conteos del inventario · oportunidades en riesgo,
cada lectura con filtro explícito por organización → RLS →
buildExecutiveDashboard(): win rate, días sin actividad → ViewModel
```

| Bloque | Indicador | Regla |
|---|---|---|
| Pipeline comercial | Oportunidades activas | Abiertas hoy: Nueva, En calificación y En negociación |
| | Ganadas en el mes | `won` con cierre (`updated_at`) en el mes |
| | Win rate | Ganadas / (ganadas + perdidas) del mes, con un decimal · sin cierres, "Sin dato" (nunca 0 %) |
| Salud del inventario | En stock | Unidades no vendidas ni reservadas, incluidas las en preparación |
| | Reservadas | Vinculadas a una oportunidad En negociación (y no vendidas) |
| | Vendidas en el mes | Vinculadas a una oportunidad ganada que se cerró en el mes |
| Atención | Enfriándose · Inactivas | Abiertas de 2 a 5 días · de más de 5 días sin actividad del cliente (DEC-035 §2) |

- **Período (propuesta de implementación, DEC-037 §4):** el mes calendario de Asunción que contiene `now`, de su primer instante (incluido) al del mes siguiente (excluido). Lo calcula el dominio (`monthWindow()`), también cuando un cambio de horario se come la medianoche, y la base solo compara instantes. Ganadas, perdidas, win rate y vendidas son del mes; activas, stock, reservadas y atención son el estado actual.
- **Fecha de cierre:** no hay `closed_at`. Una oportunidad cerrada no vuelve a cambiar `updated_at`, así que esa es su fecha de cierre:
  - el trigger lo fija al cerrar (DEC-034 §9);
  - una cerrada solo admite el toque de actividad (DEC-034 §4 y §5, DEC-036 §3);
  - el toque no cambia `updated_at` (DEC-036 §1).
  - Habilitar la edición de una cerrada, o que el toque cambie `updated_at`, exige agregar antes `closed_at`.
- **Inventario derivado de los vínculos:**
  - Clasificación del fundador: una unidad vinculada a una ganada es vendida; a una en negociación, reservada; el resto, en stock.
  - `vehicles.status` no se consulta ni se cambia: no son los grupos "Reservadas" y "Vendidas" de la Stock List, y vincular sigue sin reservar ni vender la unidad (DEC-033 §2).
  - Propuestas de implementación (DEC-037 §7):
    - vendida tiene precedencia sobre reservada, y cada unidad está en una sola categoría;
    - "Vendidas en el mes" es del mes. Una unidad vendida antes no vuelve al stock ni aparece en el mes, así que los tres indicadores no suman el total de unidades.
- **Recencia sin repetir umbrales:** `recencyCutoffs()` (`domains/scoring/engine.ts`, junto a `recencyState()`) convierte la regla de DEC-035 §2 en dos instantes de corte que la base usa en `count(*) FILTER`.
  - Son límites exclusivos, un milisegundo después del borde: `last_activity_at` guarda microsegundos y el motor ve la fecha truncada al milisegundo, así que `last_activity_at < corte` clasifica igual que la cola.
  - Un test los cruza con `evaluateRecency()` en los bordes y otros comparan el dashboard con la cola, también con microsegundos.
- **Dominio puro** en `domains/dashboard/`: `period.ts` (mes de Asunción y su nombre), `metrics.ts` (tipos, `OPEN_STAGES`, `winRate()` exacto sobre enteros y `buildExecutiveDashboard()`) y `presentation.ts` (formato es-PY: "1.234", "66,7%", "Sin dato").
- **Capa de datos** (`db/queries/dashboard.ts`): tres lecturas en la misma transacción `withTenant()`, todas con filtro por `organization_id` sobre RLS: conteos de oportunidades, unidades con un `LEFT JOIN` al agregado de sus vínculos (`bool_or`, también filtrado y unido por organización y unidad, como la FK compuesta) y la lista en riesgo con su total (`count(*) over ()`). Los instantes se ligan con operadores de columna (`gte`, `lt`, `lte`, `gt`) para que viajen como `timestamptz`.
- **UI** (Server Components en `components/dashboard/`, tokens de DEC-013): tres bloques de tarjetas en una grilla CSS ("Pipeline comercial", "Salud del inventario" y "Atención"), el win rate con un medidor de marca, Enfriándose e Inactivas en ámbar y rojo solo cuando hay alguna, y en el rail "Oportunidades en riesgo": las Inactivas de la más vieja a la más reciente, con contacto, etapa, días sin actividad y enlace a `/opportunities/[id]`. Muestra a lo sumo 10 y, si hay más, enlaza a la cola.
- **Autorización:** la lectura de cualquier membership activa (`admin` o `seller`). Restringirla a `admin` requiere una decisión nueva.
- **Solo lectura:** no hay migración, policies, grants ni escrituras nuevas, y leer no modifica `last_activity_at`, `updated_at` ni el estado de las unidades.
- **Limitaciones conocidas:** el dashboard y la Stock List pueden diferir, porque una unidad vendida según el dashboard sigue `available` en Stock hasta que se habilite vender la unidad. Cada request agrega todas las oportunidades y unidades de la organización: si el volumen del piloto lo exige, se revisa con una decisión nueva.
- **Fuera de este bloque:** gráficos, series históricas, comparación con meses anteriores, metas, filtros, exportación, refresco automático, el valor vendido por moneda, ventas influenciadas y atribución, comisiones, restringir por rol, `closed_at` y reservar o vender la unidad en Stock.

## Configuración y equipo (Hito 6)

`/settings` deja de ser un placeholder de B1: el admin edita los datos del concesionario y gestiona su equipo (DEC-038). Dos secciones con navegación interna: General (`/settings`) y Equipo (`/settings/team`).

```text
Server Action → requireTenant() → rol admin → Zod (domains/settings, domains/team) →
db/queries/settings-write.ts → withTenant() → filtro explícito por organización →
RLS de admin (private.user_admin_org_ids()) → triggers de guarda → revalidar /settings
```

| Acción | Server Action | Admin | Seller |
|---|---|---|---|
| Editar nombre y moneda por defecto | `updateOrganization()` | Sí | `forbidden` (y RLS: 0 filas) |
| Invitar por email | `inviteMember()` | Sí | `forbidden` (y `42501` en la base) |
| Cambiar rol | `updateMemberRole()` | Sí, nunca el propio | `forbidden` (y RLS: 0 filas) |
| Quitar acceso | `removeMember()` | Sí, nunca el propio | `forbidden` (y RLS: 0 filas) |
| Ver la configuración y el equipo | loaders de `db/queries/settings.ts` | Sí | Sí, de solo lectura |

- **Invitar sin credenciales nuevas:** invitar da acceso a la organización activa a una **cuenta de Porandú que ya existe**, buscada por email (`private.find_member_candidate()`).
  - Crea la membership activa con el rol elegido, o reactiva una revocada con ese rol. Si ya es miembro activo, no cambia nada.
  - No crea cuentas ni envía correos: la aplicación no tiene service role (DEC-020, DEC-022). Sin cuenta, responde "No encontramos una cuenta de Porandú con ese email" y no cambia nada.
- **Guardas de la base** (trigger `memberships_change_guard`, `23514`):
  - nadie cambia ni revoca su propia membership (`memberships_self_change`);
  - un pedido con identidad no deja la organización sin admin activo (`memberships_last_admin`, con bloqueo de la organización para serializar carreras);
  - una membership no cambia de organización ni de usuario (`memberships_identity_immutable`).
  - `updated_at` lo fija la base. El provisioning con el rol dueño (sin claims) puede revocar a cualquiera, también al único admin (A-09).
- **Revocar** es `active = false`: no borra la cuenta, ni sus registros, ni sus memberships en otras organizaciones, y rige desde el request siguiente.
- **Lista del equipo:** los miembros activos con nombre, email y rol, por `private.organization_members()`, que solo responde a un miembro activo de la organización. `profiles` sigue mostrando solo el perfil propio y `auth.users` sigue cerrado para `authenticated`.
- **Moneda por defecto** (`organizations.default_currency`, `PYG | USD`): se guarda y se muestra. Los formularios todavía no la adoptan.
- **UI** (tokens de DEC-013): General es un formulario en panel (solo lectura para el seller). Equipo es una lista con avatar, nombre, email y rol; el admin invita desde un drawer y gestiona cada miembro desde un menú de acciones (Radix Dropdown Menu) con confirmación.
- **Fuera de este bloque:** crear cuentas, enviar correos de invitación, invitaciones pendientes, editar el perfil, auditoría de cambios, transferir la propiedad, crear o borrar organizaciones, zona horaria y restringir otras superficies por rol.
- `0012_team_settings` no se aplica a staging en esta rama: va después del merge con `preflight → migrate → verify`, con `expected_migrations = 0012_team_settings` (o con las anteriores que falten delante, en orden).

## Ingesta de WhatsApp (Hito 7)

Los mensajes de texto que un cliente envía a la línea de WhatsApp del concesionario llegan solos (DEC-039): el webhook los valida y los registra en el contacto, su conversación y, si corresponde, el muro de la oportunidad. Servidor a servidor, sin sesión ni usuario.

```text
POST /api/webhooks/whatsapp → secreto configurado (503) → cuerpo ≤ 3 MiB (413)
→ X-Hub-Signature-256 = HMAC-SHA256(cuerpo, WHATSAPP_APP_SECRET) (401)
→ JSON y sobre de la Cloud API con Zod (400) → por cada mensaje de texto:
teléfono E.164 (libphonenumber) → withIngestion(): authenticated sin claims →
private.ingest_whatsapp_message() (SECURITY DEFINER): organización de la línea →
contacto → conversación abierta → oportunidad abierta única → mensaje (idempotente)
→ último mensaje de la conversación → trigger de actividad → 200 con conteos
```

- **Tenant por la línea:** `whatsapp_lines.phone_number_id` (único global) es lo único que determina la organización. El payload no elige `organization_id`. Una línea desconocida o inactiva responde `200` sin escribir nada (`unknown_line`).
- **Identidad de sistema:** `authenticated` **sin claims**. Sin usuario no hay membership, así que RLS no deja ver ni escribir ninguna fila: solo se escribe por la función de ingesta, que rechaza con `42501` cualquier llamada con claims (un miembro no puede ingerir). Sin service role, roles nuevos ni credenciales nuevas: `app_runtime` sigue siendo miembro solo de `authenticated`. `withIngestion()` vive en `db/tenant.ts` y solo lo importa `db/queries/ingest-whatsapp-message.ts`, que solo importa `lib/whatsapp/webhook.ts` (ESLint).
- **Dominio puro** en `domains/webhooks/` (la capa de Ingestion de DEC-029 §2, la única que conoce el payload de WhatsApp):
  - `whatsapp.ts`: esquemas Zod del sobre y de cada mensaje de texto (`id`, `from`, `timestamp`, `text.body`, `metadata.phone_number_id`), estrictos en lo que se usa y tolerantes a campos nuevos del proveedor. Estados de entrega, media, reacciones y otros campos se ignoran; un mensaje con un campo inválido se descarta sin frenar el lote.
  - `inbound-message.ts`: el contrato propio `InboundMessage` (estricto, sin forma del proveedor) y el nombre de un contacto nuevo (el perfil de WhatsApp o "Contacto de WhatsApp").
  - `domains/conversations/conversations.ts`: canales y estados de una conversación y `messagePreview()` (una línea, hasta 160 caracteres, con "…").
- **Conversaciones (`conversations`):** una abierta por contacto y canal (unique parcial `WHERE status = 'open'`), con `last_message_at` (cuándo lo envió el cliente) y `last_message_preview`. Un mensaje viejo que llega tarde no pisa el último. Los miembros solo las leen; ningún flujo las cierra todavía.
- **Mensajes:** un mensaje ingerido no tiene autor (`recorded_by` NULL) y lleva `conversation_id`, `external_id` (el id del proveedor) y `sent_at`. El CHECK `messages_source_check` separa los dos orígenes: lo registró un miembro, o es un WhatsApp entrante ingerido. Siguen append-only.
- **Concurrencia e idempotencia:** la unicidad de la base es la autoridad (contacto por teléfono, conversación abierta, `(organization_id, external_id)`). Dos mensajes del mismo número nuevo a la vez dejan un contacto y una conversación; una entrega repetida, una sola fila (`duplicate`). Cada mensaje va en su propia transacción: si uno falla, el endpoint responde `500` y el reintento del proveedor encuentra los anteriores como `duplicate`.
- **Muro del Hito 4:** si el contacto tiene **exactamente una** oportunidad abierta, el mensaje se asocia a ella: aparece en su muro como "Mensaje recibido · WhatsApp", con autor "WhatsApp (automático)", y el trigger de DEC-036 mueve `last_activity_at` (la oportunidad vuelve a Activa y sube en la cola). Sin oportunidad abierta, o con varias, queda solo en la conversación: no se adivina el negocio ni se crea una oportunidad.
- **Logs:** solo conteos por resultado y, ante un error, `{ name, code, constraint_name }`. Nunca teléfonos, nombres, textos, ids ni el secreto.
- **Alta de una línea (provisioning, con el rol dueño):**

  ```sql
  INSERT INTO public.whatsapp_lines (organization_id, phone_number_id)
  VALUES ('<organization_id>', '<phone_number_id de Meta>');
  -- Darla de baja: UPDATE public.whatsapp_lines SET active = false WHERE phone_number_id = '…';
  ```

- **Base (`0013_whatsapp_ingestion`):** `whatsapp_lines` y `conversations` con FKs, CHECKs, índices, RLS, policy y grants; las columnas, la FK compuesta, la unique de idempotencia y el CHECK de origen de `messages`; la función de ingesta y sus postcondiciones. No toca filas existentes: los mensajes de los miembros cumplen el CHECK nuevo tal como están.
- **Limitaciones conocidas:** C-14 (sin redacción) también aplica a los mensajes ingeridos y a los nombres de perfil. Un número que `libphonenumber-js` no valida se descarta (`invalid_sender`).
- **Fuera de este bloque:** el GET de verificación de la suscripción en Meta (necesario antes de suscribir el endpoint), enviar mensajes, plantillas, estados de entrega o lectura, media y reacciones, crear oportunidades automáticamente, cerrar conversaciones, la bandeja `/conversations`, registrar líneas desde la UI, colas y límites de tasa, extracción asistida (H2a), Intent e IA.
- `0013_whatsapp_ingestion` no se aplica a staging en esta rama: va después del merge con `preflight → migrate → verify`, con `expected_migrations = 0013_whatsapp_ingestion` (o con las anteriores que falten delante, en orden).

## Convenciones

- Código, rutas, DB e identificadores en inglés. Copy de UI en español es-PY (DEC-011).
- Commits con Conventional Commits (`feat:`, `fix:`, `chore:`, `test:`, `docs:`, `spike:`).
- Trabajo en ramas y PR a `main` con CI en verde.
- Multi-tenancy: ver DEC-006 y ADR-001. Nunca se accede a datos tenant-scoped fuera del mecanismo aprobado.

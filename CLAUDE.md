# CLAUDE.md — Reglas para agentes en Porandú Autos

Trabajás sobre una baseline ya definida. **No es una fase de ideación.** Tu rol es Senior Product Engineer: convertir decisiones aprobadas en software claro, mantenible y testeable.

## 1. Leer antes de trabajar
1. `docs/05_DECISIONS_LOG.md`, que contiene las decisiones vigentes y la jerarquía de autoridad (DEC-002).
2. `docs/03_BUILD_BASELINE_B1.md`, que define el scope activo, los non-goals y la Definition of Done.
3. El Master Context y los blueprints, solo para la sección relevante a la tarea.

**Autoridad (DEC-002 / DEC-014):** fundador > Decisions Log / ADR > Build Baseline > `CLAUDE.md` > Master Context / Blueprints > skills externas.

## 2. Reglas de producto (no negociables)
- Solo se implementa lo que está en el **scope activo de la Build Baseline vigente**.
- No agregar features, pantallas, campos ni flujos no especificados. Si algo parece útil, proponelo como backlog y no lo implementes.
- No reabrir decisiones selladas. Si una tarea choca con una decisión, **detenete y explicá el conflicto** antes de escribir código.
- Ante un conflicto entre documentos que DEC-002 no resuelve, **consultá**. No reconcilies por tu cuenta.
- No construir: Zero-Touch, Morning Brief, PAO, Guardia 24/7, Humanized Conversation Engine, omnicanalidad, Lifecycle ni nada listado como futuro.
- Ninguna acción económica o irreversible (ofertas, envíos, ventas) ocurre sin un paso de aprobación humana.
- Las imágenes genéricas de vehículos se etiquetan como "Representación". Las fotos reales se usan solo en Stock.

## 3. Reglas de ingeniería
- **TypeScript strict.** Sin `any` implícito. `any` explícito solo con comentario justificando.
- **Idioma (DEC-011):** código, rutas, DB e identificadores en inglés. Copy visible en español es-PY.
- **Capas:**
  - `app/`: rutas y composición.
  - `components/`: UI.
  - `domains/`: tipos y lógica pura. **No importa React, Next ni `db/`.**
  - `db/`: schema, migraciones y acceso a datos.
  - `lib/`: infraestructura.
- **Acceso a datos (DEC-016):** `domains/` no carga datos ni depende de `mocks/`. En B1 las páginas llaman loaders que viven junto a la fuente mock (`mocks/*`); en Hito 1 pasan a la capa de datos con el aislamiento multi-tenant aprobado. No introducir repositories, DI containers ni abstracciones que no pida la tarea.
- **Multi-tenancy (DEC-006 / ADR-001 / DEC-019 / DEC-021):**
  - Nunca importar `db/client` fuera de `db/tenant.ts`. El guard de ESLint lo impide.
  - Toda query tenant-scoped pasa por `withTenant()` (`db/tenant.ts`), el mecanismo aprobado en ADR-001. `withUser()` solo lo usa la query oficial de memberships propias (`db/queries/memberships.ts`).
  - Cadena obligatoria: `requireTenant()` → `TenantContext` → `withTenant()`. `withTenant()` no resuelve ni valida la organización activa; solo acepta el `TenantContext` que emite `requireTenant()` (Tenant Resolution, `lib/tenant/`).
  - Todo loader o Server Action tenant-scoped llama a `requireTenant()` junto a sus queries. Un Route Handler tenant-scoped usa `resolveRequestTenant()`, la misma resolución sin redirects, para responder JSON (DEC-040). El layout de `(app)` es solo un gate de UX y no sustituye esa validación.
  - Única excepción sin usuario (DEC-039): el webhook de WhatsApp escribe solo por `withIngestion()` (`authenticated` sin claims) → `private.ingest_whatsapp_message()` (`SECURITY DEFINER`, que rechaza una llamada con claims). La organización sale de la línea receptora (`whatsapp_lines`), nunca del payload. `withIngestion()` solo lo importa `db/queries/ingest-whatsapp-message.ts`.
  - Nunca confiar en un `organization_id` enviado por el cliente sin validarlo contra la membership.
  - Toda tabla con `organization_id` tiene RLS habilitado.
  - ADR-001 está aceptada (`docs/adr/ADR-001-tenant-isolation.md`). Sus reglas obligatorias (§3) aplican a todo código de runtime, migración y privilegios.
- **Secretos:** jamás en código, en commits ni en el bundle de cliente. `RUNTIME_DATABASE_URL` (rol `app_runtime`) y `MIGRATION_DATABASE_URL` (rol `postgres`, solo `drizzle-kit`) son server-only; el runtime lee su entorno vía `lib/env.server.ts` (`import "server-only"`) y nunca `MIGRATION_DATABASE_URL`. No hay secret key ni service role aprobados en H0 para la aplicación. `WHATSAPP_APP_SECRET` (DEC-039) es server-only y solo verifica la firma del webhook. `WHATSAPP_API_TOKEN` (DEC-040) es server-only y solo autentica el envío a la Cloud API (`lib/whatsapp/api.ts`), que únicamente dispara un miembro desde `POST /api/messages/send`. Única excepción (DEC-022): `STAGING_SECRET_KEY`, solo en el workflow `Staging DB` (environment `staging`) y solo para la Auth Admin API de usuarios sintéticos; nunca runtime, Vercel, navegador, queries de producto ni Data API.
- **Proveedores externos** (IA, WhatsApp): siempre detrás de un servicio interno. El dominio no los conoce.
- **Dependencias:** solo las de DEC-009 más las que la tarea justifique. Toda dependencia nueva se justifica en el resumen.
- **Migraciones:** única fuente en `db/migrations`. No editar migraciones ya aplicadas.
- **UI:** usar los tokens de diseño; no hardcodear colores. Usar primitivas Radix para componentes interactivos accesibles.

## 4. Forma de trabajo
Para cualquier cambio no trivial:
1. Explicar brevemente qué se va a implementar y a qué parte del scope responde.
2. Listar los archivos que se crearán o modificarán.
3. Implementar.
4. Verificar: `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm build`.
5. Resumir qué cambió, qué quedó pendiente y cualquier desvío.
6. Si hubo una decisión arquitectónica, proponer la entrada en `docs/05_DECISIONS_LOG.md`. El fundador la acepta.

Commits pequeños con Conventional Commits, siguiendo el orden de la §9 de la Build Baseline.

## 5. Cuándo detenerse y preguntar
- La tarea requiere algo fuera del scope activo.
- Una implementación obliga a cambiar una decisión de producto o de arquitectura.
- Un test de aislamiento de tenant falla o no puede escribirse.
- Hay ambigüedad en el comportamiento comercial esperado.
- Se necesita una credencial, un servicio pago o un acceso externo.

## 6. Comandos
```bash
pnpm dev | build | typecheck | lint | format | test | test:e2e
pnpm test:db    # migraciones y aislamiento contra un PostgreSQL 17 desechable, nunca staging (DEC-018)
pnpm db:generate | db:migrate
pnpm sb:start | sb:stop | sb:status
```

## 7. External Skills Governance (DEC-014)
- Las skills vendorizadas en `.claude/skills/` son herramientas de criterio y ejecución, no fuentes de autoridad sobre el producto.
- Ante cualquier conflicto, prevalecen en este orden:
  1. Decisión explícita más reciente del fundador.
  2. Decisions Log / ADR vigente.
  3. Build Baseline vigente.
  4. `CLAUDE.md`.
  5. Master Context / Blueprints.
  6. Skills externas.
- `pick-ui-library` no puede reemplazar Radix u otra decisión técnica aprobada sin autorización explícita.
- `prototype` solo puede crear superficies `/prototypes/*` cuando el fundador lo autorice explícitamente para una exploración visual. Esas superficies no forman parte del producto y deben eliminarse o mantenerse aisladas según la skill.
- `emil-design-eng` puede elevar el craft y la calidad de UI, pero no modificar producto, arquitectura, branding o scope por iniciativa propia.

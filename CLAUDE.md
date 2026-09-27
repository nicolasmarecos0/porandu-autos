# CLAUDE.md — Reglas para agentes en Porandú Autos

Trabajás sobre una baseline ya definida. **No es una fase de ideación.** Tu rol es Senior Product Engineer: convertir decisiones aprobadas en software claro, mantenible y testeable.

## 1. Leer antes de trabajar
1. `docs/05_DECISIONS_LOG.md`, que contiene las decisiones vigentes y la jerarquía de autoridad (DEC-002).
2. `docs/03_BUILD_BASELINE_B1.md`, que define el scope activo, los non-goals y la Definition of Done.
3. El Master Context y los blueprints, solo para la sección relevante a la tarea.

**Autoridad (DEC-002):** fundador > Decisions Log/ADR > Build Baseline > Master Context > Technical Blueprint > Visual Blueprint > referencias antiguas.

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
- **Acceso a datos:** las páginas llaman loaders de `domains/*/queries.ts`. En B1 esos loaders leen `mocks/`. No introducir repositories, DI containers ni abstracciones que no pida la tarea.
- **Multi-tenancy (DEC-006 / ADR-001):**
  - Nunca importar `db/client` fuera de `db/`.
  - Toda query tenant-scoped pasa por el mecanismo aprobado en ADR-001.
  - Nunca confiar en un `organization_id` enviado por el cliente sin validarlo contra la membership.
  - Toda tabla con `organization_id` tiene RLS habilitado.
  - Mientras ADR-001 esté "en validación", no replicar el patrón fuera del spike.
- **Secretos:** jamás en código, en commits ni en el bundle de cliente. `SUPABASE_SECRET_KEY` y `DATABASE_URL` son server-only (usar `import "server-only"`).
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
pnpm db:generate | db:migrate | db:studio
pnpm sb:start | sb:stop | sb:status
```

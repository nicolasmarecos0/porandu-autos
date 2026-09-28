# PORANDÚ AUTOS — DECISIONS LOG

Registro de decisiones de producto, arquitectura y tooling posteriores a las baselines.
**Autoridad:** nivel 2 según DEC-002. Una decisión registrada aquí prevalece sobre la Build Baseline, el Master Context y los blueprints.

**Formato:** cada entrada indica fecha, estado, decisión, qué supersede o aclara y sus consecuencias.
**Estados posibles:** Aceptada · Aceptada en principio · Superseded · Rechazada.

Las decisiones selladas heredadas siguen vigentes según el Master Context §39 y el Technical Blueprint §17. No se duplican aquí.

---

## Índice

| ID | Título | Estado | Fecha |
|---|---|---|---|
| DEC-001 | Navegación global oficial | Aceptada | 2026-09-21 |
| DEC-002 | Jerarquía de autoridad | Aceptada | 2026-09-21 |
| DEC-003 | Offer Builder v0.1 pertenece a P1 | Aceptada | 2026-09-21 |
| DEC-004 | Cuatro scores | Aceptada | 2026-09-21 |
| DEC-005 | Dato faltante no penaliza | Aceptada | 2026-09-21 |
| DEC-006 | Tenant isolation en DB + aplicación | Aceptada | 2026-09-21 |
| DEC-007 | Ubicación en roadmap de Zero-Touch, Morning Brief y PAO | Aceptada | 2026-09-21 |
| DEC-008 | Build Baseline B1 aprobada | Aceptada | 2026-09-21 |
| DEC-009 | Tooling base | Aceptada | 2026-09-21 |
| DEC-010 | Hosting de staging: Vercel | Aceptada | 2026-09-21 |
| DEC-011 | Convención de idioma | Aceptada | 2026-09-21 |
| DEC-012 | Login B1: email + password | Aceptada | 2026-09-21 |
| DEC-013 | Dirección visual: Automotive Enterprise UI | Aceptada | 2026-09-28 |
| DEC-014 | Gobernanza de Design Skills | Aceptada | 2026-09-28 |
| ADR-001 | Implementación de tenant isolation | Aceptada en principio · implementación en validación | 2026-09-21 |

---

## DEC-001 — Navegación global oficial
- **Estado:** Aceptada · 2026-09-21
- **Decisión:** la Global Navigation es Cockpit / Opportunities / Stock / Conversations / Calendar / Recovery / Intelligence / Settings.
  - Pipeline es una vista dentro de Opportunities.
  - Sales/Ventas es una entidad y un resultado del dominio, no un ítem de navegación principal en P1.
- **Supersede:** la navegación del Technical Blueprint §5 (Inicio, Inbox, Leads, Inventario, Pipeline, Agenda, Ventas, Configuración) y la estructura de rutas sugerida en el TB §11.
- **Consecuencias:** las rutas de `app/` siguen esta lista. Recovery e Intelligence existen como rutas en P1 aunque su contenido se construye progresivamente.

## DEC-002 — Jerarquía de autoridad
- **Estado:** Aceptada · 2026-09-21
- **Decisión:** en caso de conflicto, el orden de autoridad es:
  1. Decisión explícita más reciente del fundador.
  2. Decisions Log / ADR aceptado posteriormente.
  3. Build Baseline vigente.
  4. Master Context vigente.
  5. Technical Blueprint.
  6. Visual/Product Blueprint.
  7. Referencias antiguas.
- **Supersede:** el orden del Master Context §0 y el de las Project Instructions iniciales.
- **Consecuencias:** un conflicto no resuelto por esta jerarquía se consulta al fundador. Ningún agente reconcilia por su cuenta.

## DEC-003 — Offer Builder v0.1 pertenece a P1
- **Estado:** Aceptada · 2026-09-21
- **Decisión:** Offer Builder v0.1 forma parte de P1.
  - En el vertical slice inicial funciona con mock data.
  - La persistencia se incorpora más adelante, dentro de P1.
  - Las condiciones económicas requieren aprobación humana antes de enviarse.
- **Aclara:** el TB §4 y §10, que no incluían una entidad de ofertas en P1.
- **Consecuencias:**
  - El schema de P1 incorporará una entidad de ofertas con estados cuando corresponda su persistencia.
  - El motor financiero completo sigue fuera de P1 (TB §4). Goal Seek y cuota estimada solo operan con datos existentes y no inventan condiciones.

## DEC-004 — Cuatro scores
- **Estado:** Aceptada · 2026-09-21
- **Decisión:** la arquitectura de scoring usa cuatro scores: Porandú, Intent, Vehicle Fit y Deal Readiness. Todos son explicables, trazables, reversibles y dinámicos.
- **Supersede:** el score único de lead del TB §10 (`leads.score`).
- **Consecuencias:** el dominio `scoring` modela los cuatro scores con sus drivers. La fórmula de Porandú Score (40/30/30) es conceptual y se recalibra con datos de piloto.

## DEC-005 — Dato faltante no penaliza
- **Estado:** Aceptada · 2026-09-21
- **Decisión:** la ausencia de información no penaliza automáticamente un score. Los scores se evalúan sobre las señales conocidas y registran por separado cobertura y confianza.
- **Supersede:** la interpretación aditiva de los pesos del Match Score del TB §8 en lo referido a datos ausentes.
- **Consecuencias:**
  - Los tipos de score incluyen `coverage` y confianza.
  - La UI distingue "sin dato" de "no coincide".
  - La fórmula concreta se define en Hito 3. Los pesos del TB §8 se mantienen como baseline de referencia.

## DEC-006 — Tenant isolation en DB + aplicación
- **Estado:** Aceptada · 2026-09-21
- **Decisión:** multi-tenancy real desde Hito 0. El aislamiento se aplica a nivel de base de datos (RLS) y en la capa de aplicación. Drizzle y Supabase no deben permitir queries tenant-agnostic accidentales.
- **Consecuencias:** la implementación concreta se define en ADR-001.

## DEC-007 — Ubicación en roadmap de Zero-Touch, Morning Brief y PAO
- **Estado:** Aceptada · 2026-09-21
- **Decisión:**
  - Zero-Touch Onboarding queda en P1.1.
  - Morning/Overnight Brief y PAO permanecen como futuro.
- **Aclara:** la inconsistencia entre el Master Context §23 ("P1.1 / P1.2") y §38 ("P1.1"), y la mención de la "visión al despertar" en el Master Context §7.
- **Consecuencias:** ninguno de los tres entra en B1 ni en el alcance activo de P1.

## DEC-008 — Build Baseline B1 aprobada
- **Estado:** Aceptada · 2026-09-21
- **Decisión:** se aprueba `docs/03_BUILD_BASELINE_B1.md`, con alcance Hito 0 + Vertical Slice visual sobre mock data.
- **Consecuencias:** B1 es la Build Baseline vigente (nivel 3). Todo trabajo fuera de su scope activo requiere una decisión nueva.

## DEC-009 — Tooling base
- **Estado:** Aceptada · 2026-09-21
- **Decisión:**
  - Zod para validación.
  - Tailwind CSS + design tokens propios + primitivas Radix.
  - pnpm + Node LTS (24).
  - Vitest para unit e integración; Playwright para E2E.
  - GitHub Actions para CI.
- **Consecuencias:** agregar una dependencia fuera de este set requiere justificarla en el PR. Si es estructural, se registra aquí.

## DEC-010 — Hosting de staging: Vercel
- **Estado:** Aceptada · 2026-09-21
- **Decisión:** el entorno de staging se despliega en Vercel, con un proyecto Supabase de staging.
- **Consecuencias:** el hosting de producción no está decidido y no forma parte de B1.

## DEC-011 — Convención de idioma
- **Estado:** Aceptada · 2026-09-21
- **Decisión:** código, rutas, base de datos e identificadores van en inglés. El copy visible de UI va en español es-PY.
- **Consecuencias:**
  - Los nombres de DEC-001 son identificadores de ruta.
  - Las etiquetas visibles de navegación se muestran en español; su copy exacto se define al construir el shell.
  - La documentación del proyecto se mantiene en español.

## DEC-012 — Login B1: email + password
- **Estado:** Aceptada · 2026-09-21
- **Decisión:** B1 usa Supabase Auth con email + password. Magic link queda fuera de B1.

## DEC-013 — Dirección visual: Automotive Enterprise UI
- **Estado:** Aceptada · 2026-09-28
- **Decisión:**
  - Workspace claro-neutro con paneles blancos y rail oscuro.
  - Color principal de marca: `#376B89`.
  - `#376B89` se usa para identidad, navegación activa, énfasis y estados seleccionados.
  - Sombras y bordes sutiles.
  - Sin glow/neón ni glassmorphism dominante.
  - La imagen de referencia del fundador guía jerarquía, densidad, composición y lenguaje visual, pero no se copia literalmente.
- **Supersede:** la dirección dark/glassmorphism anterior ("dark mode elegante, glassmorphism moderado" en la Build Baseline B1 §3.1 y el "Estilo base" del Master Context §33).
- **Consecuencias:** los design tokens de `components/ui/tokens.css` implementan esta dirección.

## DEC-014 — Gobernanza de Design Skills
- **Estado:** Aceptada · 2026-09-28
- **Decisión:** las Design Engineering Skills de terceros son herramientas subordinadas a la jerarquía de autoridad de Porandú. No pueden superseder decisiones de producto, arquitectura o branding aprobadas. `prototype` requiere invocación explícita y trabaja de forma aislada.
- **Aclara:** DEC-002. Las skills externas quedan al final de la jerarquía, y `CLAUDE.md` se ubica entre la Build Baseline y el Master Context.
- **Consecuencias:** aplica a `emil-design-eng`, `prototype` y `pick-ui-library` en `.claude/skills/`. Las reglas operativas están en `CLAUDE.md` §7.

---

## ADR-001 — Implementación de tenant isolation
- **Estado:** principio aceptado (DEC-006). Implementación en validación.
- **Fecha:** 2026-09-21

### Contexto
Drizzle se conecta directo a Postgres. Con credenciales privilegiadas, esa conexión puede eludir RLS. Se necesita que el aislamiento no dependa solo de la disciplina del código de aplicación.

### Hipótesis a validar (spike, commit 6 de B1)
1. RLS habilitado en toda tabla con `organization_id`. Las policies usan la función `is_member(organization_id)`, basada en `auth.uid()` y `memberships`.
2. Toda query de aplicación pasa por `withTenant(ctx, fn)`. Esta función abre una transacción que:
   - ejecuta `set local role authenticated`;
   - inyecta los claims JWT de la sesión (`request.jwt.claims`) para que RLS aplique a las queries de Drizzle;
   - recibe una organización activa ya validada contra la membership.
3. El cliente de DB crudo es server-only y no se importa fuera de `db/`. Esto se asegura con `no-restricted-imports` en ESLint.
4. El acceso con service role queda reservado a webhooks y jobs futuros, en un módulo separado y con `organization_id` explícito.

### Criterios para aceptar la implementación
- Con dos organizaciones y dos usuarios, A no puede leer, insertar, actualizar ni borrar datos de B a través de `withTenant`. Probado contra Postgres real (Supabase local).
- Una query ejecutada sin contexto de tenant falla o devuelve cero filas. Nunca devuelve datos de otro tenant.
- Un test verifica que toda tabla con `organization_id` tenga RLS habilitado.
- El pooler y el entorno de Vercel son compatibles con transacciones que usan `set local`.
- El overhead de latencia es aceptable para el uso de P1.

### Resultado
_Pendiente. Se completa al cerrar el spike. Si la hipótesis falla, se documenta aquí la alternativa elegida y se consulta al fundador antes de congelarla._

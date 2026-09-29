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
| DEC-015 | Opportunities Visual Architecture | Aceptada | 2026-09-28 |
| DEC-016 | Loaders de datos fuera de `domains/` | Aceptada | 2026-09-28 |
| DEC-017 | Opportunities Surface Boundaries | Aceptada | 2026-09-28 |
| ADR-001 | Tenant isolation y SaaS foundation | Aceptada | 2026-09-29 |

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


## DEC-015 — Opportunities Visual Architecture
- **Estado:** Aceptada · 2026-09-28
- **Decisión:** la dirección visual aprobada para Opportunities es **Reference-first + Porandú DNA**: arquitectura Automotive Enterprise inspirada en las referencias aprobadas, adaptada a la identidad Porandú, con cola operativa, customer identity, Porandú Ring, cuatro scores explicables, action area, Why Now y Vehicle Rail.
  - Columna izquierda: tarjeta de identidad del prospecto seleccionado (`#376B89`) y la cola de oportunidades agrupada por urgencia.
  - Centro: strip de Porandú Score (con el Porandú Ring), Intent, Vehicle Fit y Deal Readiness; "¿Qué hacer?" (Next Best Action); "¿Por qué ahora?" en "Señales fuertes" / "A validar".
  - Derecha: Vehicle Rail con vehículo buscado, Top Match, alternativa y trade-in.
  - El Porandú Ring muestra cómo se compone el Porandú Score a partir de Intent, Vehicle Fit y Deal Readiness. La composición llega como dato (en B1, un valor de mock) y no fija la fórmula, que sigue siendo conceptual según DEC-004. Un dato faltante se dibuja punteado y no penaliza (DEC-005).
- **Aclara:** la Build Baseline B1 §3.2 ("Opportunities: lista simple que lleva al workspace"). Opportunities sigue siendo una cola de oportunidades, pero incorpora contexto de decisión comercial en la misma superficie. `/opportunities/[id]` (Opportunity Workspace) se mantiene como ruta del slice.
- **Consecuencias:**
  - La exploración se hizo con la skill `prototype` (DEC-014) y la superficie `/prototypes/opportunities` se eliminó al promover la variante.
  - Sigue siendo una implementación visual de B1 sobre fixtures (`mocks/`): sin persistencia, sin scoring real, sin WhatsApp ni IA. "Marcar como hecha" es estado simulado en cliente.
  - Una acción que cambia condiciones económicas se marca "Requiere aprobación" y no se completa desde Opportunities.

## DEC-016 — Loaders de datos fuera de `domains/`
- **Estado:** Aceptada · 2026-09-28
- **Decisión:** `domains/` contiene únicamente tipos, labels y lógica determinista de dominio. No puede depender de `mocks/`, `db/`, React, Next ni componentes de UI.
  - En B1, mientras usemos datos simulados, los loaders pueden vivir junto a la fuente mock (p. ej. `getOpportunityQueue()` en `mocks/opportunities.ts`).
  - En Hito 1 la carga de datos pasará a la capa de datos correspondiente y deberá aplicar el aislamiento multi-tenant aprobado (`withTenant` o el mecanismo vigente entonces).
- **Supersede:** las partes de `CLAUDE.md` §3 y de la Build Baseline B1 §7 que indicaban loaders dentro de `domains/*/queries.ts`.
- **Consecuencias:** `CLAUDE.md` §3 se alinea con esta decisión. La Build Baseline no se reescribe: esta decisión la supersede en ese punto.

## DEC-017 — Opportunities Surface Boundaries
- **Estado:** Aceptada · 2026-09-28
- **Decisión:** `/opportunities` queda definido como la cola operativa y superficie compacta de inteligencia comercial de Porandú Autos.
  - Su responsabilidad es responder: "¿A quién atiendo ahora, por qué y qué hago?"
  - Puede contener:
    - selección y priorización de oportunidades;
    - identidad resumida del prospecto;
    - Porandú Score;
    - Intent;
    - Vehicle Fit;
    - Deal Readiness;
    - recencia;
    - Next Best Action;
    - Why Now / señales;
    - contexto resumido de vehículo buscado;
    - Top Match;
    - alternativa;
    - trade-in.
  - Why Now y Next Best Action permanecen en `/opportunities` para mantener la superficie rápida y operativa.
  - `/opportunities/[id]`, todavía no construido, permanece dentro del alcance de B1, pero cambia su responsabilidad. No debe duplicar esta superficie: no repite la cola, los cuatro scores, Why Now, Next Best Action ni Vehicle Rail como experiencia principal. Será un deep workspace reservado para información y acciones de profundidad, como:
    - conversación completa;
    - Porandú Memory;
    - qualification detallada;
    - historial y trazabilidad;
    - notas;
    - Talking Points (Mencionar / Validar / Evitar);
    - contexto completo de trade-in;
    - matches ampliados;
    - Offer Builder;
    - acciones comerciales profundas.
  - Action Cockpit mantiene una responsabilidad distinta y transversal: "¿Qué necesita atención en todo el negocio ahora mismo?" Puede priorizar eventos provenientes de Opportunities, Conversations, Calendar, Recovery, Stock y otras áreas, pero no debe replicar la experiencia completa de `/opportunities`.
- **Aclara:** la Build Baseline B1 §1, §3.2, §6 y §8 en lo referido a Opportunity Workspace, Intelligence Workspace y Vehicle Rail, y DEC-015 respecto de `/opportunities/[id]`.
- **Consecuencias:** la pantalla Opportunities construida bajo DEC-015 absorbió parte del alcance originalmente previsto para Opportunity Workspace / Intelligence Workspace / Vehicle Rail. Los futuros módulos deben reutilizar esas capacidades y evitar duplicación.
  - La Build Baseline, el Master Context y el Visual Blueprint no se reescriben: DEC-017 prevalece sobre ellos en estos puntos (DEC-002).

---

## ADR-001 — Tenant isolation y SaaS foundation
- **Estado:** Aceptada · 2026-09-29. El principio se aceptó el 2026-09-21 (DEC-006); la implementación estuvo en validación hasta el cierre de E1 y E2.
- **Documento:** [`docs/adr/ADR-001-tenant-isolation.md`](adr/ADR-001-tenant-isolation.md), con la forma validada, la evidencia completa y el resultado frente a la hipótesis original.
- **Decisión:** arquitectura aprobada para tenant isolation:
  - PostgreSQL en Supabase, con Drizzle (`drizzle-orm` y `drizzle-kit`, driver `postgres`).
  - Rol de runtime `app_runtime`: `LOGIN NOINHERIT NOBYPASSRLS`, sin privilegios directos, miembro de `authenticated` `WITH INHERIT FALSE, SET TRUE`.
  - Credencial `postgres` separada y exclusiva para migraciones.
  - `withTenant()` como boundary transaccional y única puerta de acceso a datos tenant-scoped, con una organización ya validada contra las memberships activas.
  - Contexto JWT verificado por Supabase Auth, inyectado como `request.jwt.claims`.
  - `SET LOCAL ROLE authenticated` dentro de la transacción.
  - `set_config(..., true)`: claims y rol solo con alcance de transacción.
  - RLS como barrera de aislamiento.
  - Filtros explícitos por `organization_id` en la aplicación como defense in depth.
  - Supavisor en modo transacción para el runtime.
- **Reglas obligatorias:**
  - El runtime nunca usa `postgres`.
  - El runtime nunca usa `SET` de sesión ni `set_config(..., false)`.
  - La Data API permanece deshabilitada en H0.
  - `pg_graphql` no se habilita en H0.
  - Ninguna tabla de aplicación en `public` queda sin RLS.
  - Las migraciones y los privilegios preservan el aislamiento multi-tenant (invariantes de catálogo en el documento, §3).
- **Evidencia:** E1 (Supabase local, [run 36493339590](https://github.com/nicolasmarecos0/porandu-autos/actions/runs/36493339590)) y E2 (staging `sa-east-1`, [run 36590229247](https://github.com/nicolasmarecos0/porandu-autos/actions/runs/36590229247)) validaron el aislamiento. Ningún criterio de aislamiento falló; los únicos fail de E2 son la medición de latencia, que no tiene umbral.
- **Pendiente (E3):** únicamente latencia real Vercel → Supabase en la misma región, pool y serverless, JWKS (caché y rotación), TLS `verify-full` y manejo y rotación de la credencial de `app_runtime`. E3 no vuelve a validar el aislamiento. Si un resultado de E3 obliga a cambiar la decisión, se registra en el documento y se consulta al fundador.
- **Supersede:** la hipótesis y los criterios de la entrada ADR-001 del 2026-09-21 (su resultado queda en el documento, §6) y, de la Build Baseline B1 §7 ("Aislamiento de tenant"), los puntos 1 y 2 en lo que difieren. En particular, las policies validadas usan `private.user_org_ids()` y no `is_member()`.
- **Aclara:** cierra el gate del commit 6 de la Build Baseline §9 y el punto abierto de §10. Los puntos 3 a 5 de la Build Baseline §7 siguen vigentes. El spike no cubrió el guardrail de import de `db/client` (3) ni el service role (4), y este ADR no los aprueba. Los tests obligatorios (5) se escriben en H0.
- **Consecuencias:**
  - H0 implementa esta arquitectura en `db/`. El código del spike (`spike/h0-saas-foundation`) es experimental y no se trae a `main`.
  - `CLAUDE.md` §3 se alinea con esta decisión. La Build Baseline no se reescribe: ADR-001 prevalece sobre ella en estos puntos (DEC-002).
  - Staging conserva el schema que dejó E2. Antes de las migraciones reales de H0 se resetea o recibe una migración de limpieza; la elección queda abierta.

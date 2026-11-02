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
| DEC-018 | H0.4 SaaS Core Schema | Aceptada | 2026-09-29 |
| DEC-019 | H0.5 Tenant Isolation | Aceptada | 2026-09-30 |
| DEC-020 | H0.6 Supabase Auth | Aceptada | 2026-09-30 |
| DEC-021 | H0.7 Tenant Resolution | Aceptada | 2026-09-30 |
| DEC-022 | Official Staging Database Operations | Aceptada | 2026-09-30 |
| DEC-023 | H1.1 Opportunities sobre datos reales | Aceptada | 2026-10-01 |
| DEC-024 | Contact identity and Opportunity creation | Aceptada | 2026-10-01 |
| DEC-025 | Vehicle persistence foundation | Aceptada | 2026-10-02 |
| DEC-026 | Stock Surface Architecture | Aceptada | 2026-10-02 |
| DEC-027 | Alta rápida de unidades (H1.3B) | Aceptada | 2026-10-02 |
| DEC-028 | Disponibilidad de unidades (H1.3C) | Aceptada | 2026-10-04 |
| DEC-029 | Roadmap Checkpoint H1 y contrato de demanda | Aceptada | 2026-10-06 |
| DEC-030 | Demand Contract y Current Truth (H1.4) | Aceptada | 2026-10-06 |
| DEC-031 | Match v0 Engine y Consumo en Opportunity Workspace (H1.5) | Aceptada | 2026-10-11 |
| DEC-032 | Opportunity Stages: etapas comerciales y transiciones (H1.6) | Aceptada en principio | 2026-10-11 |
| DEC-033 | Bitácora comercial y unidad vinculada a la negociación (Hito 2) | Aceptada en principio | 2026-10-11 |
| DEC-034 | Formalización y metadatos de cierre comercial Won/Lost | Aceptada en principio | 2026-10-11 |
| DEC-035 | Motor de Scoring, Recency y NBA | Aceptada en principio | 2026-10-12 |
| DEC-036 | Módulo de Conversaciones y Actualización Automática de Actividad | Aceptada en principio | 2026-10-13 |
| DEC-037 | Dashboard Directivo y Agregación de Métricas | Aceptada en principio | 2026-10-14 |
| DEC-038 | Gestión de Equipo, Invitaciones y Configuración de Concesionario | Aceptada en principio | 2026-10-15 |
| DEC-039 | Procesamiento de Webhooks de WhatsApp e Ingesta de Mensajes | Aceptada en principio | 2026-10-21 |
| DEC-040 | Interfaz de Bandeja de Entrada y Motor de Envío de WhatsApp | Aceptada en principio | 2026-10-29 |
| DEC-041 | Agenda de pruebas de manejo (Calendar, Hito 9) | Aceptada | 2026-11-01 |
| DEC-042 | Cotizaciones formales (Deal Management, Hito 10) | Aceptada | 2026-11-01 |
| DEC-043 | Dashboard Directivo: KPIs comerciales, rangos de fechas y política de caché | Aceptada en principio | 2026-11-01 |
| DEC-044 | Bandeja premium: orden del chat, leído por miembro, estados de entrega y oportunidad de la conversación (Hito 12) | Aceptada en principio | 2026-11-01 |
| DEC-045 | Agenda ejecutiva: grilla horaria semanal, día en foco y lenguaje de estados (Hito 13) | Aceptada en principio | 2026-11-02 |
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

## DEC-018 — H0.4 SaaS Core Schema
- **Estado:** Aceptada · 2026-09-29
- **Decisión:** el schema base de la SaaS foundation es el de la migración oficial `0000_saas_core_schema` (`db/migrations`), mergeada en `main` con H0.4:
  - `organizations`: raíz del tenant. UUID, `name` y timestamps, sin `organization_id`.
  - `profiles`: identidad de aplicación 1:1 con Supabase Auth.
    - `profiles.id = auth.users.id`, con FK `ON DELETE CASCADE`.
    - `profiles.full_name` es nullable: un dato de presentación no bloquea la creación del perfil.
    - El email vive en `auth.users` y no se duplica.
    - No lleva `organization_id`: el perfil pertenece al usuario, no a una organización.
  - `memberships`: tabla tenant-scoped.
    - `organization_id` `NOT NULL` con FK a `organizations` (`RESTRICT`) y `user_id` con FK a `profiles` (`CASCADE`).
    - `role` sin default y unique `(organization_id, user_id)`.
    - `memberships.active` (`boolean`, default `true`): solo una membership activa da acceso. Revocar es pasar a `false`.
  - Roles: enum `membership_role` = `admin | seller`.
  - RLS habilitado en las tres tablas desde `0000`. Se revocan los privilegios por defecto que Supabase otorga a `anon` y `authenticated` sobre objetos nuevos de `public` (ADR-001 §3.6).
  - Harness sobre PostgreSQL 17 local y desechable (`pnpm test:db`, job `db` de CI), nunca contra staging. Aplica las migraciones desde cero con `pnpm db:migrate` y crea el mínimo de Supabase que necesitan (`tests/db/support/`).
- **Aclara:** la Build Baseline B1 §3.1 ("`memberships (role: admin | vendedor)`"). El identificador en la base es `seller` (DEC-011); el copy visible sigue en español.
- **Consecuencias:**
  - `0000` no otorga privilegios a `authenticated`: los grants de lectura y sus policies llegan con `0001` (DEC-019).
  - El harness verifica migraciones, schema y aislamiento en CI. No reemplaza las validaciones cloud pendientes de E3 (ADR-001 §7).
  - La Build Baseline no se reescribe: DEC-018 prevalece sobre ella en este punto (DEC-002).

## DEC-019 — H0.5 Tenant Isolation
- **Estado:** Aceptada · 2026-09-30
- **Decisión:** H0.5 implementa ADR-001 en `main` (migración oficial `0001_tenant_isolation` y `db/tenant.ts`) sin cambiar su arquitectura ni sus reglas. Además de lo que fija ADR-001, queda decidido:
  - **`app_runtime`:** `0001` lo crea `LOGIN NOINHERIT NOBYPASSRLS` y sin password, miembro de `authenticated` `WITH INHERIT FALSE, SET TRUE` (SET permitido, sin herencia). Al final, `0001` verifica las invariantes de ADR-001 §3.6 sobre la base real y, si alguna falla, no aplica nada.
  - **`private.user_org_ids()`** devuelve solo las organizaciones con membership **activa** del usuario de la request.
  - **Policies de lectura de H0.** `authenticated` solo tiene `SELECT` sobre estas tres tablas:
    - `organizations`: solo las organizaciones permitidas (`id IN (SELECT private.user_org_ids())`).
    - `memberships`: solo las de organizaciones permitidas (`organization_id IN (SELECT private.user_org_ids())`).
    - `profiles`: solo el perfil propio (`id = auth.uid()`). Compartir organización no expone el perfil de otro usuario.
  - **Sin policies ni grants de escritura en H0** (default deny). Una escritura se habilita cuando un flujo aprobado la necesite, con la condición de ADR-001 §4 en `USING` y `WITH CHECK`.
  - **`withUser()` y `withTenant()`** (`db/tenant.ts`) usan contexto transaccional local: una transacción por llamada, cuyo primer statement fija claims y rol `authenticated` con `set_config(..., true)`. `withUser()` solo sirve para leer las memberships propias antes de elegir organización. No se permiten claims ni rol a nivel de sesión.
  - **`withTenant()` no resuelve ni valida por sí solo la organización activa.** Recibe un contexto confiable (claims verificados y organización ya validada) y solo rechaza un contexto mal formado. Los claims verificados llegan con Supabase Auth (H0.6); resolver y validar la organización activa contra las memberships activas del usuario corresponde a Tenant Resolution (H0.7), mediante `requireTenant()`. Hasta entonces solo los tests construyen contextos.
  - **Guard de ESLint:** `db/client` solo se importa desde `db/tenant.ts` (y dos archivos de test), incluidos imports relativos y dinámicos. Ningún otro módulo puede saltear el boundary.
  - **Tests** sobre el harness de PostgreSQL 17 (DEC-018): aislamiento tenant A ↔ B (C1), contexto falsificado (A-03), membership inactiva o revocada (A-09), fallo cerrado fuera del boundary (C2), invariantes de catálogo (C3) y contaminación de sesión entre transacciones, incluidos COMMIT, ROLLBACK y error (C6).
- **Aclara:** la Build Baseline B1 §7 ("Aislamiento de tenant"), puntos 3 y 5, y ADR-001 §6, hipótesis 3. El guard de import y los tests obligatorios quedan implementados, y el guard es más estricto que "fuera de `db/`". El punto 4 (service role) sigue sin aprobarse. El tenant context de la Build Baseline §3.1 y el selector de organización quedan para Tenant Resolution (H0.7).
- **Consecuencias:**
  - `CLAUDE.md` §3 se alinea con esta decisión (guard de `db/client` y alcance de `withTenant()`).
  - El aislamiento ya lo validaron E1 y E2 (ADR-001) y el harness lo cubre en CI. E3 no lo vuelve a validar.
  - La Build Baseline no se reescribe: DEC-019 prevalece sobre ella en estos puntos (DEC-002).

## DEC-020 — H0.6 Supabase Auth
- **Estado:** Aceptada · 2026-09-30
- **Decisión:** H0.6 implementa Supabase Auth (DEC-012) solo para autenticación e identidad verificada:
  - **Server-side only.** Se usan únicamente `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. No hay cliente de Supabase de datos ni de navegador en B1.
  - **Credenciales.** La Auth web nunca usa service role, la credencial de migración (`MIGRATION_DATABASE_URL`) ni la de runtime (`RUNTIME_DATABASE_URL`).
  - **Identidad confiable.** Se obtiene con `auth.getClaims()`, que verifica el access token. `getSession()` no se usa para decisiones de autorización.
  - **Usuario válido.** `sub` es un UUID válido, `role` es `authenticated` y el usuario no es anónimo.
  - **Sin organización.** H0.6 no acepta ni deriva `organizationId` desde el JWT, el formulario, la query ni ningún otro input del cliente.
  - **Cookies de sesión:** `HttpOnly`, `SameSite=Lax` y `Secure` en producción.
  - **Login B1:** solo email + password. Quedan fuera el signup público, Magic Link, OAuth, reset de password e invitaciones.
  - **Redirects.** El login exitoso redirige a `/cockpit`. En H0 no existe parámetro `next`, para no introducir redirects arbitrarios.
  - **Logout** usa `scope: "local"` y cierra solo la sesión del dispositivo actual.
  - **`proxy.ts`** refresca la sesión y sus cookies y hace redirects optimistas de autenticación. No es la barrera final de autorización.
  - **Alcance.** H0.6 valida solo autenticación. Membership, organización activa, cookie de organización, `requireTenant()`, selector de organización y `/no-access` pertenecen a Tenant Resolution (H0.7).
- **Aclara:** la Build Baseline B1 §3.1 (Supabase Auth: login, logout y sesión) y ADR-001 §7, punto 3 de E3.
- **Consecuencias:**
  - E3 no reinventa la verificación contra el JWKS: valida el comportamiento de `getClaims()` en el runtime serverless real, incluidas la caché y la rotación de claves y la topología de deployment.
  - La Build Baseline no se reescribe: DEC-020 prevalece sobre ella en estos puntos (DEC-002).

## DEC-021 — H0.7 Tenant Resolution
- **Estado:** Aceptada · 2026-09-30
- **Decisión:** H0.7 completa la cadena `AuthenticatedUser → memberships activas → organización activa → TenantContext confiable → withTenant()`:
  - **`requireTenant()`** resuelve el tenant a partir del `AuthenticatedUser` verificado (H0.6) y de sus memberships activas leídas en la base en cada request:
    - 0 memberships activas → `/no-access`;
    - 1 membership activa → esa organización, automáticamente;
    - 2+ memberships activas → una cookie válida selecciona la organización; cookie ausente o inválida → `/select-organization`.
  - **Cookie de organización:** es solo un hint no confiable. Nunca autoriza por sí misma: se valida contra las memberships activas en cada request.
  - **Fuente de autoridad:** el `organizationId` final y el `role` del `TenantContext` provienen de una membership activa validada en la base. JWT, formulario, query string y cookie nunca son fuente de autoridad para role ni tenant.
  - **`TenantContext` opaco:** es un tipo branded y solo lo emite el boundary oficial de Tenant Resolution. `withTenant()` rechaza cualquier contexto no emitido por ese boundary.
  - **`withUser()`** queda restringido a la query oficial de memberships propias.
  - **Hito 1:** todo loader o Server Action tenant-scoped ejecuta `requireTenant()` junto a sus queries y pasa ese contexto a `withTenant()`. El layout de `(app)` es solo un gate de UX.
  - **Selector:** revalida la membership en la base antes de escribir la cookie.
  - **Logout y login exitoso** eliminan la preferencia de organización anterior.
  - **Fuera de H0.7:** parámetro `next`, provisioning y gestión de miembros.
- **Aclara:** la Build Baseline B1 §3.1 (tenant context validado en cada request y selector de organización), DEC-019 (quién construye el contexto que recibe `withTenant()`) y DEC-020 (Tenant Resolution como alcance de H0.7).
- **Consecuencias:**
  - `CLAUDE.md` §3 se alinea con esta decisión (`requireTenant() → TenantContext → withTenant()`).
  - Los detalles de implementación que no forman parte de la decisión (nombre, atributos y duración de la cookie) quedan documentados en el README y pueden ajustarse sin cambiar el modelo de seguridad.
  - La Build Baseline no se reescribe: DEC-021 prevalece sobre ella en estos puntos (DEC-002).

## DEC-022 — Official Staging Database Operations
- **Estado:** Aceptada · 2026-09-30
- **Decisión:** `.github/workflows/staging-db.yml` (Staging DB) es la vía oficial para las operaciones de base de datos de staging: preflight, migraciones, credencial de `app_runtime`, verificación y acceptance.
  - **Ejecución:** manual (`workflow_dispatch`), exclusivamente desde `main` y con el environment `staging`. Antes de conectar valida que el project ref coincida entre `vars.STAGING_PROJECT_REF`, la confirmación del input, `STAGING_SUPABASE_URL` y el usuario del Session pooler.
  - **Migraciones:** usan exclusivamente la credencial `postgres` (Session pooler) y solo `db/migrations`, con `pnpm db:migrate`.
  - **Runtime:** usa exclusivamente `app_runtime` por el Supavisor transaction pooler (6543).
  - **Password de `app_runtime`:** vive en el GitHub secret `STAGING_RUNTIME_DB_PASSWORD`, nunca en migraciones ni en el repositorio, y no puede ser la de `postgres`. El provisioning manda a Postgres un verificador SCRAM-SHA-256, no el texto plano. Rotar es volver a correr el provisioning con el secret nuevo.
  - **`STAGING_SECRET_KEY`:** excepción operacional, permitida únicamente para la Supabase Auth Admin API (crear y eliminar usuarios sintéticos) dentro del acceptance y la limpieza sintética de staging. Solo en GitHub Actions y en el environment `staging`. Jamás se despliega al runtime: nunca Vercel, navegador, queries de producto ni Data API.
  - **Preflight:** de solo lectura, falla cerrado ante cualquier estado inesperado (historial, objetos ajenos, residuos, privilegios) y nunca limpia automáticamente ni usa `CASCADE`.
  - **Datos sintéticos:** llevan marcas explícitas y se eliminan al terminar cada acceptance. El schema, el historial de migraciones y `app_runtime` permanecen como infraestructura oficial de staging.
  - **Data API:** en este gate se considera segura si no existe acceso lateral a datos: ninguna request REST o GraphQL, con la publishable key o con un token sintético, devuelve tablas, datos o schema de la app. No se fija un código HTTP concreto como contrato. La comprobación fuerte es el acceptance Auth → Tenant con datos sintéticos.
- **Aclara:** ADR-001 §7, punto 5 (credencial real de `app_runtime`: en staging vive en `STAGING_RUNTIME_DB_PASSWORD` y se rota con el workflow), y ADR-001 §8 y `CLAUDE.md` §3 respecto de la secret key, que sigue sin aprobarse para la aplicación.
- **Consecuencias:**
  - `CLAUDE.md` §3 registra la excepción de `STAGING_SECRET_KEY`. El README documenta el workflow, sus operaciones y el runbook.
  - H0.9/E3 cubre Vercel, la misma región, el runtime oficial desplegado, la latencia, el JWKS en serverless y el TLS `verify-full` pendiente.

## DEC-023 — H1.1 Opportunities sobre datos reales
- **Estado:** Aceptada · 2026-10-01
- **Decisión:** H1.1 lleva la cola de Opportunities a PostgreSQL real (migración oficial `0002_opportunities_persistence`):
  - **Entidades:** `Contact` y `Opportunity` (tablas `contacts` y `opportunities`) son las primeras entidades de producto persistidas de Hito 1. Ambas son tenant-scoped según ADR-001 §3.6.
  - **Cadena de datos:** la lista `/opportunities` lee PostgreSQL real mediante `requireTenant() → withTenant()` y un filtro explícito por `organization_id`.
  - **Defensa en profundidad:** RLS y el filtro explícito son capas complementarias; ninguna sustituye a la otra.
  - **Sin outputs inventados:** los outputs de motores que todavía no existen (scores, NBA, Why Now, matches, trade-in, entre otros) no se inventan ni se persisten. Se representan como ausencia / "sin dato" (DEC-005).
  - **Intención mínima:** `interest_model` e `interest_version` son el mínimo temporal de intención en H1.1. Las preferencias estructuradas quedan para Qualification.
  - **Responsable:** la asignación de vendedor/responsable queda diferida.
  - **Estados y origen:** `stage` y `source` usan por ahora `text` + `CHECK`, no enum, para poder evolucionar mediante migraciones.
  - **Capas:** los loaders de datos viven en `db/queries/`. Páginas y componentes no conocen Drizzle y `domains/` permanece puro (DEC-016).
  - **Mocks:** la cola real ya no usa mocks en runtime. Los fixtures quedan únicamente como referencia del contrato visual y de los tests.
  - **Solo lectura:** H1.1 es read-only. No hay policies ni grants de escritura todavía (default deny).
- **Aclara:** la Build Baseline B1 §4 (persistencia de contacts y leads diferida a hitos siguientes de P1), DEC-016 (loaders en la capa de datos en Hito 1) y DEC-021 (loaders tenant-scoped de Hito 1).
- **Consecuencias:**
  - Los detalles de presentación temporales y reversibles de H1.1 quedan documentados en el README y no forman parte de esta decisión.
  - La Build Baseline no se reescribe: DEC-023 prevalece sobre ella en estos puntos (DEC-002).

## DEC-024 — Contact identity and Opportunity creation
- **Estado:** Aceptada · 2026-10-01
- **Decisión:** H1.2 habilita el alta manual de oportunidades con identidad de contacto por teléfono (migración oficial `0003_contact_identity_opportunity_create`):
  1. **Identidad del contacto.** Cuando `contacts.phone_normalized` está presente, identifica al contacto dentro de una organización. Es único mediante el índice parcial `(organization_id, phone_normalized) WHERE phone_normalized IS NOT NULL` y nunca global. Los contactos con `phone_normalized = NULL` no participan de esta deduplicación. `phone` conserva el valor capturado. No hay backfill SQL automático.
  2. **Normalización.** Se realiza exclusivamente server-side mediante `libphonenumber-js` con metadata completa. Paraguay es la región por defecto para números sin prefijo internacional. Números con código internacional explícito conservan su país. La DB valida solamente la forma E.164.
  3. **Deduplicación y concurrencia.** La unicidad de DB es la autoridad. El flujo utiliza `ON CONFLICT DO NOTHING` sobre la identidad tenant-scoped y reutiliza un contacto existente sin modificar nombre ni ciudad.
  4. **Puerta oficial de alta.** `createOpportunity()` es la única puerta aprobada para H1.2: `requireTenant()` → validación server-side → una única transacción `withTenant()` que resuelve/crea Contact y crea Opportunity. `organization_id` proviene exclusivamente del `TenantContext`.
  5. **Etapa inicial.** El alta manual de Opportunity nace siempre en `new`. Lo fija el código y lo exige la policy DB de INSERT mediante `stage = 'new'`. El CHECK general de etapas permanece abierto a las etapas aprobadas; las transiciones futuras se gobernarán mediante policies de UPDATE específicas.
  6. **Origen.** El origen permitido es `whatsapp | meta_ads | web | showroom | referral`. `manual` no es un origen comercial.
  7. **Recencia inicial.** `last_activity_at = now()` es una regla temporal exclusivamente para el alta manual H1.2. No define todavía la semántica de imports, conversations o eventos futuros.
  8. **Escrituras.** H1.2 habilita las primeras policies y grants de INSERT sobre `contacts` y `opportunities`, siempre con `WITH CHECK`. UPDATE y DELETE continúan prohibidos. La migración `0003` agrega una postcondición que impide policies de escritura sin `WITH CHECK`.
  9. **Roles.** En P1, cualquier membership activa (`admin` o `seller`) puede crear una oportunidad. No se introduce autorización adicional por rol en H1.2.
  10. **Dependencias.** `libphonenumber-js` permanece server-only. `@radix-ui/react-dialog` se usa únicamente como primitiva accesible para el drawer.
  11. **Relación con decisiones anteriores.** DEC-024 amplía DEC-023 únicamente habilitando alta de `contacts` y `opportunities`; no habilita edición. Respeta DEC-019 al introducir escritura solo para un flujo aprobado. En estos puntos prevalece sobre la Build Baseline conforme a DEC-002.
  12. **Rollout.** `0003_contact_identity_opportunity_create` se aplicará a staging únicamente después del merge mediante `preflight → migrate → verify`.

## DEC-025 — Vehicle persistence foundation
- **Estado:** Aceptada · 2026-10-02
- **Decisión:** H1.3A persiste el inventario mínimo con la migración oficial `0004_vehicles_stock_persistence`:
  1. **Entidad.** `vehicles` es la unidad de inventario y es tenant-scoped según ADR-001 §3.6: `organization_id` NOT NULL, FK a `organizations` con RESTRICT, índice que empieza por `organization_id` y RLS habilitado.
  2. **Cadena de datos.** Se lee con `requireTenant() → withTenant()` más un filtro explícito por `organization_id`. RLS y el filtro son capas complementarias. El loader oficial vive en `db/queries/vehicles.ts`.
  3. **Campos.** `brand`, `model`, `year` y `status` son obligatorios. `version`, `km` y `price`/`currency` son opcionales; un dato ausente se muestra como ausencia explícita (DEC-005).
  4. **Estados.** `in_preparation | available | reserved | sold`, con `text` + CHECK reemplazable, no enum. H1.3A no habilita transiciones.
  5. **Dinero.** Todo dinero persistido en Porandú usa representación decimal exacta con moneda explícita, nunca float. `numeric(14,2)` queda aprobado solo para `vehicles.price`, sin imponer esa precisión a otros dominios monetarios. Precio y moneda siempre van juntos. No hay conversión entre monedas.
  6. **Monedas.** `PYG | USD` es la lista vigente de P1, ampliable por migración; no es el universo definitivo. PYG no admite decimales.
  7. **Orden.** `created_at DESC` es solo el orden técnico inicial y representa el ingreso a Porandú, no la antigüedad física en stock.
  8. **Vendidos.** No se filtran en silencio.
  9. **Sin datos inventados.** No se inventan fotos, matches, demanda ni interesados. Stock solo usa fotos reales cuando exista `vehicle_media`.
  10. **Diferidos.** La entrega (`min_down_payment`) se revisa en H1.3B. El conteo de matches queda para el Match Engine.
  11. **Solo lectura.** H1.3A no tiene INSERT, UPDATE ni DELETE. La postcondición de `0004` solo permite altas en `contacts` y `opportunities`.
  12. **Mocks.** La Stock List no tiene fixtures en runtime y ESLint lo impide.
- **Aclara:** Build Baseline B1 §4 (persistencia de vehículos diferida) y Technical Blueprint §10 (esqueleto de `vehicles`). Prevalece sobre ellos según DEC-002.
- **Consecuencias:** las escrituras futuras de `vehicles` se habilitan con su propio flujo y `WITH CHECK`. `0004` se aplica a staging después del merge con `preflight → migrate → verify`.

## DEC-026 — Stock Surface Architecture
- **Estado:** Aceptada · 2026-10-02
- **Decisión:**
  1. Stock es una superficie inventory-first, no una tabla CRM.
  2. El inventario se presenta agrupado por estado.
  3. El header resume la distribución real del stock con conteos derivados.
  4. La superficie usa un patrón master-detail: lista a la izquierda y contexto persistente a la derecha.
  5. Los vendidos siguen consultables, pero visualmente subordinados al stock operativo.
  6. Stock nunca presenta una representación genérica como si fuera una foto real; la media real llegará con `vehicle_media`.
  7. El panel derecho puede evolucionar hacia fotos reales, compradores potenciales, matches y acciones sin convertir la lista principal en un dashboard.
- **Aclara:** Build Baseline B1 §4 y §6 (Stock como empty state) y Technical Blueprint §6 (pantalla Inventario).
- **Consecuencias:** Stock Surface v0.1 es la baseline visual de `/stock`. Los detalles de presentación (copy, colores, alturas) quedan documentados en el README y pueden ajustarse sin una nueva decisión.

## DEC-027 — Alta rápida de unidades (H1.3B)
- **Estado:** Aceptada · 2026-10-02
- **Decisión:**
  1. **Puerta única.** `createVehicle()` es la única puerta del alta de unidades: `requireTenant()` → validación server-side → `withTenant()` → `INSERT`.
  2. **Organización.** `organization_id` sale solo del `TenantContext`; ningún dato del cliente la elige.
  3. **Estado inicial.** Toda alta nace en `in_preparation`: lo fija la aplicación y lo exige la policy de INSERT (`WITH CHECK ... AND status = 'in_preparation'`). El CHECK general de estados no cambia; las transiciones de estado requerirán un flujo de UPDATE autorizado en un bloque posterior.
  4. **Autorización.** Crear exige una membership activa con rol `admin` o `seller`. Hoy equivale a "membership activa" porque `membership_role` es exactamente `admin | seller`; un rol nuevo exige revisar esta regla.
  5. **Escrituras.** `0005_vehicle_quick_create` habilita únicamente INSERT sobre `vehicles`, con `WITH CHECK`. UPDATE y DELETE sobre vehicles siguen prohibidos en H1.3B.
  6. **Dinero.** Se mantiene DEC-025: decimal exacto, precio y moneda juntos, `PYG | USD`, PYG sin decimales, sin conversión entre monedas.
  7. **Entrega mínima.** `min_down_payment` queda diferida hasta que se defina su semántica.
- **Aclara:** amplía DEC-025 (las escrituras de `vehicles` se habilitan con su propio flujo y `WITH CHECK`). Prevalece sobre la Build Baseline según DEC-002.
- **Consecuencias:** `0005` se aplica a staging después del merge con `preflight → migrate → verify`.

## DEC-028 — Disponibilidad de unidades (H1.3C)
- **Estado:** Aceptada · 2026-10-04
- **Decisión:**
  1. **Transición única.** La única transición de estado habilitada en H1.3C es `in_preparation → available`. Reservar, liberar una reserva, vender o volver a preparación siguen sin habilitar.
  2. **Puerta única.** `markVehicleAvailable()` es la única puerta: `requireTenant()` → validación server-side del id → `withTenant()` → `UPDATE … WHERE id AND organization_id AND status = 'in_preparation'`. El cliente solo identifica la unidad; el destino `available` lo fija el servidor y `organization_id` sale del `TenantContext`. Una unidad inexistente o de otra organización falla como `not_found`; una que ya no está en preparación, como `unchanged`, sin escribir nada.
  3. **Escritura (`0006_vehicle_availability`).** `authenticated` recibe UPDATE solo sobre `vehicles.status` y `vehicles.updated_at` (grant por columna). La policy `vehicles_update_mark_available` exige en `USING` una organización con membership activa y la fila actual en `in_preparation`, y en `WITH CHECK` la misma organización y la fila nueva en `available`. El resto de las columnas, DELETE y los privilegios de `app_runtime` y `anon` siguen prohibidos.
  4. **Autorización.** La misma de DEC-027 §4: membership activa AND role IN (`admin`, `seller`).
  5. **Semántica OR de PostgreSQL.** No se agrega una segunda policy permisiva de UPDATE para habilitar futuras transiciones sin una revisión específica de esa semántica: PostgreSQL combina las policies permisivas de un mismo comando con OR, por separado para `USING` y `WITH CHECK`, y cruzaría orígenes y destinos.
  6. **Próximas transiciones.** Antes de implementar otra transición, se define un mecanismo que valide el par estado anterior → estado nuevo a nivel de base de datos. Se evaluará una policy tenant-scoped única con un trigger de transiciones permitidas.
  7. **Matching.** El resultado `became_available` es el punto de integración futuro con Matching. No se implementan todavía el motor, eventos ni colas.
  8. **Dependencia.** `@radix-ui/react-alert-dialog` queda aprobada como primitiva accesible para la confirmación de acciones con significado comercial.
- **Aclara:** amplía DEC-027 §3 (las transiciones de estado requieren un flujo de UPDATE autorizado) y DEC-025 §4. Prevalece sobre la Build Baseline según DEC-002.
- **Consecuencias:** `0006` se aplica a staging después del merge con `preflight → migrate → verify` (`expected_migrations = 0006_vehicle_availability`).
- **Evidencia de cierre (2026-10-05):** DEC-028 está implementada y validada en staging. H1.3C queda cerrado.
  - PR #22 (`feat/h1-vehicle-availability`) mergeado a `main`; merge commit `39a5ed6f5e32accfa803f15ec6dc8d56f7ca964c`.
  - `0006_vehicle_availability` aplicada en staging.
  - Runtime Acceptance: 12/12.
  - Auth → Tenant Acceptance: 11/11.
  - Staging alineado con `main`; migraciones pendientes: 0.
  - Limpieza de datos sintéticos (synthetic cleanup) correcta.

## DEC-029 — Roadmap Checkpoint H1 y contrato de demanda
- **Estado:** Aceptada · 2026-10-06. Propuesta en el Roadmap Checkpoint H1 y aprobada por el fundador el mismo día, junto con las 20 decisiones de producto que definen H1.4.
- **Decisión:**
  1. **Adquisición de datos.** Las conversaciones (WhatsApp) son una fuente principal de datos comerciales mediante extracción automática; el vendedor confirma, corrige o rechaza y no está obligado a cargar todo. Ratifica MC §9 y §39.
  2. **Capas.** Domain Truth, Source/Evidence, Ingestion y Presentation se separan. El dominio no conoce proveedores (WhatsApp, BSP, LLM).
  3. **H1.4 = contrato de demanda de la oportunidad:** hechos tipados append-only de una lista cerrada, Current Truth derivada por reglas puras y una única operación de ingesta agnóstica de fuente. El vendedor es la única fuente en H1.4. Amplía DEC-023 ("las preferencias estructuradas quedan para Qualification"): la estructura entra en H1.4 y la extracción en Hito 2.
  4. **Estados.** Detectado, Confirmado, Corregido y Rechazado se persisten; Desconocido se deriva. El estado lo deriva el dominio según la fuente. Corregido es el reemplazo humano de una detección automática; un cambio real del cliente es un nuevo Confirmado. Amplía MC §9, VB §2 y BB §3.2.
  5. **Prioridad humana.** Un dato con intervención humana solo cambia por un acto humano. Una detección posterior distinta queda pendiente y nunca se aplica sola. Precisa MC §9.
  6. **Hechos del vehículo** derivados de conversaciones (precio, promociones, ofertas, disponibilidad) son propuestas con aprobación humana, en un dominio propio. No forman parte de H1.4.
  7. **H1.5 = Match v0** determinista, síncrono y explicable, sin jobs ni IA, antes de WhatsApp. Reordena MC §34 y adelanta una fórmula provisoria respecto de DEC-005, que se registra en su propia DEC.
  8. **H1.4 y H1.5** se entregan al piloto como una sola capacidad visible.
  9. **Hito 2 se divide** en H2a (extracción asistida iniciada por el usuario, sobre requireTenant/withTenant) y H2b (Cloud API, que requiere un ADR de identidad de sistema que no satisfaga las policies de miembro).
  10. **Tracks paralelos:** H0.9/E3 + provisioning (gate de piloto), trámites Meta/BSP y validación de la topología de WhatsApp con el piloto.
  11. **Gobernanza:** se crea una baseline de Hito 1 (alcance, DoD, non-goals).
- **Secuencia aprobada:** H1.4 Demand Contract → H1.5 Match v0 → **H1.6 — Opportunity Stages** → H2a assisted extraction → ADR-002 → H2b WhatsApp Cloud API. La etapa H1.6 se aprobó como "H1.6 lifecycle" y se renombra (C-7 de la spec H1.4): son las etapas y los estados terminales de la oportunidad, no el Lifecycle de posventa, que sigue fuera de alcance (CLAUDE.md §2, MC §28).
- **Aclara / supersede:** DEC-023 (intención mínima), MC §9 / VB §2 / BB §3.2 (estados), MC §34 (orden H2/H3), DEC-005 (momento de la fórmula, solo para v0). Prevalece según DEC-002.
- **Precisada por:** DEC-030, en el punto 4: Corregido también reemplaza un valor humano erróneo (C-2).
- **Consecuencias:** el modelo concreto (tabla, policies, grants, postcondiciones) se registra como DEC-030 junto con la spec de H1.4. `interest_model` queda congelado como legado.

## DEC-030 — Demand Contract y Current Truth (H1.4)
- **Estado:** Aceptada · 2026-10-06. Formaliza el H1.4 SPEC FINAL aprobado por el fundador, con los conflictos C-1 a C-14 resueltos según la opción recomendada.
- **Decisión:**
  1. **Contrato de demanda.** Cada Opportunity es dueña de un contrato tipado de 6 facts, en una lista cerrada: agregar un fact requiere migración y DEC. Todos son opcionales; el que no se conoce es Unknown ("Sin dato", DEC-005).
     - `desired_vehicle` `{ brand?, model? }`: al menos uno; un solo vehículo; sin `version` (C-4). Sin catálogo ni normalización de mayúsculas.
     - `year_range` `{ min?, max? }`: al menos un extremo, 1900–2100, `min ≤ max`; el extremo ausente queda abierto.
     - `budget_max` `{ amount, currency }`: precio total máximo del vehículo, `amount > 0`.
     - `purchase_type`: `cash | financed | undecided`. `undecided` ("A definir") es una respuesta, no Unknown.
     - `trade_in_intent`: `true | false`. `false` no es Unknown.
     - `down_payment` `{ amount, currency }`: efectivo inicial, sin el valor del usado; `amount ≥ 0`, y `0` es "Sin entrega inicial" (C-6).
  2. **Ledger append-only.** `opportunity_demand_facts` guarda una fila inmutable por afirmación: nada se actualiza ni se borra. Current Truth no se persiste: la deriva por fact el resolver puro y determinista `resolveDemand()` (`domains/demand`).
  3. **Estados.** Se persisten `detected`, `confirmed`, `corrected` y `rejected`; `unknown` es derivado, con motivo (`never_captured`, `withdrawn`, `dismissed`, `inconsistent`). Máquina → `detected`; humano → `confirmed`, `corrected` o `rejected`. Ninguna transición de máquina produce `confirmed` ni `corrected`.
     - **C-1:** si no hubo ningún acto humano sobre un fact, la detección más reciente (orden de máquina) es el valor vigente provisorio y conserva el estado `detected`. Si hubo un acto humano, las detecciones posteriores no lo reemplazan: a lo sumo quedan pendientes.
     - **C-2:** `corrected` es un humano reemplazando un valor erróneo, sea un valor humano anterior o una detección, con `target` obligatorio. Un cambio real del cliente es un nuevo `confirmed`. Precisa DEC-029 §4.
     - **C-3:** "Quitar" es un `rejected` sobre el valor humano vigente y significa error de carga. La retractación voluntaria del cliente sin reemplazo queda para una evolución posterior.
  4. **Prioridad humana.** Un dato con intervención humana solo cambia por un acto humano.
     - Cadena humana lineal por (oportunidad, fact): `previous_member_fact_id` con dos índices únicos parciales (un solo root y un solo sucesor).
     - Compare-and-set: cada ítem humano lleva el head que vio el usuario (`basedOnHead`). Un 23505 sobre la cadena o un 40P01 → rollback, una sola re-planificación en una transacción nueva y resultado `unchanged` o `stale`. Prohibido `onConflictDoNothing` / `onConflictDoUpdate` en la tabla.
     - Una detección posterior distinta queda pendiente y nunca se aplica sola. Con un pendiente sin resolver, un acto humano sobre ese fact devuelve `pending_unresolved`.
     - Una captura con cualquier ítem `stale`, `pending_unresolved`, `invalid` o `inconsistent` se aborta entera: nada se escribe.
  5. **Ingesta.** Una sola operación agnóstica de la fuente (`DemandCapture` → `planDemandCapture()`). En H1.4 la única fuente implementada es `member`. El cliente nunca envía `status`, `source_kind`, `recorded_by`, `recorded_at`, `organization_id` ni `id`: los deriva el planner o los fija la base.
  6. **Evidencia, fuente y origen.**
     - `evidence_text` opcional, de 1 a 500 caracteres: la "Nota de la edición" del vendedor. Sin conversaciones, mensajes completos, archivos ni fotos.
     - Source (`source_kind` + `recorded_by`) y Origin quedan separados. Origin no se persiste en H1.4 (C-5); el diseño lo admite como columna aditiva.
     - Los logs registran solo `{ name, code, constraint_name }`: nunca valores, notas ni la captura.
     - PII inmutable (C-14): las filas son append-only y H1.4 no tiene redacción de evidencia histórica. Se acepta como limitación conocida.
  7. **Dinero.** `numeric(14,2)` también para la demanda (amplía DEC-025 §5); `PYG | USD`; PYG sin decimales; sin FX ni conversión. Una moneda distinta a la del precio es "sin dato" para Match.
  8. **Puertas de escritura (C-8).** Un único módulo de escritura, `db/queries/demand-facts.ts`, que usan `createOpportunity()` (en la misma transacción del alta) y la Server Action `recordDemand()`. ESLint impide importarlo desde cualquier otro lado. Autorización: membership activa AND role IN (`admin`, `seller`) (DEC-027 §4); cualquier miembro edita la demanda que cargó otro (DEC-023: sin responsable asignado). Validación manual en el dominio, sin Zod (C-10).
  9. **Base de datos (`0007_opportunity_demand_facts`).**
     - `opportunities` recibe `UNIQUE (organization_id, id)`, destino de la FK compuesta de la demanda.
     - FKs RESTRICT: organización; (organización, oportunidad); `target` y `previous` dentro de la misma oportunidad y del mismo fact; `previous` solo hacia un acto humano; `recorded_by` → `profiles` (C-9: dar de baja un usuario es `active = false`; borrar de `auth.users` a un autor con historial falla).
     - CHECKs con nombre y seguros frente a NULL: forma de cada fact, estado y `target`, fuente y estado, autor humano, cadena, auto-referencia y textos (C-12: `brand` ≤ 40, `model` ≤ 80, `evidence_text` ≤ 500, recortados y sin caracteres de control; solo en esta tabla).
     - RLS: SELECT con membership activa; INSERT con membership activa, `source_kind = 'member'`, `status IN ('confirmed', 'corrected', 'rejected')`, `recorded_by = auth.uid()` y `recorded_at = now()`. Sin policies de UPDATE, DELETE ni ALL.
     - Grants, diseño A: `authenticated` recibe SELECT e INSERT de tabla. Drizzle lista todas las columnas en el INSERT, así que un grant por columna sin `id` o `recorded_at` fallaría (42501); lo fijan las pruebas P0, P1 y P2 en PostgreSQL 17. Los valores que no elige el cliente los controla el WITH CHECK.
     - `service_role`: REVOKE de UPDATE, DELETE y TRUNCATE sobre la tabla (C-11). El owner `postgres` es la limitación documentada.
     - Postcondiciones de `0007`: las de `0006`, con la tabla en la allow-list de INSERT, sin policies de UPDATE/DELETE/ALL sobre ella, sin UPDATE de `authenticated` en ninguna de sus columnas y sin UPDATE/DELETE/TRUNCATE de `service_role`.
  10. **UI.**
      - Alta: "Lo que busca" reemplaza a "Modelo buscado" y "Versión" (C-4), con pago, entrega, usado, presupuesto y años opcionales detrás de un disclosure cerrado. Todo se escribe `confirmed` en la transacción del alta.
      - `/opportunities`: resumen "Busca" y edición en un drawer (amplía DEC-017). Solo llega al navegador un resumen por oportunidad: sin evidencia, historial ni ids de usuario.
      - `/opportunities/[id]`: mínima (DEC-017), con Current Truth, estado, explicación, historial append-only, autor ("Vos" / "Otro miembro"), fecha y nota.
      - `interest_model` / `interest_version` quedan congelados como legado de solo lectura: sin backfill, no se escriben más y se muestran solo mientras `desired_vehicle` nunca se cargó.
      - La carga de demanda no modifica `last_activity_at` (amplía DEC-024 §7).
  11. **Match.** H1.5 consume un `DemandSnapshot` por oportunidad: valor, estado y `factId` por fact, sin historial ni evidencia. Rechazados, quitados, descartados e inconsistentes llegan como `unknown`; un pendiente nunca es el valor; el legado nunca se incluye. La fórmula, el peso de `detected` y las monedas distintas los decide H1.5 en su propia DEC.
  12. **Ingesta futura (H2a / H2b).** Solo cambios aditivos: ampliar el CHECK de `source_kind`, una policy INSERT para `detected`, `observed_at`, `origin`, `confidence` / `basis`, `message_id` / `media_id` con FK compuesta, serialización de escritores por (oportunidad, fact), idempotencia por mensaje y una tabla de redacciones. ADR-002 (identidad de sistema) es previa a H2b y esa identidad no puede satisfacer la policy de INSERT de miembros.
- **Aclara / supersede:** DEC-023 (intención mínima: las preferencias estructuradas entran en H1.4), DEC-024 §4 (el alta también escribe la demanda, en la misma transacción, y `recordDemand()` es la segunda puerta sobre el mismo módulo) y §7 (`last_activity_at`), DEC-025 §5 (`numeric(14,2)`), DEC-017 (edición de la demanda en `/opportunities`; `/opportunities/[id]` mínima), MC §9 / VB §2 / B1 §3.2 (se suman Rechazado y Desconocido) y DEC-029 §4 (C-2). Registra el desvío de DEC-009 (C-10: sin Zod). No requiere un ADR nuevo: ADR-001 alcanza. Prevalece según DEC-002.
- **Consecuencias:**
  - `0007_opportunity_demand_facts` se aplica a staging después del merge con `preflight → migrate → verify` (`expected_migrations = 0007_opportunity_demand_facts`).
  - C-13: el commit documental `9da9cc1` (cierre de H1.3C) tiene que estar en `main` antes de dar H1.4 por cerrado.

## DEC-031 — Match v0 Engine y Consumo en Opportunity Workspace (H1.5)
- **Estado:** Aceptada · 2026-10-11. Formaliza las reglas de Match v0 aprobadas por el fundador para H1.5.
- **Contexto:** H1.4 entregó un `DemandSnapshot` determinista sobre el ledger append-only (DEC-030 §11). H1.5 requiere cruzar la demanda con el stock `available` sin introducir colas ni IA (DEC-029 §7).
- **Decisión:**
  1. **Motor.** Determinista, síncrono y puro en `domains/match`: consume el `DemandSnapshot` de `domains/demand` y una interfaz pura `MatchableVehicle` (`id`, `organizationId`, `status`, `brand`, `model`, `year`, `price` con su moneda). No conoce la base, React, Next ni proveedores. API: `evaluateMatch(demand, vehicle)` devuelve el match o `null`; `findMatchesForDemand(demand, vehicles)` devuelve los matches del mayor puntaje al menor.
  2. **Elegibilidad.** Solo participan unidades `available`; cualquier otro estado descalifica. Una marca distinta descalifica.
  3. **Scoring (0 a 100).** Umbral de match: **40 pts**; por debajo no hay match.
     - Vehículo: marca + modelo 45 pts; solo modelo 35 pts; solo marca 35 pts. Marca y modelo se comparan normalizados (sin espacios en los bordes ni mayúsculas). Misma marca con otro modelo, cuando la demanda define los dos, no suma ni descalifica y se explica como modelo alternativo.
     - Año en rango 25 pts: extremos incluidos y el ausente abierto. Fuera de rango, 0 sin descalificar.
     - Precio ≤ presupuesto 30 pts; exceso menor al 10 % 10 pts; exceso del 10 % o más, 0 sin descalificar. Los montos se comparan exactos, nunca como float.
     - Monedas dispares: sin FX, no suman ni descalifican y no generan razón de precio (DEC-025 §5, DEC-030 §7).
     - Un fact Unknown suma 0 y no descalifica (DEC-005). v0 evalúa el valor vigente de cada fact sin ponderar su estado; en H1.4 no hay detecciones.
  4. **Explicabilidad obligatoria.** Todo match lleva `reasons` legibles para el vendedor (es-PY) y el puntaje por dimensión.
  5. **Consumo en Opportunity Workspace.** `/opportunities/[id]` calcula los matches en memoria, en cada lectura, mediante el loader tenant-scoped del detalle: `requireTenant()` → `withTenant()` → unidades de la organización activa con `status = 'available'` (filtro explícito sobre RLS) → `findMatchesForDemand()`. El Vehicle Rail muestra el Top Match y el Alternative Match reales con sus razones. Sin demanda evaluable, sin unidades disponibles o sin matches de 40 pts o más, muestra un estado "sin dato" honesto, nunca fixtures.
  6. **Aislamiento.** Unidades de más de una organización en un mismo lote son un error del llamador y el motor falla cerrado.
  7. **Sin escrituras.** Ni tablas, ni migraciones, ni jobs. Calcular matches no modifica `last_activity_at` ni ningún dato.
- **Aclara / supersede:** DEC-005 (adelanta una fórmula provisoria solo para v0, como prevé DEC-029 §7), DEC-030 §11 (fórmula, peso de `detected` y monedas distintas) y DEC-017 y DEC-030 §10 (`/opportunities/[id]` incorpora el Top Match y la alternativa reales, como matches del detalle). La card "Busca" y el Vehicle Rail de `/opportunities` no cambian en H1.5. Prevalece según DEC-002.
- **Consecuencias:**
  - Cero drift de base de datos en v0: no hay `stock_matches` ni conteo de matches persistido (DEC-025 §10).
  - Explicabilidad inmediata para el vendedor: cada match dice por qué.
  - Los matches quedan desacoplados de una persistencia prematura. Persistirlos, notificarlos o recalcularlos ante `became_available` (DEC-028 §7) requiere una decisión nueva.

## DEC-032 — Opportunity Stages: etapas comerciales y transiciones (H1.6)
- **Estado:** Aceptada en principio · 2026-10-11. Formaliza la especificación de H1.6 del fundador (secuencia de DEC-029): etapas, máquina de estados, motivo de pérdida y UI. Los puntos marcados como *propuesta de implementación* los eligió el equipo dentro de esa especificación y pasan a Aceptada con la aprobación del fundador en la revisión del PR.
- **Contexto:** hasta H1.5 toda oportunidad nacía en `new` (DEC-024 §5) y no podía avanzar: no había UPDATE sobre `opportunities`. H1.6 son las etapas del ciclo comercial de la oportunidad, no el Lifecycle Engine de posventa, que sigue fuera de alcance (DEC-029, CLAUDE.md §2).
- **Decisión:**
  1. **Etapas.** `new` (Nueva: consulta sin calificar), `qualifying` (En calificación: relevando la demanda), `negotiating` (En negociación: propuesta activa), `won` (Ganada: venta concretada) y `lost` (Perdida: descartada). `won` y `lost` son terminales. Reemplazan las etapas de B1 (`qualified`, `test_drive`, `negotiation`): el test drive deja de ser una etapa.
  2. **Máquina de estados** (pura, en `domains/opportunities/stages.ts`):
     - `new → qualifying | lost` · `qualifying → negotiating | lost` · `negotiating → won | lost`.
     - Sin saltos (`new → negotiating` no existe), sin vuelta atrás y sin salida de una etapa terminal, ni entre `won` y `lost`.
     - Pedir la etapa actual es idempotente: `unchanged`, sin escribir.
  3. **Motivo de pérdida.** Pasar a `lost` exige un motivo estructurado de una lista cerrada: `price`, `vehicle_not_available`, `bought_elsewhere`, `no_response`, `unqualified`, `other`. Sin texto libre; `other` es la salida. El motivo existe si y solo si la etapa es `lost` (CHECK) y no se reescribe. *Propuesta de implementación:* la especificación admitía motivo opcional u obligatorio; se eligió obligatorio para que toda pérdida sea analizable.
  4. **Validación en la base (resuelve DEC-028 §6).** *Propuesta de implementación.* La máquina se exige también en PostgreSQL, para que un bug de la aplicación no pueda escribir un pase inválido:
     - Una sola policy de UPDATE tenant-scoped, `opportunities_update_stage` (organización con membership activa en `USING` y `WITH CHECK`). No hay una policy por transición: las policies permisivas de un mismo comando se combinan con OR y cruzarían orígenes y destinos (DEC-028 §5).
     - Un trigger `BEFORE UPDATE FOR EACH ROW`, `opportunities_stage_transition`, que llama a `private.enforce_opportunity_stage_transition()` (invoker, `search_path` vacío, sin EXECUTE para nadie). Valida el par etapa anterior → etapa nueva con la misma matriz del dominio y fija `updated_at = now()`. Rechaza con `23514` y constraint `opportunities_stage_transition`.
     - Toda UPDATE de `opportunities` tiene que ser un pase válido, también la del rol dueño. Un mantenimiento que necesite otra cosa deshabilita el trigger de forma explícita, en una migración revisada.
     - `authenticated` recibe UPDATE solo sobre `stage`, `loss_reason` y `updated_at` (grant por columna). DELETE sigue prohibido.
  5. **Puerta única.** `changeOpportunityStage()` (Server Action): `requireTenant()` → lectura del pedido → `transitionOpportunityStage()` (`withTenant()`, `SELECT … FOR UPDATE`, `planStageChange()` del dominio, `UPDATE … AND stage = <la leída>`) → revalidar `/opportunities` y `/opportunities/[id]`.
     - El cliente solo envía la oportunidad, la etapa de destino y, con `lost`, el motivo. La etapa de origen la lee el servidor de la fila bloqueada; organización, usuario y reloj no salen del pedido.
     - Resultados: `changed`, `unchanged`, `invalid_transition` (con la etapa real), `loss_reason_required`, `invalid`, `not_found` (inexistente o de otra organización, sin distinguir) y `failed`.
     - ESLint impide importar `db/queries/change-opportunity-stage.ts` desde cualquier otro módulo.
     - El bloqueo de la fila serializa pedidos simultáneos: nunca dos pases iguales, nunca una oportunidad ganada y perdida.
  6. **Autorización.** La de DEC-027 §4: membership activa AND role IN (`admin`, `seller`). Cualquier miembro mueve la oportunidad de otro (DEC-023: sin responsable asignado).
  7. **Recencia.** *Propuesta de implementación.* Cambiar de etapa actualiza `stage` y `updated_at`, pero no `last_activity_at`, que mide la interacción con el cliente y no el trabajo del vendedor (como la demanda en DEC-030 §10 y los matches en DEC-031 §7). El orden de la cola no cambia por un cambio de etapa.
  8. **UI.**
     - `/opportunities/[id]` suma el panel "Etapa": un stepper (Nueva › En calificación › En negociación › Ganada) con la etapa actual marcada (`aria-current="step"`) y solo las acciones que la máquina permite desde ella.
     - Avanzar es un click. Ganar y perder abren una confirmación (alertdialog de Radix, DEC-028 §8), porque de una etapa terminal no se vuelve, y perder pide el motivo.
     - Una oportunidad cerrada no ofrece acciones; una perdida muestra su motivo.
     - El encabezado y la card de la cola muestran la etapa con su color: Nueva neutral, En calificación marca, En negociación advertencia, Ganada éxito y Perdida peligro.
     - `Button` suma la variante `danger`, que usa el token `danger`.
  9. **Migración `0008_opportunity_stages`.**
     - Reemplaza el CHECK de `stage`, agrega `loss_reason` con sus dos CHECK, la policy, el trigger, su función y el grant por columna.
     - Precondición: si existe una oportunidad en una etapa que no es `new` (solo un superusuario pudo escribirla), se detiene en vez de reinterpretarla.
     - Postcondiciones: las de `0007`, con las ediciones aprobadas ampliadas a `opportunities.stage`, `loss_reason` y `updated_at`, y la exigencia de que el trigger exista, esté habilitado y sea `BEFORE UPDATE FOR EACH ROW`.
  10. **Fuera de H1.6:**
      - La venta como entidad (DEC-001; TB §6, Flujo C): `won` no crea una venta ni marca una unidad `sold`, porque la oportunidad no tiene una unidad asociada.
      - El historial de etapas (quién y cuándo), reabrir o retroceder una oportunidad, `closed_at`, filtros u ocultamiento de cerradas en la cola, métricas de conversión y el Lifecycle de posventa.
- **Aclara / supersede:**
  - DEC-024 §5: las transiciones no son "policies de UPDATE específicas", sino una policy y un trigger.
  - DEC-028 §6: este es el mecanismo de validación del par anterior → nuevo en la base para `opportunities`.
  - MC §5 (Pipeline) y TB §10 (Estados de lead / pipeline): etapas nuevas, sin Cita/Test Drive como etapa.
  - DEC-017 y DEC-030 §10: `/opportunities/[id]` incorpora el panel de etapa.
  - Prevalece según DEC-002. No requiere un ADR nuevo: ADR-001 alcanza.
- **Consecuencias:**
  - `0008_opportunity_stages` se aplica a staging después del merge con `preflight → migrate → verify`: `expected_migrations = 0008_opportunity_stages` si staging ya tiene `0007`, o `0007_opportunity_demand_facts,0008_opportunity_stages` si no.
  - La verificación de staging suma `schema.opportunity-stages`.
  - Una transición nueva se agrega en la matriz del dominio y en el trigger, con una migración, y el test cruzado de los 25 pares la cubre. Nunca con una segunda policy de UPDATE.

## DEC-033 — Bitácora comercial y unidad vinculada a la negociación (Hito 2)
- **Estado:** Aceptada en principio · 2026-10-11. Formaliza el pedido del fundador para el bloque de Hito 2 "Registro de Actividad Comercial y Vinculación de Stock". Los puntos marcados como *propuesta de implementación* los eligió el equipo dentro de ese pedido y pasan a Aceptada con la aprobación del fundador en la revisión del PR.
- **Contexto:** DEC-017 reserva para `/opportunities/[id]` las notas, el historial y las acciones comerciales profundas. H1.5 muestra el Top Match y la alternativa reales (DEC-031) y H1.6 lleva la oportunidad hasta `negotiating` y `won` (DEC-032). Faltan dos cosas: registrar qué pasó en la negociación y qué unidad del stock se está negociando. DEC-032 §10 dejaba fuera la venta "porque la oportunidad no tiene una unidad asociada".
- **Decisión:**
  1. **Bitácora comercial.** Cada oportunidad tiene una bitácora append-only de notas del vendedor (`opportunity_notes`): una fila inmutable por nota, que nunca se edita ni se borra.
     - Texto libre de 1 a 1000 caracteres. Admite saltos de línea, pero no otros caracteres de control. Se normaliza en el servidor: NFC, `\r\n` → `\n`, espacios repetidos colapsados, a lo sumo una línea en blanco seguida y recortado.
     - Autor y fecha los fija la base: `recorded_by = auth.uid()` y `recorded_at = now()`. La UI muestra "Vos" u "Otro miembro" y la fecha en hora de Asunción, sin ids de usuario.
     - *Propuesta de implementación:* se admiten notas en cualquier etapa, también en las cerradas. Una nota es un registro, no una acción sobre la oportunidad.
  2. **Unidad vinculada.** `opportunities.vehicle_id` (opcional) es la unidad del stock que se negocia.
     - Solo se elige, cambia o quita en `negotiating` o `won`. En `lost` se conserva la que había y ya no cambia. En `new` y `qualifying` no puede existir (CHECK).
     - Tiene que ser de la misma organización (FK compuesta `(organization_id, vehicle_id)` → `vehicles`, RESTRICT), estar `available` y ser un match de la demanda vigente (Match v0, al menos 40 puntos, DEC-031) en el momento de vincularla. El servidor lo vuelve a calcular: no confía en lo que mostró la tarjeta.
     - Vincular no cambia el stock: la unidad sigue `available`, y `won` sigue sin crear una venta ni marcar la unidad `sold` (DEC-032 §10).
     - *Propuesta de implementación:* quitar el vínculo también se permite en `negotiating` y `won`, para corregir un error. Dos pedidos simultáneos se serializan con el bloqueo de la fila: gana el último, sin compare-and-set.
  3. **Validación en la base (amplía DEC-032 §4).** La función del trigger `opportunities_stage_transition` (`private.enforce_opportunity_stage_transition()`, mismo nombre) acepta exactamente dos clases de UPDATE: un pase de etapa válido que no toca la unidad, o un cambio de unidad en `negotiating` o `won` sin pase de etapa. Todo lo demás se rechaza con `23514`:
     - `opportunities_stage_transition`: el pase no existe o la UPDATE no cambia ni etapa ni unidad (como en H1.6).
     - `opportunities_vehicle_link`: cambiar la unidad en otra etapa, o en la misma UPDATE que un pase.
     - Sigue habiendo una sola policy de UPDATE (`opportunities_update_stage`), y el rol dueño tampoco se salta el trigger. `authenticated` recibe además UPDATE sobre `vehicle_id` (grant por columna).
  4. **Puertas únicas.** Dos Server Actions en `lib/opportunities/actions.ts`, cada una con su único módulo de escritura (ESLint impide importarlos desde otro lado):
     - `addOpportunityNote()` → `db/queries/record-opportunity-note.ts`: `requireTenant()` → normalizar y validar → `withTenant()` → la oportunidad en la organización activa → INSERT. Resultados: `recorded`, `invalid` (vacía o demasiado larga), `not_found` y `failed`.
     - `linkOpportunityVehicle()` → `db/queries/link-opportunity-vehicle.ts`: `requireTenant()` → leer el pedido → `withTenant()` → `SELECT … FOR UPDATE` de la oportunidad → la unidad pedida en la organización activa → demanda vigente → `planVehicleLink()` (dominio) → `UPDATE … AND stage = <la leída>` → trigger. Resultados: `linked`, `unlinked`, `unchanged`, `stage_not_allowed`, `vehicle_not_found` (inexistente o de otra organización, sin distinguir), `vehicle_not_available`, `not_a_match`, `invalid`, `not_found` y `failed`.
     - El cliente solo envía la oportunidad y el texto de la nota, o la oportunidad y la unidad (vacía para quitarla). Organización, autor, etapa y reloj no salen del pedido.
  5. **Autorización.** La de DEC-027 §4: membership activa AND role IN (`admin`, `seller`). Cualquier miembro anota o vincula en la oportunidad de otro (DEC-023: sin responsable asignado).
  6. **Recencia.** *Propuesta de implementación:* ni las notas ni el vínculo modifican `last_activity_at`, que mide la interacción con el cliente (como la demanda en DEC-030 §10, los matches en DEC-031 §7 y la etapa en DEC-032 §7). Vincular sí actualiza `updated_at` (lo fija el trigger).
  7. **Migración `0009_opportunity_notes_vehicle_link`.**
     - `vehicles` recibe `UNIQUE (organization_id, id)`, destino de la FK compuesta.
     - `opportunities` recibe `vehicle_id`, su FK compuesta, el CHECK `opportunities_vehicle_stage_check`, un índice parcial `(organization_id, vehicle_id)` y la función del trigger ampliada.
     - `opportunity_notes`: FKs RESTRICT a la organización, a la oportunidad (compuesta) y a `profiles`; CHECK del texto; índice `(organization_id, opportunity_id, recorded_at DESC)`; RLS con SELECT por membership activa e INSERT con membership activa, `recorded_by = auth.uid()` y `recorded_at = now()`; sin policies de UPDATE, DELETE ni ALL.
     - Grants: `authenticated` recibe SELECT e INSERT de tabla sobre `opportunity_notes` (diseño A, como DEC-030 §9) y UPDATE sobre `opportunities.vehicle_id`. `service_role` pierde UPDATE, DELETE y TRUNCATE sobre las notas (C-11). `anon` y `app_runtime` no reciben nada.
     - Postcondiciones: las de `0008`, con `opportunity_notes` entre las altas aprobadas, `opportunities.vehicle_id` entre las ediciones aprobadas y las de un ledger append-only para las notas.
  8. **UI de `/opportunities/[id]`.**
     - Panel "Notas": un formulario con contador de caracteres y la bitácora de la más reciente a la más vieja, con autor y fecha.
     - Las tarjetas de match (Top Match y alternativa) ofrecen "Vincular a la negociación" en `negotiating` y `won`. La unidad vinculada se muestra en una tarjeta propia, con "Quitar vínculo" en esas etapas y de solo lectura en `lost`. En `new` y `qualifying`, el rail avisa desde qué etapa se puede vincular.
     - Un solo click, sin confirmación: vincular es reversible y no tiene efecto económico.
  9. **Fuera de este bloque:**
     - Editar o borrar notas, adjuntos, menciones, tareas, recordatorios y redacción de PII: la limitación C-14 de DEC-030 también aplica a las notas.
     - El historial del vínculo (quién y cuándo), reservar o vender la unidad, y la venta como entidad.
     - Mostrar notas o la unidad en la cola de `/opportunities` y en Stock, y el Lifecycle de posventa.
- **Aclara / supersede:**
  - DEC-029 (secuencia): bloque agregado por el fundador antes de H2a. No reemplaza H2a, ADR-002 ni H2b.
  - DEC-032 §4: "toda UPDATE de `opportunities` tiene que ser un pase válido" pasa a ser "un pase válido o un cambio de unidad en `negotiating` o `won`".
  - DEC-032 §8: una oportunidad ganada ofrece vincular, cambiar o quitar su unidad. Ninguna cerrada ofrece pases de etapa.
  - DEC-032 §10: la oportunidad ya puede tener una unidad asociada, pero `won` sigue sin crear la venta ni marcarla `sold`.
  - DEC-017 y DEC-031 §5 y §7: `/opportunities/[id]` suma la bitácora, y las tarjetas de match ofrecen vincular. Calcular matches sigue sin escribir: vincular es una escritura explícita del vendedor.
  - Prevalece según DEC-002. No requiere un ADR nuevo: ADR-001 alcanza.
- **Consecuencias:**
  - `0009_opportunity_notes_vehicle_link` se aplica a staging después del merge con `preflight → migrate → verify`: `expected_migrations = 0009_opportunity_notes_vehicle_link` si staging ya tiene `0008`, o `0008_opportunity_stages,0009_opportunity_notes_vehicle_link` si no.
  - La verificación de staging suma `schema.opportunity-notes` y amplía `schema.opportunity-stages` con la unidad vinculada.
  - Cuando se habiliten reservar o vender una unidad, ese flujo tiene que considerar las oportunidades que la tienen vinculada: hoy ninguna transición saca una unidad de `available`.

## DEC-034 — Formalización y metadatos de cierre comercial Won/Lost
- **Estado:** Aceptada en principio · 2026-10-11. Formaliza el pedido del fundador "Hito 2A: Registro y formalización del cierre comercial". Los puntos marcados como *propuesta de implementación* los eligió el equipo dentro de ese pedido y pasan a Aceptada con la aprobación del fundador en la revisión del PR.
- **Contexto:** DEC-032 cierra una oportunidad como `won` o `lost` con un único dato, el motivo de pérdida. DEC-033 le asocia la unidad que se negocia. No queda registrado cómo se cerró una venta (precio final, forma de pago, entrega) ni el detalle de una pérdida. El fundador lo llama "Hito 2A"; no es el H2a de DEC-029 §9 (extracción asistida), que sigue pendiente con su alcance. Como DEC-033, es un bloque agregado antes de esa extracción.
- **Decisión:**
  1. **Cerrar es un solo acto.** Pasar a `won` o `lost` escribe la etapa y sus metadatos juntos, en una sola UPDATE y por una puerta dedicada, `closeOpportunity()`. `changeOpportunityStage()` queda para los avances que no cierran (`new → qualifying`, `qualifying → negotiating`) y a un pedido de cierre responde `closure_required`, sin escribir. La máquina de estados no cambia (DEC-032 §2).
  2. **Perdida (`lost`).**
     - `loss_reason`, obligatorio, de una lista cerrada que reemplaza la de DEC-032 §3: `price` (Precio), `vehicle_unavailable` (Unidad no disponible), `competitor` (Compró en la competencia), `financing_rejected` (Financiación rechazada), `ghosted` (Dejó de responder) y `other` (Otro motivo).
     - `loss_notes`, opcional: texto libre de 1 a 500 caracteres, normalizado en el servidor como las notas (DEC-033 §1: NFC, `\r\n` → `\n`, espacios repetidos colapsados, a lo sumo una línea en blanco seguida y recortado). Vacío después de normalizar es "sin notas" (`NULL`).
     - Los dos existen solo con `lost` (CHECK).
  3. **Ganada (`won`).**
     - Exige una unidad vinculada (`vehicle_id`, DEC-033 §2): es la unidad que se vendió.
     - `sale_price` + `sale_currency`: monto final acordado. Mismo contrato de dinero que DEC-025 §5 y §6 y DEC-030 §7: `numeric(14,2)`, `PYG | USD`, PYG sin decimales, mayor que cero, sin FX. Se escribe en formato es-PY y se lee con `parseAmount()` de `domains/money.ts`. No tiene que coincidir con el precio publicado de la unidad, ni en monto ni en moneda: el publicado es una referencia y el de cierre es lo acordado.
     - `payment_method`: `cash` (Contado), `financing` (Financiación), `trade_in` (Usado como parte de pago) o `mixed` (Mixto).
     - `delivery_status` + `delivery_date`, los dos obligatorios. *Propuesta de implementación:* el pedido dice "fecha/estado de entrega"; se eligió `scheduled` (Entrega programada) o `delivered` (Entregada), siempre con una fecha de calendario (`date`, sin hora). Con `delivered`, la fecha no puede ser posterior a hoy; con `scheduled`, no puede ser anterior. "Hoy" es el día de Asunción. La base acota la fecha entre 2000-01-01 y 2100-12-31.
     - Existen si y solo si la etapa es `won` (CHECK).
  4. **Inmutables.** Una vez cerrada, ni la etapa (DEC-032 §2) ni sus metadatos cambian. El pedido admitía editarlos "solo bajo rol owner si está explícitamente permitido": no existe un rol `owner` (`membership_role` es `admin | seller`, DEC-018) y nada lo permite, así que no hay edición, ni siquiera para `admin`. La base la rechaza también para el rol dueño. Corregir un cierre o registrar la entrega efectiva de una venta programada requiere una decisión nueva.
     - La unidad vinculada pasa a formar parte del cierre: se elige, cambia o quita solo en `negotiating`. En `won` queda fija (es la vendida) y en `lost` se conserva como hasta ahora.
  5. **Validación en la base (amplía DEC-032 §4 y DEC-033 §3).** Defensa en profundidad: aunque la aplicación tuviera un bug, ninguna fila queda cerrada sin sus metadatos completos ni los cambia después.
     - CHECKs con nombre y seguros frente a NULL: `opportunities_won_closure_check` (con `won`, unidad, precio, moneda, forma de pago, estado y fecha de entrega presentes; en otra etapa, ausentes los de la venta), `opportunities_loss_reason_stage_check` (sin cambios: motivo si y solo si `lost`), `opportunities_loss_notes_stage_check`, y los de valores: `opportunities_loss_reason_check` (lista nueva), `opportunities_loss_notes_check`, `opportunities_sale_price_check`, `opportunities_sale_currency_check`, `opportunities_payment_method_check`, `opportunities_delivery_status_check` y `opportunities_delivery_date_check`.
     - El trigger `opportunities_stage_transition` (misma función, `private.enforce_opportunity_stage_transition()`) acepta exactamente tres clases de UPDATE: un pase de etapa válido que no toca la unidad, donde los metadatos de cierre solo pueden cambiar si el destino es `won` o `lost`; un cambio de unidad sin pase, solo en `negotiating`; y nada más. Rechaza con `23514`: `opportunities_stage_transition` (como hasta ahora), `opportunities_vehicle_link` (como hasta ahora, ahora también en `won`) y la nueva `opportunities_closure_immutable` (cambiar metadatos de cierre fuera del pase que cierra).
     - Sigue habiendo una sola policy de UPDATE (`opportunities_update_stage`). `authenticated` suma UPDATE por columna sobre `loss_notes`, `sale_price`, `sale_currency`, `payment_method`, `delivery_status` y `delivery_date`.
     - *Propuesta de implementación:* los metadatos son columnas de `opportunities` y no una tabla aparte. Solo así un CHECK de la misma fila garantiza que no hay cierre sin metadatos (con otra tabla, solo un trigger diferido podría), `loss_reason` ya vive ahí (DEC-032) y la venta como entidad sigue fuera de alcance (DEC-032 §10). No hay tabla nueva, así que no hay RLS ni policies nuevas: `opportunities` ya tiene RLS y su única policy de UPDATE, y la unidad de la venta ya es de la misma organización por la FK compuesta `(organization_id, vehicle_id)` → `vehicles` de 0009. Las postcondiciones de 0010 vuelven a exigir las tres cosas.
  6. **Puerta única.** `closeOpportunity()` (Server Action en `lib/opportunities/actions.ts`) → `db/queries/close-opportunity.ts`: `requireTenant()` → leer y validar el pedido → `withTenant()` → `SELECT … FOR UPDATE` de la oportunidad (etapa y unidad) → `planOpportunityClosure()` (dominio) → `UPDATE … AND stage = <la leída> AND vehicle_id = <la leída>` → RLS + CHECKs + trigger → revalidar `/opportunities` y `/opportunities/[id]`.
     - El cliente solo envía la oportunidad, el resultado (`won` o `lost`) y los campos de ese resultado. Etapa de origen, unidad, organización, usuario y reloj no salen del pedido. Los campos del otro resultado se ignoran.
     - Resultados: `closed`, `unchanged` (ya estaba cerrada así: no reescribe los metadatos), `invalid_transition` (con la etapa real; incluye cerrar una ya cerrada con el otro resultado y ganar sin pasar por la negociación), `vehicle_required`, `invalid` (con los errores por campo y lo cargado), `not_found` (inexistente o de otra organización, sin distinguir) y `failed`.
     - ESLint impide importar `db/queries/close-opportunity.ts` desde cualquier otro módulo. El bloqueo de la fila serializa los pedidos: nunca ganada y perdida, nunca dos cierres.
  7. **Validación con Zod.** El pedido de cierre se valida en `domains/opportunities/closure.ts` con Zod (DEC-009), en el servidor siempre y también en el navegador para avisar antes de enviar. Es el primer uso de Zod en el repo: la excepción C-10 de DEC-030 (demanda sin Zod) no cambia. Se agrega la dependencia `zod` (4.6.5).
  8. **Autorización.** La de DEC-027 §4: membership activa AND role IN (`admin`, `seller`). Cualquier miembro cierra la oportunidad de otro (DEC-023: sin responsable asignado).
  9. **Recencia.** Cerrar actualiza `updated_at` (lo fija el trigger) y no `last_activity_at`, como cualquier cambio de etapa (DEC-032 §7).
  10. **Migración `0010_opportunity_closure_metadata`.**
      - Precondición: si existe una oportunidad `won` (no tiene metadatos que cumplan el CHECK) o una `lost` con un motivo que no está en la lista nueva, se detiene en vez de reinterpretarla (como 0008). `price` y `other` existen en las dos listas y pasan.
      - Columnas nuevas, CHECKs, la función del trigger ampliada (`CREATE OR REPLACE`) y el grant por columna.
      - Postcondiciones: las de 0009, con las seis columnas entre las ediciones aprobadas, y además que existan y estén validados los CHECKs de cierre, que la función del trigger contenga la regla de inmutabilidad y que la FK compuesta de la unidad exista.
  11. **UI de `/opportunities/[id]`.**
      - "Marcar como ganada" y "Marcar como perdida" siguen abriendo una confirmación (alertdialog de Radix, DEC-028 §8), ahora con un formulario. Ganada: la unidad que se vende (de solo lectura), precio final y moneda, forma de pago, estado y fecha de entrega; sin unidad vinculada, avisa que hay que vincularla y no ofrece confirmar. Perdida: motivo y notas opcionales, con contador. Los errores se muestran por campo, con lo cargado.
      - Una oportunidad cerrada muestra una tarjeta "Cierre" con su resultado y sus metadatos.
  12. **Fuera de este bloque:** la venta como entidad, marcar la unidad `sold` o reservarla (la unidad sigue `available`, DEC-032 §10 y DEC-033 §2), editar o corregir un cierre, registrar la entrega efectiva, reabrir, quién y cuándo cerró (más allá de `updated_at`), mostrar el cierre en la cola o en Stock, métricas de conversión, comisiones, documentos de la venta, Offer Builder y el Lifecycle de posventa.
- **Aclara / supersede:**
  - DEC-032 §3: nueva lista de motivos de pérdida; "sin texto libre" pasa a admitir `loss_notes` opcionales.
  - DEC-032 §4 y §5: los cierres salen de `changeOpportunityStage()` y pasan por `closeOpportunity()`. El trigger también valida los metadatos de cierre.
  - DEC-032 §8: la confirmación de un cierre captura sus metadatos y la oportunidad cerrada muestra su resumen.
  - DEC-033 §2, §3 y §8: la unidad vinculada se elige, cambia o quita solo en `negotiating`; una oportunidad ganada ya no ofrece cambiarla ni quitarla.
  - DEC-030 §8 (C-10): el cierre se valida con Zod; la demanda sigue sin Zod.
  - DEC-029 §9: "Hito 2A" nombra este bloque, no la extracción asistida (H2a).
  - Prevalece según DEC-002. No requiere un ADR nuevo: ADR-001 alcanza.
- **Consecuencias:**
  - `0010_opportunity_closure_metadata` se aplica a staging después del merge con `preflight → migrate → verify`: `expected_migrations = 0010_opportunity_closure_metadata` si staging ya tiene `0009`, o la lista desde la primera pendiente si no.
  - La verificación de staging amplía `schema.opportunity-stages` con los CHECKs de cierre y la regla de inmutabilidad, y la lista de columnas que `authenticated` puede actualizar.
  - Cuando se habilite la venta como entidad o vender la unidad, nace de una oportunidad `won` y sus metadatos: no se vuelven a cargar.

## DEC-035 — Motor de Scoring, Recency y NBA
- **Estado:** Aceptada en principio · 2026-10-12. Formaliza el pedido del fundador "Hito 3: Motor de Inteligencia, Recency y Next Best Action (NBA)". Los puntos marcados como *propuesta de implementación* los eligió el equipo dentro de ese pedido y pasan a Aceptada con la aprobación del fundador en la revisión del PR.
- **Contexto:** DEC-004 fija cuatro scores explicables y deja su fórmula conceptual; DEC-005 posterga la fórmula concreta a Hito 3. Hasta acá la cola de `/opportunities` mostraba el Porandú Ring, los sub-scores y "¿Qué hacer?" como "sin dato" (DEC-023), aunque ya existen las señales para derivarlos: la etapa (DEC-032), la unidad vinculada y la bitácora (DEC-033), Match v0 (DEC-031) y `last_activity_at` (DEC-024 §7). El fundador llama a este bloque "Hito 3": no es el Hito 3 del Master Context §34 (Match Engine, que DEC-029 adelantó como H1.5) y adelanta la NBA, que el MC §34 ubicaba en Hito 4.
- **Decisión:**
  1. **Motor puro y estado derivado.** `domains/scoring/engine.ts` calcula, por oportunidad y con un `now` explícito, la recencia, el Porandú Score con su explicación y la Next Best Action. Determinista, síncrono y sin IA; no conoce la base, React ni Next. Nada se persiste: ni scores, ni recencia, ni NBA, ni matches. Sin tablas, migraciones, jobs ni colas, así que no hay nada que pueda desincronizarse de los hechos.
  2. **Recencia.** Días desde `last_activity_at`, a precisión de minuto:
     - `active` (Activa): menos de 2 días;
     - `warning` (Enfriándose): de 2 a 5 días, extremos incluidos;
     - `stale` (Inactiva): más de 5 días.
     - Una fecha futura (reloj desfasado) cuenta como 0. Una fecha inválida falla en vez de inventar un estado.
     - Complementa, no reemplaza, las bandas en minutos de B1 §3.2 y MC §12 (🔥 🟢 🟡 ❄️) ni la urgencia temporal de la cola (`bucketFromRecency()`).
  3. **Porandú Score v0.** *Propuesta de implementación:* el "Health Score (0–100)" del pedido es el Porandú Score de DEC-004, no un quinto score. Se compone de sus sub-scores:
     - **Intent:** sin dato en v0. Sus señales (MC §10: respuestas recientes, timing, cuota, visita) llegan con las conversaciones (H2a/H2b).
     - **Vehicle Fit** (match de la demanda): una unidad vinculada (`vehicle_id`) vale 100; si no, el puntaje del Top Match v0 contra el stock disponible (40 a 100); si ninguna unidad disponible llega al umbral, 0 ("no coincide"). Sin demanda evaluable o sin unidades disponibles es sin dato (DEC-005).
     - **Deal Readiness** (progreso en el embudo): la base de la etapa. `new` 20, `qualifying` 45, `negotiating` 75, `won` 100, `lost` 0.
     - **Base:** el promedio ponderado de los sub-scores conocidos con la composición del MC §10 (Intent 40 %, Vehicle Fit 30 %, Deal Readiness 30 %). Un sub-score sin dato no penaliza; la cobertura es la suma de los pesos evaluados (hoy, a lo sumo 60 %). Se calcula con pesos enteros para que el redondeo sea exacto (87,5 → 88).
     - **Penalización por recencia:** Enfriándose −15, Inactiva −40. El resultado se redondea y se acota entre 0 y 100.
     - **Etapas terminales:** el resultado ya se conoce. Ganada vale 100 y Perdida 0, sin penalización.
     - **Explicabilidad:** cada score lleva el motivo de cada sub-score, las penalizaciones aplicadas y, si está cerrada, su resultado.
     - Los pesos, las bases por etapa y las penalizaciones son provisorios y se recalibran con datos del piloto (DEC-004).
  4. **Composición como dato.** La composición que dibujan el Porandú Ring y el desglose (DEC-015) es la del motor (`PORANDU_SCORE_COMPOSITION`): la misma con que se calcula la base.
  5. **Next Best Action.** Reglas en orden de prioridad. La primera que se cumple es la acción primaria y las dos siguientes que se cumplen, las secundarias (MC §10: 1 primaria y hasta 2 secundarias, con qué hacer y por qué):
     1. `recover_stale`: Inactiva → "Retomar contacto urgente", con los días sin actividad y el riesgo de pérdida. Es la única urgente.
     2. `link_vehicle`: En negociación sin unidad vinculada → "Vincular unidad de stock". El porqué dice qué ofrece el stock: el puntaje del Top Match, que ninguna unidad coincide, que falta cargar lo que busca o que no hay unidades disponibles.
     3. `log_contact_update`: sin notas en la bitácora o con la última de hace 2 días o más → "Registrar actualización de contacto".
     4. *Propuesta de implementación:* `follow_up`: Enfriándose → "Hacer seguimiento".
     5. *Propuesta de implementación:* `on_track`: si no se cumple ninguna → "Sostener el seguimiento" ("Actividad y bitácora al día").
     - Una oportunidad cerrada (Ganada o Perdida) no tiene NBA.
     - Ninguna sugerencia cambia condiciones económicas: ninguna requiere aprobación ni ejecuta nada. "Marcar como hecha" sigue siendo estado simulado en el cliente (DEC-015).
  6. **Consumo en la cola de `/opportunities`.** *Propuesta de implementación:* el pedido admitía la cola o el loader del detalle; se eligió la cola, porque DEC-017 ubica ahí los scores, la NBA y la recencia, y `/opportunities/[id]` no los repite.
     - `getOpportunityQueue()` (`db/queries/opportunities.ts`) sigue la cadena `requireTenant()` → `withTenant()`. En la misma transacción, con filtro explícito por organización sobre RLS, lee la cola (ahora con `vehicle_id`), el ledger de demanda, una sola vez las unidades disponibles de la organización activa (`selectMatchCandidates()`) y la nota más reciente de cada oportunidad (`selectLastNoteTimes()`: `max(recorded_at)` agrupado, sin texto ni autor).
     - El motor corre en memoria por oportunidad. De Match v0 solo se usa el puntaje del Top Match: la cola no muestra tarjetas de match.
     - Calcular no escribe nada: ni `last_activity_at`, ni `updated_at`, ni notas, ni stock.
  7. **UI de `/opportunities`** (columna "Decisión" de DEC-015):
     - El strip muestra el Porandú Score real con su anillo, la cobertura, la penalización ("Inactividad −40") y la lectura del motor para Vehicle Fit y Deal Readiness. Intent sigue con la escala del Visual Blueprint §3 ("Sin dato").
     - El desglose (tooltip del anillo, también en la cola) muestra cada sub-score con su peso, valor y motivo, las penalizaciones y el resultado.
     - "¿Qué hacer?" muestra la NBA real con su porqué y sus secundarias, y un indicador de recencia con texto y color semántico: verde Activa, ámbar Enfriándose, rojo Inactiva. Una NBA urgente se destaca en rojo. Las secundarias solo aparecen si existen.
     - Dentro de cada grupo de la cola, el orden por Porandú Score (`groupQueue()`) pasa a usar el score real.
  8. **Fuera de este bloque:** persistir scores o snapshots, recalcular por jobs o eventos, Intent desde conversaciones, los drivers de "¿Por qué ahora?", reemplazar la urgencia de la cola (`bucketFromRecency()`), matches en la cola o en Stock, ejecutar la NBA desde la tarjeta, notificaciones, Cockpit, el módulo Intelligence, IA y todo lo listado como futuro (CLAUDE.md §2).
- **Aclara / supersede:**
  - DEC-004 y DEC-005: la fórmula v0 concreta es la de §3. Sigue siendo provisoria y explicable.
  - DEC-015: la composición del anillo deja de ser un valor de mock y pasa a ser la del motor.
  - DEC-023 ("sin outputs inventados"): el Porandú Score, sus sub-scores y la NBA dejan de ser "sin dato" porque ahora los deriva un motor aprobado. Siguen sin persistirse. Las señales de Why Now, el trade-in y la conversación en vivo siguen sin dato.
  - DEC-031 §5 y su "fuera de H1.5" (matches en la cola): la cola calcula Match v0 solo para Vehicle Fit, sin mostrar matches.
  - B1 §4 ("cálculo real de scores… desde fixtures"): el cálculo real entra en la cola. Los fixtures siguen como referencia de tests.
  - MC §34 y DEC-029 (secuencia): bloque agregado por el fundador como "Hito 3". No reemplaza H2a, ADR-002 ni H2b, y adelanta la NBA del Hito 4 del MC.
  - Prevalece según DEC-002. No requiere un ADR nuevo: no hay datos nuevos ni accesos nuevos, y ADR-001 alcanza.
- **Consecuencias:**
  - Cero drift de base de datos: no hay migración ni paso de staging.
  - **`last_activity_at` todavía no se mueve después del alta.** Ni la demanda, ni la etapa, ni las notas, ni la unidad vinculada lo modifican (DEC-030 §10, DEC-032 §7, DEC-033 §6). Con la regla de §2, toda oportunidad abierta pasa a Enfriándose a los 2 días de creada y a Inactiva a los 5, aunque el vendedor anote todos los días: −40 y "Retomar contacto urgente". Se corrige cuando las conversaciones (H2a/H2b) actualicen `last_activity_at`, o antes con una decisión nueva que defina qué acto del vendedor cuenta como interacción con el cliente. Esta DEC no reinterpreta DEC-033 §6.
  - Intent queda sin dato y la cobertura nunca supera 60 % hasta que haya conversaciones.
  - La cola lee el stock disponible una vez por request y evalúa Match v0 contra cada oportunidad en memoria (O(oportunidades × unidades)). Si el volumen del piloto lo exige, se revisa con una decisión nueva (índices, límites o materialización).

## DEC-036 — Módulo de Conversaciones y Actualización Automática de Actividad
- **Estado:** Aceptada en principio · 2026-10-13. Formaliza el pedido del fundador "Hito 4: Módulo de Conversaciones y Tracking de Actividad (CRM WhatsApp)". Los puntos marcados como *propuesta de implementación* los eligió el equipo dentro de ese pedido y pasan a Aceptada con la aprobación del fundador en la revisión del PR.
- **Contexto:** DEC-035 dejó documentado que `last_activity_at` no se mueve después del alta: toda oportunidad abierta pasa a Enfriándose a los 2 días y a Inactiva a los 5, aunque el vendedor anote todos los días. Tampoco hay dónde registrar los mensajes que se cruzan con el cliente. El fundador decide que toda interacción real "toque" la oportunidad y pide la estructura base de las conversaciones. Lo llama "Hito 4": no es el Hito 4 del Master Context §34 (Reactivación + Agenda) ni el H2a/H2b de DEC-029 §9. No hay integración con WhatsApp: los mensajes los registra un miembro.
- **Decisión:**
  1. **Recencia.** `last_activity_at` es la última interacción registrada con el cliente: el alta de la oportunidad (DEC-024 §7), una nota de la bitácora o un mensaje asociado a la oportunidad. La demanda, la etapa, el cierre, la unidad vinculada y los matches siguen sin moverla (DEC-030 §10, DEC-032 §7, DEC-034 §9, DEC-033 §6, DEC-031 §7).
     - La mueve la base, no la aplicación: un trigger `AFTER INSERT FOR EACH ROW` sobre `opportunity_notes` y otro sobre `messages` llaman a `private.touch_opportunity_activity()`. Ninguna puerta de escritura, presente o futura (H2a/H2b), puede olvidarse de tocarla.
     - El valor es `now()`, el mismo reloj de `recorded_at` y `created_at`. Solo avanza (`WHERE last_activity_at < now()`): dos registros en la misma transacción tocan una vez, y una transacción más vieja no la hace retroceder.
     - *Propuesta de implementación:* un mensaje sin oportunidad no toca ninguna, tampoco las demás oportunidades del contacto.
     - *Propuesta de implementación:* toca en cualquier etapa, también en una cerrada, porque un registro es un registro (DEC-033 §1). `last_activity_at` no es un metadato del cierre (DEC-034 §4).
     - *Propuesta de implementación:* el toque no cambia `updated_at`. `updated_at` es la última edición de la oportunidad (etapa, unidad, cierre) y `last_activity_at`, la última interacción.
  2. **Función del toque.** `private.touch_opportunity_activity()` es `SECURITY DEFINER` (owner `postgres`), con `search_path = ''` y sin EXECUTE para nadie. Vive en `private`: ADR-001 §3.6 prohíbe `SECURITY DEFINER` solo en `public`, y `private.user_org_ids()` es el precedente.
     - Corre como dueño porque `authenticated` no tiene ni recibe UPDATE sobre `last_activity_at`. El toque no abre una edición nueva para los miembros.
     - Solo actualiza la oportunidad de la fila recién insertada (`organization_id` y `opportunity_id` de `NEW`). Esa fila ya pasó la policy de INSERT (membership activa) y la FK compuesta, así que no puede cruzar organizaciones.
  3. **Trigger de la oportunidad (amplía DEC-032 §4, DEC-033 §3 y DEC-034 §5).** `private.enforce_opportunity_stage_transition()` (misma función, mismo trigger) acepta una cuarta clase de UPDATE: el toque de actividad. Solo cambia `last_activity_at`, avanza, vale `now()` y viene del trigger de actividad (`pg_trigger_depth() > 1`).
     - Un UPDATE directo de `last_activity_at`, también del rol dueño, se rechaza con `23514` y la constraint nueva `opportunities_activity_touch`. Lo mismo pasa con un pase de etapa o un cambio de unidad que la toque.
     - Sigue habiendo una sola policy de UPDATE y los grants de `opportunities` no cambian.
  4. **Mensajes (`messages`).** Una fila inmutable por mensaje registrado.
     - `organization_id` es el `tenant_id` del pedido: la columna de tenant de todo el schema (ADR-001 §3.6, DEC-011). Las invariantes de catálogo y las postcondiciones la reconocen por ese nombre, y otro nombre las salteaba.
     - `contact_id` es obligatorio: con quién es el mensaje.
     - `opportunity_id` es opcional: el negocio al que se asocia.
     - `channel` admite `whatsapp`, `email` o `manual`, y `direction` admite `inbound` (recibido del cliente) u `outbound` (enviado al cliente). Las dos usan `text` + CHECK reemplazable, como `stage` y `source` (DEC-023), y no un enum de Postgres.
     - `content` tiene de 1 a 4096 caracteres y se normaliza como las notas (DEC-033 §1). 4096 es el máximo de un mensaje de texto de WhatsApp.
     - `created_at` lo pone el reloj de la base (la policy exige `now()`).
     - *Propuesta de implementación:* `recorded_by` es el miembro que registró el mensaje, con FK RESTRICT a `profiles`, como la bitácora y la demanda. La policy exige `auth.uid()`. El pedido fijaba campos mínimos y este agrega la autoría.
     - FKs compuestas RESTRICT: `(organization_id, contact_id)` → `contacts` y `(organization_id, opportunity_id, contact_id)` → `opportunities (organization_id, id, contact_id)`, sobre una unique nueva. Un mensaje asociado a una oportunidad es siempre con su contacto y de la misma organización. Sin oportunidad, la segunda FK no aplica (`MATCH SIMPLE`).
     - Índices `(organization_id, opportunity_id, created_at DESC)` para el muro y `(organization_id, contact_id, created_at DESC)` para la FK y la conversación del contacto.
     - En el Hito 4 la única fuente es el miembro que registra un mensaje recibido o enviado. `channel = 'whatsapp'` dice por dónde ocurrió, no que haya integración. Registrar un mensaje "enviado" no envía nada: no hay acción económica ni irreversible (CLAUDE.md §2).
  5. **Inmutables (RLS).**
     - SELECT con membership activa. INSERT con membership activa, `recorded_by = auth.uid()` y `created_at = now()`.
     - Sin policies de UPDATE, DELETE ni ALL. `authenticated` recibe SELECT e INSERT de tabla (diseño A, DEC-030 §9).
     - `service_role` no tiene UPDATE, DELETE ni TRUNCATE (C-11). `anon` y `app_runtime` no reciben nada.
     - La limitación C-14 (PII inmutable, sin redacción) también aplica.
  6. **Puerta única.** La Server Action `addMessage()` (`lib/conversations/actions.ts`) escribe por `db/queries/record-message.ts`, y ESLint impide importar ese módulo desde otro lado: `requireTenant()` → leer y validar el pedido → `withTenant()` → la oportunidad en la organización activa (de ahí sale el contacto) → INSERT → RLS + FKs + CHECKs → trigger de actividad → revalidar `/opportunities` y `/opportunities/[id]`.
     - El cliente solo envía la oportunidad, el canal, la dirección y el texto. Organización, contacto, autor y reloj no salen del pedido.
     - Resultados: `recorded`, `invalid` (errores por campo y lo cargado), `not_found` (inexistente o de otra organización, sin distinguir) y `failed`.
     - *Propuesta de implementación:* en el Hito 4 la única entrada es el Opportunity Workspace. El schema admite mensajes sin oportunidad (la futura superficie Conversations y la ingesta de H2b), pero no hay una acción para registrarlos.
  7. **Validación con Zod.** El pedido se valida en `domains/conversations` con Zod (DEC-009), en el servidor siempre y en el navegador para avisar antes de enviar. Es el segundo uso, después de DEC-034 §7.
  8. **Autorización.** La de DEC-027 §4: membership activa AND role IN (`admin`, `seller`). Cualquier miembro registra mensajes en la oportunidad de otro (DEC-023: sin responsable asignado).
  9. **Notas.** `addOpportunityNote()` no cambia de forma. Como una nota ahora mueve la recencia y el orden de la cola, revalida también `/opportunities`.
  10. **Migración `0011_conversations_and_activity_trigger`.**
      - `opportunities` recibe la unique `(organization_id, id, contact_id)`, destino de la FK compuesta de los mensajes.
      - La tabla `messages` llega con sus FKs, CHECKs, índices, RLS, policies y grants. También la función del toque, los dos triggers y la función del trigger de la oportunidad ampliada (`CREATE OR REPLACE`).
      - Postcondiciones: las de 0010, con `messages` entre las altas aprobadas y entre los ledgers append-only. Además, la función del toque es `SECURITY DEFINER` de `postgres`, con `search_path` vacío y sin EXECUTE para nadie. Los dos triggers existen, están habilitados y son `AFTER INSERT FOR EACH ROW`, y la función del trigger de la oportunidad contiene la regla del toque.
      - No toca ninguna fila existente: no hay backfill de `last_activity_at` desde las notas que ya existen.
  11. **UI de `/opportunities/[id]`.** El panel "Notas" pasa a ser "Actividad": un muro que combina notas y mensajes, del registro más reciente al más viejo (el orden de la bitácora, DEC-033 §8).
      - Cada entrada muestra su tipo ("Nota", "Mensaje recibido" o "Mensaje enviado", con el canal), el autor ("Vos" u "Otro miembro") y la fecha de Asunción.
      - La combinación es una función pura del dominio, con desempate determinista.
      - Arriba, un selector "Nota / Mensaje" elige qué se registra. El mensaje lleva canal, dirección, texto y contador.
  12. **Fuera de este bloque:**
      - Enviar o recibir por WhatsApp o email (webhooks, Cloud API, BSP: H2b, previa ADR-002), la extracción asistida (H2a) e IA.
      - La superficie `/conversations` (inbox), registrar mensajes sin oportunidad, adjuntos y media, plantillas, estados de entrega o lectura, y editar o borrar mensajes.
      - Intent desde conversaciones (sigue sin dato, DEC-035 §3) y que la NBA `log_contact_update` cuente mensajes además de notas (DEC-035 §5).
      - Porandú Memory, notificaciones, omnicanalidad y todo lo listado como futuro (CLAUDE.md §2).
- **Aclara / supersede:**
  - DEC-033 §6: una nota sí modifica `last_activity_at`, por el trigger. La unidad vinculada sigue sin modificarla.
  - DEC-024 §7: `last_activity_at = now()` ya no es solo la regla del alta manual. También la fijan las notas y los mensajes.
  - DEC-035, Consecuencias: corrige "`last_activity_at` todavía no se mueve después del alta" con la decisión nueva que esa DEC preveía.
  - DEC-032 §4, DEC-033 §3 y DEC-034 §5: el trigger de la oportunidad admite el toque de actividad como cuarta clase de UPDATE.
  - DEC-017: `/opportunities/[id]` suma la conversación (ya prevista entre sus profundidades) en el mismo muro que la bitácora.
  - DEC-029 (secuencia) y MC §34: bloque agregado por el fundador como "Hito 4". No reemplaza H2a, ADR-002 ni H2b. `messages` es la tabla que DEC-030 §12 prevé referenciar con `message_id`.
  - DEC-001: la ruta Conversations sigue como placeholder.
  - Prevalece según DEC-002. No requiere un ADR nuevo: la función `SECURITY DEFINER` vive en `private` y cumple ADR-001 §3.6.
- **Consecuencias:**
  - `0011_conversations_and_activity_trigger` se aplica a staging después del merge con `preflight → migrate → verify`: `expected_migrations = 0011_conversations_and_activity_trigger` si staging ya tiene `0010`, o con las anteriores que falten delante, en orden.
  - La verificación de staging suma `schema.messages` y `schema.activity-touch` y amplía `schema.opportunity-stages` con la regla del toque.
  - Una oportunidad con notas o mensajes recientes queda Activa y sube en la cola. Las penalizaciones de recencia de DEC-035 reflejan la interacción registrada.
  - La ingesta de H2b escribirá en `messages` con la identidad de sistema de ADR-002, que no puede satisfacer la policy de INSERT de miembros. El trigger tocará la oportunidad sin cambios.

## DEC-037 — Dashboard Directivo y Agregación de Métricas
- **Estado:** Aceptada en principio · 2026-10-14. Formaliza el pedido del fundador "Hito 5: Dashboard Directivo y Métricas en Tiempo Real" y sus respuestas del mismo día sobre la ruta, la dirección visual y la clasificación del inventario. Los puntos marcados como *propuesta de implementación* los eligió el equipo dentro de ese pedido y pasan a Aceptada con la aprobación del fundador en la revisión del PR.
- **Contexto:** la gerencia no tiene una vista agregada del negocio: para saber cuántas oportunidades hay abiertas, cuántas se ganaron en el mes o qué unidades están comprometidas, hay que recorrer la cola y el stock. Los datos ya existen en las tablas transaccionales: etapas y cierres (DEC-032, DEC-034), la unidad vinculada (DEC-033) y la recencia (DEC-035, DEC-036). DEC-032 §10 y DEC-034 §12 dejaron las métricas de conversión fuera de esos bloques, y `/intelligence` es un empty state desde B1 (DEC-001). El fundador lo llama "Hito 5": no es el Hito 5 del TB §15 (venta, atribución y Trade-In Loop), aunque adelanta una parte de su "dashboard mínimo de impacto".
- **Decisión:**
  1. **Ruta.** El Dashboard Directivo vive en `/intelligence` ("Inteligencia", DEC-001), la ruta que hoy muestra el empty state de B1. `/` sigue redirigiendo a `/cockpit` y el login sigue aterrizando ahí (DEC-020): el Action Cockpit sigue siendo el home action-first (MC §7 y §39, TB §17). No se agrega `/dashboard` ni un ítem de navegación. Decisión del fundador (2026-10-14).
  2. **Dirección visual.** DEC-013 sin cambios (decisión del fundador, 2026-10-14): workspace claro, paneles blancos, tokens de `components/ui/tokens.css` y colores de estado solo junto a un texto. Sin glassmorphism ni dark mode.
  3. **Tiempo real = cálculo en cada lectura.** Como pide el fundador, las métricas se calculan leyendo las tablas transaccionales: se agregan en PostgreSQL en cada request, sobre `opportunities`, `vehicles` y `contacts`. No hay tablas de métricas, snapshots, vistas materializadas, jobs ni cachés. Nada se persiste, así que no hay nada que pueda desincronizarse de los hechos (como DEC-031 y DEC-035).
     - *Propuesta de implementación:* cada carga de la página refleja el último dato confirmado, pero la página no se actualiza sola. No hay suscripciones ni refresco automático.
  4. **Período.** *Propuesta de implementación* (el pedido dice "mes en curso" sin precisar zona ni a qué métricas aplica):
     - "Mes en curso" es el mes calendario de Asunción (`America/Asuncion`, la zona de presentación de P1) que contiene `now`: desde el primer instante del día 1 (incluido) hasta el primer instante del día 1 del mes siguiente (excluido). Lo calcula el dominio puro (`monthWindow()`, `domains/dashboard/period.ts`) con `now` explícito, y la base solo compara instantes. Si una medianoche no existió por un cambio de horario, el mes empieza en el cambio.
     - El período aplica a lo que ocurre en el tiempo: ganadas, perdidas, win rate y unidades vendidas.
     - Las existencias son el estado actual, no del mes: oportunidades activas, unidades en stock y reservadas, y atención. Una oportunidad activa nacida en un mes anterior cuenta, porque sigue abierta hoy.
  5. **Fecha de cierre.** *Propuesta de implementación.* No existe `closed_at` (DEC-032 §10, DEC-034 §12). La fecha de cierre de una oportunidad `won` o `lost` es su `updated_at`:
     - el trigger lo fija en el UPDATE que la cierra (DEC-034 §9);
     - después no vuelve a cambiar, porque una oportunidad cerrada solo admite el toque de actividad (DEC-034 §4 y §5, DEC-036 §3) y el toque no cambia `updated_at` (DEC-036 §1).
     - Esto convierte la *propuesta de implementación* de DEC-036 §1 ("el toque no cambia `updated_at`") en un requisito del dashboard: cambiarla exige agregar antes `closed_at`.
     - Si una decisión futura habilita editar una oportunidad cerrada (corregir un cierre, registrar la entrega efectiva), primero tiene que agregar `closed_at`, o el dashboard movería esa oportunidad de mes.
  6. **Pipeline comercial.**
     - *Oportunidades activas:* las abiertas hoy (`new`, `qualifying` y `negotiating`), sin importar cuándo nacieron.
     - *Ganadas en el mes:* `won` con cierre en el mes.
     - *Win rate:* ganadas / (ganadas + perdidas) con cierre en el mes, en porcentaje con un decimal y redondeo exacto sobre enteros. *Propuesta de implementación:* se mide sobre las cerradas, porque una abierta todavía no ganó ni perdió. Sin cierres en el mes es "Sin dato" (DEC-005), nunca 0 %.
  7. **Salud del inventario.** Clasificación del fundador (2026-10-14): "un vehículo se cuenta como Vendido si está vinculado a una oportunidad cerrada con estado Ganada (Won). Los vehículos vinculados a oportunidades en Negociación están Reservados, y el resto está En Stock." Se deriva de las oportunidades que tienen vinculada cada unidad (`vehicle_id`, DEC-033):
     - *Vendida:* vinculada a una oportunidad `won` (la unidad vinculada es la vendida, DEC-034 §3).
     - *Reservada:* vinculada a una oportunidad `negotiating`.
     - *En stock:* el resto, incluidas las unidades en preparación y las vinculadas solo a oportunidades perdidas.
     - `vehicles.status` no se consulta. Ninguna puerta escribe `reserved` ni `sold` (DEC-028 §1, DEC-034 §12), y la clasificación no cambia ni escribe el estado de la unidad: la Stock List (DEC-026) sigue mostrando `vehicles.status`.
     - *Propuesta de implementación:* si la misma unidad está vinculada a varias oportunidades (nada lo impide, DEC-033 §2), vendida tiene precedencia sobre reservada, y cada unidad está en una sola categoría.
     - *Propuesta de implementación:* el indicador "Vendidas en el mes" cuenta las unidades cuya oportunidad ganada se cerró en el mes (§4). "En stock" y "Reservadas" son el estado actual. Una unidad vendida en un mes anterior no vuelve al stock ni aparece en ningún indicador del mes, así que los tres indicadores no suman el total de unidades.
  8. **Atención (recencia).** Cuántas oportunidades abiertas están Enfriándose y cuántas Inactivas, con la regla de DEC-035 §2. Las cerradas no cuentan: no tienen NBA ni penalización (DEC-035 §3 y §5).
     - La base cuenta con dos instantes de corte que el dominio deriva de la misma regla (`recencyCutoffs()`, junto a `recencyState()` en `domains/scoring/engine.ts`): Enfriándose desde 2 días exactos, Inactiva desde 5 días y 1 minuto. El umbral no se repite en SQL.
     - Los cortes son límites exclusivos, un milisegundo después del borde. `last_activity_at` guarda microsegundos (`now()`), y el motor ve la fecha truncada al milisegundo: comparar `last_activity_at < corte` clasifica en la base igual que en la cola.
     - Un test cruza los cortes con `evaluateRecency()` en los bordes, y otros comparan el dashboard con la cola de `/opportunities`, también con microsegundos en los bordes.
  9. **Oportunidades en riesgo.** Lista de las abiertas Inactivas, de la más vieja a la más reciente, con contacto, etapa, días sin actividad y enlace a `/opportunities/[id]`.
     - *Propuesta de implementación:* muestra a lo sumo 10 y dice cuántas hay en total. La lista completa está en la cola de `/opportunities`.
     - No muestra teléfono ni demanda: solo lo necesario para decidir a quién llamar.
  10. **Capa de datos.** `getExecutiveDashboard()` (`db/queries/dashboard.ts`): `requireTenant()` → `withTenant()` → tres lecturas en la misma transacción, todas con filtro explícito por `organization_id` sobre RLS (ADR-001 §2):
      - conteos de oportunidades (`count(*) FILTER`);
      - conteos del inventario: las unidades con un `LEFT JOIN` al agregado de sus vínculos por organización y unidad (`bool_or`), también filtrado por organización y unido por los dos, como la FK compuesta;
      - la lista en riesgo, con su total en la misma lectura (`count(*) over ()`).
      - El dominio (`domains/dashboard`) arma la vista: win rate, días sin actividad y formato es-PY. Los instantes se ligan con operadores de columna para que viajen como `timestamptz`.
      - Solo lectura: no hay migración, policies, grants ni escrituras nuevas, y leer no modifica `last_activity_at`, `updated_at` ni el estado de las unidades.
  11. **Autorización.** *Propuesta de implementación:* la lectura de cualquier membership activa (`admin` o `seller`), como el resto de las superficies tenant-scoped (DEC-019, DEC-023: sin responsable asignado). El pedido enfoca el panel en el gerente o dueño, pero no pide restringirlo. Restringirlo a `admin` requiere una decisión nueva.
  12. **UI de `/intelligence`.**
      - Tres bloques en una grilla CSS: "Pipeline comercial", "Salud del inventario" y "Atención".
      - Cada indicador es una tarjeta con rótulo, valor y contexto.
      - El win rate lleva un medidor con el color de marca sobre una pista de la misma rampa.
      - Enfriándose e Inactivas usan los tonos de advertencia y peligro cuando son más de cero, siempre junto a su texto.
      - "Oportunidades en riesgo" va en el rail derecho: avatar de iniciales, contacto, etapa y días sin actividad. Con más de 10, aclara cuántas muestra y enlaza a la cola.
      - Server Components, sin JavaScript de cliente. El mes se nombra en el encabezado ("Mes en curso: octubre de 2026").
  13. **Fuera de este bloque:**
      - Gráficos, series históricas, comparación con meses anteriores, metas, filtros por vendedor o período, exportación y refresco automático o streaming.
      - El valor vendido (`SUM(sale_price)` por moneda, sin FX, DEC-025 §5), las ventas influenciadas y la atribución (TB §13), ingresos y comisiones.
      - La restricción por rol, cachés o materialización, `closed_at`, reservar o vender la unidad en Stock, el Cockpit, el Morning Brief (DEC-007) y todo lo listado como futuro (CLAUDE.md §2).
- **Aclara / supersede:**
  - DEC-001 y B1 §4 y §6: `/intelligence` deja de ser un empty state y muestra el Dashboard Directivo, como Stock con DEC-026. La navegación no cambia, y Conversations, Calendar y Recovery siguen como placeholder.
  - DEC-017: el dashboard no replica la cola de `/opportunities`. Solo cuenta, y la lista en riesgo enlaza al detalle. Además, `/intelligence` suma una vista agregada de atención (conteos y oportunidades en riesgo) para la gerencia; la priorización accionable de todo el negocio sigue siendo responsabilidad del Action Cockpit (DEC-017, MC §7), que no debe duplicarla cuando se construya.
  - DEC-032 §10 y DEC-034 §12: las métricas de conversión entran como lectura agregada, sin `closed_at` ni historial de etapas.
  - DEC-035 §8 ("el módulo Intelligence", fuera de ese bloque): entra acá, como dashboard directivo.
  - DEC-036 §1: que el toque de actividad no cambie `updated_at` pasa a ser un requisito del dashboard (§5).
  - DEC-026, DEC-028 y DEC-033 §2: las "reservadas" y "vendidas" del dashboard salen de los vínculos, no de `vehicles.status`, y no lo cambian. No son los grupos por estado de la Stock List: vincular sigue sin reservar ni vender la unidad.
  - MC §7 y §39, TB §17 y DEC-020: sin cambios. El home sigue siendo el Action Cockpit.
  - DEC-029 (secuencia), TB §15 (Hito 5) y MC §34: bloque agregado por el fundador como "Hito 5". No reemplaza H2a, ADR-002, H2b ni el registro de la venta.
  - DEC-013: sin cambios (decisión del fundador).
  - Prevalece según DEC-002. No requiere un ADR nuevo: no hay datos ni accesos nuevos, y ADR-001 alcanza.
- **Consecuencias:**
  - Cero drift de base de datos: no hay migración ni paso de staging.
  - Cada request de `/intelligence` hace tres lecturas agregadas sobre las oportunidades y unidades de la organización activa (O(oportunidades + unidades)). Si el volumen del piloto lo exige, se revisa con una decisión nueva (índices, límites o materialización).
  - El dashboard y la Stock List pueden diferir: una unidad vendida según el dashboard sigue `available` en Stock hasta que se habilite vender la unidad (DEC-034 §12). Ese flujo tiene que revisar esta DEC.
  - Habilitar la edición de una oportunidad cerrada, o que el toque de actividad cambie `updated_at`, exige agregar antes `closed_at` (§5). Si no, el dashboard movería esas oportunidades al mes en curso.

## DEC-038 — Gestión de Equipo, Invitaciones y Configuración de Concesionario
- **Estado:** Aceptada en principio · 2026-10-15. Formaliza el pedido del fundador "Hito 6: Módulo de Configuración y Gestión de Equipo (Onboarding)". Los puntos marcados como *propuesta de implementación* los eligió el equipo dentro de ese pedido y pasan a Aceptada con la aprobación del fundador en la revisión del PR.
- **Contexto:** `/settings` es un empty state desde B1 (DEC-001, B1 §6). Las memberships solo se crean, cambian o revocan por provisioning con el rol dueño: DEC-021 dejó "provisioning y gestión de miembros" fuera de H0.7, DEC-019 dejó `organizations` y `memberships` sin escrituras (default deny) y DEC-024 §9 no introdujo autorización por rol. Un concesionario no puede sumar a un vendedor, cambiarle el rol, quitarle el acceso ni corregir su nombre sin pasar por el equipo de Porandú. El fundador lo llama "Hito 6": no es un hito del Master Context §34 ni del TB §15.
- **Decisión:**
  1. **Ruta.** Configuración vive en `/settings` ("Configuración", DEC-001) con navegación interna por rutas: General (`/settings`) y Equipo (`/settings/team`). La navegación global no cambia.
  2. **Configuración general (`organizations`).** Un admin edita:
     - `name`: de 1 a 120 caracteres, normalizado en el dominio (NFC, sin caracteres de control, espacios colapsados, recortado). La base exige lo esencial con el CHECK `organizations_name_check` (largo, recortado, sin control).
     - *Propuesta de implementación:* las "preferencias básicas" son la moneda por defecto, `default_currency` (`PYG | USD`, `PYG` por defecto), la `currency_default` de `organizations` en el TB §10. `text` + CHECK reemplazable (`organizations_default_currency_check`), como las demás monedas (DEC-025 §6).
     - La moneda por defecto se guarda y se muestra. Ningún formulario la consume todavía (alta rápida de unidades, cierre): adoptarla es un cambio de esos flujos, fuera de este bloque. Cada monto sigue guardando su propia moneda (DEC-025 §5).
     - La zona horaria no es editable: `America/Asuncion` es la zona de presentación de P1 (DEC-037 §4). Una preferencia que no cambia nada confundiría.
  3. **Invitación por email, sin credenciales nuevas.** El pedido es "agregar nuevos usuarios a la organización usando su email". En P1 no hay signup público ni invitaciones de Supabase (DEC-012, DEC-020), y la aplicación no tiene service role ni secret key (CLAUDE.md §3, DEC-022): no puede crear cuentas ni enviar correos. Por eso:
     - *Propuesta de implementación:* invitar es **dar acceso a la organización activa a una cuenta de Porandú que ya existe**, identificada por su email. `inviteMember()` crea la membership activa con el rol elegido, o reactiva una revocada con ese rol. Si ya es miembro activo, no cambia nada (tampoco su rol: eso es "Cambiar rol"). Si no hay cuenta con ese email, responde `no_account` y no cambia nada.
     - `private.find_member_candidate(organization, email)` resuelve el usuario. Es `SECURITY DEFINER` (owner `postgres`), `STABLE`, con `search_path` vacío y EXECUTE solo para `authenticated`, porque el email vive en `auth.users` y no se duplica (DEC-018). Solo responde a un admin activo de esa organización (si no, `42501` sin buscar), solo devuelve usuarios con perfil y compara el email sin distinguir mayúsculas. Ninguna coincidencia, o más de una, es `NULL`.
     - La cuenta la sigue creando el provisioning (fuera de la aplicación). No hay invitaciones pendientes, tokens, correos ni links de aceptación.
     - *Limitación aceptada:* un admin puede saber si un email tiene cuenta de Porandú (en cualquier organización). Es información de cuenta, no datos de otro tenant, y solo la ve un admin. Mitigarla (respuesta uniforme o invitaciones pendientes) llega con el flujo de invitación por correo.
  4. **Escritura en la base (RLS + privilegios + triggers).**
     - `private.user_admin_org_ids()`: las organizaciones donde el usuario de la request es `admin` con membership activa. Mismo patrón que `private.user_org_ids()` (ADR-001 §4): `SECURITY DEFINER`, `STABLE`, `search_path` vacío, EXECUTE solo para `authenticated`.
     - `organizations`: policy de UPDATE `organizations_update_admin` (USING y WITH CHECK con `private.user_admin_org_ids()`) y UPDATE por columna de `name`, `default_currency` y `updated_at`. Sin INSERT ni DELETE: crear o borrar organizaciones sigue siendo provisioning.
     - `memberships`: alta `memberships_insert_admin` (admin de la organización, `active`, `created_at = now()`, `updated_at = now()`; INSERT de tabla, diseño A de DEC-030 §9) y edición `memberships_update_admin` (admin antes y después), con UPDATE por columna de `role`, `active` y `updated_at`. Sin DELETE: revocar es `active = false` (DEC-018).
     - Trigger `memberships_change_guard` (`BEFORE UPDATE FOR EACH ROW`, función `private.enforce_membership_change()`, `SECURITY DEFINER` de `postgres`, sin EXECUTE para nadie). Rechaza con `23514`:
       - `memberships_identity_immutable`: cambiar organización, usuario, id o alta;
       - `memberships_self_change`: que el usuario de la request cambie su propia membership. Nadie se degrada ni se quita a sí mismo;
       - `memberships_last_admin`: que un pedido con identidad deje la organización sin admin activo. Bloquea la fila de la organización (`FOR NO KEY UPDATE`) antes de contar, así dos admins que se degradan a la vez se serializan.
       - Sin claims (provisioning con el rol dueño) las dos últimas no aplican: revocar de inmediato una cuenta comprometida, aunque sea el único admin, sigue siendo posible (ADR-001 §4, A-09).
       - Fija `updated_at` con el reloj de la base.
     - Trigger `organizations_update_guard` (`private.enforce_organization_update()`, sin `SECURITY DEFINER`): rechaza cambiar id o alta y fija `updated_at`.
  5. **RBAC.** Solo `admin` edita la organización, invita, cambia roles o revoca. Un `seller` ve General y Equipo de solo lectura.
     - El rol es el de la membership activa del `TenantContext` (DEC-021), nunca del cliente.
     - Defensa en profundidad: las Server Actions (`updateOrganization()`, `inviteMember()`, `updateMemberRole()`, `removeMember()`, en `lib/settings/actions.ts`) llaman a `requireTenant()` y devuelven `forbidden` a un seller antes de leer el pedido. La base rechaza lo mismo sin esa regla: RLS filtra el UPDATE (0 filas), la policy de INSERT y `find_member_candidate()` responden `42501`.
     - Es la primera autorización por rol del producto (amplía DEC-024 §9, DEC-027 §4 y DEC-037 §11, que siguen sin restricción por rol).
     - *Propuesta de implementación:* "quitar a un miembro" desactiva su membership de esta organización. No borra su cuenta, ni sus registros (notas, mensajes, cierres), ni sus memberships en otras organizaciones. Rige desde el request siguiente (DEC-021), también con una sesión abierta.
  6. **Lista del equipo.** Los miembros **activos** de la organización activa con nombre, email y rol. La lee `private.organization_members(organization)`: `SECURITY DEFINER`, `STABLE`, `search_path` vacío, EXECUTE solo para `authenticated`. Solo responde a un miembro activo de esa organización y solo devuelve nombre (`profiles.full_name`), email (`auth.users.email`), rol y alta de sus miembros activos.
     - La policy `profiles_select_own` no cambia (DEC-019): la tabla sigue mostrando solo el perfil propio y `auth.users` sigue cerrado para `authenticated`.
     - *Propuesta de implementación:* un seller también ve los emails de sus compañeros. Es el dato con el que se identifica a un miembro del equipo.
     - Las memberships revocadas no se listan. Reactivar a alguien es volver a invitarlo.
  7. **Validación con Zod.** `domains/settings/organization.ts` (nombre y moneda) y `domains/team/members.ts` (roles, invitación, reglas `canManageTeam()` y `canManageMember()`) son puros y aptos para el navegador. El servidor siempre valida antes de escribir.
  8. **UI.**
     - DEC-013 sin cambios: workspace claro, paneles blancos y tokens de `components/ui/tokens.css`. El pedido menciona "Glassmorphism, Dark Mode", pero DEC-013 superseded esa dirección y el fundador la confirmó en DEC-037 §2.
     - General: formulario en panel para el admin; datos de solo lectura con "Solo lectura" para el seller.
     - Equipo: lista con avatar, nombre, "(vos)", email y rol. El admin ve "Invitar miembro" (drawer con email y rol) y un menú de acciones por miembro (cambiar a Administrador o Vendedor, quitar acceso), con confirmación (alertdialog). No hay menú sobre la propia fila.
     - *Propuesta de implementación:* el menú usa `@radix-ui/react-dropdown-menu` (primitiva Radix, DEC-009).
  9. **Migración `0012_team_settings`.**
     - Agrega `organizations.default_currency` (las organizaciones existentes quedan en `PYG`) y los dos CHECKs. Si una organización tiene un nombre fuera del CHECK, la migración se detiene y no aplica nada: corregirlo es una decisión humana.
     - Crea las cuatro funciones, los dos triggers, las tres policies y los grants.
     - Postcondiciones: las de `0011`, con `memberships` entre las altas aprobadas y las columnas nuevas entre las ediciones aprobadas. Además, los triggers de guarda habilitados, la función de la guarda `SECURITY DEFINER` sin EXECUTE para nadie, y las tres funciones de equipo `SECURITY DEFINER` de `postgres` con EXECUTE solo para `authenticated`.
     - No toca ninguna fila existente.
  10. **Fuera de este bloque:** crear cuentas, signup y enviar correos de invitación (requiere un proveedor de email y la Auth Admin API, con su decisión de credenciales); invitaciones pendientes; transferir la propiedad; crear o borrar organizaciones; editar el perfil propio; auditoría de cambios de membership; restringir otras superficies por rol; adoptar la moneda por defecto en los formularios; zona horaria, logo, sucursales e integraciones (TB §5 "Configuración"); y todo lo listado como futuro (CLAUDE.md §2).
- **Aclara / supersede:**
  - DEC-019 ("sin policies ni grants de escritura en H0"): `organizations` y `memberships` reciben escrituras solo para admin, con `WITH CHECK`. Se cumple ADR-001 §4: misma condición en USING y WITH CHECK.
  - DEC-019 (`profiles` solo propio): la policy no cambia. La lista del equipo expone nombre y email de los miembros activos de la misma organización por una función acotada (§6).
  - DEC-020 ("quedan fuera… invitaciones") y DEC-021 ("fuera de H0.7: provisioning y gestión de miembros"): la gestión de miembros entra, sin crear cuentas ni enviar correos (§3).
  - DEC-024 §9, DEC-027 §4 y DEC-037 §11: el Hito 6 es el primer flujo con autorización por rol. Las demás superficies siguen sin restricción por rol.
  - B1 §6 ("Settings: Organización y perfil (solo lectura)") y DEC-001: `/settings` deja de ser un empty state y el admin edita la organización. El perfil queda fuera.
  - DEC-013: sin cambios.
  - Prevalece según DEC-002. No requiere un ADR nuevo: las funciones `SECURITY DEFINER` viven en `private` (ADR-001 §3.6) y siguen el patrón de `private.user_org_ids()`.
- **Consecuencias:**
  - `0012_team_settings` se aplica a staging después del merge con `preflight → migrate → verify`: `expected_migrations = 0012_team_settings` si staging ya tiene `0011`, o con las anteriores que falten delante, en orden. La verificación suma `schema.team-settings` y amplía `rls.policies`, `privileges.authenticated` y `privileges.authenticated-update-columns`.
  - Las funciones de equipo leen `auth.users.email` como `postgres`. El harness lo modela (`email` y SELECT para `postgres` en `supabase-shim.sql`), pero ni la migración ni la verificación de staging lo ejercitan: PostgreSQL revisa ese privilegio al ejecutar, no al crear la función. Lo ejercita el acceptance Auth → Tenant (`auth-tenant-acceptance`), con usuarios creados por la Auth Admin API: lista el equipo con `getTeam()` (`private.organization_members()`) e invita por email con `inviteMember()` (`private.find_member_candidate()`), y comprueba que `authenticated` sigue sin leer `auth.users`. Si Supabase no lo permitiera, se consulta antes de cambiar el mecanismo.
  - El provisioning con el rol dueño sigue pudiendo revocar o degradar a cualquier miembro (A-09). Un concesionario sin admin activo solo se recupera por provisioning.

## DEC-039 — Procesamiento de Webhooks de WhatsApp e Ingesta de Mensajes
- **Estado:** Aceptada en principio · 2026-10-21. Formaliza el pedido del fundador "Hito 7: Ingesta Activa de WhatsApp (Webhooks)". Los puntos marcados como *propuesta de implementación* los eligió el equipo dentro de ese pedido y pasan a Aceptada con la aprobación del fundador en la revisión del PR.
- **Contexto:** hasta el Hito 4 los mensajes solo los registra un miembro (DEC-036 §4 y §6), y los webhooks, la Cloud API y el BSP quedaron para H2b, después de un ADR-002 de identidad de sistema que no satisfaga las policies de miembro (DEC-029 §9, DEC-036 §12 y Consecuencias). El fundador pide recibir los mensajes entrantes de WhatsApp por webhook y registrarlos solos. El pedido nombra tablas que el schema no tiene con esos nombres:
  - `customers` es `contacts` (DEC-023, DEC-024): la identidad del cliente por teléfono dentro de la organización. No se crea otra tabla.
  - `conversations` no existe. Se crea (§6).
  - `tenant_id` es `organization_id`, como en DEC-036 §4.
  - El pedido admite el Service Role de Supabase o funciones `SECURITY DEFINER`. El service role sigue sin aprobarse para la aplicación (CLAUDE.md §3, ADR-001 §8, DEC-022, DEC-038 §3): se usa una función `SECURITY DEFINER` (§4).
- **Decisión:**
  1. **Endpoint.** `POST /api/webhooks/whatsapp` (Route Handler de Next, runtime Node). Recibe los eventos de la WhatsApp Cloud API (`object = whatsapp_business_account`). Solo POST.
     - *Propuesta de implementación:* el formato es el de la Cloud API de Meta, la fuente prevista en DEC-029 §9. La verificación de la suscripción (`hub.challenge`) entra como enmienda del 2026-10-28, a pedido del fundador: `GET /api/webhooks/whatsapp` valida con Zod `hub.mode = subscribe`, `hub.verify_token` y `hub.challenge`; compara el token con `WHATSAPP_VERIFY_TOKEN` en tiempo constante y devuelve el challenge como `text/plain` con `nosniff`. Un pedido que no valida o con otro token es `403`, sin decir qué falló; sin el token configurado (mínimo 16 caracteres, server-only y distinto del app secret) falla cerrado con `503`. El challenge se acota a letras, dígitos y `. _ ~ -` (hasta 256), porque se devuelve tal cual. No toca la base.
     - `proxy.ts` no corre sobre `/api/webhooks/*`: no hay sesión que refrescar ni redirect que hacer.
  2. **Autenticación (seguridad básica).** El header `X-Hub-Signature-256: sha256=<hex>` tiene que ser el HMAC-SHA256 del cuerpo crudo con el secreto compartido `WHATSAPP_APP_SECRET`, comparado en tiempo constante.
     - *Propuesta de implementación:* el pedido dice "token o secret en los headers"; se eligió la firma HMAC, porque el secreto no viaja, el cuerpo no se puede alterar y es lo que envía Meta.
     - El secreto es server-only y se lee con `lib/env.server.ts`. Tiene que tener al menos 32 caracteres. Nunca se registra.
     - Sin el secreto configurado, el endpoint falla cerrado (`503`) sin leer el cuerpo. Una firma ausente o inválida es `401` y no se parsea nada. Un cuerpo de más de 3 MiB es `413`.
  3. **Validación (Zod) en `domains/webhooks/`.** Puro y separado del framework: no conoce Next, la base ni `lib/`.
     - `whatsapp.ts` valida el sobre del payload (`entry[].changes[].value`, `metadata.phone_number_id`, `contacts[]` y `messages[]`) y cada mensaje de texto: `id` (el id del proveedor), `from` (número de origen, solo dígitos), `timestamp` (segundos Unix) y `text.body`.
     - Es estricto en los campos que se usan (forma, largo y rangos) y tolerante a los campos que el proveedor agregue: un campo nuevo de Meta no puede hacer perder mensajes. El contrato propio, `InboundMessage` (`inbound-message.ts`), es estricto y no conoce WhatsApp.
     - Un sobre inválido o un cuerpo que no es JSON es `400` y no se escribe nada. Un evento que no es un mensaje de texto entrante (estados de entrega, reacciones, media, etc.) se ignora con `200`, para que el proveedor no lo reintente. Un mensaje de texto con un campo inválido (texto vacío o de más de 4096 caracteres después de normalizar) se descarta, sin escribir, y el resto del lote sigue.
     - `domains/webhooks` es la capa de Ingestion de DEC-029 §2: el único módulo que conoce el payload de WhatsApp. Domain Truth (`domains/conversations`, `domains/opportunities`) sigue sin conocer proveedores.
  4. **Identidad de sistema (resuelve, para la ingesta entrante, el ADR-002 de DEC-029 §9).** El fundador pide registrar la decisión como DEC-039; si prefiere el documento ADR-002 aparte, se extrae sin cambiar la decisión.
     - La identidad de la ingesta es **`authenticated` sin claims**. Sin usuario no hay membership: `private.user_org_ids()` no devuelve nada, RLS no le deja ver ni escribir ninguna fila y no satisface ninguna policy de miembro (DEC-029 §9). Solo puede escribir por la función de ingesta (§7).
     - La función rechaza con `42501` cualquier llamada con claims (`request.jwt.claims` o `request.jwt.claim.sub`): un miembro, que siempre llega por `withTenant()` con sus claims verificados, no puede ingerir en nombre de una línea. La regla está en la base, no solo en la aplicación.
     - Boundary `withIngestion()` en `db/tenant.ts`: una transacción por llamada, cuyo primer statement vacía los claims (`set_config('request.jwt.claims', '', true)`) y asume `authenticated` (`set_config('role', 'authenticated', true)`). Mismas reglas que `withTenant()` (ADR-001 §3.2). ESLint solo deja importarlo a `db/queries/ingest-whatsapp-message.ts`, y ese módulo solo a `lib/whatsapp/webhook.ts`.
     - Sin roles, memberships ni credenciales nuevas: ADR-001 §2 no cambia (`app_runtime` sigue siendo miembro solo de `authenticated`). La Data API sigue deshabilitada (ADR-001 §3.3); aun habilitada, PostgREST siempre fija los claims de un JWT verificado para `authenticated`, así que no llega a la función sin ellos.
     - *Descartados:* un rol de sistema `NOLOGIN` (`app_ingest`) que `app_runtime` asuma exige que `app_runtime` sea miembro de él, y la postcondición de `0001` (aplicada e inmutable) exige que sea miembro solo de `authenticated`. Como los roles son del cluster, toda base que vuelva a migrar desde cero junto a una con `0013` fallaría (el harness de PostgreSQL 17 y una base local recreada). Un rol con login propio requiere una credencial y un provisioning nuevos, fuera del pedido.
  5. **Tenant por la línea receptora.** Tabla nueva `whatsapp_lines`: `organization_id` y el `phone_number_id` de la línea (único global, porque una línea pertenece a una sola organización), con `active`.
     - El `metadata.phone_number_id` del payload es lo único que determina la organización. Ningún dato del payload elige `organization_id`.
     - Una línea desconocida o inactiva es `unknown_line`: no se escribe nada y responde `200`.
     - *Propuesta de implementación:* las líneas las da de alta el provisioning con el rol dueño, como las cuentas (DEC-038 §3). Sin UI, sin policies ni grants para `authenticated` (default deny, con RLS habilitado).
  6. **Conversaciones (`conversations`).** Una por contacto y canal mientras está abierta: `organization_id`, `contact_id` (FK compuesta a `contacts`), `channel` (`whatsapp`, `text` + CHECK ampliable), `status` (`open | closed`), `last_message_at` y `last_message_preview` (juntos o ninguno, CHECK), `created_at` y `updated_at`.
     - "Conversación activa" es `status = 'open'`. La unique parcial `(organization_id, contact_id, channel) WHERE status = 'open'` garantiza una sola por contacto.
     - `last_message_preview` es el texto del mensaje en una sola línea, de 1 a 160 caracteres, con "…" si se cortó. Lo arma el dominio (`messagePreview()`).
     - Lectura para los miembros activos (SELECT, como los mensajes). Sin INSERT, UPDATE ni DELETE para `authenticated`: solo la escribe la función de ingesta.
     - *Propuesta de implementación:* ningún flujo cierra una conversación en este bloque. `closed` existe para que "activa" tenga sentido; cerrar llega con la superficie `/conversations`.
  7. **Función de ingesta.** `private.ingest_whatsapp_message(línea, id del proveedor, teléfono, teléfono E.164, nombre del contacto, texto, preview, enviado)` es `SECURITY DEFINER` (owner `postgres`), con `search_path` vacío y EXECUTE solo para `authenticated`. En una sola transacción:
     1. con claims, `42501` sin leer nada (§4); sin todos los argumentos, `22004`;
     2. la organización de la línea activa; si no hay, `unknown_line`;
     3. si el mensaje ya se registró en esa organización (mismo id del proveedor), `duplicate`;
     4. el contacto de esa organización con ese `phone_normalized`, o uno nuevo (`ON CONFLICT DO NOTHING` y relectura, DEC-024 §3). Un contacto existente no cambia: ni nombre ni ciudad;
     5. la conversación abierta del contacto, o una nueva (`ON CONFLICT DO NOTHING` y relectura);
     6. la oportunidad abierta del contacto (§9);
     7. el INSERT del mensaje (`inbound`, `whatsapp`, sin autor). Un choque de idempotencia es `duplicate`;
     8. `last_message_at` y `last_message_preview` de la conversación, solo si el mensaje no es más viejo que el último;
     9. el trigger de actividad (DEC-036 §1), si el mensaje tiene oportunidad.
     - Devuelve el resultado (`recorded`, `duplicate` o `unknown_line`) y los ids. Todo `organization_id` que escribe sale de la línea, y las FKs compuestas impiden cruzar organizaciones.
  8. **Concurrencia e idempotencia.** La unicidad de la base es la autoridad:
     - contacto: `(organization_id, phone_normalized)` (DEC-024 §1);
     - conversación abierta: `(organization_id, contact_id, channel) WHERE status = 'open'`;
     - mensaje: `(organization_id, external_id) WHERE external_id IS NOT NULL`.
     - Dos mensajes del mismo número nuevo al mismo tiempo: el segundo espera la confirmación del primero en el índice único y reutiliza su contacto y su conversación. Una entrega repetida (reintentos del proveedor, también simultáneos) deja una sola fila.
     - El último mensaje de la conversación se actualiza con un UPDATE condicional bajo el bloqueo de la fila: un mensaje viejo que llega tarde no pisa el preview.
     - Cada mensaje del lote va en su propia transacción. Si uno falla, el endpoint responde `500`, el proveedor reintenta y los ya registrados son `duplicate`.
  9. **Muro del Hito 4.** *Propuesta de implementación:* el muro de actividad es por oportunidad (DEC-036 §11) y no lee `conversations`. Para que el chat "suba", el mensaje se asocia a la oportunidad abierta (`new`, `qualifying` o `negotiating`) del contacto **cuando hay exactamente una**: aparece en su muro y el trigger de DEC-036 mueve `last_activity_at`, así que la oportunidad vuelve a Activa y sube en la cola.
     - Sin oportunidad abierta, o con varias, el mensaje queda solo en la conversación: no se adivina el negocio ni se crea una oportunidad (`createOpportunity()` sigue siendo su única puerta, DEC-024 §4).
     - En el muro, un mensaje ingerido muestra "WhatsApp (automático)" como autor.
     - `last_message_at` y `last_message_preview` quedan listos para la bandeja de `/conversations`, que sigue como placeholder (DEC-001).
  10. **Mensajes (amplía DEC-036 §4 y §5).**
      - `recorded_by` pasa a ser opcional: un mensaje ingerido no tiene autor. Columnas nuevas, opcionales: `conversation_id` (FK compuesta `(organization_id, conversation_id, contact_id)` → `conversations`, RESTRICT), `external_id` (el id del proveedor, de 1 a 256 caracteres sin espacios ni control) y `sent_at` (el `timestamp` del proveedor).
      - CHECK `messages_source_check`: o lo registró un miembro (con autor, sin conversación, id ni `sent_at`), o es un WhatsApp entrante ingerido (sin autor, con conversación, id y `sent_at`).
      - La policy de INSERT de miembros no cambia: exige `recorded_by = auth.uid()`, así que un miembro no puede escribir un mensaje con forma de ingerido.
      - `created_at` sigue siendo el reloj de la base (el momento en que Porandú lo registró) y ordena el muro. `sent_at` es cuándo lo envió el cliente, y ordena la conversación.
      - Siguen append-only: sin UPDATE ni DELETE para ningún rol de la app, tampoco `service_role` (C-11).
  11. **Contacto nuevo.** `phone` es el número tal como llega (`+` y los dígitos de `from`), y `phone_normalized`, su E.164 con `libphonenumber-js` en el servidor (DEC-024 §2). Un número que no valida es `invalid_sender` y no se escribe.
      - *Propuesta de implementación:* el nombre es el nombre de perfil de WhatsApp del remitente (`contacts[].profile.name`), normalizado (NFC, sin caracteres de control, espacios colapsados) y acotado a 120 caracteres. Si falta, "Contacto de WhatsApp".
  12. **Respuestas y logs.** `200` con los conteos por resultado; `400`, `401`, `413`, `503` y `500` como en §2, §3 y §8. Los logs registran solo los conteos y, ante un error, `{ name, code, constraint_name }`: nunca teléfonos, nombres, textos ni ids.
  13. **Migración `0013_whatsapp_ingestion`.**
      - `whatsapp_lines` y `conversations` con FKs, CHECKs, índices, RLS, policies y grants. `messages` recibe sus columnas, la FK compuesta, la unique de idempotencia y `messages_source_check`, y `recorded_by` deja de ser obligatorio. `conversations` recibe la `UNIQUE (organization_id, id, contact_id)` destino de esa FK.
      - La función de ingesta con su grant (EXECUTE solo para `authenticated`).
      - Postcondiciones: las de 0012, con `conversations` y `whatsapp_lines` entre las tablas sin altas ni ediciones de `authenticated`; `app_runtime` sigue siendo miembro solo de `authenticated`; la función `SECURITY DEFINER` de `postgres`, con `search_path` vacío, EXECUTE solo para `authenticated` y la regla que rechaza las llamadas con claims; `whatsapp_lines` sin policies ni privilegios de `authenticated`; el CHECK y las FKs de los mensajes y las uniques de idempotencia y de conversación abierta, validados.
      - No toca ninguna fila existente: los mensajes registrados por miembros cumplen el CHECK nuevo tal como están.
  14. **Fuera de este bloque:** enviar mensajes, plantillas y estados de entrega o lectura; media, adjuntos, reacciones y mensajes interactivos; crear oportunidades automáticamente; cerrar conversaciones; la bandeja `/conversations`; registrar líneas desde la UI; varias líneas por organización con conversaciones separadas; colas o procesamiento asíncrono; límites de tasa; la extracción asistida (H2a), Intent desde conversaciones, IA y todo lo listado como futuro (CLAUDE.md §2).
- **Aclara / supersede:**
  - DEC-029 §9 y DEC-036 §12 y Consecuencias: la ingesta entrante de WhatsApp entra por decisión del fundador, con la identidad de sistema de §4 en lugar de un ADR-002 previo. El envío y el resto de H2b siguen fuera.
  - ADR-001 §2 y §4: sin cambios de roles. `withTenant()` sigue siendo la única puerta de los datos tenant-scoped de un usuario; `withIngestion()` es la del sistema, sin usuario, y solo escribe por la función de ingesta. Las reglas de §3 se mantienen: sin `SET` de sesión, sin privilegios directos de `app_runtime`, sin `SECURITY DEFINER` en `public`.
  - CLAUDE.md §3: el service role y la secret key siguen sin aprobarse. `WHATSAPP_APP_SECRET` es un secreto server-only nuevo, solo para verificar la firma.
  - DEC-036 §4, §5 y §6: los mensajes admiten una segunda fuente (la ingesta), sin autor. `addMessage()` sigue siendo la única puerta de los miembros.
  - DEC-024 §4: los contactos también nacen de la ingesta. Las oportunidades, no.
  - DEC-029 §2 y DEC-016: `domains/webhooks` es la capa de Ingestion, pura; Domain Truth no conoce proveedores.
  - B1 §4 (WhatsApp: webhooks diferidos) y DEC-001 (Conversations sigue como placeholder).
  - Prevalece según DEC-002.
- **Consecuencias:**
  - `0013_whatsapp_ingestion` se aplica a staging después del merge con `preflight → migrate → verify`: `expected_migrations = 0013_whatsapp_ingestion` si staging ya tiene `0012`, o con las anteriores que falten delante, en orden. La verificación suma `schema.whatsapp-ingestion` y amplía `schema.tables`, `rls.policies`, `schema.messages` y `privileges.authenticated`.
  - Operación: `WHATSAPP_APP_SECRET` se configura en Vercel como variable server-only, y cada línea se registra en `whatsapp_lines` por provisioning. Para suscribir el endpoint en Meta, `WHATSAPP_VERIFY_TOKEN` se configura en Vercel y se carga igual en Meta (Verify token).
  - El runtime acceptance de staging todavía no ejercita la ingesta. Se suma cuando haya una línea de prueba.
  - La limitación C-14 (PII inmutable, sin redacción) también aplica a los mensajes ingeridos y a los nombres de perfil.

## DEC-040 — Interfaz de Bandeja de Entrada y Motor de Envío de WhatsApp
- **Estado:** Aceptada en principio · 2026-10-29. Formaliza el pedido del fundador "Hito 8: Bandeja de Entrada y Envío de Mensajes (Chat UI)". Los puntos marcados como *propuesta de implementación* los eligió el equipo dentro de ese pedido y pasan a Aceptada con la aprobación del fundador en la revisión del PR.
- **Contexto:** DEC-039 dejó las conversaciones ingeridas listas para una bandeja (`last_message_at` y `last_message_preview`), pero `/conversations` sigue como placeholder (DEC-001) y nadie puede responder: enviar quedó fuera (DEC-036 §12, DEC-039 §14). El fundador pide la bandeja de dos columnas y el envío de texto por la Cloud API de Meta. El pedido nombra cosas que el schema tiene con otro nombre o que conviene precisar:
  - `tenant_id` es `organization_id`, como en DEC-036 §4 y DEC-039.
  - "seller/admin" son los dos roles de `membership_role` (DEC-018): cualquier membership activa.
  - `direction = 'outbound'` ya existe (DEC-036 §4).
  - "Componentes de Shadcn UI": el repositorio no usa la CLI ni los paquetes de shadcn. `components/ui/` ya sigue ese patrón (componentes propios sobre Radix, Tailwind y los tokens de DEC-013, DEC-009). La bandeja usa esas primitivas y suma las suyas en `components/inbox/`, sin dependencias nuevas.
  - "RLS/Middleware": la autorización la dan la resolución del tenant (§3) y RLS. `proxy.ts` refresca la sesión y no es una barrera (DEC-020).
- **Decisión:**
  1. **Bandeja (`/conversations`).** Deja de ser placeholder: dos columnas, con Server Components y solo el composer de cliente.
     - Izquierda: las conversaciones activas (`status = 'open'`, DEC-039 §6) de la organización activa, de la más reciente a la más vieja por `last_message_at`. Las que no tienen mensajes van al final, por alta. Cada una muestra el contacto, el preview y la fecha de Asunción.
     - Derecha: el historial de la conversación elegida y, al pie, el composer. La elección viaja en la URL (`/conversations?c=<id>`). Sin elección, la columna invita a elegir una. Un id inválido, de otra organización, inexistente o de una conversación cerrada muestra "No encontramos la conversación", sin distinguir.
     - Los entrantes (del cliente) van a la izquierda, en superficie blanca con borde y autor "Cliente". Los salientes (de un miembro) van a la derecha, en el tono suave de marca y con autor "Vos" u "Otro miembro". Cada mensaje lleva su fecha de Asunción.
     - El historial ordena por `sent_at` (DEC-039 §10), con desempate por `created_at` e id. Solo muestra mensajes con conversación (los del webhook y los enviados): los registrados a mano en una oportunidad (Hito 4) siguen en su muro.
     - El encabezado del historial muestra el teléfono enmascarado (`maskPhone()`), nunca completo.
     - *Propuesta de implementación:* la lista muestra a lo sumo 100 conversaciones y el historial los últimos 200 mensajes. Cada uno dice cuántos hay cuando no los muestra todos.
  2. **Endpoint.** `POST /api/messages/send` (Route Handler de Next, runtime Node). El pedido es JSON `{ conversationId, text }`, validado con Zod en `domains/conversations/outbound.ts`, puro y apto para el navegador: el composer avisa con el mismo esquema antes de enviar.
     - `conversationId` es un UUID. `text` se normaliza como un mensaje registrado (DEC-036 §4) y tiene de 1 a 4096 caracteres.
     - Cualquier otro campo se ignora: organización, contacto, línea, autor y reloj no salen del pedido.
     - *Propuesta de implementación* (defensas de la request): `Content-Type: application/json` (si no, `415`), un cuerpo de hasta 64 KiB (`413`) y `Origin` igual al host de la request (si falta o difiere, `403`). Las cookies de sesión ya son `SameSite=Lax` (DEC-020); el `Origin` cierra además un pedido cruzado desde otro origen del mismo sitio.
  3. **Autorización.** Membership activa (`admin` o `seller`) en la organización dueña de la conversación. Cualquier miembro responde cualquier conversación de su organización (DEC-023: sin responsable asignado).
     - *Propuesta de implementación:* `resolveRequestTenant()` (`lib/tenant/session.ts`) es la misma resolución de DEC-021 sin redirects, para que un Route Handler responda JSON: sin usuario verificado es `401`, y sin organización activa resuelta (sin memberships activas, o varias sin elección válida) es `403`. `requireTenant()` pasa a ser ese mismo resultado con sus redirects: la cadena `usuario verificado → memberships activas → TenantContext → withTenant()` no cambia.
     - La conversación se lee con `withTenant()` y filtro explícito por `organization_id` sobre RLS. De otra organización, inexistente o cerrada es `404 not_found`, sin distinguir, y no se llama a Meta.
     - La función de registro (§6) vuelve a exigir, en la base, la membership activa en la organización y que la conversación sea de ella.
  4. **Línea emisora y destinatario.** El pedido no elige la línea.
     - *Propuesta de implementación:* se responde desde la línea activa de la organización (`whatsapp_lines.phone_number_id`), y tiene que haber exactamente una. Sin línea, o con varias, es `409 no_line`, sin llamar a Meta: varias líneas por organización siguen fuera (DEC-039 §14).
     - Para leerla, `authenticated` recibe SELECT sobre `whatsapp_lines`, cubierto por la policy `whatsapp_lines_select_member` (membership activa, el patrón de ADR-001 §4). Sigue sin INSERT, UPDATE ni DELETE: las líneas las da de alta el provisioning. `phone_number_id` es un identificador de Meta, no una credencial.
     - El destinatario es `contacts.phone_normalized` del contacto de la conversación, sin el `+`. Si faltara, es `409 no_recipient`.
  5. **Cliente de Meta (`lib/whatsapp/api.ts`).** Es el servicio interno que conoce la Cloud API: el dominio no la conoce (CLAUDE.md §3).
     - `POST https://graph.facebook.com/v20.0/{PHONE_NUMBER_ID}/messages`, con `Authorization: Bearer <WHATSAPP_API_TOKEN>` y un mensaje de texto (`messaging_product: "whatsapp"`, `type: "text"`, `preview_url: false`).
     - Éxito es solo un `200` con `messages[0].id` válido, validado con Zod y tolerante a campos nuevos. Ese id (el wamid) es el `external_id` del mensaje.
     - Un `4xx` de Meta es `502 provider_rejected`; un `5xx`, un error de red, un timeout de 10 segundos o una respuesta inválida son `502 provider_unavailable`. No se escribe nada.
     - `WHATSAPP_API_TOKEN` es un secreto server-only nuevo, de al menos 32 caracteres, que se lee con `lib/env.server.ts`. Sin él, el endpoint responde `503 not_configured` sin leer la base ni llamar a Meta.
     - Los logs registran el status y el código de error de Meta. Nunca el token, teléfonos, textos ni ids.
  6. **Registro, después del `200` de Meta.** `private.record_outbound_whatsapp_message(organización, conversación, wamid, texto, preview)`: `SECURITY DEFINER` (owner `postgres`), con `search_path` vacío y EXECUTE solo para `authenticated`, llamada dentro de `withTenant()`. En una sola transacción:
     1. sin usuario en los claims, `42501` (`outbound_requires_user`): la identidad de la ingesta (DEC-039 §4) no puede enviar. Sin todos los argumentos, `22004`;
     2. la organización tiene que estar entre las de membership activa del usuario (`private.user_org_ids()`); si no, `42501`;
     3. la conversación abierta de esa organización; si no hay, `not_found`;
     4. la oportunidad abierta del contacto, si hay exactamente una (DEC-039 §9);
     5. el INSERT del mensaje: `whatsapp`, `outbound`, autor `auth.uid()`, `external_id` (el wamid) y `sent_at = now()`, con la conversación y su contacto. Un choque de idempotencia es `duplicate`;
     6. `last_message_at = now()` y `last_message_preview` (de `messagePreview()`) de la conversación, solo si no es más viejo que el último;
     7. el trigger de actividad (DEC-036 §1), si el mensaje tiene oportunidad.
     - *Propuesta de implementación:* una función en lugar de grants de UPDATE sobre `conversations`. Los miembros siguen sin escribir conversaciones (DEC-039 §6), y el último mensaje solo cambia junto con un mensaje.
     - *Propuesta de implementación:* el enviado se asocia a la oportunidad abierta única, como el recibido. Aparece en su muro como "Mensaje enviado · WhatsApp" y mueve la recencia: enviar es una interacción con el cliente (DEC-036 §1).
  7. **Mensajes (amplía DEC-036 §4 y §5 y DEC-039 §10).**
     - `messages_source_check` suma un tercer origen: un WhatsApp saliente enviado por un miembro, con autor, conversación, `external_id` y `sent_at`, `channel = 'whatsapp'` y `direction = 'outbound'`.
     - La policy de alta de miembros (`messages_insert_member`) exige además `conversation_id IS NULL`. Un miembro sigue registrando a mano solo mensajes sin conversación; un mensaje de una conversación solo lo escriben la ingesta y la función de envío.
     - Siguen append-only, también para `service_role` (C-11).
  8. **Orden, fallas y respuestas.** Leer (una transacción) → Meta → registrar (otra transacción). Ninguna transacción queda abierta durante la llamada a Meta (Supavisor en modo transacción).
     - Si Meta aceptó y el registro falla (la membership se revocó o la conversación se cerró en el medio, o un error de base), responde `500 unrecorded`. El cliente ya recibió el mensaje: la UI avisa que no lo reenvíe. No hay reintento automático. El log registra solo `{ name, code, constraint_name }`.
     - Respuestas: `200 { outcome: "sent", messageId }` (también ante un `duplicate`), `400 invalid` con el error de cada campo, y `401`, `403`, `404`, `409`, `413`, `415`, `502`, `503` y `500` como arriba. Ninguna expone SQLSTATE, constraints ni datos de otra organización.
     - Revalida `/conversations` y, si el mensaje tiene oportunidad, `/opportunities` y `/opportunities/[id]`.
  9. **Puerta única.** `handleSendMessage()` (`lib/conversations/send.ts`) es el único módulo que importa `db/queries/outbound-message.ts` (la lectura del destino y el registro), y ESLint lo impide en cualquier otro. La ruta solo compone.
  10. **Migración `0014_whatsapp_outbound`.**
      - Reemplaza `messages_source_check`, ajusta `messages_insert_member`, crea `whatsapp_lines_select_member` con su grant de SELECT y la función con su grant (EXECUTE solo para `authenticated`).
      - Postcondiciones: las de 0013, con `whatsapp_lines` solo con la lectura de miembros (ninguna otra policy ni privilegio de `authenticated`), la función de envío `SECURITY DEFINER` de `postgres` con `search_path` vacío, EXECUTE solo para `authenticated` y la regla que exige usuario, y la policy de alta de miembros con `conversation_id IS NULL`.
      - No toca ninguna fila existente: los mensajes registrados y los ingeridos cumplen el CHECK nuevo tal como están.
  11. **Fuera de este bloque:** plantillas y la ventana de 24 horas de atención de Meta (un texto fuera de la ventana puede ser aceptado y fallar después, en un estado de entrega); estados de entrega o lectura; media, adjuntos y reacciones; iniciar una conversación nueva; cerrar o reabrir conversaciones; asignación, búsqueda, filtros y no leídos; tiempo real o refresco automático; reintento automático de un envío no registrado; límites de tasa; respuestas sugeridas, IA y todo lo listado como futuro (CLAUDE.md §2).
- **Aclara / supersede:**
  - DEC-001: `/conversations` deja de ser placeholder. La navegación no cambia.
  - DEC-036 §12 y DEC-039 §14: entran la bandeja y el envío de texto. Plantillas, estados y media siguen fuera.
  - DEC-039 §5: `whatsapp_lines` tiene lectura de miembros. Las escrituras siguen siendo de provisioning.
  - DEC-039 §6: las conversaciones también las escribe la función de envío. Los miembros siguen sin escribirlas directamente.
  - DEC-036 §5 y §6: la policy de alta de miembros suma `conversation_id IS NULL`, y `addMessage()` sigue siendo la puerta del registro manual.
  - DEC-021 y CLAUDE.md §3: un Route Handler tenant-scoped resuelve con `resolveRequestTenant()`, la misma cadena sin redirects.
  - CLAUDE.md §3: `WHATSAPP_API_TOKEN` es un secreto server-only nuevo, solo para la Cloud API. El service role y la secret key siguen sin aprobarse.
  - CLAUDE.md §2: enviar es irreversible. Lo dispara siempre un miembro con "Enviar" y nada se envía solo.
  - DEC-009: sin dependencias nuevas.
  - Prevalece según DEC-002. No requiere un ADR nuevo: la función vive en `private` (ADR-001 §3.6) y `withTenant()` sigue siendo la puerta de los datos de un usuario.
- **Consecuencias:**
  - `0014_whatsapp_outbound` se aplica a staging después del merge con `preflight → migrate → verify`: `expected_migrations = 0014_whatsapp_outbound` si staging ya tiene `0013`, o con las anteriores que falten delante, en orden. La verificación suma `schema.whatsapp-outbound` y amplía `schema.messages`, `schema.whatsapp-ingestion`, `rls.policies` y `privileges.authenticated`.
  - Operación: `WHATSAPP_API_TOKEN` se configura en Vercel como variable server-only (un token de la Cloud API con permiso de mensajería sobre la cuenta de la línea), y la línea tiene que estar registrada y activa en `whatsapp_lines`.
  - La versión `v20.0` de la Graph API es la del pedido. Meta retira las versiones con el tiempo: cambiarla es cambiar la constante `GRAPH_API_VERSION` de `lib/whatsapp/api.ts`.
  - La limitación C-14 (PII inmutable, sin redacción) también aplica a los mensajes enviados.
  - El runtime acceptance de staging todavía no ejercita el envío: necesita una línea y un número de prueba.

## DEC-041 — Agenda de pruebas de manejo (Calendar, Hito 9)
- **Estado:** Aceptada · 2026-11-01. Formaliza la elección del fundador del 1 nov 2026 ("Calendar: test drives" como Hito 9, entre las opciones que dejó abiertas el cierre del Hito 8). El fundador aprobó la decisión completa el mismo día, incluidas las *propuestas de implementación* (horizonte de 180 días, tolerancia de 5 minutos, superposición como aviso no bloqueante y reprogramación como cancelar y agendar otra).
- **Contexto:** `/calendar` sigue como placeholder (DEC-001, B1 §6). El Master Context §34 ubica la Agenda y el test drive en el Hito 4 de su orden oficial ("Reactivación + Agenda"), y el Technical Blueprint (Agenda) pide "próximos test drives y conflictos" con los estados pendiente, confirmado, completado, cancelado y no-show. No existía ninguna tabla de agenda.
- **Decisión:**
  1. **Alcance.** `/calendar` deja de ser placeholder y muestra la agenda semanal de pruebas de manejo de la organización activa. Una prueba es de una oportunidad abierta y de una unidad del stock, a una hora. Nada más entra en la agenda en este bloque.
  2. **Modelo (`test_drives`).** Tenant-scoped (ADR-001 §3.6): `organization_id` NOT NULL con FK, `opportunity_id` y `vehicle_id` obligatorios con FKs compuestas `(organization_id, …)` RESTRICT, `scheduled_at` (`timestamptz`, acotado a 2000–2100), `status` con CHECK, `created_by` (FK a `profiles`, RESTRICT), `created_at` y `updated_at`. Índices `(organization_id, scheduled_at)` y `(organization_id, opportunity_id)`.
  3. **Estados y escrituras.**
     - `scheduled` (Agendada) → `confirmed` (Confirmada) | `completed` (Realizada) | `no_show` (No asistió) | `cancelled` (Cancelada); `confirmed` → `completed` | `no_show` | `cancelled`. Las terminales no se reabren: reprogramar es cancelar y agendar otra.
     - `completed` y `no_show` solo desde la hora agendada, con el reloj de la base.
     - Alta: cualquier membership activa (admin o seller), en una oportunidad `new`, `qualifying` o `negotiating` y una unidad `available` o `reserved` de la organización activa. La policy de INSERT exige membership activa, `created_by = auth.uid()`, `status = 'scheduled'`, el reloj de la base y una hora no anterior a `now()` menos 5 minutos (*propuesta de implementación*: la tolerancia cubre el tiempo entre abrir el formulario y enviarlo). El horizonte es de 180 días (*propuesta de implementación*, validado en el servidor).
     - Edición: solo `status` y `updated_at`, por columna, con la policy `test_drives_update_member` y el trigger `test_drives_status_transition`, que exige la matriz y la hora, deja inmutable el resto de la fila (también para el rol dueño) y fija `updated_at`. Sin DELETE.
     - Única puerta: las Server Actions `scheduleTestDrive()` y `changeTestDriveStatus()` de `lib/calendar/actions.ts` (`requireTenant()` → validación → `withTenant()`). ESLint impide importar `db/queries/test-drives-write.ts` desde cualquier otro módulo. El cambio de estado es compare-and-set sobre la fila bloqueada: si otra persona ya la movió, responde `unchanged` con el estado real.
  4. **Vista.** Semana de lunes a domingo en la hora de Asunción, en la URL (`/calendar?w=YYYY-MM-DD`; cualquier día identifica su semana). Siete columnas en desktop, dos en tablet y una lista de días en teléfono. Cada tarjeta muestra hora, cliente (lleva a su oportunidad), unidad, estado y quién la agendó ("Vos" u "Otro miembro"). Cada cambio de estado pasa por una confirmación.
     - *Propuesta de implementación:* "conflictos" se muestra como el aviso "Unidad superpuesta" cuando la misma unidad tiene otra prueba abierta a menos de 60 minutos. Es solo un aviso: no bloquea.
     - *Propuesta de implementación:* a lo sumo 500 pruebas por semana y 200 opciones en cada select del alta.
  5. **Sin envíos.** Agendar, confirmar o cancelar no le manda nada al cliente (CLAUDE.md §2). La agenda es interna.
  6. **Migración `0015_test_drives`.** Crea la tabla con RLS, sus policies, la función y el trigger de estados, los grants (`SELECT`, `INSERT` y `UPDATE (status, updated_at)` para `authenticated`) y repite las postcondiciones de 0014 con `test_drives` entre las altas y las ediciones aprobadas, más las del trigger y las FKs compuestas. No toca filas existentes.
  7. **Fuera de este bloque:** recordatorios y mensajes automáticos, reprogramar (editar la hora), duración y franjas configurables, bloqueo de superposiciones, asignación a un vendedor, otros tipos de evento (entregas, visitas, llamadas), sincronización con calendarios externos, vista mensual o diaria, el feed de agenda del Cockpit y que una prueba mueva la recencia de la oportunidad.
- **Aclara / supersede:**
  - DEC-001 y B1 §4 y §6: `/calendar` deja de ser placeholder. La navegación no cambia. Recovery sigue como placeholder.
  - MC §34: la Agenda (test drive) entra antes que el resto del Hito 4 de ese orden (borradores, envío controlado), que sigue pendiente.
  - DEC-009: sin dependencias nuevas (la hora de Asunción usa `Intl`).
  - Prevalece según DEC-002. No requiere un ADR nuevo: el acceso sigue `requireTenant()` → `withTenant()` → RLS (ADR-001).
- **Consecuencias:**
  - `0015_test_drives` se aplica a staging después del merge con `preflight → migrate → verify`, con `expected_migrations = 0015_test_drives` si staging ya tiene `0014` (o con las anteriores que falten delante, en orden).
  - `domains/calendar/zoned-time.ts` repite la conversión de hora de pared de `domains/dashboard/period.ts`. Unificarlas queda como backlog técnico.

---

## DEC-042 — Cotizaciones formales (Deal Management, Hito 10)
- **Estado:** Aceptada · 2026-11-01. Formaliza el pedido del fundador del 1 nov 2026 ("Módulo de Cotizaciones y Ofertas" como Hito 10: presupuesto formal tras un test drive, asociado a un cliente y una unidad, con descuentos, y la oportunidad ganada o perdida). El fundador aprobó la decisión completa el mismo día, incluidas las *propuestas de implementación* (aprobación de admin por encima del 10 %, tope del 30 %, validez de 7 días propuesta y hasta 30, y cotizaciones inmutables que se anulan y se vuelven a crear).
- **Contexto:** DEC-003 ubica el Offer Builder en P1, con persistencia "más adelante, dentro de P1", aprobación humana obligatoria y la consecuencia de que el schema incorporará una entidad de ofertas con estados. Hasta acá solo existía el mock del slice. DEC-034 ya cierra la oportunidad (`won`/`lost`) con sus metadatos por una puerta única, `closeOpportunity()`.
- **Decisión:**
  1. **Alcance.** Una cotización es el presupuesto formal de **una unidad** del stock para **una oportunidad** (el cliente es el de la oportunidad: no se duplica el contacto). Una oportunidad puede tener varias; a lo sumo una aceptada. Se crea en `qualifying` o `negotiating` y para una unidad `available` o `reserved` de la organización activa.
  2. **Estados (`quotes.status`).**
     - `draft` (Borrador) → `approved` (Aprobada) | `withdrawn` (Anulada); `approved` → `sent` (Enviada) | `withdrawn`; `sent` → `accepted` (Aceptada) | `rejected` (Rechazada) | `withdrawn`. Las tres últimas son terminales.
     - `approved` es el **paso de aprobación humana obligatorio** (DEC-003, CLAUDE.md §2): nada pasa a `sent` sin pasar por él. *Propuesta de implementación:* cualquier miembro activo aprueba un descuento efectivo de hasta el 10 %; por encima, solo `admin`.
     - Aprobar, enviar o aceptar exigen la validez vigente y la oportunidad en `qualifying` o `negotiating`; aceptar exige además la unidad `available` o `reserved`. Rechazar o anular siempre se puede (limpian, no comprometen).
     - "Vencida" no es un estado guardado: una cotización abierta cuyo `valid_until` es anterior al día de Asunción se muestra "Vencida" (sin jobs, B1 §4).
     - *Propuesta de implementación:* las condiciones económicas son inmutables desde el alta. Corregir una cotización es anularla y crear otra (como reprogramar en DEC-041).
  3. **Precio y descuento.**
     - `list_price` + `currency`: el precio publicado de la unidad al crear la cotización, copiado por el servidor (no sale del pedido). Una unidad sin precio publicado no se cotiza. Precio publicado ≠ precio ofertado (DEC-003).
     - Un solo descuento: ninguno, un monto fijo (en la moneda de la lista; PYG sin decimales) o un porcentaje (hasta dos decimales). *Propuesta de implementación:* tope del 30 % efectivo.
     - `total_price` = lista − descuento. El porcentaje se redondea al guaraní (PYG) o al centavo (USD), la mitad hacia arriba. Mismo contrato de dinero que DEC-025 §5 y §6: `numeric(14,2)`, sin float ni FX. La base rehace la cuenta en un CHECK.
  4. **Validez y condiciones.** `valid_until` es el último día de validez, inclusive, en días de Asunción. *Propuesta de implementación:* el formulario propone 7 días y admite de hoy a 30 días. `notes` (condiciones) opcionales, de 1 a 500 caracteres, normalizadas como la bitácora (DEC-033 §1). El pedido se valida con Zod (DEC-009, como DEC-034 §7).
  5. **Modelo y base (`0016_quotes`).** Tabla `quotes` tenant-scoped (ADR-001 §3.6) con FKs compuestas `(organization_id, opportunity_id)` y `(organization_id, vehicle_id)` RESTRICT, número correlativo por organización (`UNIQUE (organization_id, number)`, asignado por el trigger `quotes_assign_number` con un advisory lock por organización), CHECKs de precio, descuento, total, validez, notas y sellos, y el índice único parcial `quotes_accepted_opportunity_key`.
     - RLS: lectura por membership activa; alta con `created_by = auth.uid()`, `status = 'draft'`, sin sellos, el reloj de la base, la oportunidad cotizable y la unidad en stock con el precio publicado igual a la lista; edición tenant-scoped.
     - Grants: `SELECT`, `INSERT` y `UPDATE (status, updated_at)` para `authenticated`. Sin DELETE.
     - El trigger `quotes_status_transition` exige la matriz, la validez, la oportunidad abierta, la unidad en stock, el rol `admin` sobre el 10 % y un usuario para aprobar; deja inmutable el resto de la fila (también para el rol dueño) y fija `approved_by`/`approved_at`, `sent_at`, `decided_at` y `updated_at`.
     - Postcondiciones: las de 0015 con `quotes` entre las altas y `quotes.status`/`updated_at` entre las ediciones aprobadas, más los triggers, sus funciones, las FKs compuestas, los CHECKs y los índices únicos.
  6. **Sin envíos.** "Enviada" lo marca el vendedor cuando entregó el presupuesto por su cuenta. Porandú no manda nada al cliente (B1 §4: envío real de ofertas fuera de alcance). Un PDF o un mensaje de WhatsApp con la cotización requieren una decisión nueva.
  7. **Ganada y perdida.** Aceptar o rechazar una cotización **no cierra** la oportunidad: el cierre sigue siendo un solo acto por `closeOpportunity()` (DEC-034 §1). *Propuesta de implementación:* con una cotización aceptada, el diálogo "Marcar como ganada" precarga el precio final y la moneda con su total (editables), y la unidad vinculada se compara con la cotizada solo como aviso.
  8. **Puertas únicas.** Server Actions `createQuote()` y `changeQuoteStatus()` en `lib/quotes/actions.ts` → `db/queries/quotes-write.ts` (`requireTenant()` → validar → `withTenant()` → filas bloqueadas → `planQuoteTransition()` → UPDATE compare-and-set → trigger). ESLint impide importar el módulo de escritura desde otro lado. Lectura en `db/queries/quotes.ts`, dentro de la transacción del loader de `/opportunities/[id]`. Resultados de `createQuote()`: `created`, `invalid` (errores por campo, incluida la unidad fuera de stock o sin precio publicado), `opportunity_unavailable` y `failed`. De `changeQuoteStatus()`: `changed`, `unchanged` (compare-and-set, con el estado real), `not_found`, `invalid_transition`, `expired`, `opportunity_closed`, `vehicle_unavailable`, `requires_admin`, `already_accepted` y `failed`.
  9. **UI.** En `/opportunities/[id]`, un panel "Cotizaciones" con la lista (número, unidad, total, validez, estado) y un drawer "Nueva cotización" (Radix Dialog) con la unidad, el precio de lista de solo lectura, el descuento con el total en vivo, la validez y las condiciones. Cada cambio de estado pasa por una confirmación (alertdialog de Radix).
  10. **Fuera de este bloque:** editar una cotización, PDF o envío al cliente, varias unidades o accesorios por cotización, trade-in y financiación (motor financiero, TB §4), Goal Seek, comisiones, reservar o vender la unidad al aceptar, límites de descuento configurables por organización, el Deal Health real y mostrar cotizaciones en la cola, Stock o el Cockpit.
- **Aclara / supersede:**
  - DEC-003: la entidad de ofertas con estados se persiste como `quotes`. El Offer Builder completo de 8 secciones sigue como referencia visual; este bloque persiste su núcleo (precio, descuento, validez y aprobación).
  - B1 §4: la persistencia de `offers` deja de estar diferida para este núcleo. El envío real sigue fuera.
  - DEC-009: sin dependencias nuevas.
  - Prevalece según DEC-002. No requiere un ADR nuevo: el acceso sigue `requireTenant()` → `withTenant()` → RLS (ADR-001).
- **Consecuencias:**
  - `0016_quotes` se aplica a staging después del merge con `preflight → migrate → verify`, con `expected_migrations = 0016_quotes` si staging ya tiene `0015`.
  - Cuando se habilite reservar o vender una unidad, ese flujo tiene que considerar las cotizaciones abiertas que la tienen: hoy aceptar no saca la unidad de `available`.

---

## DEC-043 — Dashboard Directivo: KPIs comerciales, rangos de fechas y política de caché
- **Estado:** Aceptada en principio · 2026-11-01. Formaliza el pedido del fundador del 1 nov 2026 (arquitectura y reglas de negocio del Dashboard Directivo y de Métricas, con el módulo de Cotizaciones ya mergeado): vista analítica para la gerencia con ventas cerradas, cotizaciones pendientes, tasa de conversión y test drives de la semana, rangos de fechas, caché y eficiencia de las consultas. Los puntos marcados como *propuesta de implementación* los eligió el equipo dentro de ese pedido y pasan a Aceptada con la aprobación del fundador en la revisión del PR. El punto §3.3 queda **pendiente de confirmación** del fundador.
- **Contexto:** DEC-037 ya puso el Dashboard Directivo en `/intelligence`, con métricas del mes en curso calculadas en cada lectura. Desde entonces existen dos fuentes nuevas que la gerencia no ve agregadas: las pruebas de manejo (DEC-041) y las cotizaciones con su paso de aprobación humana (DEC-042). DEC-037 §13 dejó fuera los filtros por período y las cachés; el pedido nuevo pide manejar rangos de fechas y definir la caché.
- **Decisión:**
  1. **Ruta y navegación.** Sin cambios (DEC-037 §1): el dashboard sigue en `/intelligence` ("Inteligencia"). No se agrega `/dashboard` ni un ítem de navegación. El home sigue siendo el Action Cockpit.
  2. **Rango de fechas.** Reemplaza el "mes en curso" fijo de DEC-037 §4 por un rango elegido en la URL, puro en `domains/dashboard/range.ts` (`resolveDashboardRange()`, con `now` y la zona explícitos):
     - Sin parámetros: el mes en curso de Asunción, exactamente la ventana de DEC-037 §4.
     - *Propuesta de implementación:* presets `?range=` `month` (Mes en curso), `previous_month` (Mes anterior), `last_30_days` (Últimos 30 días: hoy y los 29 anteriores), `quarter` (Trimestre en curso) y `year` (Año en curso), y `?range=custom&from=YYYY-MM-DD&to=YYYY-MM-DD` con los dos días incluidos.
     - Días de calendario de `America/Asuncion`. El rango es el intervalo de instantes [primer instante de `from`, primer instante del día siguiente a `to`), con límite exclusivo, como DEC-037 §4. La base solo compara instantes.
     - La URL es input no confiable: fechas inexistentes, fuera de 2000–2100, `from` posterior a `to` o un rango desconocido caen al mes en curso con un aviso visible, nunca a un error. Un `to` posterior a hoy se recorta a hoy.
     - *Propuesta de implementación:* un rango personalizado tiene a lo sumo 366 días (acota el costo de cada lectura).
     - **A qué aplica.** El rango aplica a los flujos: ventas cerradas, perdidas, tasa de conversión y unidades vendidas. Las existencias son el estado de hoy y no dependen del rango (DEC-037 §4): oportunidades activas, cotizaciones pendientes, unidades en stock y reservadas, y atención. Las pruebas de manejo son siempre las de la semana en curso (§5).
  3. **Ventas cerradas y tasa de conversión.**
     1. *Ventas cerradas:* oportunidades `won` con cierre en el rango. La fecha de cierre sigue siendo `updated_at` (DEC-037 §5, con su requisito sobre el toque de actividad).
     2. *Tasa de conversión:* ventas cerradas / (ganadas + perdidas) con cierre en el rango, en porcentaje con un decimal y redondeo exacto sobre enteros. Es la regla del win rate de DEC-037 §6 aplicada al rango. Sin cierres en el rango es "Sin dato" (DEC-005), nunca 0 %. La tarjeta "Win rate" pasa a llamarse "Tasa de conversión": un número, un nombre.
     3. **Pendiente de confirmación del fundador:** si "tasa de conversión" debe medir otra cosa (por ejemplo, cotizaciones aceptadas / cotizaciones decididas, o ventas / oportunidades creadas en el rango), se cambia solo esta regla antes de construir la UI. Mientras tanto rige 3.2.
  4. **Cotizaciones pendientes.** Estado actual, no del rango. Cuenta las cotizaciones abiertas (`draft`, `approved`, `sent`) de oportunidades cotizables (`qualifying` o `negotiating`):
     - *Pendientes* = vigentes por aprobar (`draft`) + por enviar (`approved`) + esperando respuesta (`sent`). Vigente = `valid_until` no anterior al día de Asunción (último día inclusive, DEC-042 §4).
     - El desglose se muestra como contexto de la tarjeta: "N por aprobar · N por enviar · N esperando respuesta". Por aprobar es el paso de aprobación humana obligatorio (DEC-042 §2).
     - *Vencidas sin cerrar:* abiertas con la validez vencida. No suman a las pendientes y se muestran aparte, con el tono de advertencia junto a su texto, porque piden anularse o rehacerse.
     - *Propuesta de implementación:* una cotización abierta de una oportunidad ya cerrada no cuenta: ya no se puede aprobar, enviar ni aceptar (DEC-042 §2), así que no está pendiente de nada.
     - Las terminales (`accepted`, `rejected`, `withdrawn`) nunca cuentan como pendientes.
  5. **Test drives de la semana.** La semana en curso de lunes a domingo en la hora de Asunción, la misma de `/calendar` (DEC-041 §4), por `scheduled_at`:
     - *Agendadas* = por realizar (`scheduled` + `confirmed`) + realizadas (`completed`) + no asistió (`no_show`). Las canceladas no ocupan la agenda y se muestran aparte.
     - La tarjeta enlaza a `/calendar?w=<lunes>`.
     - *Propuesta de implementación:* la semana no sigue el rango: es una métrica operativa de "esta semana", como pide el pedido.
  6. **Caché.** Se mantiene DEC-037 §3: tiempo real = cálculo en cada lectura. *Propuesta de implementación:*
     - **Sin caché compartida entre requests.** No se usan `"use cache"`, `unstable_cache`, `revalidate` ni cachés de `fetch` para datos del dashboard. La lectura corre como `authenticated` con los claims de la request dentro de `withTenant()` (ADR-001): una caché compartida ejecutaría fuera de esa cadena o dependería de una clave por organización que, con un error, mostraría datos de otra organización. Además, la gerencia necesita ver el último dato confirmado (una cotización recién aprobada, un cierre de hace un minuto).
     - **Memoización por request.** El loader se envuelve en `cache()` de React con argumentos primitivos (`rangeKey()`): si varios Server Components de la misma request lo piden, se hace una sola transacción. No sobrevive a la request.
     - **Render dinámico.** `/intelligence` ya es dinámica (lee cookies). Los enlaces de rango usan `prefetch={false}`: un prefetch por hover no dispara lecturas agregadas.
     - **Sin revalidaciones nuevas.** Las Server Actions de cierres, cotizaciones y pruebas no necesitan `revalidatePath("/intelligence")`: no hay nada cacheado que invalidar.
     - Si el volumen del piloto lo exigiera, la alternativa (vistas materializadas o caché por organización) requiere una decisión nueva con su análisis de aislamiento.
  7. **Eficiencia de las consultas.**
     - Una sola transacción `withTenant()` por request con lecturas de una fila (`count(*) FILTER`), además del agregado de inventario y la lista en riesgo de DEC-037 §10: una pasada por organización y por tabla, sin traer filas a la aplicación.
     - Toda lectura filtra por `organization_id` (ADR-001 §2) y usa índices que empiezan por él: `test_drives (organization_id, scheduled_at)`, `quotes (organization_id, opportunity_id)` y la unique `opportunities (organization_id, id)` para el join.
     - *Propuesta de implementación:* migración `0017_dashboard_indexes` con un índice parcial `opportunities_organization_id_closed_at_idx` sobre `(organization_id, updated_at) WHERE stage IN ('won', 'lost')`, para que los cierres de un rango (hasta un año) no recorran las abiertas. Solo un índice: sin tablas, policies ni grants nuevos.
  8. **Capa de datos.**
     - Dominio puro: `domains/dashboard/range.ts` (rango), `domains/dashboard/commercial.ts` (conversión, cotizaciones pendientes y pruebas de la semana) y `domains/dashboard/metrics.ts` (sin cambios de reglas).
     - Lecturas: `db/queries/dashboard-commercial.ts` (`selectClosedCounts()`, `selectPendingQuoteCounts()` y `selectWeekTestDriveCounts()`), que reciben la transacción y no son loaders.
     - Loader: `getExecutiveDashboard(params, now)` (`db/queries/dashboard.ts`), `requireTenant()` → `withTenant()` → todas las lecturas en la misma transacción → dominio → ViewModel.
     - Solo lectura: no escribe nada ni cambia `last_activity_at`, `updated_at` o estados. No hay Server Actions nuevas: cambiar el rango es una navegación GET.
  9. **UI de `/intelligence`.** DEC-013 sin cambios (workspace claro, tokens, colores de estado solo junto a un texto).
     - Encabezado con el rango ("Mes en curso: noviembre de 2026") y un selector: los presets como enlaces de navegación (`aria-current`) y "Personalizado" en un drawer (Radix Dialog, `components/ui/drawer.tsx`) con un formulario GET de dos fechas. Sin dependencias nuevas.
     - Una fila de cuatro KPIs arriba: Ventas cerradas, Tasa de conversión (con el medidor de DEC-037 §12), Cotizaciones pendientes (con el desglose y las vencidas) y Test drives de la semana (con el desglose y el enlace a la agenda).
     - Debajo, los bloques de DEC-037 §12 (Pipeline comercial, Salud del inventario y Atención) y el rail de Oportunidades en riesgo.
     - Server Components; solo el drawer del rango es de cliente.
  10. **Autorización.** Sin cambios (DEC-037 §11): cualquier membership activa. Restringirlo a `admin` requiere una decisión nueva.
  11. **Fuera de este bloque:** comparación con el período anterior, gráficos y series históricas, metas, filtros por vendedor, montos (valor cotizado, vendido o pipeline por moneda), tasa de aceptación de cotizaciones, tasa de asistencia a pruebas, exportación, refresco automático o streaming, cachés compartidas o materialización, `closed_at`, la restricción por rol, el Cockpit y todo lo listado como futuro (CLAUDE.md §2).
- **Aclara / supersede:**
  - DEC-037 §4: el período fijo pasa a ser un rango elegido en la URL, con el mes en curso como default.
  - DEC-037 §6 y §12: el win rate se rotula "Tasa de conversión" y se suma la fila de KPIs.
  - DEC-037 §10: el loader suma las lecturas de cotizaciones y pruebas.
  - DEC-037 §13: los filtros por período entran; las cachés siguen fuera, ahora con la política de §6.
  - DEC-041 y DEC-042: el dashboard lee `test_drives` y `quotes` sin cambiarlos.
  - Prevalece según DEC-002. No requiere un ADR nuevo: el acceso sigue `requireTenant()` → `withTenant()` → RLS (ADR-001).
- **Consecuencias:**
  - `0017_dashboard_indexes` se aplica a staging después del merge con `preflight → migrate → verify`, con `expected_migrations = 0017_dashboard_indexes` si staging ya tiene `0016`.
  - Cada request de `/intelligence` hace seis lecturas agregadas en una transacción. El costo lo acotan el filtro por organización, los índices y el tope de 366 días.
  - Habilitar la edición de una oportunidad cerrada sigue exigiendo `closed_at` antes (DEC-037 §5).
  - `domains/dashboard/range.ts` reutiliza la hora de pared de `domains/calendar/zoned-time.ts`. Unificar `domains/dashboard/period.ts` con ese módulo sigue como backlog técnico (DEC-041).

---

## DEC-044 — Bandeja premium: orden del chat, leído por miembro, estados de entrega y oportunidad de la conversación (Hito 12)
- **Estado:** Aceptada en principio · 2026-11-01. Formaliza el pedido del fundador del 1 nov 2026 (arquitectura, reglas de negocio y primeras capas de UI y dominio de la Bandeja de Entrada, con el Dashboard ya mergeado): una interfaz de chat premium, 100 % responsiva, y las reglas del orden de los mensajes, los estados de lectura y la asociación con oportunidades. Los puntos marcados como *propuesta de implementación* los eligió el equipo dentro de ese pedido y pasan a Aceptada con la aprobación del fundador en la revisión del PR. El fundador aprobó el mismo día los dos puntos que quedaban pendientes (§2.6 y §3.4).
- **Contexto:** DEC-040 (Hito 8) ya puso la bandeja de dos columnas y el envío de texto. Debajo de `lg` las columnas se apilan, el historial es una sola lista con la fecha completa en cada burbuja y nada dice a qué oportunidad se suman los mensajes. DEC-040 §11 dejó fuera los no leídos y los estados de entrega o lectura, y DEC-039 §9 fijó la asociación con la oportunidad abierta única. El pedido llama "Hito 11" al Dashboard (DEC-043): este bloque es el Hito 12. "Estados de lectura" nombra dos cosas que se separan: el leído interno del equipo (§2) y el "visto" del cliente en WhatsApp (§3).
- **Decisión:**
  1. **Orden del chat (aclara DEC-040 §1).**
     - El historial sigue del más viejo al más nuevo por `sent_at`, con desempate por `created_at` e id. Un mensaje viejo que el proveedor entrega tarde se ubica en su lugar cronológico, no al pie; la lista no retrocede porque `last_message_at` solo avanza (DEC-039 §8).
     - Separadores por día de calendario de Asunción: "Hoy", "Ayer", "Lunes 26 de octubre" en el año en curso y "26 de octubre de 2025" en otro. El separador queda fijo arriba mientras se recorre su día.
     - *Propuesta de implementación:* dos mensajes seguidos de la misma dirección y el mismo autor ("Cliente", "Vos" u "Otro miembro"), del mismo día y a lo sumo a 5 minutos, forman un grupo: solo el primero muestra el autor y la cola de la burbuja. Cada burbuja muestra su hora ("14:32") y la fecha completa en el `title`.
     - La lista no cambia de orden (`last_message_at` descendente, sin mensajes al final). Cada conversación muestra la hora de chat: "14:32" hoy, "Ayer", el día de la semana hasta seis días atrás, "26 oct" en el año en curso y "26 oct 2025" en otro. *Propuesta de implementación:* los no leídos (§2) no reordenan ni fijan conversaciones arriba.
     - Puro en `domains/conversations/chat-time.ts` y `domains/conversations/thread-layout.ts`, con el instante de la request explícito.
  2. **Leído interno del equipo (no leídos).**
     1. Por miembro: cada membership activa tiene su propio cursor por conversación. No hay responsable asignado (DEC-023): que un vendedor lea no marca leído para otro.
     2. Solo cuentan los entrantes. Lo que envía el equipo nunca está sin leer.
     3. El cursor es el `created_at` (reloj de la base) del mensaje más nuevo que el miembro tenía en pantalla, resuelto por la base a partir de su id. No es `now()`, `sent_at` ni un reloj del cliente: un mensaje que llegó mientras tanto, o uno viejo entregado tarde, sigue sin leer.
     4. Responder es leer: la última respuesta del propio miembro en la conversación también es cursor.
     5. El cursor solo avanza (`GREATEST`): marcar un mensaje más viejo no vuelve a mostrar nada como no leído.
     6. **Aprobado por el fundador (2026-11-01):** sin cursor ni respuesta propia, todo entrante está sin leer. Al desplegar, cada miembro ve sin leer las conversaciones con entrantes hasta abrirlas. Sembrar los cursores en la migración queda descartado: contradice "no toca filas existentes".
     7. Marcar visto nunca es efecto de un GET: un prefetch de la lista, un enlace compartido o una pestaña en segundo plano no marcan. Lo marca la Server Action `markConversationRead({ conversationId, upToMessageId })`, que el historial dispara en el navegador cuando la conversación está a la vista. El pedido se valida con Zod (`parseMarkRead()`, DEC-009); uno inválido se ignora sin error.
     8. *Propuesta de implementación:* la lista muestra el contador de entrantes sin leer ("99+" desde 100, con "N mensajes sin leer" en texto) y el nombre en negrita. El historial muestra el separador "Mensajes nuevos" antes del primero sin leer.
     9. *Propuesta de implementación (12B, migración `0018_conversation_reads`):* tabla `conversation_reads` (`organization_id`, `conversation_id`, `user_id`, `read_up_to`, `updated_at`), PK `(organization_id, conversation_id, user_id)`, FK compuesta a `conversations` y FK a `profiles`, con RLS: SELECT solo de las filas propias (`user_id = auth.uid()` y membership activa) y sin INSERT, UPDATE ni DELETE para `authenticated`. Escribe solo `private.mark_conversation_read(organización, conversación, mensaje)`, `SECURITY DEFINER` de `postgres`, con `search_path` vacío y EXECUTE solo para `authenticated`: exige usuario en los claims, membership activa, la conversación abierta de la organización y un mensaje de esa conversación, y guarda su `created_at` con `GREATEST`. Idempotente. El contador se lee en el loader con `count(*) FILTER` por conversación y un índice `messages (organization_id, conversation_id, created_at) WHERE conversation_id IS NOT NULL`.
  3. **Estado de entrega de los salientes (el "visto" del cliente).**
     1. Estados `sent` (Enviado), `delivered` (Entregado), `read` (Leído) y `failed` (No entregado). Todo saliente registrado nace `sent`: la base lo registra después del `200` de Meta (DEC-040 §6). Desde este bloque se muestra así.
     2. El vigente es el de mayor precedencia entre los recibidos (`sent` < `failed` < `delivered` < `read`), sin importar el orden de llegada ni las repeticiones. Un `failed` no pisa un `delivered` ni un `read`. Puro en `domains/conversations/delivery.ts`.
     3. *Propuesta de implementación (12C, migración `0019_message_statuses`):* los `statuses[]` del webhook, que hoy se ignoran con `200` (DEC-039 §3), se ingieren por `withIngestion()` → `private.ingest_whatsapp_status()`, `SECURITY DEFINER` y con el rechazo de claims de DEC-039 §4. La organización sale de la línea receptora y el mensaje se busca por `(organization_id, external_id)` con `direction = 'outbound'`. Tabla append-only `message_statuses` con unique `(organization_id, message_id, status)` para la idempotencia. Los mensajes siguen inmutables (C-11): el estado no es una columna de `messages`. Un estado de un id desconocido se ignora con `200`.
     4. **Aprobado por el fundador (2026-11-01):** Porandú **no** envía a Meta confirmaciones de lectura de los entrantes (las tildes azules que ve el cliente). Es una decisión comercial: protege la negociación del vendedor, que no le revela al cliente cuándo leyó su mensaje. Además sería una escritura hacia el proveedor que nadie disparó explícitamente (CLAUDE.md §2). Marcar visto (§2.7) es solo interno. Cambiarlo requiere una decisión nueva.
     5. Cada saliente muestra el ícono y el estado en texto. Solo "No entregado" usa un tono de estado, junto a su texto (DEC-013).
  4. **Oportunidad de la conversación (aclara DEC-039 §9 y DEC-040 §6, sin cambiar la regla).**
     1. La asociación sigue en la base, al registrar cada mensaje: la oportunidad abierta (`new`, `qualifying` o `negotiating`) del contacto cuando hay exactamente una. Con ninguna o con varias no se asocia, no se adivina el negocio y no se crea una oportunidad.
     2. Un mensaje registrado no cambia de oportunidad (append-only, C-11). Reasociar a mano requiere una decisión nueva.
     3. El encabezado del historial dice a qué se suma lo que el vendedor responda ahora, con la misma regla: "Oportunidad abierta: En negociación · actividad …" con enlace a `/opportunities/[id]`; "N oportunidades abiertas · Los mensajes no se asocian a ninguna", en tono de advertencia junto al texto y con un menú de Radix que lista hasta cinco por actividad más reciente; o "Sin oportunidad abierta".
     4. La lectura va en la transacción del loader de `/conversations`: las abiertas del contacto con filtro por `organization_id`, sobre el índice `(organization_id, contact_id)`. Puro en `domains/conversations/opportunity-link.ts`.
  5. **UI premium y responsiva.**
     - Desde `lg`, dos columnas con scroll propio. Debajo, maestro/detalle por URL: sin `?c=` se ve la lista a pantalla completa; con `?c=`, solo el chat, con "Volver" a `/conversations`. Lo decide el servidor, sin JavaScript, así que el botón atrás del teléfono vuelve a la lista.
     - *Propuesta de implementación:* en una pantalla táctil (`pointer: coarse`), Enter escribe una línea nueva y se envía solo con el botón. El atajo de teclado se oculta debajo de `sm`.
     - Radix (`DropdownMenu` de `components/ui/`) y Tailwind con los tokens de DEC-013. Sin dependencias nuevas.
  6. **Capas.** Dominio puro en `domains/conversations/`: `chat-time.ts`, `thread-layout.ts`, `read-state.ts`, `delivery.ts`, `opportunity-link.ts` e `inbox.ts` ampliado. UI en `components/inbox/`. El loader `getInbox()` sigue siendo `requireTenant()` → `withTenant()` → RLS y no escribe nada. En 12B y 12C, cada escritura nueva tiene su puerta única con guard de ESLint, como DEC-040 §9.
  7. **Autorización.** Sin cambios (DEC-040 §3): cualquier membership activa.
  8. **Fuera de este bloque:** tiempo real o refresco automático, el contador en la navegación, asignación, búsqueda y filtros (también "solo no leídos"), cerrar o reabrir conversaciones, iniciar una conversación, crear una oportunidad desde la conversación, reasociar mensajes, plantillas y la ventana de 24 horas, media, las confirmaciones de lectura al cliente (descartadas, §3.4), IA y todo lo listado como futuro (CLAUDE.md §2).
- **Aclara / supersede:**
  - DEC-040 §11: entran los no leídos (§2) y los estados de entrega (§3). Tiempo real, asignación, búsqueda y filtros siguen fuera.
  - DEC-040 §1: el historial se agrupa por día y por autor, y la lista usa la hora de chat. El orden no cambia.
  - DEC-039 §3 y §14: los `statuses[]` del webhook se ingieren cuando entre 12C; hasta entonces se siguen ignorando con `200`.
  - DEC-039 §9 y DEC-040 §6: la regla de asociación no cambia; la bandeja la muestra.
  - B1 §4 ("optimización móvil más allá de razonablemente usable"): la bandeja es responsiva por pedido del fundador.
  - DEC-009: sin dependencias nuevas.
  - Prevalece según DEC-002. No requiere un ADR nuevo: las funciones nuevas viven en `private` (ADR-001 §3.6), el leído pasa por `requireTenant()` → `withTenant()` y los estados por `withIngestion()` (DEC-039 §4).
- **Consecuencias:**
  - 12A (este bloque) no tiene migración: la UI y el dominio usan datos que ya existen, y "Enviado" es el estado real de todo saliente registrado.
  - `0018_conversation_reads` (12B) y `0019_message_statuses` (12C) se aplican a staging después de su merge con `preflight → migrate → verify`.
  - El shell sigue siendo desktop-first (rail de navegación de 4rem): en teléfono la bandeja usa el ancho que queda. Un shell móvil requiere una decisión nueva.
  - **12B (implementación de §2).** *Propuestas de implementación* dentro de §2.7 a §2.9, que pasan a Aceptada con la aprobación del fundador en la revisión del PR:
    - **Esquema.** La FK compuesta a `conversations` necesita una unique nueva `(organization_id, id)` en `conversations` (segura: `id` ya es PK). La FK a `profiles` es CASCADE, como `memberships` (DEC-018): el cursor es estado del miembro, no un registro de auditoría. `0018` repite las postcondiciones de `0016` y `0017` y suma las de §2.9.
    - **Función.** `private.mark_conversation_read()` devuelve `marked` (avanzó), `unchanged` (ya estaba ahí o más adelante: no escribe) o `not_found` (conversación cerrada, de otra organización o inexistente, o mensaje ajeno, sin distinguir). Sin usuario o sin membership activa es `42501` (`read_requires_user`, `read_not_member`).
    - **Precisión.** La base guarda el `created_at` completo (microsegundos), pero el contador de la lista y el historial comparan al milisegundo, la precisión de `Date` en el dominio: así cuentan lo mismo y marcar el mensaje más nuevo en pantalla siempre deja la conversación en cero. Un entrante registrado en el mismo milisegundo que el mensaje marcado cuenta como leído.
    - **Cuándo se marca.** El historial llama a la Server Action solo si hay entrantes sin leer, con la pestaña visible y el historial en pantalla (IntersectionObserver), con el mensaje registrado más tarde entre los que muestra. Si falla, lo reintenta la próxima vez que vuelve a estar a la vista.
    - **Después de marcar.** Si el cursor avanzó, la acción revalida `/conversations`: el contador de la lista se actualiza y el caché del router no vuelve a mostrar la conversación sin leer con el botón atrás. El separador "Mensajes nuevos" queda donde estaba mientras la conversación sigue abierta (lo recuerda el historial en el navegador). Una navegación durante la marca no espera: Next la prioriza y refresca al terminar.
    - **Lista.** La conversación elegida no muestra el contador (está a la vista). Una conversación con no leídos lleva el contador (Tailwind y tokens de DEC-013, con el texto completo en un tooltip de Radix), el nombre en negrita y la hora y el preview resaltados.
    - **Puerta única.** ESLint restringe por nombre `recordConversationRead()` de `db/queries/conversation-reads.ts`: solo la importa `lib/conversations/read.ts`. Las lecturas del mismo módulo (los contadores y el cursor) las usa el loader de `/conversations`.
  - **12C (implementación de §3).** Pedido del fundador del 1 nov 2026 ("Hito 12C: estados de entrega"). *Propuestas de implementación* dentro de §3.3, que pasan a Aceptada con la aprobación del fundador en la revisión del PR:
    - **Nombre de la migración.** `0019_whatsapp_delivery_status`, el nombre que pidió el fundador, en lugar de `0019_message_statuses` (§3.3). Solo cambia el nombre del archivo: la tabla sigue siendo `message_statuses`. Prevalece la instrucción explícita más reciente del fundador (DEC-002, DEC-014).
    - **Esquema.** `message_statuses` (`organization_id`, `message_id`, `status`, `occurred_at`, `created_at`). La unique de §3.3 es la PK `(organization_id, message_id, status)`, que también es el índice que empieza por `organization_id` (ADR-001 §3.6). `occurred_at` es el `timestamp` del proveedor y `created_at`, el reloj de la base. FK compuesta `(organization_id, message_id)` → `messages (organization_id, id)`, RESTRICT, sobre una unique nueva de `messages` (segura: `id` ya es PK); CHECK de los cuatro estados de §3.1. Lectura de los miembros (`message_statuses_select_member`), solo SELECT para `authenticated`, y append-only también para `service_role`, como los otros ledgers (C-11). `0019` repite las postcondiciones de `0018` y suma las de §3.
    - **Función.** `private.ingest_whatsapp_status(línea, wamid, estado, ocurrido)` devuelve `recorded`, `duplicate` (el mismo estado del mismo mensaje: no escribe), `unknown_line` (línea desconocida o inactiva) o `unknown_message` (ningún saliente de esa organización con ese id: también un entrante o uno de otra organización). Con claims es `42501` (`ingestion_without_user`, como DEC-039 §4); sin todos los argumentos, `22004`.
    - **Payload.** `domains/webhooks/whatsapp-status.ts` valida `id`, `status` y `timestamp` (estricto en lo que se usa, tolerante a `recipient_id`, `conversation`, `pricing`, `errors` y a campos nuevos). Otro estado del proveedor (`deleted`, `warning`…) se ignora (`ignored`); uno con un campo inválido se descarta sin frenar el lote. La respuesta del webhook suma `statuses` con sus conteos; los de los mensajes no cambian, salvo que `ignored` ya no cuenta los estados del contrato.
    - **Orden y fallas.** Primero los mensajes del lote, después los estados, cada uno en su transacción. Si una escritura falla, `500` y el reintento del proveedor encuentra lo ya registrado como `duplicate`.
    - **Bandeja.** El loader lee los estados de cada saliente del historial en su transacción (sobre la PK) y el dominio calcula el vigente (§3.2): un estado inferior que llega tarde se registra, pero nunca pisa uno superior. La UI ya existente (`DeliveryMark`, 12A) muestra el estado real.
    - **Puerta única.** ESLint: `db/queries/ingest-whatsapp-status.ts` solo lo importa el webhook (`lib/whatsapp/webhook.ts`), y `withIngestion()` solo los dos módulos de ingesta. `CLAUDE.md` §3 se alinea.
    - **Limitaciones.** Un estado que llega antes de que el envío quede registrado (la carrera entre el `200` de Meta y el registro, o un `500 unrecorded`, DEC-040 §8) es `unknown_message` y se ignora con `200`, como manda §3.3: no se reintenta. El motivo de una falla (el código de error de Meta) no se guarda ni se muestra.
    - **Staging.** `0019_whatsapp_delivery_status` se aplica después del merge con `preflight → migrate → verify`. La verificación suma `schema.message-statuses` y `privileges.service_role-message-statuses`, y amplía `schema.tables`, `rls.policies`, `schema.messages` y `privileges.authenticated`.

---

## DEC-045 — Agenda ejecutiva: grilla horaria semanal, día en foco y lenguaje de estados (Hito 13)
- **Estado:** Aceptada en principio · 2026-11-02. Formaliza el pedido del fundador del 2 nov 2026 (interfaz "Calendario Ejecutivo" de la agenda de pruebas de manejo con Radix y Tailwind, 100 % responsiva: lista o grilla ágil en teléfono y vista de semana en escritorio, filtrada por día y por semana, con el estado de cada prueba identificable a simple vista). Los puntos marcados como *propuesta de implementación* los eligió el equipo dentro de ese pedido y pasan a Aceptada con la aprobación del fundador en la revisión del PR.
- **Contexto:** DEC-041 (Hito 9) ya puso la agenda semanal con su backend completo: `0015_test_drives` (RLS, trigger de estados y grants), las Server Actions `scheduleTestDrive()` y `changeTestDriveStatus()` y el loader `getCalendarAgenda()`. Su vista apila tarjetas en siete columnas en desktop, dos en tablet y una lista de los siete días en teléfono: las tarjetas no se ubican por hora, así que la semana no se lee como un calendario, y en teléfono hay que recorrer los días anteriores para llegar a hoy. DEC-041 §7 dejó fuera la vista diaria. El pedido nombra los estados "Pendiente, Completada, No asistió": son los de DEC-041 con otro nombre (§5).
- **Decisión:**
  1. **Sin cambios de datos.** Ni migración, ni Server Actions, ni escrituras nuevas: la misma tabla `test_drives`, los mismos estados, la misma matriz y la misma confirmación de cada cambio (DEC-041 §3), el mismo loader (`requireTenant()` → `withTenant()` → RLS) y los mismos topes (500 pruebas por semana, 200 opciones por select). Es una capa de presentación sobre lo que ya existe.
  2. **Semana y día en foco en la URL.** La semana sigue en `?w=YYYY-MM-DD` y cualquier día la identifica (DEC-041 §4). Ese día pasa a ser además el **día en foco**; sin `?w=` válido, el día en foco es hoy. Anterior y siguiente llevan al mismo día de la semana anterior o siguiente, y "Hoy", a hoy. Todo es navegación GET (se comparte, se vuelve atrás y se recarga) y elegir un día no lee nada distinto: el loader sigue leyendo la semana. Al agendar, la agenda salta a la semana de la prueba con su día en foco.
  3. **Escritorio (desde `lg`): grilla horaria semanal.** Siete columnas, de lunes a domingo, sobre un eje de horas de Asunción común a la semana. Cada prueba es un bloque ubicado por su hora, con el alto de la franja de 60 minutos que DEC-041 ya usa para avisar superposiciones (`TEST_DRIVE_SLOT_MINUTES`). No es una duración: DEC-041 §7 la deja fuera.
     - *Propuesta de implementación:* el eje va de 08:00 a 20:00 y se extiende hasta la hora entera que contiene la prueba más temprana de la semana y hasta la que cierra la franja de la más tardía, como mucho la medianoche: nunca deja una prueba afuera.
     - Los bloques de un día cuyas franjas se pisan, aunque sean de unidades distintas, se reparten el ancho en carriles en orden de hora. Es solo presentación: el aviso "Unidad superpuesta" (la misma unidad, DEC-041 §4) no cambia y además se marca en el bloque con un contorno de advertencia y un ícono.
     - El bloque muestra hora, estado, cliente y unidad, recortados si el carril es angosto (la forma del estado se ve siempre). Es un botón que abre un drawer (Radix Dialog, `components/ui/drawer.tsx`) con la tarjeta completa de DEC-041 §4: cliente con enlace a su oportunidad, unidad, estado, aviso, quién la agendó y el menú de estados con su confirmación, más "Ver oportunidad".
     - El encabezado de cada día queda fijo al recorrer las horas, con la cantidad de pruebas; hoy se destaca y los días pasados se atenúan.
     - *Propuesta de implementación:* una línea "ahora" sobre la columna de hoy, que arranca con la hora del request y se mueve sola cada minuto en el navegador. Es solo visual: no revalida la agenda.
  4. **Teléfono y tablet (debajo de `lg`): día en foco.** Una tira de los siete días (con la cantidad de pruebas de cada uno, hoy con un anillo y el día en foco destacado) y, debajo, la agenda del día en foco de la más temprana a la más tardía con las tarjetas completas de DEC-041 §4. Tocar un día es un enlace a `?w=<día>`: funciona sin JavaScript y el botón atrás vuelve al día anterior. Es la misma semana, presentada de a un día.
  5. **Lenguaje de estados.** Los cinco estados y su copy no cambian (DEC-041 §3): Agendada, Confirmada, Realizada, No asistió y Cancelada. Del pedido, "Pendiente" son las agendadas y las confirmadas, y "Completada" es Realizada.
     - Cada estado tiene el color de su token y además una forma propia, para que el color nunca sea la única señal (DEC-013), también en un bloque angosto: Agendada (anillo), Confirmada (punto lleno), Realizada (tilde), No asistió (alerta) y Cancelada (cruz, contorno punteado y hora tachada).
     - El resumen de la semana agrupa con la regla de los test drives del Dashboard (DEC-043 §5): **Por realizar** (agendadas + confirmadas, con su desglose), Realizadas, No asistió y Canceladas, siempre en ese orden y con el 0 atenuado. *Propuesta de implementación:* encima, un medidor segmentado de la distribución por estado, como el de Stock.
  6. **Accesibilidad y movimiento.** Radix para el drawer, el menú y la confirmación. En la grilla, cada día es una sección con su título para lectores de pantalla y sus bloques en orden de hora; el eje y los encabezados visuales se ocultan, porque cada bloque dice su hora y su estado en texto. La tira marca el día en foco con `aria-current="page"` y el título del día se anuncia al cambiar. Sin animaciones al cambiar de día o de semana: son navegaciones frecuentes.
  7. **Capas.** Dominio puro en `domains/calendar/`: `time-grid.ts` (eje, carriles, ubicación de los bloques y línea "ahora"), `agenda.ts` (minuto del día de cada prueba, día en foco y resumen por grupo), `week.ts` (día en foco y saltos de semana) y `zoned-time.ts` (`minuteOfDay()`). UI en `components/calendar/`: Server Components salvo los bloques, las tarjetas, la línea "ahora" y el drawer de alta. Sin dependencias nuevas (DEC-009).
  8. **Autorización.** Sin cambios (DEC-041 §3): cualquier membership activa ve y mueve cualquier prueba de su organización.
  9. **Fuera de este bloque:** vista mensual, vista diaria de escritorio, filtros por vendedor ("Mis pruebas"), por estado o por unidad, arrastrar un bloque para reprogramar, duración configurable, refresco automático de la agenda (más allá de la línea "ahora"), marcar las pruebas pasadas que siguen abiertas, el feed de agenda del Cockpit y todo lo que DEC-041 §7 sigue dejando fuera.
- **Aclara / supersede:**
  - DEC-041 §4: en desktop, la grilla horaria reemplaza las columnas de tarjetas; debajo de `lg`, el día en foco reemplaza "dos columnas en tablet y una lista de días en teléfono". La tarjeta, sus datos y la confirmación de cada cambio no cambian.
  - DEC-041 §7 ("vista mensual o diaria"): entra el día en foco como presentación de la semana debajo de `lg`, por pedido del fundador. La vista diaria de escritorio y la mensual siguen fuera.
  - B1 §4 ("optimización móvil más allá de razonablemente usable"): la agenda es responsiva por pedido del fundador, como la bandeja (DEC-044 §5).
  - DEC-009: sin dependencias nuevas.
  - Prevalece según DEC-002. No requiere un ADR nuevo: no hay accesos nuevos a datos.
- **Consecuencias:**
  - Sin migración: no hay nada que aplicar a staging. Requiere `0015_test_drives` aplicada (DEC-041).
  - El enlace del Dashboard (`/calendar?w=<lunes>`, DEC-043 §5) abre la semana en curso con el lunes en foco en teléfono. Si se prefiere hoy, el enlace pasa a `/calendar` (decisión del fundador).
  - Tres o más pruebas que se pisan el mismo día en el mismo rango dejan carriles angostos: el bloque recorta el texto y el detalle sigue a un toque.
  - El shell sigue siendo desktop-first (rail de 4rem): en teléfono la tira y la agenda usan el ancho que queda.

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
- **Pendiente (E3):** únicamente latencia real y topología de deployment Vercel → Supabase en la misma región, el runtime oficial por Supavisor en modo transacción (pool y serverless), la integración y las pruebas de la verificación de claims del runtime oficial de H0.6 en serverless (fetch, caché y rotación del JWKS; E2 ya validó tokens contra el JWKS real de staging), TLS `verify-full` y la credencial real de `app_runtime` en staging y en el runtime (dónde vive y cómo se rota). E3 no vuelve a validar el aislamiento. Si un resultado de E3 obliga a cambiar la decisión, se registra en el documento y se consulta al fundador.
- **Follow-ups no bloqueantes:** el test de token vencido con firma válida (A-14b) y la causa del `503 PGRST002` con la Data API deshabilitada. No son requisito para aprobar ADR-001 ni forman parte de E3.
- **Supersede:** la hipótesis y los criterios de la entrada ADR-001 del 2026-09-21 (su resultado queda en el documento, §6) y, de la Build Baseline B1 §7 ("Aislamiento de tenant"), los puntos 1 y 2 en lo que difieren. En particular, `is_member()` queda reemplazada por `private.user_org_ids()`, el patrón de referencia aprobado para H0 porque es el mecanismo validado por E1 y E2.
- **Aclara:** cierra el gate del commit 6 de la Build Baseline §9 y el punto abierto de §10. Los puntos 3 a 5 de la Build Baseline §7 siguen vigentes. El spike no cubrió el guardrail de import de `db/client` (3) ni el service role (4), y este ADR no los aprueba. Los tests obligatorios (5) se escriben en H0.
- **Consecuencias:**
  - H0 implementa esta arquitectura en `db/`: H0.4 (DEC-018) y H0.5 (DEC-019), ya en `main`. El código del spike (`spike/h0-saas-foundation`) es experimental y no se trae a `main`.
  - `CLAUDE.md` §3 se alinea con esta decisión. La Build Baseline no se reescribe: ADR-001 prevalece sobre ella en estos puntos (DEC-002).
  - Staging (actualizado el 2026-09-30): la limpieza del schema que dejó E2 ya se ejecutó y verificó, y la elección entre reset y limpieza ya no está abierta.
    - No quedan `organizations`, `profiles`, `memberships`, el enum `membership_role`, el schema `private`, el historial ni el schema experimental de Drizzle, ni el rol `app_runtime`.
    - `public` volvió al baseline limpio, con ACL y default privileges restaurados y verificados. Los objetos administrados por Supabase quedaron intactos.
    - Staging está listo para las migraciones oficiales `0000` y `0001`.

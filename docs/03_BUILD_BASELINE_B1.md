# PORANDÚ AUTOS — BUILD BASELINE B1
**Estado:** APROBADO — 21 sep 2026 (DEC-008)
**Fecha:** 21 sep 2026
**Alcance:** Hito 0 (Foundation) + Vertical Slice visual
**Autoridad:** nivel 3 según DEC-002. Subordinada a decisiones del fundador y al Decisions Log.

---

## 1. Objetivo de B1

Dejar un repositorio **ejecutable, multi-tenant y seguro**, con un **vertical slice visual navegable sobre mock data**. El slice sirve para validar jerarquía, interacción y claridad comercial antes de persistir el dominio.

B1 termina cuando el fundador puede loguearse en un tenant real y recorrer el flujo:
**Cockpit → Opportunity Workspace → Intelligence → Vehicle Rail → Offer Builder → aprobación simulada.**

---

## 2. Decisiones vigentes que aplican

| ID | Decisión | Impacto en B1 |
|---|---|---|
| DEC-001 | Nav: Cockpit / Opportunities / Stock / Conversations / Calendar / Recovery / Intelligence / Settings. Pipeline = vista de Opportunities. Ventas ≠ nav. | Define shell y rutas |
| DEC-002 | Jerarquía de autoridad | Este documento = nivel 3 |
| DEC-003 | Offer Builder v0.1 ∈ P1; mock en slice; aprobación humana obligatoria | Drawer completo con mock |
| DEC-004 | 4 scores: Porandú, Intent, Vehicle Fit, Deal Readiness | Tipos y UI con 4 scores |
| DEC-005 | Dato faltante no penaliza; cobertura/confianza separada | Tipos incluyen `coverage` |
| DEC-006 | Aislamiento de tenant en DB y en app; no queries tenant-agnostic accidentales | Mecanismo `withTenant` + RLS + lint |
| DEC-007 | Zero-Touch = P1.1. Morning Brief y PAO = futuro | Non-goals |
| DEC-009…012 | Tooling, Vercel, idioma, login email + password | §5, §6, §7 |
| ADR-001 | Principio aprobado; implementación sujeta a spike | §7, commit 6 |

---

## 3. Scope activo

### 3.1 Hito 0 — Foundation
- Repositorio, convenciones, `/docs` con las baselines y el Decisions Log.
- Next.js (App Router) + TypeScript `strict`.
- Supabase local (CLI) y proyecto de staging.
- Validación de variables de entorno al arrancar; `.env.example` sin secretos.
- **Supabase Auth** con email + password: login, logout y sesión. Magic link fuera de B1.
- Schema mínimo: `organizations`, `profiles`, `memberships (role: admin | vendedor)`.
- **RLS habilitado** en toda tabla con `organization_id`.
- **Tenant context**: la organización activa se valida contra la membership en cada request. El `organization_id` del cliente nunca se usa sin validar.
- Selector de organización cuando el usuario tiene más de una membership.
- Design tokens (dark mode elegante, glassmorphism moderado) y primitivas UI accesibles.
- Shell con Global Navigation Rail (DEC-001).
- CI con typecheck, lint, test y build.

### 3.2 Vertical Slice visual (mock data)
- **Cockpit:** Prioridad Hoy, Match Feed, Inbox SLA y Agenda. Impacto como bloque secundario. Cada tarjeta muestra persona/vehículo, motivo, recencia y CTA.
- **Opportunities:** lista simple que lleva al workspace.
- **Opportunity Workspace:** layout de 4 columnas (Nav · Memory · Intelligence · Vehicle Rail).
- **Customer / Memory Panel:**
  - cliente, estado, vendedor, prioridad;
  - badge `● En vivo`;
  - tabs Perfil / Conversación / Notas / Actividad / Campañas / Historial;
  - Current Truth con estados Detectado / Confirmado / Corregido por humano, más historial visible.
- **Intelligence Workspace:**
  - 4 scores con cobertura;
  - ¿Por qué ahora? (3–5 drivers con fuente y timestamp);
  - Talking Points (Mencionar / Validar / Evitar);
  - NBA (1 acción primaria + hasta 2 secundarias, con el porqué).
- **Vehicle Rail:**
  - Current Vehicle y Trade-In condicional (detectado / estimado / tasado / aprobado);
  - Top Match con breakdown al abrir el score, y Alternative Match;
  - Vehicle Visual Resolver mínimo con fallback neutro. Siempre muestra la etiqueta **"Representación"**.
- **Offer Builder (drawer derecho):**
  - las 8 secciones del blueprint;
  - precio publicado ≠ precio oferta;
  - cálculo de saldo como función pura testeada;
  - Deal Health;
  - Offer Card preview;
  - mensaje acompañante como texto mock;
  - **paso de aprobación humana obligatorio** y estados simulados (Borrador → Enviada).
- **Recency badges:** 🔥 <5 min · 🟢 5–30 min · 🟡 30 min–2 h · ❄️ >2 h.
- **Estado simulado en cliente:** las acciones del slice (aprobar oferta, corregir un dato) actualizan la UI y agregan una entrada en Actividad. No se persisten.

---

## 4. Non-goals de B1

**Diferido a hitos siguientes de P1:**
- persistencia de vehicles, contacts, leads, preferences, trade-ins, offers y sales;
- branches;
- Pipeline kanban, que irá como vista de Opportunities en Hito 1;
- Stock real y upload de fotos;
- WhatsApp: webhooks, envío e Inbox real;
- LLM/IA de cualquier tipo;
- cálculo real de scores y matching (en B1 los valores vienen de fixtures);
- jobs y colas;
- Agenda funcional, registro de ventas, atribución y Trade-In Loop;
- envío real de ofertas o mensajes.

**Fuera de P1 o futuro (sin cambios):** Zero-Touch, Morning Brief, PAO, Guardia 24/7, Humanized Conversation Engine, omnicanalidad y todo lo listado como fuera de alcance en el Master Context §6 y §38.

**Tampoco en B1:** entorno de producción, analytics de producto, framework i18n y optimización móvil más allá de "razonablemente usable".

Stock, Conversations, Calendar, Recovery, Intelligence y Settings existen como **rutas con empty state**. No se construye funcionalidad en ellas.

---

## 5. Stack

| Capa | Decisión | Origen |
|---|---|---|
| Framework | Next.js App Router + TypeScript strict | Aprobado |
| DB | PostgreSQL vía Supabase | Aprobado |
| Auth / Storage | Supabase Auth / Supabase Storage (Storage sin uso en B1) | Aprobado |
| ORM | Drizzle + drizzle-kit, driver `postgres` | Aprobado |
| Validación | Zod (env + tipos de borde) | Aprobado (DEC-009) |
| UI | Tailwind CSS + design tokens propios + primitivas Radix | Aprobado (DEC-009) |
| Package manager | pnpm, Node LTS (24) | Aprobado (DEC-009) |
| Tests | Vitest (unit + aislamiento de tenant), Playwright (1 smoke E2E del slice) | Aprobado (DEC-009) |
| CI | GitHub Actions | Aprobado (DEC-009) |
| Hosting staging | Vercel | Aprobado (DEC-010) |
| Error tracking | Se difiere a Hito 2 (webhooks). B1 usa un logger estructurado mínimo | Aprobado con B1 |

---

## 6. Navegación (DEC-001)

Rutas en inglés; las etiquetas visibles se muestran en español es-PY (DEC-011). El copy exacto de cada etiqueta se define en el commit 10.

| Item | Ruta | Estado en B1 |
|---|---|---|
| Cockpit | `/cockpit` (redirect desde `/`) | Slice |
| Opportunities | `/opportunities`, `/opportunities/[id]` | Slice (lista + workspace + Offer Builder) |
| Stock | `/stock` | Empty state |
| Conversations | `/conversations` | Empty state |
| Calendar | `/calendar` | Empty state |
| Recovery | `/recovery` | Empty state |
| Intelligence | `/intelligence` | Empty state |
| Settings | `/settings` | Organización y perfil (solo lectura) |

---

## 7. Arquitectura mínima

```text
porandu-autos/
├── app/
│   ├── (auth)/login/
│   ├── (app)/                  # layout: shell + auth guard + tenant context
│   │   ├── cockpit/
│   │   ├── opportunities/[id]/ # Workspace + Offer Builder drawer
│   │   ├── stock/  conversations/  calendar/
│   │   ├── recovery/  intelligence/  settings/
│   └── api/                    # vacío en B1
├── components/
│   ├── ui/                     # primitivas + tokens
│   ├── shell/  cockpit/  workspace/
│   ├── intelligence/  vehicle-rail/  offer-builder/
├── domains/                    # tipos + lógica pura, sin React ni DB
│   ├── organizations/  opportunities/  memory/
│   ├── scoring/                # tipos de 4 scores + coverage (sin cálculo)
│   ├── vehicles/  offers/      # offers: cálculo de saldo (puro, testeado)
├── db/
│   ├── schema/  migrations/    # drizzle-kit + SQL custom para RLS
│   ├── client.ts               # server-only, NO exportado fuera de db/
│   └── tenant.ts               # withTenant(ctx, fn): única puerta de acceso
├── mocks/                      # fixtures tipados con tipos de domains/
├── lib/  env.ts  auth/  logger.ts
├── tests/  unit/  tenant/  e2e/
└── docs/  00_MASTER_CONTEXT.md … 05_DECISIONS_LOG.md (ver README)
```

### Reglas
- Código, rutas, DB e identificadores en inglés. Copy visible de UI en español es-PY (DEC-011).
- `domains/` no importa React, Next ni `db/`.
- Las páginas acceden a datos solo mediante loaders por dominio (`domains/*/queries.ts`). En B1 esos loaders leen `mocks/`; en Hito 1 pasarán a leer `withTenant`. No se agrega un patrón repository.
- Un único origen de migraciones: `db/migrations`.

### Aislamiento de tenant (DEC-006) — ADR-001

**Estado:** el principio (aislamiento en DB + aplicación) está aprobado. La implementación descrita abajo es la **hipótesis del spike** del commit 6. No se congela como patrón hasta que los tests reales pasen y el resultado quede registrado en ADR-001.
1. **DB:** RLS en cada tabla tenant-scoped. Las policies usan `is_member(organization_id)`, basada en `auth.uid()` y `memberships`.
2. **App:** toda query pasa por `withTenant(ctx, fn)`. Esta función abre una transacción que:
   - hace `set local role authenticated`;
   - inyecta los claims JWT de la sesión, para que RLS aplique también vía Drizzle;
   - recibe la organización activa ya validada contra la membership.
3. **Guardrail:** una regla ESLint `no-restricted-imports` impide importar `db/client` fuera de `db/`.
4. **Service role:** reservado para webhooks y jobs futuros, en un módulo server-only separado, con `organization_id` explícito. Queda prohibido en código de UI.
5. **Test obligatorio:** con dos organizaciones, el usuario A no puede leer ni escribir datos de B. Otro test verifica que toda tabla con `organization_id` tenga RLS habilitado.

---

## 8. Definition of Done de B1

**Foundation**
- [ ] Desde un clone limpio, el README permite levantar todo en local (install → supabase start → migrate → dev).
- [ ] CI verde: typecheck, lint, unit tests, build.
- [ ] Login real. Un usuario sin membership no accede a `(app)`. El selector de organización funciona.
- [ ] Tests de aislamiento de tenant y de RLS en verde. El import directo de `db/client` falla en lint.
- [ ] El repo no contiene secretos. `.env.example` está completo.
- [ ] Staging operativo (Supabase + Vercel).

**Vertical Slice**
- [ ] El shell muestra los 8 ítems con estado activo. Desktop y tablet correctos; teléfono usable.
- [ ] El recorrido completo funciona sin errores: Cockpit → tarjeta → Workspace → breakdown de match → "Construir oferta" → Offer Builder → aprobar → estado "Enviada" (simulado) → entrada en Actividad.
- [ ] Se ven los 4 scores con cobertura. Los datos faltantes se muestran como "sin dato" y no bajan el score.
- [ ] Current Truth muestra valor vigente, estado e historial.
- [ ] Toda imagen del workspace está etiquetada como "Representación".
- [ ] Ninguna oferta cambia a "Enviada" sin pasar por el paso de aprobación.
- [ ] El cálculo de saldo del Offer Builder está cubierto por unit tests.
- [ ] Smoke E2E del recorrido en verde.
- [ ] `docs/05_DECISIONS_LOG.md` contiene DEC-001…012 y ADR-001 con el resultado del spike.
- [ ] ADR-001 pasa de "implementación en validación" a "aceptado" (o se registra el patrón alternativo).

---

## 9. Orden de commits

1. `chore: init repo, README, docs/ (baselines, B1, decisions log)`
2. `chore: scaffold Next.js + TS strict, pnpm, ESLint, Prettier`
3. `ci: typecheck, lint, test, build`
4. `chore(env): env validation + .env.example`
5. `feat(db): Supabase local + Drizzle + organizations/profiles/memberships`
6. `spike(tenant): RLS + is_member() + withTenant() — validar ADR-001 con tests reales` → **gate: no seguir sin resultado registrado**
7. `test(tenant): isolation + RLS coverage tests (patrón definitivo) + lint guard`
8. `feat(auth): login, session, org selection, (app) guard`
9. `feat(ui): design tokens + base primitives`
10. `feat(shell): navigation rail + empty states` → **checkpoint 1: revisión de Foundation**
11. `feat(mocks): domain types (4 scores, coverage, current truth) + fixtures`
12. `feat(cockpit): priority, match feed, SLA, agenda`
13. `feat(workspace): 4-column layout + Memory panel`
14. `feat(intelligence): scores, why now, talking points, NBA`
15. `feat(vehicle-rail): current, trade-in, top match, breakdown, alternative, visual resolver`
16. `feat(offer-builder): drawer, calc, deal health, preview, approval gate, simulated states`
17. `test(e2e): slice smoke` → **checkpoint 2: validación de UX con el fundador**
18. `chore(deploy): staging en Vercel`

---

## 10. Puntos abiertos

Ninguno bloqueante. El resultado del spike ADR-001 es el único gate técnico abierto dentro de B1.

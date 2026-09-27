# PORANDÚ AUTOS — VISUAL & PRODUCT DESIGN BLUEPRINT v0.1
**Fecha:** 12 sep 2026  
**Estado:** baseline aprobada para handoff a prototipo/código.

---

## 0. Visión de esta etapa
Porandú debe diseñarse primero como sistema vivo antes de programarse. El vendedor no debería pasar el día cargando CRM; Porandú observa las conversaciones, estructura la información, mantiene memoria, prioriza oportunidades, recomienda vehículos y prepara acciones/ofertas.

### Loop principal
**Detectar → Priorizar → Entender → Recomendar → Construir oferta → Actuar → Medir → Aprender**

### Principio rector
**Cada elemento de la interfaz debe justificar una decisión comercial.**

---

## 1. Opportunity Workspace

Arquitectura de escritorio:

```text
┌──────┬────────────────────┬───────────────────────────────────┬────────────────────┐
│ NAV  │ MEMORY / CLIENTE   │ INTELLIGENCE WORKSPACE            │ VEHICLE RAIL       │
│      │                    │                                   │                    │
│      │                    │ Scores                            │ Current Vehicle    │
│      │                    │ Why Now                           │                    │
│      │                    │ Talking Points                    │ Top Match          │
│      │                    │ Next Best Action                  │                    │
│      │                    │                                   │ Alternative        │
└──────┴────────────────────┴───────────────────────────────────┴────────────────────┘
```

### Navegación global
Cockpit · Opportunities · Stock · Conversations · Calendar · Recovery · Intelligence · Settings.

### Customer / Memory Panel
Siempre visible:
- cliente;
- estado comercial;
- vendedor;
- score;
- WhatsApp `● En vivo` con punto verde cuando hay conversación activa;
- accesos: Perfil, Conversación, Notas, Actividad, Campañas, Historial.

### Conversación vs Actividad
- Conversación = qué se dijo.
- Actividad = qué ocurrió/cambió en el sistema.

---

## 2. Porandú Memory + automatización

### Regla central
El vendedor corrige; no carga.

```text
WHATSAPP
   ↓
Interpretación
   ↓
Extracción estructurada
   ↓
Porandú Memory
   ↓
Stock / Scores / Match
   ↓
UI actualizada
```

### Current Truth
Cada dato mantiene:
- valor vigente;
- historial;
- fuente;
- timestamp;
- estado.

Estados:
- Detectado
- Confirmado
- Corregido por humano

Una corrección humana confirmada tiene prioridad frente a inferencias posteriores dudosas.

---

## 3. Intelligence Workspace

### Cuatro scores

```text
PORANDÚ        INTENT        VEHICLE FIT        DEAL
   88             92              91             79
```

#### Porandú Score
Prioridad comercial general. Fórmula conceptual inicial:
- Intent 40%
- Vehicle Fit 30%
- Deal 30%

#### Intent
Qué tan seriamente parece querer comprar/cambiar ahora.

Escala:
- 0–39 Exploratorio
- 40–64 Interés
- 65–79 Qualified Intent
- 80–89 High Intent
- 90–100 Buying Window

#### Vehicle Fit
Qué tan bien encaja stock con preferencias/constraints.

Falta de información no es penalización.

#### Deal Readiness
Qué tan viable está convertir la intención en operación.

### Reglas
Todos los scores:
- explicables;
- trazables;
- reversibles;
- dinámicos.

### ¿Por qué ahora?
Máximo 3–5 drivers fuertes, por ejemplo:
- compra este mes;
- presupuesto confirmado;
- trade-in detectado;
- pregunta de financiación reciente.

### Talking Points
- Bueno para mencionar
- Validar
- Evitar / No asumir

### Next Best Action
1 acción primaria + hasta 2 secundarias.
Debe decir **qué hacer y por qué**.

---

## 4. Vehicle Rail

Objetivo: mostrar qué tiene el cliente, qué venderle y cuál es la alternativa.

### Current Vehicle
Representación genérica del modelo/año/color + kilometraje si existe.

### Trade-In
Se activa solo si hay intención de entregar el auto.
Distinguir valor estimado de aprobado.

### Top Match
Tarjeta protagonista:
- Match %;
- representación genérica;
- modelo/año;
- precio;
- km/transmisión;
- hasta 3 razones de match;
- cuota estimada si aplica;
- CTA `Construir oferta`;
- `Ver unidad real`.

### Imágenes
- Opportunity Workspace: representación genérica/de catálogo.
- Stock: fotos reales.

### Vehicle Visual Resolver
Marca + modelo + generación/año + color → asset visual adecuado con fallbacks.

### Alternative Match
Una tarjeta secundaria + acceso a más alternativas/comparación.

### Match bidireccional
- Lead → Stock
- Stock → Leads

Cuando cambia presupuesto/preferencia o entra stock nuevo, el ranking se recalcula y Activity registra por qué.

---

## 5. Offer Builder

### Objetivo
Convertir contexto comercial ya conocido en propuesta lista para revisar/enviar en 30–60 segundos.

### Apertura
Drawer grande desde la derecha, manteniendo el Opportunity Workspace visible.

### Estructura
1. Vehículo
2. Trade-In
3. Estructura económica
4. Financiación si aplica
5. Deal Health
6. Preview / Offer Card
7. Mensaje acompañante
8. Acción final

### Vehículo
Mostrar precio publicado y precio oferta como valores distintos.

### Trade-In
Mostrar estado, estimación y valor aprobado por separado.

### Estructura económica
Contado / financiación / mixto.

Ejemplo:

```text
PRECIO VEHÍCULO            USD 21.900
Trade-In Auris            - USD 8.000
Entrega adicional         - USD 5.000
                           ────────────
SALDO A FINANCIAR           USD 8.900
```

### Goal Seek
Si existe cuota objetivo, Porandú intenta estructurar una operación compatible o recomienda otra unidad.

### Deal Health
No es score global; indica qué tan completa/cerrable está la oferta.

### Preview
Offer Card clara, visual y compartible. WhatsApp es el canal principal; PDF no es protagonista.

### Mensaje
Porandú redacta el texto que acompaña la oferta. Más adelante usa Style Profile por asesor.

### Human Approval
En P1, ofertas económicas requieren aprobación humana antes del envío.

### Estados
Borrador → Enviada → Vista → En negociación → Aceptada/Rechazada (+ Expirada si aplica).

### Negociación viva
Contraofertas/objeciones se detectan y se conservan en historial; no sobrescribir silenciosamente.

---

## 6. Futuro — Humanized Conversation Engine

Style Profile por asesor:
- vocabulario;
- formalidad;
- longitud;
- emojis;
- saludos/cierres;
- ritmo.

Pacing natural:
- “escribiendo…” mientras se prepara respuesta;
- pausas razonables;
- mensajes divididos cuando sea natural.

Mantener uso legítimo de estos indicadores, sin diseñar trucos cuyo objetivo sea afirmar falsamente que un humano está escribiendo manualmente.

---

## 7. Futuro — Morning / Overnight Autonomous Opportunity Brief

Visión:
> El jefe abre Porandú por la mañana y encuentra trabajo comercial ya avanzado automáticamente.

Podría mostrar:
- oportunidades calientes nuevas;
- leads reactivados;
- respuestas a ofertas;
- compradores potenciales detectados;
- matches nuevos por stock ingresado;
- seguimientos preparados;
- borradores listos para revisar.

Ejemplo conceptual:

```text
BUEN DÍA — Porandú trabajó mientras estabas fuera

5 nuevas oportunidades calientes
3 leads reactivados
2 clientes respondieron ofertas
1 unidad nueva tiene 7 compradores potenciales
4 seguimientos listos para revisar

[ Revisar prioridades ]
```

Regla: automatizar trabajo comercial no implica comprometer condiciones económicas sin permisos/aprobación.

---

## 8. Próxima etapa de diseño
**WhatsApp / Conversation Intelligence Experience** — pausada hasta reanudar explícitamente.

## 9. Orden de construcción recomendado
1. Shell y navegación
2. Opportunity Workspace estático
3. Customer Memory Panel
4. Intelligence Workspace
5. Vehicle Rail
6. Offer Builder drawer
7. Fixtures/mock data
8. State engine simulado
9. Stock real / galería
10. Integración WhatsApp real después de validar visual y flujos

## 10. Principios de ingeniería para handoff
- No acoplar diseño a un proveedor de IA.
- Separar UI de scoring/matching.
- Mantener trazabilidad de scores.
- Current Truth conserva historial.
- Representación genérica ≠ foto real de stock.
- Cambios se modelan como eventos cuando tenga sentido.
- No inventar funciones fuera del blueprint sin marcarlas como propuestas.
